import { getDatabase } from '../client';
import { ReminderSchedule, ReminderTime, RecurrenceType } from '../../types';

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

export const scheduleRepository = {
  getAll(): ReminderSchedule[] {
    const db = getDatabase();
    const rows = db.getAllSync<ScheduleRow>(
      'SELECT * FROM schedules ORDER BY created_at DESC;'
    );
    return rows.map(mapRowToSchedule);
  },

  getById(id: string): ReminderSchedule | null {
    const db = getDatabase();
    const row = db.getFirstSync<ScheduleRow>(
      'SELECT * FROM schedules WHERE id = ?;',
      [id]
    );
    return row ? mapRowToSchedule(row) : null;
  },

  getByMedicineId(medicineId: string): ReminderSchedule | null {
    const db = getDatabase();
    const row = db.getFirstSync<ScheduleRow>(
      'SELECT * FROM schedules WHERE medicine_id = ? LIMIT 1;',
      [medicineId]
    );
    return row ? mapRowToSchedule(row) : null;
  },

  save(schedule: ReminderSchedule): void {
    const db = getDatabase();
    db.runSync(
      `INSERT OR REPLACE INTO schedules (
        id, medicine_id, recurrence, start_date, end_date,
        times_json, enabled, notifications_enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        schedule.id,
        schedule.medicineId,
        schedule.recurrence,
        schedule.startDate,
        schedule.endDate ?? null,
        JSON.stringify(schedule.times),
        schedule.enabled ? 1 : 0,
        schedule.notificationsEnabled ? 1 : 0,
        schedule.createdAt,
        schedule.updatedAt,
      ]
    );
  },

  delete(id: string): boolean {
    const db = getDatabase();
    if (!this.getById(id)) return false;
    const result = db.runSync('DELETE FROM schedules WHERE id = ?;', [id]);
    return result.changes > 0;
  },

  toggleEnabled(id: string, enabled: boolean): void {
    const db = getDatabase();
    db.runSync(
      'UPDATE schedules SET enabled = ?, updated_at = ? WHERE id = ?;',
      [enabled ? 1 : 0, new Date().toISOString(), id]
    );
  },
};
