import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  OCR_API_CONFIG,
  OcrConnectionError,
  recognizePackagingImage,
  checkOcrServerHealth,
} from '../src/services/remoteOcrService';

describe('Remote OCR Service', () => {
  const originalEnv = process.env;
  const originalFetch = (globalThis as any).fetch;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    (globalThis as any).fetch = originalFetch;
  });

  describe('Configuration & Environment Variables', () => {
    it('reads URL and API Key from process.env and does not hardcode them', () => {
      process.env.EXPO_PUBLIC_OCR_API_URL = 'http://test-ocr-server.local:8080';
      process.env.EXPO_PUBLIC_OCR_API_KEY = 'test-secret-key-12345';

      expect(OCR_API_CONFIG.BASE_URL).toBe('http://test-ocr-server.local:8080');
      expect(OCR_API_CONFIG.API_KEY).toBe('test-secret-key-12345');
    });

    it('throws error when API URL is missing', async () => {
      delete process.env.EXPO_PUBLIC_OCR_API_URL;
      process.env.EXPO_PUBLIC_OCR_API_KEY = 'test-key';

      await expect(recognizePackagingImage('file:///test/med.jpg')).rejects.toThrow(
        /OCR API URL is missing/,
      );
    });

    it('throws error when API key is missing', async () => {
      process.env.EXPO_PUBLIC_OCR_API_URL = 'http://test-server:8080';
      delete process.env.EXPO_PUBLIC_OCR_API_KEY;

      await expect(recognizePackagingImage('file:///test/med.jpg')).rejects.toThrow(
        /OCR API key is missing/,
      );
    });

    it('throws error when no image is provided', async () => {
      process.env.EXPO_PUBLIC_OCR_API_URL = 'http://test-server:8080';
      process.env.EXPO_PUBLIC_OCR_API_KEY = 'test-key';

      await expect(recognizePackagingImage('')).rejects.toThrow(/No image provided/);
    });
  });

  describe('OcrConnectionError', () => {
    it('has isConnectionError flag and default internet connection message', () => {
      const err = new OcrConnectionError();
      expect(err.isConnectionError).toBe(true);
      expect(err.name).toBe('OcrConnectionError');
      expect(err.message).toBe('Please connect to internet to use this feature or add manually.');
    });
  });

  describe('Server Health Check', () => {
    it('returns true when server health endpoint responds with ok: true', async () => {
      process.env.EXPO_PUBLIC_OCR_API_URL = 'http://mock-server:8010';
      const mockFetch = jest.fn((..._args: any[]) =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
        }),
      );
      (globalThis as any).fetch = mockFetch;

      const healthy = await checkOcrServerHealth();
      expect(healthy).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://mock-server:8010/health',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('returns false when server health check fails or times out', async () => {
      process.env.EXPO_PUBLIC_OCR_API_URL = 'http://mock-server:8010';
      (globalThis as any).fetch = jest.fn((..._args: any[]) =>
        Promise.reject(new Error('Network request failed')),
      );

      const healthy = await checkOcrServerHealth();
      expect(healthy).toBe(false);
    });
  });

  describe('Recognition Request & Response Parsing', () => {
    it('sends X-API-Key header and parses successful RapidOCR response', async () => {
      process.env.EXPO_PUBLIC_OCR_API_URL = 'http://mock-ocr:8010';
      process.env.EXPO_PUBLIC_OCR_API_KEY = 'valid-test-key-999';

      const mockResponse = {
        success: true,
        count: 2,
        elapsed_seconds: 0.15,
        text: 'Amoxicillin 500mg\nExp: 08/2026',
        lines: [
          { text: 'Amoxicillin 500mg', score: 0.98 },
          { text: 'Exp: 08/2026', score: 0.95 },
        ],
      };

      const mockFetch = jest.fn((..._args: any[]) =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        }),
      );
      (globalThis as any).fetch = mockFetch;

      const result = await recognizePackagingImage('file:///mock/image.jpg');

      expect(result.success).toBe(true);
      expect(result.text).toBe('Amoxicillin 500mg\nExp: 08/2026');
      expect(result.lines).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://mock-ocr:8010/ocr',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-API-Key': 'valid-test-key-999',
          }),
        }),
      );
    });

    it('throws OcrConnectionError when network fails', async () => {
      process.env.EXPO_PUBLIC_OCR_API_URL = 'http://mock-ocr:8010';
      process.env.EXPO_PUBLIC_OCR_API_KEY = 'valid-test-key-999';

      (globalThis as any).fetch = jest.fn((..._args: any[]) =>
        Promise.reject(new Error('Network request failed')),
      );

      await expect(recognizePackagingImage('file:///mock/image.jpg')).rejects.toThrow(
        OcrConnectionError,
      );
    });
  });
});
