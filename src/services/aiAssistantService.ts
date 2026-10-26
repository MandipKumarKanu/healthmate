import * as SecureStore from 'expo-secure-store';
import { AIMessage } from '../types';

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
const DEFAULT_MODEL = 'gemini-2.5-flash';
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
};
