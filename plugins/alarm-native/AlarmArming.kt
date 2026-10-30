package com.healthmate.app.alarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale

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
    const val PREFS_NAME = "healthmate_active_alarms"
    private const val KEY_PENDING = "pending_alarms"

    private const val J_SCHEDULE_ID = "scheduleId"
    private const val J_TIME = "time"
    private const val J_MEDICINE_NAME = "medicineName"
    private const val J_AMOUNT = "amount"
    private const val J_LABEL = "label"
    private const val J_RECURRENCE = "recurrence"
    private const val J_START_DATE = "startDate"
    private const val J_END_DATE = "endDate"
    private const val J_HAS_DATE_BOUNDS = "hasDateBounds"
    private const val J_TRIGGERS = "triggers"
    private const val J_SOURCE_SCHEDULE_ID = "sourceScheduleId"
    private const val J_SOURCE_INSTANCE_ID = "sourceInstanceId"

    data class Entry(
        val scheduleId: String,
        val time: String,
        val medicineName: String,
        val amount: String,
        val label: String,
        val recurrence: String,
        /** YYYY-MM-DD in the device's local calendar, not an instant. */
        val startDate: String,
        val endDate: String?,
        /** False for legacy JSON entries written before date bounds were persisted. */
        val hasDateBounds: Boolean,
        val triggers: MutableList<Long>,
        /** Set only for one-shot snooze entries. */
        val sourceScheduleId: String? = null,
        val sourceInstanceId: String? = null
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
        startDate = json.optString(J_START_DATE, ""),
        endDate = if (json.isNull(J_END_DATE)) null else json.optString(J_END_DATE, "").takeIf { it.isNotBlank() },
        hasDateBounds = json.optBoolean(J_HAS_DATE_BOUNDS, false),
        sourceScheduleId = if (json.isNull(J_SOURCE_SCHEDULE_ID)) null else json.optString(J_SOURCE_SCHEDULE_ID).takeIf { it.isNotBlank() },
        sourceInstanceId = if (json.isNull(J_SOURCE_INSTANCE_ID)) null else json.optString(J_SOURCE_INSTANCE_ID).takeIf { it.isNotBlank() },
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
        put(J_START_DATE, entry.startDate)
        put(J_END_DATE, entry.endDate ?: JSONObject.NULL)
        put(J_HAS_DATE_BOUNDS, entry.hasDateBounds)
        put(J_SOURCE_SCHEDULE_ID, entry.sourceScheduleId ?: JSONObject.NULL)
        put(J_SOURCE_INSTANCE_ID, entry.sourceInstanceId ?: JSONObject.NULL)
        put(J_TRIGGERS, JSONArray(entry.triggers))
    }

    fun getAllEntries(context: Context): List<Entry> {
        val map = readPendingMap(context)
        val names = map.names() ?: return emptyList()
        return (0 until names.length()).map { entryFromJson(map.getJSONObject(names.getString(it))) }
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
        val keys = (0 until names.length()).map { names.getString(it) }.filter { key ->
            val json = try { map.getJSONObject(key) } catch (_: Exception) { return@filter false }
            val entry = entryFromJson(json)
            key.startsWith("$scheduleId|") || entry.sourceScheduleId == scheduleId
        }
        for (key in keys) {
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
        triggerAtMillis: Long,
        sourceScheduleId: String? = null,
        sourceInstanceId: String? = null
    ) {
        try {
            val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
            val intent = Intent(context, AlarmReceiver::class.java).apply {
                putExtra(AlarmService.EXTRA_SCHEDULE_ID, scheduleId)
                putExtra(AlarmService.EXTRA_MEDICINE_NAME, medicineName)
                putExtra(AlarmService.EXTRA_AMOUNT, amount)
                putExtra(AlarmService.EXTRA_TIME, time)
                putExtra(AlarmService.EXTRA_LABEL, label)
                putExtra(AlarmService.EXTRA_TRIGGER_AT_MILLIS, triggerAtMillis)
                putExtra(AlarmService.EXTRA_SOURCE_SCHEDULE_ID, sourceScheduleId ?: "")
                putExtra(AlarmService.EXTRA_SOURCE_INSTANCE_ID, sourceInstanceId ?: triggerAtMillis.toString())
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
        armDose(
            context,
            entry.scheduleId,
            entry.medicineName,
            entry.amount,
            entry.time,
            entry.label,
            triggerAtMillis,
            entry.sourceScheduleId,
            entry.sourceInstanceId
        )
    }

    // ------------------------------------------------------------------
    // Reboot recovery + chain advance
    // ------------------------------------------------------------------

    /** YYYY-MM-DD for an epoch instant in the device's current local timezone. */
    private fun localDateString(epochMillis: Long): String {
        val cal = Calendar.getInstance().apply { timeInMillis = epochMillis }
        return "%04d-%02d-%02d".format(
            Locale.US,
            cal.get(Calendar.YEAR),
            cal.get(Calendar.MONTH) + 1,
            cal.get(Calendar.DAY_OF_MONTH)
        )
    }

    private fun isWithinScheduleDates(entry: Entry, epochMillis: Long): Boolean {
        if (!entry.hasDateBounds) return false
        val occurrenceDate = localDateString(epochMillis)
        if (entry.startDate.isNotBlank() && occurrenceDate < entry.startDate) return false
        val end = entry.endDate ?: return true
        return occurrenceDate <= end
    }

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
     * dose repeats daily, synthesizes the next occurrence only when a new-format
     * entry explicitly carries date-bound metadata and the local calendar date is
     * within its start/end range. Legacy entries without metadata are allowed to
     * finish their stored trigger list but are never extended. Weekly and monthly
     * schedules are not synthesized; the app reconciles them on next open.
     */
    fun fireAndAdvance(context: Context, scheduleId: String, time: String) {
        try {
            val entry = getEntry(context, scheduleId, time) ?: return
            val now = System.currentTimeMillis()
            entry.triggers.removeAll {
                it <= now || (entry.hasDateBounds && !isWithinScheduleDates(entry, it))
            }

            val next: Long? = entry.triggers.minOrNull()
            if (next != null) {
                saveEntry(context, entry)
                armEntry(context, entry, next)
                return
            }

            if (entry.recurrence == "daily" && entry.hasDateBounds) {
                val synthesized = nextDailyOccurrenceMillis(entry.time, now)
                if (synthesized != null && isWithinScheduleDates(entry, synthesized)) {
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
     * exact-alarm permission change. Drops past and out-of-range triggers,
     * synthesizes the next daily occurrence only for entries with date metadata,
     * and removes chains that can
     * no longer fire (the app reconciles those on next open).
     */
    fun reArmAll(context: Context) {
        try {
            val now = System.currentTimeMillis()
            val entries = getAllEntries(context)
            for (entry in entries) {
                entry.triggers.removeAll {
                    it <= now || (entry.hasDateBounds && !isWithinScheduleDates(entry, it))
                }

                val next: Long? = entry.triggers.minOrNull()
                if (next == null && entry.recurrence == "daily" && entry.hasDateBounds) {
                    val synthesized = nextDailyOccurrenceMillis(entry.time, now)
                    if (synthesized != null && isWithinScheduleDates(entry, synthesized)) {
                        entry.triggers.add(synthesized)
                    }
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
