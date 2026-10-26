package com.healthmate.app.alarm

import android.app.AlarmManager
import android.app.KeyguardManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.healthmate.app.MainActivity

class AlarmModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "AlarmModule"

    private val prefs by lazy {
        reactContext.getSharedPreferences("healthmate_active_alarms", Context.MODE_PRIVATE)
    }

    @ReactMethod
    fun stopAlarm(promise: Promise) {
        try {
            stopAlarmInternal()
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

            scheduleAlarmInternal(scheduleId, medicineName, amount, time, label, triggerAtMillis)
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
            scheduleAlarmInternal(scheduleId, medicineName, amount, time, label, triggerAtMillis.toLong())
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SCHEDULE_FAILED", e.message, e)
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
            val alarmManager = reactContext.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
            val activeIds = prefs.getStringSet("active_ids", emptySet()) ?: emptySet()

            for (id in activeIds) {
                val intent = Intent(reactContext, AlarmReceiver::class.java)
                val pendingIntent = PendingIntent.getBroadcast(
                    reactContext,
                    id.hashCode(),
                    intent,
                    PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
                )
                if (pendingIntent != null && alarmManager != null) {
                    alarmManager.cancel(pendingIntent)
                    pendingIntent.cancel()
                }
            }
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
            currentActivity?.let { activity ->
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    val keyguardManager = reactContext.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
                    keyguardManager?.requestDismissKeyguard(activity, null)
                }
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
        val alarmManager = reactContext.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
        val intent = Intent(reactContext, AlarmReceiver::class.java)
        val pendingIntent = PendingIntent.getBroadcast(
            reactContext,
            scheduleId.hashCode(),
            intent,
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        )
        if (pendingIntent != null && alarmManager != null) {
            alarmManager.cancel(pendingIntent)
            pendingIntent.cancel()
        }
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
        triggerAtMillis: Long
    ) {
        val alarmManager = reactContext.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        val intent = Intent(reactContext, AlarmReceiver::class.java).apply {
            putExtra(AlarmService.EXTRA_SCHEDULE_ID, scheduleId)
            putExtra(AlarmService.EXTRA_MEDICINE_NAME, medicineName)
            putExtra(AlarmService.EXTRA_AMOUNT, amount)
            putExtra(AlarmService.EXTRA_TIME, time)
            putExtra(AlarmService.EXTRA_LABEL, label)
        }

        val pendingIntent = PendingIntent.getBroadcast(
            reactContext,
            scheduleId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val showIntent = Intent(reactContext, MainActivity::class.java)
        val showPendingIntent = PendingIntent.getActivity(
            reactContext,
            scheduleId.hashCode(),
            showIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val canExact = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            alarmManager.canScheduleExactAlarms()
        } else {
            true
        }

        if (canExact) {
            alarmManager.setAlarmClock(
                AlarmManager.AlarmClockInfo(triggerAtMillis, showPendingIntent),
                pendingIntent
            )
        } else {
            // Graceful fallback if exact-alarm permission was revoked or absent
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pendingIntent)
            } else {
                alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAtMillis, pendingIntent)
            }
        }

        // Track active schedule ID
        val currentIds = prefs.getStringSet("active_ids", emptySet())?.toMutableSet() ?: mutableSetOf()
        currentIds.add(scheduleId)
        prefs.edit().putStringSet("active_ids", currentIds).apply()
    }
}
