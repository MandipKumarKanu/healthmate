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
import {
  recognizePackagingImage,
  OcrConnectionError,
  RemoteOcrResponse,
} from './remoteOcrService';
import { aiAssistantService } from './aiAssistantService';

export { OcrConnectionError };

/** Longest edge of the compact recognition variant (px). */
const OCR_VARIANT_COMPACT = 2048;
/** JPEG quality of the compact variant. */
const COMPACT_QUALITY = 0.8;

export type ScanStage =
  | 'idle'
  | 'preparing'
  | 'front_ocr'
  | 'back_ocr'
  | 'parallel_ocr'
  | 'cleaning'
  | 'ai_analysis'
  | 'complete';

export interface MultiSideScanOptions {
  frontUri: string;
  backUri?: string;
  onProgress?: (stage: ScanStage, detail?: string) => void;
}

export interface MultiSideScanResult extends LabelScanResult {
  frontRawText?: string;
  backRawText?: string;
  frontImageUri: string;
  backImageUri?: string;
}

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
 * Runs the multi-side OCR and AI analysis pipeline.
 * Concurrently processes front and back images when both are provided,
 * cleanly combines text context, and uses AI for structured extraction.
 */
export async function processMultiSideLabelImages(
  options: MultiSideScanOptions,
): Promise<MultiSideScanResult> {
  const { frontUri, backUri, onProgress } = options;

  if (!frontUri) {
    throw new Error('Front packaging image is required for scanning.');
  }

  // 1. Stage: Preparing images
  onProgress?.('preparing', 'Optimizing packaging image quality…');
  const [preparedFront, preparedBack] = await Promise.all([
    prepareImageForOcr(frontUri, {
      maxDimension: OCR_VARIANT_COMPACT,
      quality: COMPACT_QUALITY,
    }),
    backUri
      ? prepareImageForOcr(backUri, {
          maxDimension: OCR_VARIANT_COMPACT,
          quality: COMPACT_QUALITY,
        })
      : Promise.resolve(null),
  ]);

  const uploadFrontUri = preparedFront?.uri || frontUri;
  const uploadBackUri = preparedBack?.uri || backUri;

  let frontText = '';
  let backText = '';
  let frontRemoteResult: RemoteOcrResponse | null = null;
  let backRemoteResult: RemoteOcrResponse | null = null;

  // 2. Stage: Parallel or single OCR
  if (uploadBackUri) {
    onProgress?.('parallel_ocr', 'Reading text from front and back packaging in parallel…');
    const [frontOutcome, backOutcome] = await Promise.allSettled([
      recognizePackagingImage(uploadFrontUri),
      recognizePackagingImage(uploadBackUri),
    ]);

    let frontError: unknown = null;
    let backError: unknown = null;

    if (frontOutcome.status === 'fulfilled') {
      frontRemoteResult = frontOutcome.value;
      frontText = frontOutcome.value.text || '';
    } else {
      frontError = frontOutcome.reason;
    }

    if (backOutcome.status === 'fulfilled') {
      backRemoteResult = backOutcome.value;
      backText = backOutcome.value.text || '';
    } else {
      backError = backOutcome.reason;
    }

    // If both failed to read any text or threw errors, propagate the error
    if (!frontText && !backText) {
      if (frontError) throw frontError;
      if (backError) throw backError;
      throw new Error('Could not detect readable text on either side of the packaging.');
    }
  } else {
    onProgress?.('front_ocr', 'Reading packaging label with Cloud OCR…');
    frontRemoteResult = await recognizePackagingImage(uploadFrontUri);
    frontText = frontRemoteResult.text || '';
  }

  // 3. Stage: Cleaning and consolidating raw text
  onProgress?.('cleaning', 'Cleaning and structuring packaging text…');
  let combinedRawText = '';
  if (frontText && backText) {
    combinedRawText = `[FRONT SIDE PACKAGING]\n${frontText.trim()}\n\n[BACK SIDE PACKAGING]\n${backText.trim()}`;
  } else if (frontText) {
    combinedRawText = frontText.trim();
  } else {
    combinedRawText = backText.trim();
  }

  // Extract base structured information using dictionary
  let extracted = ocrService.extractMedicineData(combinedRawText);
  let aiWarning: string | undefined;

  // 4. Stage: AI Analysis
  onProgress?.('ai_analysis', 'Personal AI analyzing medication details…');
  try {
    const aiParsed = await aiAssistantService.parseMedicinePackagingWithAI(combinedRawText);
    if (aiParsed) {
      extracted = aiParsed;
    }
  } catch (aiErr) {
    console.warn('AI medication packaging interpretation fallback:', aiErr);
    aiWarning =
      (aiErr as { message?: string })?.message ||
      'Personal AI interpretation failed. Review all extracted medicine fields manually.';
  }

  // 5. Stage: Complete
  onProgress?.('complete', 'Medicine details ready for review');

  const debugPasses: LabelScanPassDebug[] = [];
  if (devMode) {
    if (frontRemoteResult) {
      debugPasses.push({
        label: 'cloud-rapidocr-front',
        score: (frontRemoteResult.count || 0) * 10,
        signals: [
          (extracted.candidates?.length ?? 0) > 0,
          !!extracted.detectedStrength,
          !!extracted.expiryDate,
          !!extracted.batchNumber,
          !!extracted.manufacturer,
        ].filter(Boolean).length,
        chars: frontText.replace(/\s+/g, '').length,
        imageUri: uploadFrontUri,
        rawText: frontText,
      });
    }
    if (backRemoteResult) {
      debugPasses.push({
        label: 'cloud-rapidocr-back',
        score: (backRemoteResult.count || 0) * 10,
        signals: [!!extracted.batchNumber, !!extracted.manufacturer, !!extracted.expiryDate].filter(
          Boolean,
        ).length,
        chars: backText.replace(/\s+/g, '').length,
        imageUri: uploadBackUri || backUri || '',
        rawText: backText,
      });
    }
  }

  return {
    rawText: combinedRawText,
    frontRawText: frontText,
    backRawText: backText,
    frontImageUri: frontUri,
    backImageUri: backUri,
    extracted,
    usedFallbackEngine: false,
    retried: false,
    aiWarning,
    debugPasses: debugPasses.length > 0 ? debugPasses : null,
  };
}

/**
 * Runs the Cloud OCR pipeline for a single medicine-label photo.
 * Maintains full backward compatibility with existing callers.
 */
export async function processLabelImage(imageUri: string): Promise<LabelScanResult> {
  return processMultiSideLabelImages({ frontUri: imageUri });
}
