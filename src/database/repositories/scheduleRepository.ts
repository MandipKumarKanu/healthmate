import { getDatabase } from '../client';
import { ReminderSchedule, ReminderTime, RecurrenceType } from '../../types';
import {
  getTodayDateString,
  getPreviousDayString,
  isScheduleDueOnDate,
  parseDateParts,
} from '../../utils/scheduleRecurrence';

interface ScheduleRow {
  id: string;
  medicine_id: string;
  recurrence: string;
  start_date: string;
  end_date: string | null;
  times_json: string;
  enabled: number;
  notifications_enabled: number;
  created_at: string;
  updated_at: string;
}

interface ScheduleHistoryRow {
  id: string;
  schedule_id: string;
  medicine_id: string;
  recurrence: string;
  start_date: string;
  end_date: string;
  times_json: string;
  created_at: string;
  updated_at: string;
}

function mapRowToSchedule(row: ScheduleRow): ReminderSchedule {
  let times: ReminderTime[] = [];
  try {
    times = JSON.parse(row.times_json);
  } catch {
    times = [];
  }

  return {
    id: row.id,
    medicineId: row.medicine_id,
    recurrence: row.recurrence as RecurrenceType,
    startDate: row.start_date,
    endDate: row.end_date ?? undefined,
    times,
    enabled: row.enabled === 1,
    notificationsEnabled: row.notifications_enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * How many history versions to retain per schedule before the oldest
 * rows are dropped. Dose identity for dropped versions is still recoverable
 * from adherence_logs (doses are re-created from log rows not covered by
 * current schedules), so dropping only affects display amount for very old
 * doses.
 */
export const MAX_HISTORY_ROWS_PER_SCHEDULE = 10;

function addDayUtc(dateStr: string, days: number): string {
  const parts = parseDateParts(dateStr);
  if (!parts) return dateStr;
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days));
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    String(d.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function mapHistoryRowToSchedule(row: ScheduleHistoryRow): ReminderSchedule {
  let times: ReminderTime[] = [];
  try {
    times = JSON.parse(row.times_json);
  } catch {
    times = [];
  }

  return {
    id: row.schedule_id, // Preserves the original schedule_id so adherence_logs match accurately
    medicineId: row.medicine_id,
    recurrence: row.recurrence as RecurrenceType,
    startDate: row.start_date,
    endDate: row.end_date ?? undefined,
    times,
    enabled: true,
    notificationsEnabled: false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const scheduleRepository = {
  getAll(): ReminderSchedule[] {
    const db = getDatabase();
    const rows = db.getAllSync<ScheduleRow>('SELECT * FROM schedules ORDER BY created_at DESC;');
    return rows.map(mapRowToSchedule);
  },

  getHistoricalSchedules(): ReminderSchedule[] {
    const db = getDatabase();
    const rows = db.getAllSync<ScheduleHistoryRow>(
      'SELECT * FROM schedule_history ORDER BY created_at DESC;',
    );
    return rows.map(mapHistoryRowToSchedule);
  },

  getById(id: string): ReminderSchedule | null {
    const db = getDatabase();
    const row = db.getFirstSync<ScheduleRow>('SELECT * FROM schedules WHERE id = ?;', [id]);
    return row ? mapRowToSchedule(row) : null;
  },

  getByMedicineId(medicineId: string): ReminderSchedule | null {
    const db = getDatabase();
    const row = db.getFirstSync<ScheduleRow>(
      'SELECT * FROM schedules WHERE medicine_id = ? LIMIT 1;',
      [medicineId],
    );
    return row ? mapRowToSchedule(row) : null;
  },

  getAllByMedicineId(medicineId: string): ReminderSchedule[] {
    const db = getDatabase();
    const rows = db.getAllSync<ScheduleRow>(
      'SELECT * FROM schedules WHERE medicine_id = ?;',
      [medicineId],
    );
    return rows.map(mapRowToSchedule);
  },

  getSchedulesForDate(date: string): ReminderSchedule[] {
    const db = getDatabase();
    const activeRows = db.getAllSync<ScheduleRow>('SELECT * FROM schedules WHERE enabled = 1;');
    const activeSchedules = activeRows.map(mapRowToSchedule);

    const histRows = db.getAllSync<ScheduleHistoryRow>('SELECT * FROM schedule_history;');
    const histSchedules = histRows.map(mapHistoryRowToSchedule);

    const result: ReminderSchedule[] = [];
    const coveredMedicineIds = new Set<string>();

    // 1. If an active schedule is in effect and due on this date, use it
    for (const active of activeSchedules) {
      if (isScheduleDueOnDate(active, date)) {
        result.push(active);
        coveredMedicineIds.add(active.medicineId);
      }
    }

    // 2. For medicines not covered by an active schedule on this date, check historical versions
    for (const hist of histSchedules) {
      if (coveredMedicineIds.has(hist.medicineId)) continue;
      if (isScheduleDueOnDate(hist, date)) {
        result.push(hist);
        coveredMedicineIds.add(hist.medicineId);
      }
    }

    return result;
  },

  save(schedule: ReminderSchedule): void {
    const db = getDatabase();
    const existing = this.getById(schedule.id);
    const today = getTodayDateString();

    let newStartDate = schedule.startDate;

    if (existing) {
      const timesChanged = JSON.stringify(existing.times) !== JSON.stringify(schedule.times);
      const recurrenceChanged = existing.recurrence !== schedule.recurrence;
      const datesChanged =
        existing.startDate !== schedule.startDate || existing.endDate !== schedule.endDate;

      if (timesChanged || recurrenceChanged || datesChanged) {
        // Effective date of the edit: use updatedAt date if provided, otherwise today
        const editDate = schedule.updatedAt ? schedule.updatedAt.split('T')[0] : today;

        if (existing.startDate < editDate) {
          const histEndDate = getPreviousDayString(editDate);
          const effectiveEndDate =
            existing.endDate && existing.endDate < histEndDate ? existing.endDate : histEndDate;

          if (existing.startDate <= effectiveEndDate) {
            const histId = `${existing.id}_hist_${(existing.updatedAt || existing.createdAt || editDate).replace(/[:.-]/g, '_')}`;
            db.runSync(
              `INSERT OR REPLACE INTO schedule_history (
                id, schedule_id, medicine_id, recurrence, start_date, end_date,
                times_json, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
              [
                histId,
                existing.id,
                existing.medicineId,
                existing.recurrence,
                existing.startDate,
                effectiveEndDate,
                JSON.stringify(existing.times),
                existing.createdAt,
                existing.updatedAt,
              ],
            );
          }

          // Advance the new schedule's startDate to the edit date so it does not
          // retroactively conflict with or distort records on past dates.
          if (schedule.startDate < editDate) {
            newStartDate = editDate;
          }
        }
      }
    }

    db.runSync(
      `INSERT OR REPLACE INTO schedules (
        id, medicine_id, recurrence, start_date, end_date,
        times_json, enabled, notifications_enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        schedule.id,
        schedule.medicineId,
        schedule.recurrence,
        newStartDate,
        schedule.endDate ?? null,
        JSON.stringify(schedule.times),
        schedule.enabled ? 1 : 0,
        schedule.notificationsEnabled ? 1 : 0,
        schedule.createdAt,
        schedule.updatedAt,
      ],
    );

    // Keep the version history bounded after every archive.
    this.compactScheduleHistory(schedule.id);
  },

  delete(id: string): boolean {
    const db = getDatabase();
    const existing = this.getById(id);
    if (!existing) return false;

    // Archive the schedule into schedule_history so past adherence logs retain their dose identity
    const today = getTodayDateString();
    const histEndDate = existing.endDate && existing.endDate < today ? existing.endDate : today;
    const histId = `${existing.id}_del_${new Date().toISOString().replace(/[:.-]/g, '_')}`;
    db.runSync(
      `INSERT OR REPLACE INTO schedule_history (
        id, schedule_id, medicine_id, recurrence, start_date, end_date,
        times_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        histId,
        existing.id,
        existing.medicineId,
        existing.recurrence,
        existing.startDate,
        histEndDate,
        JSON.stringify(existing.times),
        existing.createdAt,
        new Date().toISOString(),
      ],
    );

    // CRITICAL: Preserve historical adherence_logs for past records
    const result = db.runSync('DELETE FROM schedules WHERE id = ?;', [id]);
    this.compactScheduleHistory(id);
    return result.changes > 0;
  },

  toggleEnabled(id: string, enabled: boolean): void {
    const db = getDatabase();
    db.runSync('UPDATE schedules SET enabled = ?, updated_at = ? WHERE id = ?;', [
      enabled ? 1 : 0,
      new Date().toISOString(),
      id,
    ]);
  },

  /**
   * Compacts the schedule-history for one schedule:
   *
   * 1. Merge pass: consecutive versions with identical recurrence, times and
   *    medicine that form a contiguous/overlapping date range are folded into
   *    a single segment (older rows survive, one merged row per segment).
   * 2. Cap pass: if more than MAX_HISTORY_ROWS_PER_SCHEDULE versions remain,
   *    the OLDEST versions are dropped — their dates fall back to adherence
   *    log-based dose recovery, which preserves dose identity.
   *
   * Called after every save()/delete() that archives a history row. Rows are
   * read once and sorted in JS so behavior is identical on SQLite and the
   * in-memory demonstration adapter.
   */
  compactScheduleHistory(scheduleId: string): void {
    const db = getDatabase();
    const rows = db
      .getAllSync<ScheduleHistoryRow>(
        'SELECT * FROM schedule_history WHERE schedule_id = ? ORDER BY start_date ASC;',
        [scheduleId],
      )
      .slice()
      .sort(
        (a, b) =>
          a.start_date.localeCompare(b.start_date) || a.created_at.localeCompare(b.created_at),
      );

    // Merge pass: fold contiguous/overlapping identical versions together.
    const merged: ScheduleHistoryRow[] = [];
    for (const row of rows) {
      const prev = merged[merged.length - 1];
      if (
        prev &&
        prev.medicine_id === row.medicine_id &&
        prev.recurrence === row.recurrence &&
        prev.times_json === row.times_json &&
        row.start_date <= addDayUtc(prev.end_date, 1)
      ) {
        // Extend the surviving segment to the later end; delete the merged row.
        const newEnd = row.end_date > prev.end_date ? row.end_date : prev.end_date;
        if (newEnd !== prev.end_date) {
          db.runSync('UPDATE schedule_history SET end_date = ? WHERE id = ?;', [newEnd, prev.id]);
          prev.end_date = newEnd;
        }
        db.runSync('DELETE FROM schedule_history WHERE id = ?;', [row.id]);
      } else {
        merged.push({ ...row });
      }
    }

    // Cap pass: keep the newest MAX_HISTORY_ROWS_PER_SCHEDULE versions.
    // "Newest" is by updated_at of the version (falls back to created_at).
    if (merged.length > MAX_HISTORY_ROWS_PER_SCHEDULE) {
      const byNewest = merged
        .slice()
        .sort((a, b) => (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at));
      const toDrop = new Set(byNewest.slice(MAX_HISTORY_ROWS_PER_SCHEDULE).map((row) => row.id));
      for (const id of toDrop) {
        db.runSync('DELETE FROM schedule_history WHERE id = ?;', [id]);
      }
    }
  },
};
