package com.healthmate.app.alarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

/**
 * Shared alarm persistence + arming logic used by both AlarmModule (JS calls)
 * and AlarmReceiver (alarm fires, device reboots).
 *
 * Why this exists: Android wipes all scheduled AlarmManager alarms on reboot.
 * Earlier versions of this app left reboot recovery to a JS-side reconcile that
 * only runs when the app next becomes active, so dose alarms stayed silent until
 * the user opened the app. This object stores each dose's upcoming trigger
 * window (a chain of future epoch millis computed by the JS scheduler) in
 * SharedPreferences so the receiver can re-arm exact alarms natively at boot,
 * with no app launch and no SQLite access.
 */
object AlarmArming {
    private const val PREFS_NAME = "healthmate_active_alarms"
    private const val KEY_PENDING = "pending_alarms"

    private const val J_SCHEDULE_ID = "scheduleId"
    private const val J_TIME = "time"
    private const val J_MEDICINE_NAME = "medicineName"
    private const val J_AMOUNT = "amount"
    private const val J_LABEL = "label"
    private const val J_RECURRENCE = "recurrence"
    private const val J_TRIGGERS = "triggers"

    data class Entry(
        val scheduleId: String,
        val time: String,
        val medicineName: String,
        val amount: String,
        val label: String,
        val recurrence: String,
        val triggers: MutableList<Long>
    )

    fun alarmKey(scheduleId: String, time: String): String = "$scheduleId|$time"

    // ------------------------------------------------------------------
    // Chain store (SharedPreferences JSON)
    // ------------------------------------------------------------------

    private fun readPendingMap(context: Context): JSONObject {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return try {
            JSONObject(prefs.getString(KEY_PENDING, "{}") ?: "{}")
        } catch (_: Exception) {
            JSONObject()
        }
    }

    private fun writePendingMap(context: Context, map: JSONObject) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_PENDING, map.toString()).apply()
    }

    private fun entryFromJson(json: JSONObject): Entry = Entry(
        scheduleId = json.optString(J_SCHEDULE_ID, ""),
        time = json.optString(J_TIME, "00:00"),
        medicineName = json.optString(J_MEDICINE_NAME, "Medication"),
        amount = json.optString(J_AMOUNT, ""),
        label = json.optString(J_LABEL, ""),
        recurrence = json.optString(J_RECURRENCE, "daily"),
        triggers = json.optJSONArray(J_TRIGGERS)?.let { arr ->
            (0 until arr.length()).map { arr.optLong(it) }.toMutableList()
        } ?: mutableListOf()
    )

    private fun entryToJson(entry: Entry): JSONObject = JSONObject().apply {
        put(J_SCHEDULE_ID, entry.scheduleId)
        put(J_TIME, entry.time)
        put(J_MEDICINE_NAME, entry.medicineName)
        put(J_AMOUNT, entry.amount)
        put(J_LABEL, entry.label)
        put(J_RECURRENCE, entry.recurrence)
        put(J_TRIGGERS, JSONArray(entry.triggers))
    }

    fun getAllEntries(context: Context): List<Entry> {
        val map = readPendingMap(context)
        return (0 until map.length()).map { entryFromJson(map.getJSONObject(map.names().getString(it))) }
    }

    fun getEntry(context: Context, scheduleId: String, time: String): Entry? {
        val key = alarmKey(scheduleId, time)
        val map = readPendingMap(context)
        return if (map.has(key)) entryFromJson(map.getJSONObject(key)) else null
    }

    /** Replaces (or removes, if no triggers remain) the stored chain for one dose. */
    fun saveEntry(context: Context, entry: Entry) {
        val key = alarmKey(entry.scheduleId, entry.time)
        val map = readPendingMap(context)
        if (entry.triggers.isEmpty()) {
            map.remove(key)
        } else {
            map.put(key, entryToJson(entry))
        }
        writePendingMap(context, map)
    }

    // ------------------------------------------------------------------
    // Arming
    // ------------------------------------------------------------------

    private fun pendingIntentFor(context: Context, key: String, intent: Intent): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            key.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

    fun cancelPendingIntent(context: Context, scheduleId: String, time: String) {
        val key = alarmKey(scheduleId, time)
        try {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
            val intent = Intent(context, AlarmReceiver::class.java)
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                key.hashCode(),
                intent,
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )
            if (pendingIntent != null) {
                alarmManager?.cancel(pendingIntent)
                pendingIntent.cancel()
            }
        } catch (_: Exception) {
        }
    }

    fun cancelAllForSchedule(context: Context, scheduleId: String) {
        val map = readPendingMap(context)
        val names = map.names() ?: return
        val keys = (0 until names.length()).map { names.getString(it) }.filter { it.startsWith("$scheduleId|") }
        for (key in keys) {
            val json = try { map.getJSONObject(key) } catch (_: Exception) { continue }
            val entry = entryFromJson(json)
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
            val intent = Intent(context, AlarmReceiver::class.java)
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                key.hashCode(),
                intent,
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )
            if (pendingIntent != null) {
                alarmManager?.cancel(pendingIntent)
                pendingIntent.cancel()
            }
            map.remove(key)
        }
        writePendingMap(context, map)
    }

    fun cancelAll(context: Context) {
        val map = readPendingMap(context)
        val names = map.names() ?: return
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
        val intent = Intent(context, AlarmReceiver::class.java)
        for (i in 0 until names.length()) {
            val key = names.getString(i)
            val pendingIntent = PendingIntent.getBroadcast(
                context,
                key.hashCode(),
                intent,
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )
            if (pendingIntent != null) {
                alarmManager?.cancel(pendingIntent)
                pendingIntent.cancel()
            }
        }
        writePendingMap(context, JSONObject())
    }

    /** Registers one exact alarm (with a safe inexact fallback) for the given dose. */
    fun armDose(
        context: Context,
        scheduleId: String,
        medicineName: String,
        amount: String,
        time: String,
        label: String,
        triggerAtMillis: Long
    ) {
        try {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
            val intent = Intent(context, AlarmReceiver::class.java).apply {
                putExtra(AlarmService.EXTRA_SCHEDULE_ID, scheduleId)
                putExtra(AlarmService.EXTRA_MEDICINE_NAME, medicineName)
                putExtra(AlarmService.EXTRA_AMOUNT, amount)
                putExtra(AlarmService.EXTRA_TIME, time)
                putExtra(AlarmService.EXTRA_LABEL, label)
            }
            val key = alarmKey(scheduleId, time)
            val pendingIntent = pendingIntentFor(context, key, intent)

            val showIntent = Intent(context, com.healthmate.app.MainActivity::class.java)
            val showPendingIntent = PendingIntent.getActivity(
                context,
                key.hashCode(),
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
        } catch (_: Exception) {
        }
    }

    fun armEntry(context: Context, entry: Entry, triggerAtMillis: Long) {
        armDose(context, entry.scheduleId, entry.medicineName, entry.amount, entry.time, entry.label, triggerAtMillis)
    }

    // ------------------------------------------------------------------
    // Reboot recovery + chain advance
    // ------------------------------------------------------------------

    /** Next occurrence of an HH:mm time strictly in the future. */
    private fun nextDailyOccurrenceMillis(time: String, nowMillis: Long): Long? {
        val match = Regex("^([01]\\d|2[0-3]):([0-5]\\d)$").find(time) ?: return null
        val hour = match.groupValues[1].toInt()
        val minute = match.groupValues[2].toInt()
        val cal = Calendar.getInstance().apply {
            timeInMillis = nowMillis
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }
        if (cal.timeInMillis <= nowMillis) {
            cal.add(Calendar.DAY_OF_YEAR, 1)
        }
        return cal.timeInMillis
    }

    /**
     * Called when the OS delivers a dose alarm. Drops the fired trigger from the
     * stored chain and re-arms the next one. When the chain is exhausted and the
     * dose repeats daily, synthesizes the next occurrence so unbounded daily
     * schedules keep ringing even if the app is never opened. Weekly and monthly
     * schedules are never synthesized (native code must not invent occurrences);
     * the app reconciles them on next open.
     */
    fun fireAndAdvance(context: Context, scheduleId: String, time: String) {
        try {
            val entry = getEntry(context, scheduleId, time) ?: return
            val now = System.currentTimeMillis()
            entry.triggers.removeAll { it <= now }

            val next: Long? = entry.triggers.minOrNull()
            if (next != null) {
                saveEntry(context, entry)
                armEntry(context, entry, next)
                return
            }

            if (entry.recurrence == "daily") {
                val synthesized = nextDailyOccurrenceMillis(entry.time, now)
                if (synthesized != null) {
                    entry.triggers.add(synthesized)
                    saveEntry(context, entry)
                    armEntry(context, entry, synthesized)
                    return
                }
            }

            // Nothing left to ring; forget the entry. The app reconciles on next open.
            saveEntry(context, entry)
        } catch (_: Exception) {
        }
    }

    /**
     * Re-arms every stored dose alarm after a reboot, package replacement, or
     * exact-alarm permission change. Drops past triggers, synthesizes the next
     * daily occurrence when a chain is exhausted, and removes chains that can
     * no longer fire (the app reconciles those on next open).
     */
    fun reArmAll(context: Context) {
        try {
            val now = System.currentTimeMillis()
            val entries = getAllEntries(context)
            for (entry in entries) {
                entry.triggers.removeAll { it <= now }

                val next: Long? = entry.triggers.minOrNull()
                if (next == null && entry.recurrence == "daily") {
                    val synthesized = nextDailyOccurrenceMillis(entry.time, now)
                    if (synthesized != null) entry.triggers.add(synthesized)
                }

                if (entry.triggers.isEmpty()) {
                    cancelPendingIntent(context, entry.scheduleId, entry.time)
                    saveEntry(context, entry)
                } else {
                    entry.triggers.sort()
                    saveEntry(context, entry)
                    armEntry(context, entry, entry.triggers.first())
                }
            }
        } catch (_: Exception) {
        }
    }
}
