import { NativeModule, requireNativeModule } from 'expo';

/** Result of one grayscale + contrast enhancement pass. */
export interface EnhancedImage {
  /** file:// URI of the re-encoded grayscale/contrast JPEG. */
  uri: string;
  width: number;
  height: number;
}

export interface ImageEnhancerModule extends NativeModule<Record<string, never>> {
  /**
   * Converts a local image to luma grayscale, auto-stretches contrast to the
   * 2nd-98th luminance percentiles, and applies an adaptive gamma for
   * low-light labels. Re-encodes a clean JPEG into the app's cache.
   */
  enhanceAsync(uri: string): Promise<EnhancedImage>;
}

/**
 * Resolve the native implementation only when the enhancement path is used.
 * Expo Go, web, and older development builds do not necessarily contain this
 * local module, so importing the package itself must never throw.
 */
export function getImageEnhancerModule(): ImageEnhancerModule | null {
  try {
    return requireNativeModule<ImageEnhancerModule>('ImageEnhancer');
  } catch {
    return null;
  }
}

export default getImageEnhancerModule;
