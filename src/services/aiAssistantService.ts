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
const DEFAULT_MODEL = 'gemini-flash-lite-latest';
const MAX_HISTORY_TURNS = 12; // keep requests bounded; persistence holds more

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
      this._cachedKey = await SecureStore.getItemAsync(KEY_STORE_NAME);
      return this._cachedKey ?? null;
    } catch {
      return null;
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
      this._cachedKey = trimmed;
    } catch (error) {
      console.warn('Could not store Gemini API key:', error);
    }
  },

  async deleteApiKey(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(KEY_STORE_NAME);
    } catch {
      // ignore
    }
    this._cachedKey = null;
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
    const apiKey =
      options.apiKey ??
      (await this.getApiKey()) ??
      (undefined as unknown as string);
    if (!apiKey) {
      throw Object.assign(
        new Error('No Gemini API key configured.'),
        { code: 'NO_KEY' },
      );
    }

    const model = options.model ?? DEFAULT_MODEL;
    const contents = this.buildContents(history, prompt);
    const body = {
      systemInstruction: {
        parts: [{ text: MEDICATION_GUARDRAIL_SYSTEM_PROMPT }],
      },
      contents: contents.map((t) => ({
        role: t.role,
        parts: [{ text: t.text }],
      })),
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 512,
      },
    };

    const timeoutMs = options.timeoutMs ?? 20000;
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

      if (response.status === 401 || response.status === 403) {
        throw Object.assign(
          new Error('Gemini rejected the API key.'),
          { code: 'BAD_KEY' },
        );
      }
      if (response.status === 429) {
        throw Object.assign(new Error('Rate limited.'), { code: 'RATE_LIMIT' });
      }
      if (!response.ok) {
        throw Object.assign(
          new Error(`Gemini API error ${response.status}`),
          { code: 'HTTP_ERROR', status: response.status },
        );
      }

      const answerText = this.extractAnswerText(await response.json());
      if (!answerText) {
        throw Object.assign(
          new Error('Gemini returned an empty answer.'),
          { code: 'EMPTY_ANSWER' },
        );
      }
      return { text: answerText, model, usedNetwork: true };
    } catch (error) {
      if ((error as { name?: string }).name === 'AbortError') {
        throw Object.assign(new Error('Gemini request timed out.'), {
          code: 'TIMEOUT',
        });
      }
      if (!(error as { code?: string })?.code) {
        // Transport-level failure (offline, DNS, TLS): categorize it so the
        // screen can show its offline-guide fallback copy.
        throw Object.assign(error as Error, { code: 'NETWORK' });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
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
    const timer = setTimeout(() => controller.abort(), 10000);
    const modelsToTry = [
      DEFAULT_MODEL,
      'gemini-2.0-flash-lite',
      'gemini-2.5-flash',
      'gemini-1.5-flash',
    ];

    try {
      for (const model of modelsToTry) {
        try {
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
            }
          );

          if (response.ok) {
            return { valid: true };
          }
          if (
            response.status === 400 ||
            response.status === 401 ||
            response.status === 403
          ) {
            return {
              valid: false,
              error: 'Invalid API key. Please check your key from Google AI Studio.',
            };
          }
          if (response.status === 429) {
            return {
              valid: false,
              error: 'Rate limit exceeded on Google AI Studio. Please try again shortly.',
            };
          }
          if (response.status === 404) {
            continue;
          }
          return {
            valid: false,
            error: `Gemini API returned status ${response.status}.`,
          };
        } catch (innerErr: any) {
          if (innerErr?.name === 'AbortError') throw innerErr;
          continue;
        }
      }
      return {
        valid: false,
        error: 'Verification failed. Could not reach Gemini models.',
      };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return {
          valid: false,
          error: 'Verification timed out. Check your internet connection.',
        };
      }
      return {
        valid: false,
        error: 'Network error. Please check your internet connection.',
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

    const modelsToTry = [
      DEFAULT_MODEL,
      'gemini-2.0-flash-lite',
      'gemini-2.5-flash',
      'gemini-1.5-flash',
    ];

    for (const model of modelsToTry) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);

        const response = await fetch(
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

        clearTimeout(timer);

        if (!response.ok) {
          if (response.status === 404) continue;
          break;
        }

        const data = await response.json();
        const answerText = this.extractAnswerText(data);
        if (!answerText) break;

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
          isHighConfidence: Boolean(resolvedMedName || resolvedGenName),
          confidenceScore: 0.98,
          candidates: (resolvedMedName || resolvedGenName)
            ? [
                {
                  name: resolvedMedName || resolvedGenName || '',
                  genericName: resolvedGenName || resolvedMedName || '',
                  isBrand: Boolean(
                    parsed.medicineName &&
                      parsed.genericName &&
                      parsed.medicineName.toLowerCase() !==
                        parsed.genericName.toLowerCase()
                  ),
                  score: 0.99,
                  isExact: true,
                  originalText: parsed.medicineName || parsed.genericName || '',
                },
              ]
            : baseExtraction.candidates,
        };
      } catch (err) {
        console.warn(`Gemini packaging parse on model ${model} failed:`, err);
      }
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
