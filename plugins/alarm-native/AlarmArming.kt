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
    const val KEY_LAST_RECOVERY = "last_recovery_report"

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
    private const val J_IS_EXACT = "isExact"

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
        val sourceInstanceId: String? = null,
        val isExact: Boolean = true
    )

    data class EntryRecoveryDetail(
        val scheduleId: String,
        val time: String,
        val status: String, // "recovered", "expired", "failed", "malformed"
        val isExact: Boolean = false,
        val triggerAtMillis: Long = 0L,
        val error: String? = null
    )

    data class RecoveryReport(
        val timestamp: Long,
        val totalProcessed: Int,
        val recoveredCount: Int,
        val expiredCount: Int,
        val failedCount: Int,
        val malformedCount: Int,
        val details: List<EntryRecoveryDetail>
    ) {
        fun toJson(): JSONObject = JSONObject().apply {
            put("timestamp", timestamp)
            put("totalProcessed", totalProcessed)
            put("recoveredCount", recoveredCount)
            put("expiredCount", expiredCount)
            put("failedCount", failedCount)
            put("malformedCount", malformedCount)
            val detailsArray = JSONArray()
            for (d in details) {
                detailsArray.put(JSONObject().apply {
                    put("scheduleId", d.scheduleId)
                    put("time", d.time)
                    put("status", d.status)
                    put("isExact", d.isExact)
                    put("triggerAtMillis", d.triggerAtMillis)
                    if (d.error != null) put("error", d.error)
                })
            }
            put("details", detailsArray)
        }
    }

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

    private fun entryFromJson(json: JSONObject): Entry {
        val sDate = json.optString(J_START_DATE, "")
        val eDate = if (json.isNull(J_END_DATE)) null else json.optString(J_END_DATE, "").takeIf { it.isNotBlank() }
        val explicitBounds = json.optBoolean(J_HAS_DATE_BOUNDS, false)
        val hasBounds = explicitBounds || eDate != null || sDate.isNotBlank()
        return Entry(
            scheduleId = json.optString(J_SCHEDULE_ID, ""),
            time = json.optString(J_TIME, "00:00"),
            medicineName = json.optString(J_MEDICINE_NAME, "Medication"),
            amount = json.optString(J_AMOUNT, ""),
            label = json.optString(J_LABEL, ""),
            recurrence = json.optString(J_RECURRENCE, "daily"),
            startDate = sDate,
            endDate = eDate,
            hasDateBounds = hasBounds,
            sourceScheduleId = if (json.isNull(J_SOURCE_SCHEDULE_ID)) null else json.optString(J_SOURCE_SCHEDULE_ID).takeIf { it.isNotBlank() },
            sourceInstanceId = if (json.isNull(J_SOURCE_INSTANCE_ID)) null else json.optString(J_SOURCE_INSTANCE_ID).takeIf { it.isNotBlank() },
            isExact = json.optBoolean(J_IS_EXACT, true),
            triggers = json.optJSONArray(J_TRIGGERS)?.let { arr ->
                (0 until arr.length()).map { arr.optLong(it) }.toMutableList()
            } ?: mutableListOf()
        )
    }

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
        put(J_IS_EXACT, entry.isExact)
        put(J_TRIGGERS, JSONArray(entry.triggers))
    }

    fun getAllEntries(context: Context): List<Entry> {
        val map = readPendingMap(context)
        val names = map.names() ?: return emptyList()
        val list = mutableListOf<Entry>()
        for (i in 0 until names.length()) {
            val key = names.getString(i)
            try {
                val json = map.getJSONObject(key)
                list.add(entryFromJson(json))
            } catch (_: Exception) {
                // One malformed JSON entry does not block other valid entries
            }
        }
        return list
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

    /** Cancels only pending snooze entries that originated from the given scheduleId. */
    fun cancelSnoozesForSchedule(context: Context, scheduleId: String) {
        val map = readPendingMap(context)
        val names = map.names() ?: return
        val keys = (0 until names.length()).map { names.getString(it) }.filter { key ->
            val json = try { map.getJSONObject(key) } catch (_: Exception) { return@filter false }
            val entry = entryFromJson(json)
            entry.sourceScheduleId == scheduleId
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

    /** Registers one exact alarm (or inexact fallback) for the given dose. Returns true if exact, false if inexact fallback. Throws on system/permission failure. */
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
    ): Boolean {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
            ?: throw IllegalStateException("AlarmManager system service is not available")

        if (triggerAtMillis <= System.currentTimeMillis()) {
            throw IllegalArgumentException("Invalid trigger time: must be in the future")
        }

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
            try {
                alarmManager.setAlarmClock(
                    AlarmManager.AlarmClockInfo(triggerAtMillis, showPendingIntent),
                    pendingIntent
                )
            } catch (secEx: SecurityException) {
                throw SecurityException("Exact alarm permission SCHEDULE_EXACT_ALARM is not granted", secEx)
            }
        } else {
            // Graceful fallback if exact-alarm permission was revoked or absent
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pendingIntent)
            } else {
                alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAtMillis, pendingIntent)
            }
        }
        return canExact
    }

    fun armEntry(context: Context, entry: Entry, triggerAtMillis: Long): Boolean {
        return armDose(
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
    fun localDateString(epochMillis: Long): String {
        val cal = Calendar.getInstance().apply { timeInMillis = epochMillis }
        return "%04d-%02d-%02d".format(
            Locale.US,
            cal.get(Calendar.YEAR),
            cal.get(Calendar.MONTH) + 1,
            cal.get(Calendar.DAY_OF_MONTH)
        )
    }

    fun isWithinScheduleDates(entry: Entry, epochMillis: Long): Boolean {
        if (!entry.hasDateBounds) return false
        val occurrenceDate = localDateString(epochMillis)
        if (entry.startDate.isNotBlank() && occurrenceDate < entry.startDate) return false
        val end = entry.endDate ?: return true
        return occurrenceDate <= end
    }

    /** Next occurrence of an HH:mm time strictly in the future. */
    fun nextDailyOccurrenceMillis(time: String, nowMillis: Long): Long? {
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
        if (cal.timeInMillis <= nowMillis + 60_000L) {
            cal.add(Calendar.DAY_OF_YEAR, 1)
        }
        return cal.timeInMillis
    }

    /** Next weekly occurrence of an HH:mm time on the same weekday as startDate strictly in the future. */
    fun nextWeeklyOccurrenceMillis(time: String, startDate: String, nowMillis: Long): Long? {
        val match = Regex("^([01]\\d|2[0-3]):([0-5]\\d)$").find(time) ?: return null
        val hour = match.groupValues[1].toInt()
        val minute = match.groupValues[2].toInt()

        val startParts = startDate.split("-")
        val targetDayOfWeek = if (startParts.size == 3) {
            val sy = startParts[0].toIntOrNull()
            val sm = startParts[1].toIntOrNull()
            val sd = startParts[2].toIntOrNull()
            if (sy != null && sm != null && sd != null) {
                Calendar.getInstance().apply {
                    set(sy, sm - 1, sd, 12, 0, 0)
                }.get(Calendar.DAY_OF_WEEK)
            } else null
        } else null

        val cal = Calendar.getInstance().apply {
            timeInMillis = nowMillis
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }

        if (targetDayOfWeek != null) {
            while (cal.timeInMillis <= nowMillis + 60_000L || cal.get(Calendar.DAY_OF_WEEK) != targetDayOfWeek) {
                cal.add(Calendar.DAY_OF_YEAR, 1)
            }
        } else {
            if (cal.timeInMillis <= nowMillis + 60_000L) {
                cal.add(Calendar.DAY_OF_YEAR, 7)
            }
        }
        return cal.timeInMillis
    }

    /** Next monthly occurrence, clamping month-end dates (31 -> 30/29/28). */
    fun nextMonthlyOccurrenceMillis(time: String, startDate: String, nowMillis: Long): Long? {
        val match = Regex("^([01]\\d|2[0-3]):([0-5]\\d)$").find(time) ?: return null
        val hour = match.groupValues[1].toInt()
        val minute = match.groupValues[2].toInt()

        val startParts = startDate.split("-")
        if (startParts.size != 3) return null
        val startDay = startParts[2].toIntOrNull() ?: return null
        if (startDay !in 1..31) return null

        val cal = Calendar.getInstance().apply {
            timeInMillis = nowMillis
            set(Calendar.DAY_OF_MONTH, 1)
            set(Calendar.HOUR_OF_DAY, hour)
            set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
        }

        repeat(24) {
            val lastDay = cal.getActualMaximum(Calendar.DAY_OF_MONTH)
            cal.set(Calendar.DAY_OF_MONTH, minOf(startDay, lastDay))
            if (cal.timeInMillis > nowMillis + 60_000L) return cal.timeInMillis
            cal.add(Calendar.MONTH, 1)
            cal.set(Calendar.DAY_OF_MONTH, 1)
        }
        return null
    }

    /**
     * Called when the OS delivers a dose alarm. Drops the fired trigger from the
     * stored chain and re-arms the next one. When the chain is exhausted and the
     * dose repeats daily or weekly, synthesizes the next occurrence only when an
     * entry carries date-bound metadata and the local calendar date is within its
     * start/end range. Legacy entries without metadata are allowed to finish their
     * stored trigger list but are never extended. 'once' schedules never synthesize.
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

            var synthesized: Long? = null
            if (entry.hasDateBounds) {
                when (entry.recurrence) {
                    "daily" -> synthesized = nextDailyOccurrenceMillis(entry.time, now)
                    "weekly" -> synthesized = nextWeeklyOccurrenceMillis(entry.time, entry.startDate, now)
                    else -> {}
                }
            }

            if (synthesized != null && isWithinScheduleDates(entry, synthesized)) {
                entry.triggers.add(synthesized)
                saveEntry(context, entry)
                armEntry(context, entry, synthesized)
                return
            }

            // Nothing left to ring; forget the entry and cancel any pending intent.
            cancelPendingIntent(context, entry.scheduleId, entry.time)
            entry.triggers.clear()
            saveEntry(context, entry)
        } catch (_: Exception) {
        }
    }

    fun getLastRecoveryReport(context: Context): String? {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_LAST_RECOVERY, null)
    }

    private fun saveRecoveryReport(context: Context, report: RecoveryReport) {
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_LAST_RECOVERY, report.toJson().toString()).apply()
    }

    /**
     * Re-arms every stored dose alarm after a reboot, package replacement, or
     * exact-alarm permission change.
     * - Individual malformed entries never block recovery of valid entries.
     * - Expired entries (past endDate or past one-time dates) are pruned and not restored.
     * - Triggers are deduplicated and armed with FLAG_UPDATE_CURRENT to prevent duplicates.
     * - Generates a diagnosable per-entry RecoveryReport stored in SharedPreferences.
     */
    fun reArmAll(context: Context): RecoveryReport {
        val now = System.currentTimeMillis()
        val todayStr = localDateString(now)
        val map = readPendingMap(context)
        val names = map.names()
        val total = names?.length() ?: 0

        var recoveredCount = 0
        var expiredCount = 0
        var failedCount = 0
        var malformedCount = 0
        val details = mutableListOf<EntryRecoveryDetail>()

        if (names == null || total == 0) {
            val emptyReport = RecoveryReport(now, 0, 0, 0, 0, 0, emptyList())
            saveRecoveryReport(context, emptyReport)
            return emptyReport
        }

        var mapMutated = false

        for (i in 0 until total) {
            val key = names.getString(i)
            val json: JSONObject
            val entry: Entry
            try {
                json = map.getJSONObject(key)
                entry = entryFromJson(json)
            } catch (e: Exception) {
                malformedCount++
                details.add(
                    EntryRecoveryDetail(
                        scheduleId = key.substringBefore("|"),
                        time = key.substringAfter("|", ""),
                        status = "malformed",
                        error = e.message ?: "Invalid JSON entry format"
                    )
                )
                map.remove(key)
                mapMutated = true
                continue
            }

            try {
                if (entry.scheduleId.isBlank()) {
                    malformedCount++
                    details.add(
                        EntryRecoveryDetail(
                            scheduleId = "",
                            time = entry.time,
                            status = "malformed",
                            error = "Missing scheduleId"
                        )
                    )
                    map.remove(key)
                    mapMutated = true
                    continue
                }

                // Check expired end dates: a bounded schedule whose endDate is in the past must never restore!
                if (entry.hasDateBounds && entry.endDate != null && entry.endDate < todayStr) {
                    cancelPendingIntent(context, entry.scheduleId, entry.time)
                    map.remove(key)
                    mapMutated = true
                    expiredCount++
                    details.add(
                        EntryRecoveryDetail(
                            scheduleId = entry.scheduleId,
                            time = entry.time,
                            status = "expired",
                            error = "Schedule end date ${entry.endDate} has passed"
                        )
                    )
                    continue
                }

                // Clean out past triggers and triggers outside schedule bounds
                entry.triggers.removeAll {
                    it <= now || (entry.hasDateBounds && !isWithinScheduleDates(entry, it))
                }

                // Deduplicate remaining triggers to avoid duplicate events
                val uniqueTriggers = entry.triggers.distinct().toMutableList()
                entry.triggers.clear()
                entry.triggers.addAll(uniqueTriggers)

                // If triggers are exhausted, check if we can synthesize next recurrence
                var next: Long? = entry.triggers.minOrNull()
                if (next == null) {
                    if (entry.recurrence == "once") {
                        // One-time schedules that already passed must never be restored or synthesized
                        cancelPendingIntent(context, entry.scheduleId, entry.time)
                        map.remove(key)
                        mapMutated = true
                        expiredCount++
                        details.add(
                            EntryRecoveryDetail(
                                scheduleId = entry.scheduleId,
                                time = entry.time,
                                status = "expired",
                                error = "One-time schedule has already passed"
                            )
                        )
                        continue
                    }

                    if (entry.hasDateBounds) {
                        val synthesized = when (entry.recurrence) {
                            "daily" -> nextDailyOccurrenceMillis(entry.time, now)
                            "weekly" -> nextWeeklyOccurrenceMillis(entry.time, entry.startDate, now)
                            "monthly" -> nextMonthlyOccurrenceMillis(entry.time, entry.startDate, now)
                            else -> null
                        }
                        if (synthesized != null && isWithinScheduleDates(entry, synthesized)) {
                            entry.triggers.add(synthesized)
                            next = synthesized
                        }
                    }
                }

                if (entry.triggers.isEmpty() || next == null) {
                    cancelPendingIntent(context, entry.scheduleId, entry.time)
                    map.remove(key)
                    mapMutated = true
                    expiredCount++
                    details.add(
                        EntryRecoveryDetail(
                            scheduleId = entry.scheduleId,
                            time = entry.time,
                            status = "expired",
                            error = "No future triggers remain within schedule bounds"
                        )
                    )
                } else {
                    entry.triggers.sort()
                    val wasExact = armEntry(context, entry, next)
                    val updatedEntry = entry.copy(isExact = wasExact)
                    map.put(key, entryToJson(updatedEntry))
                    mapMutated = true
                    recoveredCount++
                    details.add(
                        EntryRecoveryDetail(
                            scheduleId = entry.scheduleId,
                            time = entry.time,
                            status = "recovered",
                            isExact = wasExact,
                            triggerAtMillis = next
                        )
                    )
                }
            } catch (entryErr: Exception) {
                failedCount++
                details.add(
                    EntryRecoveryDetail(
                        scheduleId = entry.scheduleId,
                        time = entry.time,
                        status = "failed",
                        error = entryErr.message ?: "Failed to arm entry"
                    )
                )
            }
        }

        if (mapMutated) {
            writePendingMap(context, map)
        }

        val report = RecoveryReport(
            timestamp = now,
            totalProcessed = total,
            recoveredCount = recoveredCount,
            expiredCount = expiredCount,
            failedCount = failedCount,
            malformedCount = malformedCount,
            details = details
        )
        saveRecoveryReport(context, report)
        return report
    }
}
