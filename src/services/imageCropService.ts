/**
 * HealthMate - Image Crop & Adjustment Service
 *
 * Provides real boundary cropping, 90-degree step rotation, preset calculation,
 * and optional low-light contrast enhancement for medicine packaging images.
 * Always preserves the original uncropped image, saving the manipulated output
 * to a distinct separate asset URI.
 */

import { Image } from 'react-native';
import { manipulateAsync, SaveFormat, Action, ImageResult } from 'expo-image-manipulator';
import { enhanceImageForOcr } from './imagePreProcessing';

export interface CropBounds {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export type CropPreset = 'auto' | 'full' | 'inset_5' | 'aspect_4_3' | 'aspect_1_1';

export interface CropAdjustOptions {
  crop?: CropBounds;
  rotation?: number; // 0, 90, 180, 270
  enhance?: boolean;
  quality?: number;
}

export interface CropResult {
  uri: string;
  width: number;
  height: number;
  rotation: number;
  enhanced: boolean;
  cropped: boolean;
}

/**
 * Calculates preset crop boundaries based on image dimensions.
 */
export function calculatePresetCrop(
  imageWidth: number,
  imageHeight: number,
  preset: CropPreset = 'auto',
): CropBounds {
  const safeWidth = Math.max(imageWidth, 1);
  const safeHeight = Math.max(imageHeight, 1);

  switch (preset) {
    case 'full':
      return { originX: 0, originY: 0, width: safeWidth, height: safeHeight };

    case 'auto':
    case 'inset_5': {
      // 5% margin inside image frame to auto-focus on medication box
      const marginX = Math.round(safeWidth * 0.05);
      const marginY = Math.round(safeHeight * 0.05);
      return {
        originX: marginX,
        originY: marginY,
        width: Math.max(safeWidth - marginX * 2, 10),
        height: Math.max(safeHeight - marginY * 2, 10),
      };
    }

    case 'aspect_4_3': {
      // Centered 4:3 box
      const targetAspect = 4 / 3;
      let w = safeWidth;
      let h = Math.round(w / targetAspect);
      if (h > safeHeight) {
        h = safeHeight;
        w = Math.round(h * targetAspect);
      }
      const originX = Math.max(0, Math.floor((safeWidth - w) / 2));
      const originY = Math.max(0, Math.floor((safeHeight - h) / 2));
      return { originX, originY, width: w, height: h };
    }

    case 'aspect_1_1': {
      // Centered square
      const size = Math.min(safeWidth, safeHeight);
      const originX = Math.max(0, Math.floor((safeWidth - size) / 2));
      const originY = Math.max(0, Math.floor((safeHeight - size) / 2));
      return { originX, originY, width: size, height: size };
    }

    default:
      return { originX: 0, originY: 0, width: safeWidth, height: safeHeight };
  }
}

/**
 * Inspects natural image dimensions from local URI.
 */
export async function getImageDimensions(uri: string): Promise<{ width: number; height: number }> {
  if (!uri) return { width: 0, height: 0 };
  if (typeof Image?.getSize !== 'function') {
    return { width: 0, height: 0 };
  }
  return new Promise((resolve) => {
    try {
      Image.getSize(
        uri,
        (width, height) => resolve({ width, height }),
        () => resolve({ width: 0, height: 0 }),
      );
    } catch {
      resolve({ width: 0, height: 0 });
    }
  });
}

/**
 * Executes real cropping, rotation, and optional contrast enhancement.
 * Never modifies or deletes the original source file.
 */
export async function cropAndAdjustImage(
  sourceUri: string,
  options: CropAdjustOptions = {},
): Promise<CropResult> {
  if (!sourceUri) {
    throw new Error('No source image provided for crop and adjustment.');
  }

  const { crop, rotation = 0, enhance = false, quality = 0.9 } = options;
  const actions: Action[] = [];

  // Normalize rotation to standard 0, 90, 180, 270
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  if (normalizedRotation !== 0) {
    actions.push({ rotate: normalizedRotation });
  }

  // Add crop if valid bounds specified
  let hasCrop = false;
  if (crop && crop.width > 0 && crop.height > 0) {
    actions.push({
      crop: {
        originX: Math.max(0, Math.round(crop.originX)),
        originY: Math.max(0, Math.round(crop.originY)),
        width: Math.max(1, Math.round(crop.width)),
        height: Math.max(1, Math.round(crop.height)),
      },
    });
    hasCrop = true;
  }

  let resultUri = sourceUri;
  let outWidth = 0;
  let outHeight = 0;

  try {
    if (actions.length > 0) {
      const manipulated: ImageResult = await manipulateAsync(sourceUri, actions, {
        format: SaveFormat.JPEG,
        compress: quality,
      });
      resultUri = manipulated.uri;
      outWidth = manipulated.width;
      outHeight = manipulated.height;
    } else {
      const dims = await getImageDimensions(sourceUri);
      outWidth = dims.width;
      outHeight = dims.height;
    }
  } catch (manipulateError) {
    console.warn('Image manipulation failed, using original:', manipulateError);
    const dims = await getImageDimensions(sourceUri);
    return {
      uri: sourceUri,
      width: dims.width,
      height: dims.height,
      rotation: 0,
      enhanced: false,
      cropped: false,
    };
  }

  // Apply native enhancement if requested
  let enhancedApplied = false;
  if (enhance) {
    try {
      const enhanced = await enhanceImageForOcr(resultUri);
      if (enhanced.processed && enhanced.uri) {
        resultUri = enhanced.uri;
        if (enhanced.width) outWidth = enhanced.width;
        if (enhanced.height) outHeight = enhanced.height;
        enhancedApplied = true;
      }
    } catch (enhanceErr) {
      console.warn('Image enhancement pass skipped:', enhanceErr);
    }
  }

  return {
    uri: resultUri,
    width: outWidth,
    height: outHeight,
    rotation: normalizedRotation,
    enhanced: enhancedApplied,
    cropped: hasCrop,
  };
}
