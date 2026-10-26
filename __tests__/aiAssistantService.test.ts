import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Use a global fetch mock captured before the module imports.
type FetchResponse = { ok: boolean; status?: number; json: () => Promise<unknown> };
interface FetchSpy {
  (url: string, init: unknown): Promise<FetchResponse>;
  mockResolvedValueOnce(value: unknown): void;
  mockRejectedValueOnce(value: unknown): void;
  mockReset(): void;
  mockCalls: unknown[][];
  mock: {
    calls: unknown[][];
  };
}
const mockFetch = jest.fn() as unknown as FetchSpy;
(globalThis as { fetch?: unknown }).fetch = mockFetch as unknown;
(globalThis as { AbortController?: unknown }).AbortController =
  (globalThis as { AbortController?: unknown }).AbortController ?? class {
    signal = { aborted: false, onabort: null };
    abort() { this.signal.aborted = true; }
  };

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { aiAssistantService } = require('../src/services/aiAssistantService') as {
  aiAssistantService: {
    getApiKey(): Promise<string | null>;
    saveApiKey(key: string): Promise<void>;
    askGemini(question: string, history?: { role: string; content: string }[]): Promise<{ text: string; model: string; usedNetwork: boolean }>;
  };
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const secureStoreMock = require('./__mocks__/expo-secure-store') as { __clearStore(): void };

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function geminiBodyWithText(text: string) {
  return {
    candidates: [
      {
        content: {
          parts: [{ text }],
        },
        finishReason: 'STOP',
      },
    ],
  };
}

describe('aiAssistantService (Gemini)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    secureStoreMock.__clearStore();
  });

  it('refuses to answer without a key (offline-first behavior unchanged)', async () => {
    await expect(aiAssistantService.askGemini('What does 10mg mean?'))
      .rejects.toMatchObject({ code: 'NO_KEY' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('persisted keys round-trip through SecureStore-backed storage', async () => {
    await aiAssistantService.saveApiKey('sk-test-key-123');
    await expect(aiAssistantService.getApiKey()).resolves.toBe('sk-test-key-123');
  });

  it('calls generateContent with the correct model, key, and safety system prompt', async () => {
    await aiAssistantService.saveApiKey('sk-live-key');
    mockFetch.mockResolvedValueOnce(okResponse(geminiBodyWithText('A milligram is a unit of mass.')));

    const result = await aiAssistantService.askGemini('What does mg mean on a label?');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers['x-goog-api-key']).toBe('sk-live-key');

    const body = (init as { body: string }).body;
    const parsed = JSON.parse(body);
    // System instruction present (safety rules)
    expect(parsed.systemInstruction?.parts?.[0]?.text).toContain('pharmacist');
    expect(parsed.systemInstruction?.parts?.[0]?.text).toContain('NEVER give personalized medical advice');
    // Question routed as user role
    expect(parsed.contents).toEqual([
      expect.objectContaining({ role: 'user', parts: [expect.objectContaining({ text: 'What does mg mean on a label?' })] }),
    ]);

    expect(result.text).toBe('A milligram is a unit of mass.');
  });

  it('sends prior conversation turns as alternating user/assistant contents', async () => {
    await aiAssistantService.saveApiKey('sk-live-key');
    mockFetch.mockResolvedValueOnce(okResponse(geminiBodyWithText('hr means hour.')));

    await aiAssistantService.askGemini('and what does hr mean?', [
      { role: 'user', content: 'What does mg mean?' },
      { role: 'assistant', content: 'A unit of mass.' },
    ]);

    const body = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body);
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'assistant', 'user']);
  });

  it('raises BAD_KEY when Gemini rejects an invalid key', async () => {
    await aiAssistantService.saveApiKey('sk-bad-key');
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401, json: () => Promise.resolve({ error: { message: 'API key not valid' } }) });

    await expect(aiAssistantService.askGemini('hello'))
      .rejects.toMatchObject({ code: 'BAD_KEY' });
  });

  it('surfaces a categorized RATE_LIMIT code on 429 responses', async () => {
    await aiAssistantService.saveApiKey('sk-throttled');
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, json: () => Promise.resolve({ error: { message: 'resource_exhausted' } }) });

    await expect(aiAssistantService.askGemini('hello'))
      .rejects.toMatchObject({ code: 'RATE_LIMIT' });
  });

  it('categorizes transport failures as NETWORK so screens can fall back', async () => {
    await aiAssistantService.saveApiKey('sk-network');
    mockFetch.mockRejectedValueOnce(new Error('Network request failed'));

    await expect(aiAssistantService.askGemini('hello'))
      .rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('returns EMPTY_ANSWER when candidates arrive without usable content parts', async () => {
    await aiAssistantService.saveApiKey('sk-malformed');
    mockFetch.mockResolvedValueOnce(okResponse({ candidates: [{ finishReason: 'SAFETY' }] }));

    await expect(aiAssistantService.askGemini('hello'))
      .rejects.toMatchObject({ code: 'EMPTY_ANSWER' });
  });
});
