package com.healthmate.app.alarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import com.healthmate.app.MainActivity
import com.healthmate.app.R
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ConcurrentHashMap

class AlarmService : Service() {

    private var mediaPlayer: MediaPlayer? = null
    private var vibrator: Vibrator? = null

    data class ActiveAlarm(
        val scheduleId: String,
        val medicineName: String,
        val amount: String,
        val time: String,
        val label: String,
        val instanceId: String,
        val sourceScheduleId: String,
        val notificationId: Int
    ) {
        val key: String get() = if (instanceId.isNotEmpty()) "$scheduleId:$instanceId" else "$scheduleId:$time"

        fun toJson(): JSONObject = JSONObject().apply {
            put("scheduleId", scheduleId)
            put("medicineName", medicineName)
            put("amount", amount)
            put("time", time)
            put("label", label)
            put("instanceId", instanceId)
            put("sourceScheduleId", sourceScheduleId)
            put("notificationId", notificationId)
        }
    }

    companion object {
        const val CHANNEL_ID = "medication_alarm_channel"
        const val NOTIFICATION_ID = 9001
        const val SUMMARY_NOTIFICATION_ID = 9000
        const val GROUP_KEY = "com.healthmate.app.MEDICATION_ALARMS"

        const val ACTION_START_ALARM = "com.healthmate.app.ACTION_START_ALARM"
        const val ACTION_STOP_ALARM = "com.healthmate.app.ACTION_STOP_ALARM"
        const val EXTRA_SCHEDULE_ID = "scheduleId"
        const val EXTRA_MEDICINE_NAME = "medicineName"
        const val EXTRA_AMOUNT = "amount"
        const val EXTRA_TIME = "time"
        const val EXTRA_LABEL = "label"
        const val EXTRA_TRIGGER_AT_MILLIS = "triggerAtMillis"
        const val EXTRA_SOURCE_SCHEDULE_ID = "sourceScheduleId"
        const val EXTRA_SOURCE_INSTANCE_ID = "sourceInstanceId"

        val activeAlarms = ConcurrentHashMap<String, ActiveAlarm>()

        fun getActiveAlarmsJson(): String {
            val array = JSONArray()
            for (alarm in activeAlarms.values) {
                array.put(alarm.toJson())
            }
            return array.toString()
        }

        fun hasActiveAlarms(): Boolean = activeAlarms.isNotEmpty()

        fun notificationIdFor(scheduleId: String, time: String, instanceId: String = ""): Int {
            val key = if (instanceId.isNotEmpty()) "$scheduleId:$instanceId" else "$scheduleId:$time"
            return 10000 + (Math.abs(key.hashCode()) % 80000)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: return START_NOT_STICKY

        if (action == ACTION_STOP_ALARM) {
            val targetScheduleId = intent.getStringExtra(EXTRA_SCHEDULE_ID)
            val targetTime = intent.getStringExtra(EXTRA_TIME)
            val targetInstanceId = intent.getStringExtra(EXTRA_SOURCE_INSTANCE_ID)

            if (targetScheduleId.isNullOrEmpty()) {
                // Global stop: clears all active alarms
                stopAllAlarms()
            } else {
                // Scoped stop: dismisses only this specific dose
                stopDoseAlarm(targetScheduleId, targetTime, targetInstanceId)
            }
            return START_NOT_STICKY
        }

        if (action == ACTION_START_ALARM) {
            val scheduleId = intent.getStringExtra(EXTRA_SCHEDULE_ID) ?: ""
            val medicineName = intent.getStringExtra(EXTRA_MEDICINE_NAME) ?: "Medication"
            val amount = intent.getStringExtra(EXTRA_AMOUNT) ?: ""
            val time = intent.getStringExtra(EXTRA_TIME) ?: ""
            val label = intent.getStringExtra(EXTRA_LABEL) ?: ""
            val sourceScheduleId = intent.getStringExtra(EXTRA_SOURCE_SCHEDULE_ID) ?: ""
            val instanceId = intent.getStringExtra(EXTRA_SOURCE_INSTANCE_ID) ?: ""

            startAlarm(scheduleId, medicineName, amount, time, label, instanceId, sourceScheduleId)
        }

        return START_STICKY
    }

    private fun startAlarm(
        scheduleId: String,
        medicineName: String,
        amount: String,
        time: String,
        label: String,
        instanceId: String,
        sourceScheduleId: String
    ) {
        createNotificationChannel()

        val notifId = notificationIdFor(scheduleId, time, instanceId)
        val active = ActiveAlarm(
            scheduleId = scheduleId,
            medicineName = medicineName,
            amount = amount,
            time = time,
            label = label,
            instanceId = instanceId,
            sourceScheduleId = sourceScheduleId,
            notificationId = notifId
        )
        activeAlarms[active.key] = active

        val notification = buildDoseNotification(active)
        val notificationManager = getSystemService(NotificationManager::class.java)

        // If this is the only active alarm, promote it to the foreground service notification
        if (activeAlarms.size == 1) {
            startForeground(notifId, notification)
        } else {
            // Simultaneous dose: notify independently under the group so both are represented
            notificationManager?.notify(notifId, notification)
            updateSummaryNotification()
        }

        // Try direct startActivity as well to ensure full-screen alarm appears
        try {
            val fullScreenIntent = createFullScreenIntent(active)
            startActivity(fullScreenIntent)
        } catch (_: Exception) {
            // fullScreenIntent on notification handles delivery when background launch is constrained
        }

        playAudio()
        startVibration()
    }

    private fun createFullScreenIntent(alarm: ActiveAlarm): Intent {
        val deepLinkUri = Uri.parse(
            "healthmate://alarm?scheduleId=" + Uri.encode(alarm.scheduleId) +
            "&medicineName=" + Uri.encode(alarm.medicineName) +
            "&amount=" + Uri.encode(alarm.amount) +
            "&time=" + Uri.encode(alarm.time) +
            "&label=" + Uri.encode(alarm.label) +
            "&instanceId=" + Uri.encode(alarm.instanceId) +
            "&sourceScheduleId=" + Uri.encode(alarm.sourceScheduleId)
        )

        return Intent(Intent.ACTION_VIEW, deepLinkUri, this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
            putExtra(EXTRA_SCHEDULE_ID, alarm.scheduleId)
            putExtra(EXTRA_MEDICINE_NAME, alarm.medicineName)
            putExtra(EXTRA_AMOUNT, alarm.amount)
            putExtra(EXTRA_TIME, alarm.time)
            putExtra(EXTRA_LABEL, alarm.label)
            putExtra(EXTRA_SOURCE_SCHEDULE_ID, alarm.sourceScheduleId)
            putExtra(EXTRA_SOURCE_INSTANCE_ID, alarm.instanceId)
            putExtra("is_alarm_intent", true)
        }
    }

    private fun buildDoseNotification(alarm: ActiveAlarm): Notification {
        val fullScreenIntent = createFullScreenIntent(alarm)
        val requestCode = (alarm.scheduleId + "_" + alarm.time + "_" + alarm.instanceId).hashCode()

        val fullScreenPendingIntent = PendingIntent.getActivity(
            this,
            requestCode,
            fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Dismiss intent specifically targets this individual dose alarm
        val dismissIntent = Intent(this, AlarmService::class.java).apply {
            action = ACTION_STOP_ALARM
            putExtra(EXTRA_SCHEDULE_ID, alarm.scheduleId)
            putExtra(EXTRA_TIME, alarm.time)
            putExtra(EXTRA_SOURCE_INSTANCE_ID, alarm.instanceId)
        }
        val dismissPendingIntent = PendingIntent.getService(
            this,
            requestCode + 1,
            dismissIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Time to take ${alarm.medicineName}")
            .setContentText(if (alarm.label.isNotEmpty()) "${alarm.label} · ${alarm.amount}" else alarm.amount)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setGroup(GROUP_KEY)
            .setContentIntent(fullScreenPendingIntent)
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Dismiss", dismissPendingIntent)
            .build()
    }

    private fun updateSummaryNotification() {
        if (activeAlarms.size > 1) {
            val summaryNotification = NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("HealthMate Reminders")
                .setContentText("${activeAlarms.size} doses due now")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setGroup(GROUP_KEY)
                .setGroupSummary(true)
                .setAutoCancel(true)
                .build()
            val manager = getSystemService(NotificationManager::class.java)
            manager?.notify(SUMMARY_NOTIFICATION_ID, summaryNotification)
        }
    }

    private fun stopDoseAlarm(scheduleId: String, time: String?, instanceId: String?) {
        val manager = getSystemService(NotificationManager::class.java)

        // Find matching active alarms for this scheduleId (and time/instanceId if supplied)
        val matchingKeys = activeAlarms.filter { (_, alarm) ->
            alarm.scheduleId == scheduleId || alarm.sourceScheduleId == scheduleId
        }.filter { (_, alarm) ->
            (time.isNullOrEmpty() || alarm.time == time) &&
            (instanceId.isNullOrEmpty() || alarm.instanceId == instanceId)
        }.keys

        for (k in matchingKeys) {
            val removed = activeAlarms.remove(k)
            if (removed != null) {
                manager?.cancel(removed.notificationId)
            }
        }

        if (activeAlarms.isEmpty()) {
            manager?.cancel(SUMMARY_NOTIFICATION_ID)
            stopAllAudioAndFinish()
        } else {
            // There are still other doses ringing! Update summary and promote the next dose to foreground
            updateSummaryNotification()
            val nextAlarm = activeAlarms.values.firstOrNull()
            if (nextAlarm != null) {
                try {
                    startForeground(nextAlarm.notificationId, buildDoseNotification(nextAlarm))
                } catch (_: Exception) {}
            }
        }
    }

    private fun stopAllAlarms() {
        val manager = getSystemService(NotificationManager::class.java)
        for (alarm in activeAlarms.values) {
            manager?.cancel(alarm.notificationId)
        }
        manager?.cancel(SUMMARY_NOTIFICATION_ID)
        activeAlarms.clear()
        stopAllAudioAndFinish()
    }

    private fun playAudio() {
        // Do not interrupt or recreate audio player if it is already looping for a ringing alarm
        if (mediaPlayer?.isPlaying == true) {
            return
        }

        try {
            mediaPlayer?.release()
            mediaPlayer = null

            val rawResId = resources.getIdentifier("alarm_melody", "raw", packageName)
            val audioUri = if (rawResId != 0) {
                Uri.parse("android.resource://$packageName/$rawResId")
            } else {
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
                    ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            }

            mediaPlayer = MediaPlayer().apply {
                setDataSource(applicationContext, audioUri)
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                )
                isLooping = true
                prepare()
                start()
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun startVibration() {
        if (vibrator != null) {
            return // Vibration is already active
        }

        try {
            vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                vibratorManager?.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            }

            val pattern = longArrayOf(0, 600, 400, 600, 400, 1000)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(pattern, 0)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun stopAllAudioAndFinish() {
        try {
            mediaPlayer?.apply {
                if (isPlaying) stop()
                release()
            }
            mediaPlayer = null
        } catch (e: Exception) {
            e.printStackTrace()
        }

        try {
            vibrator?.cancel()
            vibrator = null
        } catch (e: Exception) {
            e.printStackTrace()
        }

        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Medication Alarms",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Critical full-screen alarms for medication reminders"
                setSound(null, null)
                enableVibration(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                try {
                    setBypassDnd(true)
                } catch (_: Exception) {}
            }
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        stopAllAlarms()
        super.onDestroy()
    }
}
