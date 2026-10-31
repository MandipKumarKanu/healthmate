const { withGradleProperties } = require('@expo/config-plugins');

/**
 * Removes size dead-weight from the Android build. `expo prebuild --clean`
 * (used by every CI workflow) regenerates `android/gradle.properties` from
 * Expo defaults, which would otherwise:
 *
 *   - package all 4 ABIs (x86/x86_64 libraries are emulator-only and add
 *     ~10MB+ compressed to a universal APK),
 *   - skip R8/ProGuard shrinking (`android.enableMinifyInReleaseBuilds=false`),
 *   - bundle Fresco's GIF + WebP support libs even though the app renders no
 *     GIFs or WebP through RN's <Image> (expo-image handles its own formats).
 *
 * This plugin re-applies all three after prebuild, so CI and local builds
 * behave identically.
 */
function withReleaseOptimization(config, options = {}) {
  return withGradleProperties(config, (config) => {
    const overrides = {
      reactNativeArchitectures: {
        value: options.architectures || 'armeabi-v7a,arm64-v8a',
        comment: 'Only real-device ABIs; x86/x86_64 are emulator-only',
      },
      'android.enableMinifyInReleaseBuilds': {
        value: 'true',
        comment: 'R8 shrinking for release builds',
      },
      'expo.gif.enabled': {
        value: 'false',
        comment: 'No GIF assets in the app; saves Fresco libs',
      },
      'expo.webp.enabled': {
        value: 'false',
        comment: 'No WebP assets in the app; saves Fresco libs',
      },
    };

    const results = config.modResults.map((item) => {
      if (item.type !== 'property') return item;
      const override = overrides[item.key];
      if (override) {
        delete overrides[item.key]; // applied
      }
      return override ? { ...item, ...override } : item;
    });

    // Append any optimization key the prebuild template did not generate.
    for (const [key, { value, comment }] of Object.entries(overrides)) {
      results.push({ type: 'property', key, value, comment });
    }

    config.modResults = results;
    return config;
  });
}

module.exports = withReleaseOptimization;
