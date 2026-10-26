/**
 * HealthMate - OCR Recognition Pipeline
 *
 * Orchestrates the native engine steps so the scan screen stays simple:
 *
 *   preprocess image variants → ML Kit Latin recognizer → geometric reading
 *   order → clean-line parsing
 *
 * to squeeze the best possible on-device read out of one photo:
 *
 *   1. High-resolution variant (~4096px) — the detail pass most labels need.
 *   2. Compact variant (~2048px) — different downsample sometimes recovers
 *      text the high-res render smears (and vice versa).
 *   3. Grayscale + contrast pass — the photo goes through the native
 *      ImageEnhancer module (histogram stretch + adaptive gamma); shots in
 *      low light that stay unread in color frequently become readable here.
 *   4. Focused crop pass — when all whole-frame passes read poorly, the
 *      recognized line frames define a tight label region; one more pass runs
 *      on just that region, dropping background noise and glare.
 *
 * Each pass is scored (recognized lines + parsed label signals: dictionary
 * name match, strength, expiry, batch, manufacturer) and the best-scoring
 * pass wins. Falls back to demo text only when the native module is not
 * bundled (Expo Go).
 *
 * Kept separate from `ocrService.ts`, which stays a pure, unit-testable
 * parser with no native dependencies.
 */

import {
  prepareImageForOcr,
  cropImageRegionForOcr,
  enhanceImageForOcr,
  PreparedImage,
} from './imagePreProcessing';
import { ocrService, ExtractedMedicineData } from './ocrService';
import {
  recognizePackagingImage,
  OcrConnectionError,
} from './remoteOcrService';
import {
  FramedLine,
  LineFrame,
  reconstructReadingOrder,
  computeTextRegion,
} from './ocrTextGeometry';

export { OcrConnectionError } from './remoteOcrService';

interface TextLineLike {
  text?: string;
  frame?: LineFrame | null;
}

interface TextBlockLike {
  lines?: TextLineLike[];
}

interface TextRecognitionResultLike {
  text?: string;
  blocks?: TextBlockLike[];
}

interface TextRecognitionModuleLike {
  recognize: (
    uri: string,
    script?: string
  ) => Promise<TextRecognitionResultLike>;
}

let TextRecognitionModule: TextRecognitionModuleLike | null = null;
let mlKitAvailable = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('@react-native-ml-kit/text-recognition');
  TextRecognitionModule = (mod.default || mod) as TextRecognitionModuleLike;
  mlKitAvailable = !!TextRecognitionModule?.recognize;
} catch {
  // Native ML Kit not installed (e.g. Expo Go); fallback gracefully below.
}

// TextRecognitionScript.LATIN, kept inline so the native module is only
// require()d inside the guarded block above.
const LATIN_SCRIPT = 'Latin';

/** Longest edge of the high-resolution recognition variant (px). */
const OCR_VARIANT_HIGH_RES = 4096;
/** Longest edge of the compact recognition variant (px). */
const OCR_VARIANT_COMPACT = 2048;
/** JPEG quality of the high-res / compact variants. */
const HIGH_RES_QUALITY = 0.9;
const COMPACT_QUALITY = 0.8;

/**
 * Demo text used when the native engine is not bundled with the app, so the
 * review flow remains demonstrable. The UI marks this as a sample.
 */
export const DEMO_LABEL_TEXT =
  'Metformin 500mg Tablets BP\nBatch: DEMO-MF0426\nExp: 12/2027\nMfg: Example Pharma';

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
   * Lets a developer compare the color read against the grayscale/contrast
   * pass for low-light labels. Null outside __DEV__.
   */
  debugPasses: LabelScanPassDebug[] | null;
}

export interface LabelScanPassDebug {
  /** Human label of the variant: highres / compact / grayscale+contrast / crop. */
  label: string;
  score: number;
  /** Parsed label signals (dictionary name, strength, expiry, batch, mfg). */
  signals: number;
  chars: number;
  /** Image the pass recognized (URI), for inspecting the enhanced render. */
  imageUri: string;
  /** The pass's full-text read, line by line. */
  rawText: string;
}

function collectFramedLines(
  recognition: TextRecognitionResultLike
): FramedLine[] {
  const lines: FramedLine[] = [];
  for (const block of recognition.blocks ?? []) {
    for (const line of block.lines ?? []) {
      if (line.text?.trim()) {
        lines.push({ text: line.text, frame: line.frame ?? null });
      }
    }
  }
  return lines;
}

interface RecognitionPass {
  /** Reading-order text ready for display + parsing. */
  rawText: string;
  /** Line frames in the pass image's pixel space (for the crop pass). */
  frames: LineFrame[];
}

/**
 * One recognition pass: rebuild the text in reliable reading order from the
 * line frames. ML Kit's frames carry the true visual layout; the flattened
 * `text` blob is only a last resort.
 */
async function recognizePass(uri: string): Promise<RecognitionPass | null> {
  if (
    !TextRecognitionModule ||
    typeof TextRecognitionModule.recognize !== 'function'
  ) {
    return null;
  }
  try {
    const recognition = await TextRecognitionModule.recognize(uri, LATIN_SCRIPT);
    const framedLines = collectFramedLines(recognition);

    let orderedLines = reconstructReadingOrder(framedLines);
    if (orderedLines.length === 0) {
      const flat = recognition.text?.trim();
      if (flat) orderedLines = flat.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    }
    if (orderedLines.length === 0) return null;

    return {
      rawText: orderedLines.join('\n'),
      frames: framedLines
        .map((line) => line.frame)
        .filter((frame): frame is LineFrame => !!frame),
    };
  } catch (error) {
    console.warn('Medicine label text recognition failed:', error);
    return null;
  }
}

/**
 * Scores a read: structured label signals (a real dictionary match, strength,
 * expiry, batch, manufacturer) dominate, then recognized bulk. A "strong"
 * read has at least two signals — good enough to stop early.
 */
function scorePass(pass: RecognitionPass): {
  score: number;
  signals: number;
  chars: number;
} {
  const extracted = ocrService.extractMedicineData(pass.rawText);
  const signals = [
    (extracted.candidates?.length ?? 0) > 0,
    !!extracted.detectedStrength,
    !!extracted.expiryDate,
    !!extracted.batchNumber,
    !!extracted.manufacturer,
  ].filter(Boolean).length;
  const chars = pass.rawText.replace(/\s+/g, '').length;
  const lineCount = pass.rawText.split('\n').length;
  const score =
    signals * 100 + Math.min(chars, 1600) + Math.min(lineCount, 40) * 2;
  return { score, signals, chars };
}

function isStrongRead(scored: { signals: number; chars: number }): boolean {
  return scored.signals >= 2 && scored.chars >= 80;
}

/** Dev-gating available in every environment (jest sets no __DEV__). */
const devMode = typeof __DEV__ !== 'undefined' && __DEV__;

/**
 * Runs the Cloud OCR pipeline for a medicine-label photo using the remote
 * RapidOCR service. Requires an active internet connection.
 */
export async function processLabelImage(
  imageUri: string
): Promise<LabelScanResult> {
  // Pre-process and optimize resolution for upload
  const prepared = await prepareImageForOcr(imageUri, {
    maxDimension: OCR_VARIANT_COMPACT,
    quality: COMPACT_QUALITY,
  });

  const uploadUri = prepared.uri || imageUri;

  // Perform remote recognition via RapidOCR API
  const remoteResult = await recognizePackagingImage(uploadUri);

  const rawText = remoteResult.text || "";
  const extracted = ocrService.extractMedicineData(rawText);

  return {
    rawText,
    extracted,
    usedFallbackEngine: false,
    retried: false,
    debugPasses: devMode
      ? [
          {
            label: "cloud-rapidocr",
            score: (remoteResult.count || 0) * 10,
            signals: [
              (extracted.candidates?.length ?? 0) > 0,
              !!extracted.detectedStrength,
              !!extracted.expiryDate,
              !!extracted.batchNumber,
              !!extracted.manufacturer,
            ].filter(Boolean).length,
            chars: rawText.replace(/\s+/g, "").length,
            imageUri: uploadUri,
            rawText,
          },
        ]
      : null,
  };
}
