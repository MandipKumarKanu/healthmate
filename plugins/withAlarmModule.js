const {
  withAndroidManifest,
  withMainActivity,
  withMainApplication,
  withDangerousMod,
  createRunOncePlugin,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

function applyManifestModifications(androidManifest) {
  const permissions = [
    'android.permission.INTERNET',
    'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.USE_FULL_SCREEN_INTENT',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
    'android.permission.WAKE_LOCK',
    'android.permission.SCHEDULE_EXACT_ALARM',
    'android.permission.RECEIVE_BOOT_COMPLETED',
    'android.permission.VIBRATE',
    'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
  ];

  androidManifest['uses-permission'] = androidManifest['uses-permission'] || [];
  for (const perm of permissions) {
    if (!androidManifest['uses-permission'].some((p) => p.$['android:name'] === perm)) {
      androidManifest['uses-permission'].push({
        $: { 'android:name': perm },
      });
    }
  }

  const app = androidManifest.application[0];
  app.$['android:usesCleartextTraffic'] = 'false';
  app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
  app.service = app.service || [];
  if (!app.service.some((s) => s.$['android:name'] === '.alarm.AlarmService')) {
    app.service.push({
      $: {
        'android:name': '.alarm.AlarmService',
        'android:enabled': 'true',
        'android:exported': 'false',
        'android:foregroundServiceType': 'mediaPlayback',
      },
    });
  }

  app.receiver = app.receiver || [];
  const receiverIndex = app.receiver.findIndex(
    (r) => r.$['android:name'] === '.alarm.AlarmReceiver',
  );
  const receiverObj = {
    $: {
      'android:name': '.alarm.AlarmReceiver',
      'android:enabled': 'true',
      'android:exported': 'true',
    },
    'intent-filter': [
      {
        action: [
          { $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } },
          { $: { 'android:name': 'android.intent.action.LOCKED_BOOT_COMPLETED' } },
          { $: { 'android:name': 'android.intent.action.MY_PACKAGE_REPLACED' } },
          { $: { 'android:name': 'android.intent.action.QUICKBOOT_POWERON' } },
          { $: { 'android:name': 'com.htc.intent.action.QUICKBOOT_POWERON' } },
          {
            $: {
              'android:name': 'android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED',
            },
          },
        ],
      },
    ],
  };
  if (receiverIndex >= 0) {
    app.receiver[receiverIndex] = receiverObj;
  } else {
    app.receiver.push(receiverObj);
  }

  if (app.activity && app.activity[0]) {
    app.activity[0].$ = app.activity[0].$ || {};
    app.activity[0].$['android:showWhenLocked'] = 'true';
    app.activity[0].$['android:turnScreenOn'] = 'true';
  }

  return androidManifest;
}

function withAlarmPermissions(config) {
  return withAndroidManifest(config, (config) => {
    applyManifestModifications(config.modResults.manifest);
    return config;
  });
}

function withAlarmMainActivity(config) {
  return withMainActivity(config, (config) => {
    let contents = config.modResults.contents;
    if (!contents.includes('setShowWhenLocked')) {
      const lockScreenCode = `
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
        android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
        android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
        android.view.WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
      )
    }
    window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
`;
      const onNewIntentCode = `
  override fun onNewIntent(intent: android.content.Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
        android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
        android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
        android.view.WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
      )
    }
    window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    val keyguardManager = getSystemService(android.content.Context.KEYGUARD_SERVICE) as? android.app.KeyguardManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      keyguardManager?.requestDismissKeyguard(this, null)
    }
  }
`;
      // Insert lockScreenCode before super.onCreate(null)
      contents = contents.replace(
        'super.onCreate(null)',
        `${lockScreenCode}\n    super.onCreate(null)`,
      );
      // Insert onNewIntent immediately after onCreate closing brace
      contents = contents.replace(
        /(super\.onCreate\(null\)\s*\n\s*\})/,
        `$1\n\n${onNewIntentCode}`,
      );
      config.modResults.contents = contents;
    }
    return config;
  });
}

function withAlarmMainApplication(config) {
  return withMainApplication(config, (config) => {
    let contents = config.modResults.contents;
    if (!contents.includes('AlarmPackage()')) {
      contents = contents.replace(
        'PackageList(this).packages.apply {',
        'PackageList(this).packages.apply {\n          add(com.healthmate.app.alarm.AlarmPackage())',
      );
      config.modResults.contents = contents;
    }
    return config;
  });
}

function withAlarmNativeFiles(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const srcDir = path.join(projectRoot, 'plugins/alarm-native');

      const targetJavaDir = path.join(
        projectRoot,
        'android/app/src/main/java/com/healthmate/app/alarm',
      );
      fs.mkdirSync(targetJavaDir, { recursive: true });

      const ktFiles = [
        'AlarmService.kt',
        'AlarmReceiver.kt',
        'AlarmModule.kt',
        'AlarmPackage.kt',
        'AlarmArming.kt',
      ];
      for (const file of ktFiles) {
        const srcFile = path.join(srcDir, file);
        if (fs.existsSync(srcFile)) {
          fs.copyFileSync(srcFile, path.join(targetJavaDir, file));
        }
      }

      const targetResDir = path.join(projectRoot, 'android/app/src/main/res/raw');
      fs.mkdirSync(targetResDir, { recursive: true });

      const audioSrc = path.join(srcDir, 'alarm_melody.wav');
      if (fs.existsSync(audioSrc)) {
        fs.copyFileSync(audioSrc, path.join(targetResDir, 'alarm_melody.wav'));
      }

      const targetXmlDir = path.join(projectRoot, 'android/app/src/main/res/xml');
      fs.mkdirSync(targetXmlDir, { recursive: true });

      const networkSecurityConfigContent = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">localhost</domain>
        <domain includeSubdomains="true">127.0.0.1</domain>
        <domain includeSubdomains="true">10.0.2.2</domain>
    </domain-config>
    <debug-overrides>
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </debug-overrides>
</network-security-config>
`;
      fs.writeFileSync(
        path.join(targetXmlDir, 'network_security_config.xml'),
        networkSecurityConfigContent,
        'utf8',
      );

      return config;
    },
  ]);
}

const withAlarmModule = (config) => {
  config = withAlarmPermissions(config);
  config = withAlarmMainActivity(config);
  config = withAlarmMainApplication(config);
  config = withAlarmNativeFiles(config);
  return config;
};

const plugin = createRunOncePlugin(withAlarmModule, 'withAlarmModule', '1.0.0');
plugin.applyManifestModifications = applyManifestModifications;

module.exports = plugin;
