/**
 * HealthMate - Cloud OCR Service
 *
 * Connects to the RapidOCR API with token authentication
 * to process prescription and medication packaging labels.
 */

import { Platform } from 'react-native';
import { File } from 'expo-file-system';

export const OCR_API_CONFIG = {
  get BASE_URL(): string {
    return process.env.EXPO_PUBLIC_OCR_API_URL || '';
  },
  get API_KEY(): string {
    return process.env.EXPO_PUBLIC_OCR_API_KEY || '';
  },
  TIMEOUT_MS: 25000,
  HEALTH_TIMEOUT_MS: 4000,
};

export interface RemoteOcrLine {
  text: string;
  score: number;
  box?: number[][];
}

export interface RemoteOcrResponse {
  success: boolean;
  count: number;
  elapsed_seconds?: number;
  text: string;
  lines: RemoteOcrLine[];
  error?: string;
}

export class OcrConnectionError extends Error {
  readonly isConnectionError = true;

  constructor(message = 'Please connect to internet to use this feature or add manually.') {
    super(message);
    this.name = 'OcrConnectionError';
  }
}

/**
 * Validates the remote OCR endpoint URL for security.
 * In production builds, cleartext HTTP requests to non-local hosts are blocked.
 */
export function validateOcrEndpoint(url: string): { valid: boolean; error?: string } {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return {
      valid: false,
      error:
        'OCR API URL is missing. Please set EXPO_PUBLIC_OCR_API_URL in your environment (.env).',
    };
  }
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { valid: false, error: 'OCR API URL must use HTTP or HTTPS protocol.' };
    }
    const isLocal =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '10.0.2.2';
    const isProduction =
      process.env.NODE_ENV === 'production' ||
      (typeof __DEV__ !== 'undefined' && !__DEV__);

    if (parsed.protocol === 'http:' && isProduction && !isLocal) {
      return {
        valid: false,
        error:
          'Insecure HTTP OCR endpoint is not allowed in production. HTTPS is required to protect patient and medication data.',
      };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: `Invalid OCR API URL: "${url}".` };
  }
}

/**
 * Checks if the remote OCR service is reachable over the internet.
 */
export async function checkOcrServerHealth(): Promise<boolean> {
  const url = OCR_API_CONFIG.BASE_URL;
  if (!url) return false;

  const validation = validateOcrEndpoint(url);
  if (!validation.valid) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OCR_API_CONFIG.HEALTH_TIMEOUT_MS);

  try {
    const res = await fetch(`${url}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const json = await res.json();
    return json?.ok === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads a local file URI into a base64 string for JSON payload delivery.
 */
async function fileUriToBase64(uri: string): Promise<string> {
  // If already a base64 data URI
  if (uri.startsWith('data:')) {
    const commaIndex = uri.indexOf(',');
    return commaIndex >= 0 ? uri.slice(commaIndex + 1) : uri;
  }

  // Try the new Expo FileSystem File API
  try {
    const file = new File(uri);
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    if (typeof btoa !== 'undefined') {
      return btoa(binary);
    }
  } catch (err) {
    console.warn('file.arrayBuffer failed, falling back to fetch blob:', err);
  }

  // Fallback via standard fetch blob -> FileReader
  const response = await fetch(uri);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = reader.result as string;
      const comma = res.indexOf(',');
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Sends a medication packaging image to the remote OCR server.
 * Uses multipart FormData first, falling back to JSON base64 if needed.
 */
export async function recognizePackagingImage(imageUri: string): Promise<RemoteOcrResponse> {
  if (!imageUri) {
    throw new Error('No image provided for text recognition.');
  }

  const endpointValidation = validateOcrEndpoint(OCR_API_CONFIG.BASE_URL);
  if (!endpointValidation.valid) {
    throw new Error(endpointValidation.error);
  }

  if (!OCR_API_CONFIG.API_KEY) {
    throw new Error(
      'OCR API key is missing. Please set EXPO_PUBLIC_OCR_API_KEY in your environment (.env).',
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OCR_API_CONFIG.TIMEOUT_MS);

  let lastNetworkError: any = null;

  // Strategy 1: Multipart FormData (recommended by OCR API doc)
  try {
    const formData = new FormData();
    formData.append('file', {
      uri: imageUri,
      name: 'medication_label.jpg',
      type: 'image/jpeg',
    } as any);

    const response = await fetch(`${OCR_API_CONFIG.BASE_URL}/ocr`, {
      method: 'POST',
      headers: {
        'X-API-Key': OCR_API_CONFIG.API_KEY,
      },
      body: formData,
      signal: controller.signal,
    });

    if (response.ok) {
      const data: RemoteOcrResponse = await response.json();
      if (data.success) {
        return data;
      }
      if (data.error) {
        throw new Error(data.error);
      }
    } else if (response.status === 401) {
      throw new Error('OCR API authentication failed: invalid API key.');
    } else if (response.status === 413) {
      throw new Error('Image file is too large for OCR server (max 20MB).');
    }
  } catch (err: any) {
    // If it's an explicit authentication or size error from the server, rethrow immediately
    if (err?.message?.includes('authentication') || err?.message?.includes('too large')) {
      throw err;
    }
    lastNetworkError = err;
    console.warn('Multipart OCR request failed, trying base64 JSON payload:', err);
  } finally {
    clearTimeout(timer);
  }

  // Strategy 2: JSON base64 payload
  const fallbackController = new AbortController();
  const fallbackTimer = setTimeout(() => fallbackController.abort(), OCR_API_CONFIG.TIMEOUT_MS);

  try {
    const base64String = await fileUriToBase64(imageUri);
    const response = await fetch(`${OCR_API_CONFIG.BASE_URL}/ocr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': OCR_API_CONFIG.API_KEY,
      },
      body: JSON.stringify({
        image_base64: base64String,
      }),
      signal: fallbackController.signal,
    });

    if (response.ok) {
      const data: RemoteOcrResponse = await response.json();
      if (data.success) {
        return data;
      }
      throw new Error(data.error || 'OCR server failed to recognize image.');
    }

    if (response.status === 401) {
      throw new Error('OCR API authentication failed: invalid API key.');
    } else if (response.status === 413) {
      throw new Error('Image file is too large for OCR server (max 20MB).');
    } else {
      throw new Error(`OCR server responded with status ${response.status}.`);
    }
  } catch (err: any) {
    if (
      err?.message?.toLowerCase().includes('cleartext') ||
      lastNetworkError?.message?.toLowerCase().includes('cleartext')
    ) {
      throw new Error(
        'Cleartext HTTP communication to OCR server is blocked by Android security policy. Ensure usesCleartextTraffic is enabled.',
      );
    }

    const isOfflineOrAborted =
      err?.name === 'AbortError' ||
      err?.message?.toLowerCase().includes('network request failed') ||
      err?.message?.toLowerCase().includes('failed to fetch') ||
      err?.message?.toLowerCase().includes('fetch failed') ||
      err?.message?.toLowerCase().includes('networkerror') ||
      err?.message?.toLowerCase().includes('timeout') ||
      lastNetworkError?.message?.toLowerCase().includes('network request failed') ||
      lastNetworkError?.message?.toLowerCase().includes('failed to fetch') ||
      lastNetworkError?.message?.toLowerCase().includes('fetch failed');

    if (isOfflineOrAborted) {
      throw new OcrConnectionError(
        'Please connect to internet to use this feature or add manually.',
      );
    }

    throw err;
  } finally {
    clearTimeout(fallbackTimer);
  }
}
