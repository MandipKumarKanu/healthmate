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

class AlarmService : Service() {

    private var mediaPlayer: MediaPlayer? = null
    private var vibrator: Vibrator? = null

    companion object {
        const val CHANNEL_ID = "medication_alarm_channel"
        const val NOTIFICATION_ID = 9001
        const val ACTION_START_ALARM = "com.healthmate.app.ACTION_START_ALARM"
        const val ACTION_STOP_ALARM = "com.healthmate.app.ACTION_STOP_ALARM"
        const val EXTRA_SCHEDULE_ID = "scheduleId"
        const val EXTRA_MEDICINE_NAME = "medicineName"
        const val EXTRA_AMOUNT = "amount"
        const val EXTRA_TIME = "time"
        const val EXTRA_LABEL = "label"
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: return START_NOT_STICKY

        if (action == ACTION_STOP_ALARM) {
            stopAlarm()
            return START_NOT_STICKY
        }

        if (action == ACTION_START_ALARM) {
            val scheduleId = intent.getStringExtra(EXTRA_SCHEDULE_ID) ?: ""
            val medicineName = intent.getStringExtra(EXTRA_MEDICINE_NAME) ?: "Medication"
            val amount = intent.getStringExtra(EXTRA_AMOUNT) ?: ""
            val time = intent.getStringExtra(EXTRA_TIME) ?: ""
            val label = intent.getStringExtra(EXTRA_LABEL) ?: ""

            startAlarm(scheduleId, medicineName, amount, time, label)
        }

        return START_STICKY
    }

    private fun startAlarm(scheduleId: String, medicineName: String, amount: String, time: String, label: String) {
        createNotificationChannel()

        val deepLinkUri = Uri.parse(
            "healthmate://alarm?scheduleId=" + Uri.encode(scheduleId) +
            "&medicineName=" + Uri.encode(medicineName) +
            "&amount=" + Uri.encode(amount) +
            "&time=" + Uri.encode(time) +
            "&label=" + Uri.encode(label)
        )

        val requestCode = (scheduleId + "_" + time).hashCode()

        val fullScreenIntent = Intent(Intent.ACTION_VIEW, deepLinkUri, this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
            putExtra(EXTRA_SCHEDULE_ID, scheduleId)
            putExtra(EXTRA_MEDICINE_NAME, medicineName)
            putExtra(EXTRA_AMOUNT, amount)
            putExtra(EXTRA_TIME, time)
            putExtra(EXTRA_LABEL, label)
        }

        val fullScreenPendingIntent = PendingIntent.getActivity(
            this,
            requestCode,
            fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val stopIntent = Intent(this, AlarmService::class.java).apply {
            action = ACTION_STOP_ALARM
        }
        val stopPendingIntent = PendingIntent.getService(
            this,
            1,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("Time to take $medicineName")
            .setContentText(if (label.isNotEmpty()) "$label · $amount" else amount)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(fullScreenPendingIntent)
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Dismiss", stopPendingIntent)
            .build()

        startForeground(NOTIFICATION_ID, notification)

        // Try direct startActivity as well to ensure full-screen alarm appears
        try {
            startActivity(fullScreenIntent)
        } catch (_: Exception) {
            // fullScreenIntent on notification handles delivery when background launch is constrained
        }

        playAudio()
        startVibration()
    }

    private fun playAudio() {
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

    private fun stopAlarm() {
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
        stopAlarm()
        super.onDestroy()
    }
}
