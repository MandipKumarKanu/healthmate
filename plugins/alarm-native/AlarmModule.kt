package com.healthmate.app.alarm

import android.app.Activity
import android.app.AlarmManager
import android.app.KeyguardManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class AlarmModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AlarmModule"

    private val prefs by lazy {
        reactContext.getSharedPreferences(AlarmArming.PREFS_NAME, Context.MODE_PRIVATE)
    }

    @ReactMethod
    fun stopAlarm(promise: Promise) {
        try {
            stopAlarmInternal()
            reactContext.currentActivity?.runOnUiThread {
                try {
                    val activity = reactContext.currentActivity
                    if (activity != null) {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                            activity.setShowWhenLocked(false)
                        }
                        activity.window?.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    }
                } catch (_: Exception) {}
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("STOP_ALARM_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun snoozeAlarm(
        scheduleId: String,
        medicineName: String,
        amount: String,
        time: String,
        label: String,
        minutes: Int,
        promise: Promise
    ) {
        try {
            stopAlarmInternal()

            val snoozeMinutes = if (minutes > 0) minutes else 10
            val triggerAtMillis = System.currentTimeMillis() + (snoozeMinutes * 60 * 1000L)

            scheduleAlarmInternal(scheduleId, medicineName, amount, time, label, "once", triggerAtMillis)
            promise.resolve(triggerAtMillis.toDouble())
        } catch (e: Exception) {
            promise.reject("SNOOZE_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun scheduleAlarm(
        scheduleId: String,
        medicineName: String,
        amount: String,
        time: String,
        label: String,
        triggerAtMillis: Double,
        promise: Promise
    ) {
        try {
            scheduleAlarmInternal(scheduleId, medicineName, amount, time, label, "once", triggerAtMillis.toLong())
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SCHEDULE_FAILED", e.message, e)
        }
    }

    /**
     * Stores the full upcoming trigger chain (epoch millis, computed by the JS
     * scheduler) for one dose and arms the earliest future trigger. Also
     * de-duplicates by clearing any previous alarm for this schedule+time.
     */
    @ReactMethod
    fun syncAlarmChain(
        scheduleId: String,
        medicineName: String,
        amount: String,
        time: String,
        label: String,
        recurrence: String,
        startDate: String,
        endDate: String,
        triggersJson: String,
        promise: Promise
    ) {
        try {
            val triggers = org.json.JSONArray(triggersJson)
            val millis = (0 until triggers.length())
                .map { triggers.optLong(it) }
                .filter { it > System.currentTimeMillis() }
                .sorted()
                .toMutableList()

            // Replace any previously armed alarm for the same dose.
            AlarmArming.cancelPendingIntent(reactContext, scheduleId, time)

            val entry = AlarmArming.Entry(
                scheduleId = scheduleId,
                time = time,
                medicineName = medicineName,
                amount = amount,
                label = label,
                recurrence = recurrence,
                startDate = startDate,
                endDate = endDate.takeIf { it.isNotBlank() },
                hasDateBounds = true,
                triggers = millis
            )
            AlarmArming.saveEntry(reactContext, entry)

            val earliest = millis.firstOrNull()
            if (earliest != null) {
                AlarmArming.armEntry(reactContext, entry, earliest)
                promise.resolve(true)
            } else {
                promise.resolve(false)
            }
        } catch (e: Exception) {
            promise.reject("SYNC_CHAIN_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun cancelAlarm(scheduleId: String, promise: Promise) {
        try {
            cancelAlarmInternal(scheduleId)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CANCEL_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun cancelAllAlarms(promise: Promise) {
        try {
            stopAlarmInternal()
            AlarmArming.cancelAll(reactContext)
            prefs.edit().remove("active_ids").apply()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CANCEL_ALL_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun canScheduleExactAlarms(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val alarmManager = reactContext.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
                promise.resolve(alarmManager?.canScheduleExactAlarms() ?: false)
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun dismissKeyguard(promise: Promise) {
        try {
            val activity: Activity? = reactContext.currentActivity
            if (activity != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val keyguardManager = reactContext.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
                keyguardManager?.requestDismissKeyguard(activity, null)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun isIgnoringBatteryOptimizations(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val powerManager = reactContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
                val isIgnoring = powerManager?.isIgnoringBatteryOptimizations(reactContext.packageName) ?: true
                promise.resolve(isIgnoring)
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun requestIgnoreBatteryOptimizations(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val powerManager = reactContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
                if (powerManager?.isIgnoringBatteryOptimizations(reactContext.packageName) == true) {
                    promise.resolve(true)
                    return
                }

                try {
                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:${reactContext.packageName}")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    reactContext.startActivity(intent)
                    promise.resolve(true)
                } catch (e: Exception) {
                    val fallbackIntent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    reactContext.startActivity(fallbackIntent)
                    promise.resolve(true)
                }
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("REQUEST_IGNORE_BATTERY_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun openExactAlarmSettings(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val intent = Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM).apply {
                    data = Uri.parse("package:${reactContext.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(intent)
                promise.resolve(true)
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            try {
                val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:${reactContext.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(intent)
                promise.resolve(true)
            } catch (fallbackEx: Exception) {
                promise.reject("OPEN_EXACT_ALARM_SETTINGS_FAILED", e.message, e)
            }
        }
    }

    @ReactMethod
    fun canUseFullScreenIntent(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                val notificationManager = reactContext.getSystemService(Context.NOTIFICATION_SERVICE) as? android.app.NotificationManager
                promise.resolve(notificationManager?.canUseFullScreenIntent() ?: true)
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun openFullScreenIntentSettings(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
                    data = Uri.parse("package:${reactContext.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(intent)
                promise.resolve(true)
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("OPEN_FSI_SETTINGS_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun openAppBatterySettings(promise: Promise) {
        try {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.parse("package:${reactContext.packageName}")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            reactContext.startActivity(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("OPEN_APP_SETTINGS_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun getDeviceManufacturer(promise: Promise) {
        try {
            val manufacturer = Build.MANUFACTURER ?: "unknown"
            promise.resolve(manufacturer.lowercase())
        } catch (e: Exception) {
            promise.resolve("unknown")
        }
    }

    @ReactMethod
    fun openOemAutoStartSettings(promise: Promise) {
        try {
            val mfr = (Build.MANUFACTURER ?: "").lowercase()
            val intents = mutableListOf<Intent>()

            when {
                mfr.contains("xiaomi") || mfr.contains("redmi") || mfr.contains("poco") -> {
                    intents.add(Intent().setComponent(ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")))
                }
                mfr.contains("huawei") || mfr.contains("honor") -> {
                    intents.add(Intent().setComponent(ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity")))
                    intents.add(Intent().setComponent(ComponentName("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity")))
                }
                mfr.contains("oppo") || mfr.contains("realme") -> {
                    intents.add(Intent().setComponent(ComponentName("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity")))
                    intents.add(Intent().setComponent(ComponentName("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity")))
                }
                mfr.contains("vivo") || mfr.contains("iqoo") -> {
                    intents.add(Intent().setComponent(ComponentName("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity")))
                    intents.add(Intent().setComponent(ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity")))
                }
                mfr.contains("samsung") -> {
                    intents.add(Intent().setComponent(ComponentName("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity")))
                }
            }

            var launched = false
            for (intent in intents) {
                try {
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    reactContext.startActivity(intent)
                    launched = true
                    break
                } catch (_: Exception) {
                    // Try next
                }
            }

            if (!launched) {
                val appDetailsIntent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.parse("package:${reactContext.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(appDetailsIntent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    private fun stopAlarmInternal() {
        val stopIntent = Intent(reactContext, AlarmService::class.java).apply {
            action = AlarmService.ACTION_STOP_ALARM
        }
        reactContext.startService(stopIntent)
    }

    private fun cancelAlarmInternal(scheduleId: String) {
        AlarmArming.cancelAllForSchedule(reactContext, scheduleId)
        val currentIds = prefs.getStringSet("active_ids", emptySet())?.toMutableSet() ?: mutableSetOf()
        currentIds.remove(scheduleId)
        prefs.edit().putStringSet("active_ids", currentIds).apply()
    }

    private fun scheduleAlarmInternal(
        scheduleId: String,
        medicineName: String,
        amount: String,
        time: String,
        label: String,
        recurrence: String = "once",
        triggerAtMillis: Long
    ) {
        // Persist first so the alarm survives reboots, then arm it.
        AlarmArming.saveEntry(
            reactContext,
            AlarmArming.Entry(scheduleId, time, medicineName, amount, label, recurrence, mutableListOf(triggerAtMillis))
        )
        AlarmArming.armEntry(
            reactContext,
            AlarmArming.Entry(scheduleId, time, medicineName, amount, label, recurrence, mutableListOf(triggerAtMillis)),
            triggerAtMillis
        )

        // Track active schedule ID
        val currentIds = prefs.getStringSet("active_ids", emptySet())?.toMutableSet() ?: mutableSetOf()
        currentIds.add(scheduleId)
        prefs.edit().putStringSet("active_ids", currentIds).apply()
    }
}
