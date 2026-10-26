const {
  withAndroidManifest,
  withMainActivity,
  withMainApplication,
  withDangerousMod,
  createRunOncePlugin,
} = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

function withAlarmPermissions(config) {
  return withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults.manifest;

    const permissions = [
      "android.permission.USE_FULL_SCREEN_INTENT",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK",
      "android.permission.WAKE_LOCK",
      "android.permission.SCHEDULE_EXACT_ALARM",
      "android.permission.RECEIVE_BOOT_COMPLETED",
      "android.permission.VIBRATE",
      "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
    ];

    androidManifest["uses-permission"] =
      androidManifest["uses-permission"] || [];
    for (const perm of permissions) {
      if (
        !androidManifest["uses-permission"].some(
          (p) => p.$["android:name"] === perm,
        )
      ) {
        androidManifest["uses-permission"].push({
          $: { "android:name": perm },
        });
      }
    }

    const app = androidManifest.application[0];
    app.service = app.service || [];
    if (
      !app.service.some((s) => s.$["android:name"] === ".alarm.AlarmService")
    ) {
      app.service.push({
        $: {
          "android:name": ".alarm.AlarmService",
          "android:enabled": "true",
          "android:exported": "false",
          "android:foregroundServiceType": "mediaPlayback",
        },
      });
    }

    app.receiver = app.receiver || [];
    const receiverIndex = app.receiver.findIndex(
      (r) => r.$["android:name"] === ".alarm.AlarmReceiver",
    );
    const receiverObj = {
      $: {
        "android:name": ".alarm.AlarmReceiver",
        "android:enabled": "true",
        "android:exported": "false",
      },
      "intent-filter": [
        {
          action: [
            { $: { "android:name": "android.intent.action.BOOT_COMPLETED" } },
            {
              $: {
                "android:name": "android.intent.action.MY_PACKAGE_REPLACED",
              },
            },
            {
              $: {
                "android:name":
                  "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED",
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
      app.activity[0].$["android:showWhenLocked"] = "true";
      app.activity[0].$["android:turnScreenOn"] = "true";
    }

    return config;
  });
}

function withAlarmMainActivity(config) {
  return withMainActivity(config, (config) => {
    let contents = config.modResults.contents;
    if (!contents.includes("setShowWhenLocked")) {
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
      contents = contents.replace(
        "super.onCreate(null)",
        `${lockScreenCode}\n    super.onCreate(null)`,
      );
      config.modResults.contents = contents;
    }
    return config;
  });
}

function withAlarmMainApplication(config) {
  return withMainApplication(config, (config) => {
    let contents = config.modResults.contents;
    if (!contents.includes("AlarmPackage()")) {
      contents = contents.replace(
        "PackageList(this).packages.apply {",
        "PackageList(this).packages.apply {\n          add(com.healthmate.app.alarm.AlarmPackage())",
      );
      config.modResults.contents = contents;
    }
    return config;
  });
}

function withAlarmNativeFiles(config) {
  return withDangerousMod(config, [
    "android",
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const srcDir = path.join(projectRoot, "plugins/alarm-native");

      const targetJavaDir = path.join(
        projectRoot,
        "android/app/src/main/java/com/healthmate/app/alarm",
      );
      fs.mkdirSync(targetJavaDir, { recursive: true });

      const ktFiles = [
        "AlarmService.kt",
        "AlarmReceiver.kt",
        "AlarmModule.kt",
        "AlarmPackage.kt",
      ];
      for (const file of ktFiles) {
        const srcFile = path.join(srcDir, file);
        if (fs.existsSync(srcFile)) {
          fs.copyFileSync(srcFile, path.join(targetJavaDir, file));
        }
      }

      const targetResDir = path.join(
        projectRoot,
        "android/app/src/main/res/raw",
      );
      fs.mkdirSync(targetResDir, { recursive: true });

      const audioSrc = path.join(srcDir, "alarm_melody.wav");
      if (fs.existsSync(audioSrc)) {
        fs.copyFileSync(audioSrc, path.join(targetResDir, "alarm_melody.wav"));
      }

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

module.exports = createRunOncePlugin(
  withAlarmModule,
  "withAlarmModule",
  "1.0.0",
);
