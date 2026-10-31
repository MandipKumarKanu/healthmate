/**
 * ImageEnhancer - local Expo module for OCR pre-processing.
 *
 * Native (Kotlin + Swift) grayscale + contrast normalization for medicine
 * label photos taken in low light. Imported by `src/services/imagePreProcessing.ts`,
 * which owns the graceful no-native fallback.
 */
import ImageEnhancerModule, {
  EnhancedImage,
  getImageEnhancerModule,
} from './src/ImageEnhancerModule';

export { EnhancedImage, getImageEnhancerModule };
export default ImageEnhancerModule;
