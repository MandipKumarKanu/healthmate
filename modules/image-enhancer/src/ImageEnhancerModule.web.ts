import { registerWebModule, NativeModule } from 'expo';

// ImageEnhancerModule is not available on the web platform.
class ImageEnhancerModule extends NativeModule<{}> {}

export default registerWebModule(ImageEnhancerModule, 'ImageEnhancerModule');
