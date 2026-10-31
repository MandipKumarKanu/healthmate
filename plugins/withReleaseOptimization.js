const { withAppBuildGradle, withGradleProperties } = require('@expo/config-plugins');

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

/**
 * Configure release builds to use an explicit production keystore. The
 * keystore path/passwords are read only from CI/local build environment or
 * Gradle properties and are never committed to the repository. If the
 * keystore is not configured, release assembly fails rather than silently
 * producing a debug-signed artifact.
 */
function withProductionSigning(config) {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;
    if (!contents.includes('healthmateRelease')) {
      const signingConfig = `
    signingConfigs {
        healthmateRelease {
            def releaseStoreFile = System.getenv('HEALTHMATE_RELEASE_STORE_FILE') ?: findProperty('HEALTHMATE_RELEASE_STORE_FILE')
            def releaseStorePassword = System.getenv('HEALTHMATE_RELEASE_STORE_PASSWORD') ?: findProperty('HEALTHMATE_RELEASE_STORE_PASSWORD') ?: ''
            def releaseKeyAlias = System.getenv('HEALTHMATE_RELEASE_KEY_ALIAS') ?: findProperty('HEALTHMATE_RELEASE_KEY_ALIAS') ?: ''
            def releaseKeyPassword = System.getenv('HEALTHMATE_RELEASE_KEY_PASSWORD') ?: findProperty('HEALTHMATE_RELEASE_KEY_PASSWORD') ?: ''
            // Keep debug builds usable, but make a release build fail clearly
            // when production signing has not been configured.
            storeFile file(releaseStoreFile ?: '\$rootDir/.missing-healthmate-release.keystore')
            storePassword releaseStorePassword
            keyAlias releaseKeyAlias
            keyPassword releaseKeyPassword
        }
    }
`;
      contents = contents.replace(/\n\s*buildTypes\s*\{/,
        `\n${signingConfig}\n    buildTypes {`);
    }

    contents = contents.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/,
      '$1signingConfig signingConfigs.healthmateRelease',
    );

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = (config, options = {}) => {
  config = withReleaseOptimization(config, options);
  return withProductionSigning(config);
};
