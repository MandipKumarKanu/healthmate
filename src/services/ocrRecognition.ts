/**
 * HealthMate - OCR Recognition Pipeline
 *
 * The scan pipeline is remote: preprocess a compact image variant, upload it
 * to the RapidOCR service, then parse the returned text with the pure
 * `ocrService` parser and optionally refine fields with the AI assistant.
 *
 * Kept separate from `ocrService.ts`, which stays a pure, unit-testable
 * parser with no network dependencies.
 */

import {
  prepareImageForOcr,
} from './imagePreProcessing';
import { ocrService, ExtractedMedicineData } from './ocrService';
import { recognizePackagingImage, OcrConnectionError } from './remoteOcrService';
import { aiAssistantService } from './aiAssistantService';

export { OcrConnectionError } from './remoteOcrService';

/** Longest edge of the compact recognition variant (px). */
const OCR_VARIANT_COMPACT = 2048;
/** JPEG quality of the compact variant. */
const COMPACT_QUALITY = 0.8;

export interface LabelScanResult {
  /** Full label text, cleaned line-by-line, ready to display. */
  rawText: string;
  /** Parsed + structured medicine fields. */
  extracted: ExtractedMedicineData;
  /** True when the demo text was used because the engine is unavailable. */
  usedFallbackEngine: boolean;
  /** True when the best read came from a retry pass, not the first one. */
  retried: boolean;
  /**
   * Dev-only: every recognition pass that ran, with its score and full text.
   * Lets a developer compare how the cloud read performed. Null outside __DEV__.
   */
  debugPasses: LabelScanPassDebug[] | null;
  /** Explains when OCR succeeded but Gemini interpretation had to fall back. */
  aiWarning?: string;
}

export interface LabelScanPassDebug {
  /** Human label of the variant: compact / cloud-rapidocr. */
  label: string;
  score: number;
  /** Parsed label signals (dictionary name, strength, expiry, batch, mfg). */
  signals: number;
  chars: number;
  /** Image the pass recognized (URI), for inspecting the uploaded render. */
  imageUri: string;
  /** The pass's full-text read, line by line. */
  rawText: string;
}

/** Dev-gating available in every environment (jest sets no __DEV__). */
const devMode = typeof __DEV__ !== 'undefined' && __DEV__;

/**
 * Runs the Cloud OCR pipeline for a medicine-label photo using the remote
 * RapidOCR service. Requires an active internet connection.
 */
export async function processLabelImage(imageUri: string): Promise<LabelScanResult> {
  // Pre-process and optimize resolution for upload
  const prepared = await prepareImageForOcr(imageUri, {
    maxDimension: OCR_VARIANT_COMPACT,
    quality: COMPACT_QUALITY,
  });

  const uploadUri = prepared.uri || imageUri;

  // Perform remote recognition via RapidOCR API
  const remoteResult = await recognizePackagingImage(uploadUri);

  const rawText = remoteResult.text || '';
  let extracted = ocrService.extractMedicineData(rawText);
  let aiWarning: string | undefined;
  try {
    const aiParsed = await aiAssistantService.parseMedicinePackagingWithAI(rawText);
    if (aiParsed) {
      extracted = aiParsed;
    }
  } catch (aiErr) {
    console.warn('AI medication packaging interpretation fallback:', aiErr);
    aiWarning =
      (aiErr as { message?: string })?.message ||
      'Personal AI interpretation failed. Review all extracted medicine fields manually.';
  }

  return {
    rawText,
    extracted,
    usedFallbackEngine: false,
    retried: false,
    aiWarning,
    debugPasses: devMode
      ? [
          {
            label: 'cloud-rapidocr',
            score: (remoteResult.count || 0) * 10,
            signals: [
              (extracted.candidates?.length ?? 0) > 0,
              !!extracted.detectedStrength,
              !!extracted.expiryDate,
              !!extracted.batchNumber,
              !!extracted.manufacturer,
            ].filter(Boolean).length,
            chars: rawText.replace(/\s+/g, '').length,
            imageUri: uploadUri,
            rawText,
          },
        ]
      : null,
  };
}
