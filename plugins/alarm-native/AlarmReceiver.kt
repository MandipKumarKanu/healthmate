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
            // Android boot or permission state change:
            // Alarm reconciliation will run when the app becomes active, restoring all alarms.
            return
        }

        val scheduleId = intent.getStringExtra(AlarmService.EXTRA_SCHEDULE_ID) ?: ""
        val medicineName = intent.getStringExtra(AlarmService.EXTRA_MEDICINE_NAME) ?: "Medication"
        val amount = intent.getStringExtra(AlarmService.EXTRA_AMOUNT) ?: ""
        val time = intent.getStringExtra(AlarmService.EXTRA_TIME) ?: ""
        val label = intent.getStringExtra(AlarmService.EXTRA_LABEL) ?: ""

        val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        @Suppress("DEPRECATION")
        val wakeLock = powerManager?.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP,
            "HealthMate:AlarmWakeLock"
        )
        wakeLock?.acquire(10 * 1000L)

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
    }
}
