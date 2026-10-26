import { NativeModule, requireNativeModule } from 'expo';

/** Result of one grayscale + contrast enhancement pass. */
export interface EnhancedImage {
  /** file:// URI of the re-encoded grayscale/contrast JPEG. */
  uri: string;
  width: number;
  height: number;
}

declare class ImageEnhancerModule extends NativeModule<{}> {
  /**
   * Converts a local image to luma grayscale, auto-stretches contrast to the
   * 2nd-98th luminance percentiles, and applies an adaptive gamma for
   * low-light labels. Re-encodes a clean JPEG into the app's cache.
   */
  enhanceAsync(uri: string): Promise<EnhancedImage>;
}

export default requireNativeModule<ImageEnhancerModule>('ImageEnhancer');
