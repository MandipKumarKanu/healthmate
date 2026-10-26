package com.healthmate.app.alarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import androidx.core.content.ContextCompat

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (action == Intent.ACTION_BOOT_COMPLETED ||
            action == Intent.ACTION_MY_PACKAGE_REPLACED ||
            action == "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED"
        ) {
            // Android wipes all AlarmManager alarms on reboot. Re-arm every
            // stored dose alarm natively here instead of waiting for the app to
            // next become active (the old behavior left doses silent until the
            // user opened the app).
            AlarmArming.reArmAll(context)
            return
        }

        val scheduleId = intent.getStringExtra(AlarmService.EXTRA_SCHEDULE_ID) ?: ""
        val medicineName = intent.getStringExtra(AlarmService.EXTRA_MEDICINE_NAME) ?: "Medication"
        val amount = intent.getStringExtra(AlarmService.EXTRA_AMOUNT) ?: ""
        val time = intent.getStringExtra(AlarmService.EXTRA_TIME) ?: ""
        val label = intent.getStringExtra(AlarmService.EXTRA_LABEL) ?: ""

        val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        @Suppress("DEPRECATION")
        val wakeLock = try {
            powerManager?.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or
                PowerManager.ACQUIRE_CAUSES_WAKEUP or
                PowerManager.ON_AFTER_RELEASE,
                "HealthMate:AlarmScreenWakeLock"
            )
        } catch (_: Exception) {
            null
        } ?: powerManager?.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "HealthMate:AlarmWakeLock"
        )
        try {
            wakeLock?.acquire(15 * 1000L)
        } catch (_: Exception) {}

        // Launch full-screen alarm activity immediately using the setAlarmClock
        // background activity launch (BAL) exemption, so the alarm screen appears
        // over the screen like the native Clock app instead of only showing a banner.
        val deepLinkUri = android.net.Uri.parse(
            "healthmate://alarm?scheduleId=" + android.net.Uri.encode(scheduleId) +
            "&medicineName=" + android.net.Uri.encode(medicineName) +
            "&amount=" + android.net.Uri.encode(amount) +
            "&time=" + android.net.Uri.encode(time) +
            "&label=" + android.net.Uri.encode(label)
        )

        val alarmActivityIntent = Intent(Intent.ACTION_VIEW, deepLinkUri, context, com.healthmate.app.MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
            putExtra(AlarmService.EXTRA_SCHEDULE_ID, scheduleId)
            putExtra(AlarmService.EXTRA_MEDICINE_NAME, medicineName)
            putExtra(AlarmService.EXTRA_AMOUNT, amount)
            putExtra(AlarmService.EXTRA_TIME, time)
            putExtra(AlarmService.EXTRA_LABEL, label)
        }

        try {
            context.startActivity(alarmActivityIntent)
        } catch (e: Exception) {
            // Direct launch may be restricted on some OEM background managers;
            // AlarmService foreground service with fullScreenIntent handles it reliably.
            android.util.Log.w("AlarmReceiver", "Direct startActivity from receiver failed, fullScreenIntent will handle: ${e.message}")
        }

        val serviceIntent = Intent(context, AlarmService::class.java).apply {
            this.action = AlarmService.ACTION_START_ALARM
            putExtra(AlarmService.EXTRA_SCHEDULE_ID, scheduleId)
            putExtra(AlarmService.EXTRA_MEDICINE_NAME, medicineName)
            putExtra(AlarmService.EXTRA_AMOUNT, amount)
            putExtra(AlarmService.EXTRA_TIME, time)
            putExtra(AlarmService.EXTRA_LABEL, label)
        }

        try {
            ContextCompat.startForegroundService(context, serviceIntent)
        } catch (e: Exception) {
            e.printStackTrace()
        }

        // Advance the persisted chain: drop the fired trigger, arm the next
        // one so recurring doses keep ringing even if the app is never opened.
        AlarmArming.fireAndAdvance(context, scheduleId, time)
    }
}
