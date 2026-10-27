import * as SecureStore from 'expo-secure-store';
import { AIMessage, DosageForm } from '../types';
import { ocrService, ExtractedMedicineData } from './ocrService';

/**
 * Real AI assistant backend (Google Gemini REST API).
 *
 * The assistant is strictly educational: label terminology, dosage forms,
 * packaging symbols, storage, active-ingredient concepts. The system prompt
 * forbids personalized medical advice (doses, symptom triage, interactions,
 * treatment changes) and the offline fallback does the same, so the guardrail
 * holds both with and without a network connection.
 */

const KEY_STORE_NAME = 'gemini_api_key';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
// Use a stable model ID. A "latest" alias may move between model versions.
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const FALLBACK_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-2.5-flash-lite'];
const GEMINI_MODELS_TO_TRY = [DEFAULT_MODEL, ...FALLBACK_MODELS];
const MAX_HISTORY_TURNS = 12; // keep requests bounded; persistence holds more

const KEY_REJECTION_HELP =
  'Google rejected this API key. Google now rejects unrestricted standard keys. Create a new key in Google AI Studio and reconnect it. If the new key still fails, check the project status, API access, and key restrictions.';

async function readGeminiErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string; status?: string };
    };
    return body?.error?.message?.trim() || body?.error?.status?.trim() || '';
  } catch {
    return '';
  }
}

function isInvalidGeminiApiKeyMessage(message: string): boolean {
  return /api[_\s-]?key.{0,60}(invalid|not valid|reported as leaked|blocked|disabled)|(?:invalid|not valid|reported as leaked|blocked|disabled).{0,60}api[_\s-]?key|API_KEY_INVALID/i.test(
    message,
  );
}

function classifyGeminiError(status: number, detail = ''): { code: string; message: string } {
  if (status === 401 || isInvalidGeminiApiKeyMessage(detail)) {
    return { code: 'BAD_KEY', message: KEY_REJECTION_HELP };
  }
  if (status === 403) {
    return {
      code: 'ACCESS_DENIED',
      message: detail
        ? `Google denied access to Gemini: ${detail}. Check the Google AI Studio project status, API access, and key restrictions.`
        : 'Google denied access to Gemini. Check the Google AI Studio project status, API access, and key restrictions.',
    };
  }
  if (status === 429) {
    return {
      code: 'RATE_LIMIT',
      message: 'Gemini rate limit reached. Wait a little and try again.',
    };
  }
  return {
    code: 'HTTP_ERROR',
    message: detail || `Gemini API error ${status}.`,
  };
}

export const MEDICATION_GUARDRAIL_SYSTEM_PROMPT = [
  'You are the medication educator inside HealthMate, a personal medication organizer app.',
  'Your ONLY scope is general education about medicine packaging and terminology:',
  'how to read a label (name, strength, dosage form, batch/lot numbers, expiry formats),',
  'what active ingredients and generic vs. brand names mean, dosage forms (tablet, capsule, softgel, eye drop, syrup, cream),',
  'storage symbols and instructions, counting doses, and how prescriptions/labels are printed.',
  '',
  'Hard rules:',
  '- NEVER give personalized medical advice: no recommended or adjusted doses for the user,',
  '  no assessment of symptoms, no drug-interaction judgments, no advice to start, stop, or change any medicine.',
  '- If a question seeks any of that, answer ONLY with a short, kind refusal that points to the',
  "  patient leaflet, a pharmacist, or the prescriber. If overdose or severe symptoms are mentioned,",
  '  direct the user to urgent local medical help.',
  '- Do not invent drug facts. General educational content only; no product-name claims that you cannot verify.',
  '- Keep answers short (under 180 words), plain-language, and validating of "confirm with your pharmacist".',
  '- Match the language the user writes in (Bengali, Hindi, English, or other).',
  '- Never present yourself as a clinician, and never say "I recommend medicine X".',
].join('\n');

export interface GeminiTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface GeminiAnswer {
  text: string;
  model: string;
  usedNetwork: boolean;
}

export const aiAssistantService = {
  /** Reads the stored key once and caches it for the session. */
  _cachedKey: null as string | null | undefined,

  async getApiKey(): Promise<string | null> {
    if (this._cachedKey !== undefined) return this._cachedKey ?? null;
    try {
      const storedKey = await SecureStore.getItemAsync(KEY_STORE_NAME);
      this._cachedKey = storedKey;
      return storedKey ?? null;
    } catch {
      // Do not cache a storage failure as "no key". A later read may succeed.
      this._cachedKey = undefined;
      throw Object.assign(
        new Error('HealthMate could not read the saved Gemini key securely. Reopen AI setup and try again.'),
        { code: 'SECURE_STORE_READ' },
      );
    }
  },

  async saveApiKey(key: string): Promise<void> {
    const trimmed = key.trim();
    if (!trimmed) {
      await this.deleteApiKey();
      return;
    }

    try {
      await SecureStore.setItemAsync(KEY_STORE_NAME, trimmed);
      const persistedKey = await SecureStore.getItemAsync(KEY_STORE_NAME);
      if (persistedKey !== trimmed) {
        throw new Error('Secure storage did not return the saved key.');
      }
      this._cachedKey = persistedKey;
    } catch {
      // Never tell the UI the key was connected unless it was stored and read back.
      this._cachedKey = undefined;
      throw new Error(
        'HealthMate could not save the Gemini key securely. Check device storage and try again.',
      );
    }
  },

  async deleteApiKey(): Promise<void> {
    this._cachedKey = null;
    try {
      await SecureStore.deleteItemAsync(KEY_STORE_NAME);
    } catch {
      this._cachedKey = undefined;
      throw new Error(
        'HealthMate could not remove the saved Gemini key. Please try again.',
      );
    }
  },

  async _clearRejectedApiKey(): Promise<void> {
    try {
      await this.deleteApiKey();
    } catch {
      // Keep this session disconnected even if the OS secure-store deletion fails.
      this._cachedKey = null;
      console.warn('Could not remove a rejected Gemini API key from secure storage.');
    }
  },

  /**
   * Maps persisted chat history (most recent first in caller order) into
   * Gemini contents, bounded to MAX_HISTORY_TURNS recent non-empty turns.
   */
  buildContents(
    history: Pick<AIMessage, 'role' | 'content'>[],
    prompt: string,
  ): GeminiTurn[] {
    const usable = history
      .filter(
        (m) =>
          (m.role === 'user' || m.role === 'assistant') && m.content.trim(),
      )
      .slice(-MAX_HISTORY_TURNS);
    usable.push({ role: 'user', content: prompt });
    return usable.map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      text: m.content,
    }));
  },

  /** Validates the response body shape rather than trusting it. */
  extractAnswerText(body: unknown): string | null {
    try {
      const data = body as {
        candidates?: {
          content?: {
            parts?: Array<{ text?: string }>;
            role?: string;
          };
          finishReason?: string;
        }[];
      };
      const parts = data?.candidates?.[0]?.content?.parts ?? [];
      const joined = parts
        .map((p) => p.text)
        .filter((t): t is string => typeof t === 'string' && t.length > 0)
        .join(' ')
        .trim();
      return joined.length > 0 ? joined : null;
    } catch {
      return null;
    }
  },

  /**
   * Calls Gemini generateContent. Throws typed errors the caller can map to
   * user-facing copy; the assistant screen falls back to the offline guide.
   */
  async askGemini(
    prompt: string,
    history: Pick<AIMessage, 'role' | 'content'>[] = [],
    options: { apiKey?: string; model?: string; timeoutMs?: number } = {},
  ): Promise<GeminiAnswer> {
    const apiKey = options.apiKey ?? (await this.getApiKey());
    if (!apiKey) {
      throw Object.assign(new Error('No Gemini API key configured.'), {
        code: 'NO_KEY',
      });
    }

    const requestedModel = options.model ?? DEFAULT_MODEL;
    const modelsToTry = [
      requestedModel,
      ...FALLBACK_MODELS.filter((model) => model !== requestedModel),
    ];
    const contents = this.buildContents(history, prompt);
    const body = {
      systemInstruction: {
        parts: [{ text: MEDICATION_GUARDRAIL_SYSTEM_PROMPT }],
      },
      contents: contents.map((turn) => ({
        role: turn.role,
        parts: [{ text: turn.text }],
      })),
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 512,
      },
    };

    const timeoutMs = options.timeoutMs ?? 20000;
    let lastModelError = '';

    for (const model of modelsToTry) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(`${API_BASE}/models/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (response.status === 404) {
          lastModelError = await readGeminiErrorMessage(response);
          continue;
        }

        if (!response.ok) {
          const detail = await readGeminiErrorMessage(response);
          const mapped = classifyGeminiError(response.status, detail);
          if (mapped.code === 'BAD_KEY') {
            await this._clearRejectedApiKey();
          }
          throw Object.assign(new Error(mapped.message), {
            code: mapped.code,
            status: response.status,
          });
        }

        const answerText = this.extractAnswerText(await response.json());
        if (!answerText) {
          throw Object.assign(new Error('Gemini returned an empty answer.'), {
            code: 'EMPTY_ANSWER',
          });
        }

        return { text: answerText, model, usedNetwork: true };
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') {
          throw Object.assign(new Error('Gemini request timed out.'), {
            code: 'TIMEOUT',
          });
        }
        if ((error as { code?: string })?.code) throw error;
        // Fail fast on transport errors instead of hammering multiple models
        // while offline. Model fallback is only for an explicit 404 response.
        throw Object.assign(error as Error, { code: 'NETWORK' });
      } finally {
        clearTimeout(timer);
      }
    }

    throw Object.assign(
      new Error(
        lastModelError
          ? `No configured Gemini model was available: ${lastModelError}`
          : 'No configured Gemini model was available for this API key.',
      ),
      { code: 'MODEL_UNAVAILABLE' },
    );
  },

  /**
   * Verifies a Gemini API key by making a lightweight test ping to the API.
   */
  async verifyApiKey(key: string): Promise<{ valid: boolean; error?: string }> {
    const trimmed = key.trim();
    if (!trimmed) {
      return { valid: false, error: 'Please enter a Gemini API key.' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    try {
      for (const model of GEMINI_MODELS_TO_TRY) {
        const response = await fetch(
          `${API_BASE}/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': trimmed,
            },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
              generationConfig: { maxOutputTokens: 2 },
            }),
            signal: controller.signal,
          },
        );

        if (response.ok) return { valid: true };

        const detail = await readGeminiErrorMessage(response);
        if (response.status === 404) continue;

        const mapped = classifyGeminiError(response.status, detail);
        if (mapped.code === 'BAD_KEY' || mapped.code === 'ACCESS_DENIED' || mapped.code === 'RATE_LIMIT') {
          return { valid: false, error: mapped.message };
        }
        return {
          valid: false,
          error: detail
            ? `Gemini verification failed: ${detail}`
            : `Gemini API returned status ${response.status}.`,
        };
      }

      return {
        valid: false,
        error: 'Google did not expose a supported Gemini model to this key. Check the project and API access in Google AI Studio.',
      };
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        return {
          valid: false,
          error: 'Verification timed out. Check your internet connection and try again.',
        };
      }
      return {
        valid: false,
        error: 'Could not reach Gemini. Check your internet connection and retry.',
      };
    } finally {
      clearTimeout(timer);
    }
  },

  /**
   * Interprets raw OCR text from medicine packaging using the user's personal
   * Gemini AI to accurately identify medicine name, strength, form, batch, and expiry.
   */
  async parseMedicinePackagingWithAI(
    rawOcrText: string
  ): Promise<ExtractedMedicineData> {
    const baseExtraction = ocrService.extractMedicineData(rawOcrText);
    const apiKey = await this.getApiKey();
    if (!apiKey || !rawOcrText.trim()) {
      return baseExtraction;
    }

    const systemPrompt = [
      'You are a precision pharmaceutical OCR interpreter for HealthMate.',
      'Given messy raw OCR text extracted from a medication label, bottle, blister pack, or box packaging:',
      'Analyze the full text context to accurately identify the pharmaceutical fields.',
      'Intelligently deduce what is the brand name versus generic active ingredients without requiring pre-split tokens.',
      '',
      'JSON Schema:',
      '{',
      '  "medicineName": "Commercial brand name (e.g. Augmentin, Lipitor, Tylenol, Dolo 650, Panadol)",',
      '  "genericName": "Active salt/ingredient name (e.g. Amoxicillin and Clavulanate Potassium, Atorvastatin, Acetaminophen, Paracetamol)",',
      '  "detectedStrength": "Strength with unit (e.g. 625 mg, 500mg, 10mg/5ml, 0.5% w/v)",',
      '  "dosageForm": "One of: tablet, capsule, softgel, eye_drop, syrup, injection, cream, other",',
      '  "manufacturer": "Pharmaceutical manufacturing company (e.g. GlaxoSmithKline, Pfizer, Cipla, Sun Pharma)",',
      '  "batchNumber": "Batch or Lot number if present (e.g. B12345, Lot 982A)",',
      '  "expiryDate": "Expiration date formatted as MM/YYYY or Month YYYY (e.g. 12/2027)"',
      '}',
      '',
      'Rules:',
      '- Fix obvious OCR character/digit confusions (e.g. "Tab1et" -> "tablet", "Paracetamo1" -> "Paracetamol", "5OOmg" -> "500mg", "DU0" -> "DUO").',
      '- If brand name and generic name are identical (e.g. unbranded generic Paracetamol 500mg), set both fields.',
      '- Return ONLY valid JSON, with NO markdown backticks or commentary.',
    ].join('\n');

    const modelsToTry = GEMINI_MODELS_TO_TRY;
    let lastPackagingParseError: unknown = null;
    let lastModelError = '';

    for (const model of modelsToTry) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);

        let response: Response;
        try {
          response = await fetch(
            `${API_BASE}/models/${model}:generateContent`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey,
              },
              body: JSON.stringify({
                systemInstruction: {
                  parts: [{ text: systemPrompt }],
                },
                contents: [
                  {
                    role: 'user',
                    parts: [
                      {
                        text: `Raw OCR text from medication packaging:\n\n${rawOcrText}`,
                      },
                    ],
                  },
                ],
                generationConfig: {
                  temperature: 0.1,
                  responseMimeType: 'application/json',
                  maxOutputTokens: 512,
                },
              }),
              signal: controller.signal,
            }
          );
        } catch (error) {
          if ((error as { name?: string })?.name === 'AbortError') {
            throw Object.assign(
              new Error('Gemini packaging interpretation timed out.'),
              { code: 'TIMEOUT' },
            );
          }
          throw Object.assign(
            new Error('Could not reach Gemini to interpret this medicine label.'),
            { code: 'NETWORK' },
          );
        } finally {
          clearTimeout(timer);
        }

        if (!response.ok) {
          const detail = await readGeminiErrorMessage(response);
          if (response.status === 404) {
            lastModelError = detail;
            continue;
          }
          const mapped = classifyGeminiError(response.status, detail);
          if (mapped.code === 'BAD_KEY') {
            await this._clearRejectedApiKey();
          }
          throw Object.assign(new Error(mapped.message), {
            code: mapped.code,
            status: response.status,
          });
        }

        const data = await response.json();
        const answerText = this.extractAnswerText(data);
        if (!answerText) {
          throw Object.assign(
            new Error('Gemini returned an empty packaging interpretation.'),
            { code: 'EMPTY_ANSWER' },
          );
        }

        const cleanJson = answerText
          .replace(/```json/gi, '')
          .replace(/```/g, '')
          .trim();
        const parsed = JSON.parse(cleanJson);

        const resolvedMedName =
          parsed.medicineName?.trim() ||
          parsed.genericName?.trim() ||
          baseExtraction.medicineName;
        const resolvedGenName =
          parsed.genericName?.trim() ||
          parsed.medicineName?.trim() ||
          baseExtraction.genericName;

        return {
          medicineName: resolvedMedName,
          genericName: resolvedGenName,
          detectedStrength:
            parsed.detectedStrength?.trim() || baseExtraction.detectedStrength,
          dosageForm:
            normalizeDosageForm(parsed.dosageForm) ||
            baseExtraction.dosageForm ||
            'tablet',
          manufacturer:
            parsed.manufacturer?.trim() || baseExtraction.manufacturer,
          batchNumber: parsed.batchNumber?.trim() || baseExtraction.batchNumber,
          expiryDate: parsed.expiryDate?.trim() || baseExtraction.expiryDate,
          rawText: rawOcrText,
          // Gemini output helps extract fields, but its confidence is not
          // calibrated. Preserve the dictionary OCR score instead of inventing
          // a 98-99% match for an AI-generated guess.
          isHighConfidence: baseExtraction.isHighConfidence ?? false,
          confidenceScore: baseExtraction.confidenceScore,
          candidates: baseExtraction.candidates,
        };
      } catch (err) {
        if ((err as { code?: string })?.code) throw err;
        console.warn(`Gemini packaging parse on model ${model} failed:`, err);
        lastPackagingParseError = err;
      }
    }

    if (lastPackagingParseError) {
      throw Object.assign(
        new Error('Gemini could not return a reliable structured interpretation. Review the OCR fields manually.'),
        { code: 'AI_PARSE' },
      );
    }
    if (lastModelError || modelsToTry.length > 0) {
      throw Object.assign(
        new Error(
          lastModelError
            ? `No configured Gemini model was available: ${lastModelError}`
            : 'No configured Gemini model was available for packaging interpretation.',
        ),
        { code: 'MODEL_UNAVAILABLE' },
      );
    }

    return baseExtraction;
  },
};

function normalizeDosageForm(form?: string): DosageForm {
  if (!form) return 'tablet';
  const lower = form.toLowerCase().trim();
  if (
    lower.includes('tablet') ||
    lower.includes('tab') ||
    lower.includes('pill')
  ) {
    return 'tablet';
  }
  if (lower.includes('capsule') || lower.includes('cap')) {
    return 'capsule';
  }
  if (lower.includes('softgel') || lower.includes('gel cap')) {
    return 'softgel';
  }
  if (
    lower.includes('eye drop') ||
    lower.includes('ophthalmic') ||
    lower.includes('eye_drop')
  ) {
    return 'eye_drop';
  }
  if (
    lower.includes('syrup') ||
    lower.includes('liquid') ||
    lower.includes('suspension') ||
    lower.includes('solution') ||
    lower.includes('elixir')
  ) {
    return 'syrup';
  }
  if (
    lower.includes('injection') ||
    lower.includes('injectable') ||
    lower.includes('vial') ||
    lower.includes('ampoule')
  ) {
    return 'injection';
  }
  if (
    lower.includes('cream') ||
    lower.includes('ointment') ||
    lower.includes('gel') ||
    lower.includes('lotion')
  ) {
    return 'cream';
  }
  return 'other';
}
