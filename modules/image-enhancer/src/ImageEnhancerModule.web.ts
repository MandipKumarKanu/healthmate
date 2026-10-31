import { registerWebModule, NativeModule } from 'expo';
import type { ImageEnhancerModule } from './ImageEnhancerModule';

// ImageEnhancerModule is not available on the web platform.
class WebImageEnhancerModule extends NativeModule<Record<string, never>> {}

const webModule = registerWebModule(WebImageEnhancerModule, 'ImageEnhancerModule');

export function getImageEnhancerModule(): ImageEnhancerModule | null {
  return webModule as unknown as ImageEnhancerModule;
}

export default getImageEnhancerModule;
