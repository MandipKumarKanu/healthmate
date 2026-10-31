/**
 * HealthMate - Image Pre-processing for OCR
 *
 * ML Kit reads label text far more reliably when the photo is decoded at a sane
 * size: a 12MP camera frame wastes memory, adds compression noise, and slows
 * recognition without improving accuracy. This module downsamples the image at
 * decode time (the full-resolution bitmap never materializes) and re-encodes a
 * clean JPEG for the recognizer.
 *
 * Three entry points serve the recognition pipeline:
 *   - `prepareImageForOcr` renders a whole-image variant at a caller-chosen
 *     resolution/quality (the pipeline tries more than one variant and keeps
 *     whichever pass reads the label best).
 *   - `enhanceImageForOcr` renders a native grayscale + contrast-normalized
 *     variant for low-light labels via the local `modules/image-enhancer`
 *     Expo module (no-op when the native module is not bundled).
 *   - `cropImageRegionForOcr` renders one tight crop of an already-prepared
 *     variant, used as a focused last pass when whole-frame passes read poorly.
 *
 * The native module is resolved lazily so the rest of the OCR pipeline keeps
 * working (with the original image) if it cannot be loaded.
 */

import { requireNativeModule } from 'expo';
import type { ImageManipulatorContext } from 'expo-image-manipulator';
import { SaveFormat } from 'expo-image-manipulator';
// Local Expo module: native grayscale + contrast normalization (Kotlin/Swift).
import { getImageEnhancerModule } from '../../modules/image-enhancer';

/**
 * The singleton native module emission. The package's TypeScript types expose
 * `manipulate()` as an instance method of the exported class, so we type the
 * actual runtime module (which the package itself calls) via its own types.
 */
interface ImageManipulatorModule {
  manipulate(
    source: string,
    options?: { maxWidth?: number; maxHeight?: number },
  ): ImageManipulatorContext;
}

/** Longest allowed edge (px) fed into the recognizer for the compact variant. */
const DEFAULT_OCR_MAX_DIMENSION = 2048;

/** Default re-encode quality for the OCR input JPEG. */
const DEFAULT_OCR_JPEG_QUALITY = 0.9;

export interface PreparedImage {
  /** URI to feed to the OCR engine. */
  uri: string;
  /** False when the original image was passed through untouched. */
  processed: boolean;
  /** Pixel size of the prepared image (=== original's when untouched). */
  width: number;
  height: number;
}

export interface PrepareOptions {
  /** Longest allowed output edge, px (aspect preserved). */
  maxDimension?: number;
  /** Re-encode quality of the output JPEG, 0–1. */
  quality?: number;
}

let imageManipulatorModule: ImageManipulatorModule | null = null;
let imageManipulatorResolved = false;

function resolveImageManipulator(): ImageManipulatorModule | null {
  if (imageManipulatorResolved) return imageManipulatorModule;
  imageManipulatorResolved = true;
  try {
    imageManipulatorModule = requireNativeModule<ImageManipulatorModule>('ExpoImageManipulator');
  } catch {
    // Native module unavailable (e.g. web build without the native emission):
    // fall back to the original image instead of breaking the scan flow.
    imageManipulatorModule = null;
  }
  return imageManipulatorModule;
}

async function renderAndSave(
  module: ImageManipulatorModule,
  source: string,
  saveQuality: number,
  loadOptions: { maxWidth?: number; maxHeight?: number },
  crop?: { originX: number; originY: number; width: number; height: number },
): Promise<PreparedImage> {
  // Decode-time downsample only when the load options are meaningful for this
  // pass; a crop's rectangle is expressed in the source file's pixel space, so
  // the source must be decoded at its own size.
  const context = loadOptions.maxWidth
    ? module.manipulate(source, loadOptions)
    : module.manipulate(source);
  if (crop) context.crop(crop);
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({
    format: SaveFormat.JPEG,
    compress: saveQuality,
  });

  // Shared objects are no longer needed; release them eagerly.
  rendered.release();
  context.release();

  if (!saved.uri) {
    return {
      uri: source,
      processed: false,
      width: rendered.width,
      height: rendered.height,
    };
  }
  return {
    uri: saved.uri,
    processed: true,
    width: saved.width,
    height: saved.height,
  };
}

/**
 * Prepares a whole image for text recognition:
 * 1. Loads it with decode-time downsampling (both edges capped, aspect kept).
 * 2. Saves a re-encoded JPEG and frees the native references immediately.
 *
 * Never throws: on any failure the original URI is returned unchanged so OCR
 * still runs.
 */
export async function prepareImageForOcr(
  imageUri: string,
  options: PrepareOptions = {},
): Promise<PreparedImage> {
  const imageManipulator = resolveImageManipulator();
  const maxDimension = options.maxDimension ?? DEFAULT_OCR_MAX_DIMENSION;
  const quality = options.quality ?? DEFAULT_OCR_JPEG_QUALITY;

  if (!imageManipulator || !imageUri) {
    return { uri: imageUri, processed: false, width: 0, height: 0 };
  }

  try {
    return await renderAndSave(imageManipulator, imageUri, quality, {
      maxWidth: maxDimension,
      maxHeight: maxDimension,
    });
  } catch (error) {
    console.warn('OCR image preprocessing failed, using original image:', error);
    return { uri: imageUri, processed: false, width: 0, height: 0 };
  }
}

interface ImageEnhancerNativeModule {
  enhanceAsync(uri: string): Promise<{ uri: string; width: number; height: number }>;
}

let imageEnhancerModule: ImageEnhancerNativeModule | null = null;
let imageEnhancerResolved = false;

function resolveImageEnhancer(): ImageEnhancerNativeModule | null {
  if (imageEnhancerResolved) return imageEnhancerModule;
  imageEnhancerResolved = true;
  try {
    // Enhance only when the native module was bundled with the app (dev/preview
    // builds after the module was added); never throws past this point.
    const mod = getImageEnhancerModule() as unknown as ImageEnhancerNativeModule | null;
    if (typeof mod?.enhanceAsync === 'function') {
      imageEnhancerModule = mod;
    }
  } catch {
    imageEnhancerModule = null;
  }
  return imageEnhancerModule;
}

/**
 * Renders a grayscale + contrast-normalized variant of the photo via the
 * native ImageEnhancer module (tuned for low-light label reads).
 *
 * Never throws: when the native module is not bundled (Expo Go, web, older
 * dev build) or the enhancement fails, the original URI is returned with
 * `processed: false` so the pipeline keeps its other passes.
 */
export async function enhanceImageForOcr(imageUri: string): Promise<PreparedImage> {
  const imageEnhancer = resolveImageEnhancer();
  if (!imageEnhancer || !imageUri) {
    return { uri: imageUri, processed: false, width: 0, height: 0 };
  }

  try {
    const enhanced = await imageEnhancer.enhanceAsync(imageUri);
    if (!enhanced?.uri) {
      return { uri: imageUri, processed: false, width: 0, height: 0 };
    }
    return {
      uri: enhanced.uri,
      processed: true,
      width: enhanced.width,
      height: enhanced.height,
    };
  } catch (error) {
    console.warn('OCR image enhancement failed, keeping previous passes:', error);
    return { uri: imageUri, processed: false, width: 0, height: 0 };
  }
}

/**
 * Renders one crop of an already-prepared OCR image, re-encoded as a clean
 * JPEG for a focused recognition pass.
 *
 * Never throws: on any failure the source image is returned unchanged so the
 * pipeline keeps its best whole-frame result.
 */
export async function cropImageRegionForOcr(
  imageUri: string,
  region: { originX: number; originY: number; width: number; height: number },
  options: PrepareOptions = {},
): Promise<PreparedImage> {
  const imageManipulator = resolveImageManipulator();
  const quality = options.quality ?? 0.95;

  if (!imageManipulator || !imageUri || region.width <= 0 || region.height <= 0) {
    return { uri: imageUri, processed: false, width: 0, height: 0 };
  }

  try {
    // No decode cap here: the rectangle is in the source file's pixel space,
    // and prepared variants are already sized sanely by prepareImageForOcr.
    return await renderAndSave(imageManipulator, imageUri, quality, {}, region);
  } catch (error) {
    console.warn('OCR image cropping failed, keeping whole frame:', error);
    return { uri: imageUri, processed: false, width: 0, height: 0 };
  }
}
