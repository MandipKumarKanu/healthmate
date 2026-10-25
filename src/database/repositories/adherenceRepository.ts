import { getDatabase } from '../client';
import { medicineRepository } from './medicineRepository';
import { scheduleRepository } from './scheduleRepository';
import { ScheduledDose, DoseStatus, DayAdherenceSummary, ReminderSchedule } from '../../types';

interface AdherenceLogRow {
  id: string;
  schedule_id: string;
  medicine_id: string;
  dose_date: string;
  dose_time: string;
  status: string;
  logged_at: string;
}

function parseDateParts(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const parts: [number, number, number] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 || date.getUTCDate() !== parts[2]) {
    return null;
  }
  return parts;
}

/**
 * Weekly schedules repeat on the weekday of their start date. Monthly schedules
 * repeat on the same day-of-month, clamped to the last day of shorter months.
 * "custom" has no weekday/day-selection data in the current schema, so it is
 * intentionally not expanded into a potentially unsafe daily schedule.
 */
export function isScheduleDueOnDate(
  schedule: Pick<ReminderSchedule, 'recurrence' | 'startDate' | 'endDate'>,
  date: string
): boolean {
  const target = parseDateParts(date);
  const start = parseDateParts(schedule.startDate);
  if (!target || !start) return false;
  if (schedule.endDate && (!parseDateParts(schedule.endDate) || schedule.endDate < schedule.startDate)) return false;
  if (date < schedule.startDate || (schedule.endDate && date > schedule.endDate)) return false;

  if (schedule.recurrence === 'once') return date === schedule.startDate;
  if (schedule.recurrence === 'daily') return true;
  if (schedule.recurrence === 'weekly') {
    return new Date(target[0], target[1] - 1, target[2]).getDay() ===
      new Date(start[0], start[1] - 1, start[2]).getDay();
  }
  if (schedule.recurrence === 'monthly') {
    const lastDay = new Date(target[0], target[1], 0).getDate();
    return target[2] === Math.min(start[2], lastDay);
  }
  return false;
}

export function getDefaultDoseStatus(date: string, time: string, now: Date = new Date()): DoseStatus {
  if (!parseDateParts(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return 'upcoming';

  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  if (date < today) return 'missed';
  if (date > today) return 'upcoming';

  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes <= now.getHours() * 60 + now.getMinutes()
    ? 'missed'
    : 'upcoming';
}

export function calculateDayAdherenceSummary(
  date: string,
  doses: Pick<ScheduledDose, 'status'>[]
): DayAdherenceSummary {
  let taken = 0;
  let missed = 0;
  let skipped = 0;
  let remaining = 0;
  for (const dose of doses) {
    if (dose.status === 'taken') taken++;
    else if (dose.status === 'missed') missed++;
    else if (dose.status === 'skipped') skipped++;
    else remaining++;
  }
  const total = doses.length;
  return { date, total, taken, remaining, missed, skipped, percentage: total > 0 ? Math.round((taken / total) * 100) : 0 };
}

export const adherenceRepository = {
  getDosesForDate(date: string): ScheduledDose[] {
    if (!parseDateParts(date)) return [];
    const db = getDatabase();
    const schedules = scheduleRepository.getAll().filter(
      (schedule) => schedule.enabled && isScheduleDueOnDate(schedule, date)
    );
    const medicines = medicineRepository.getAll();
    const medMap = new Map(medicines.map((medicine) => [medicine.id, medicine]));
    const logs = db.getAllSync<AdherenceLogRow>(
      'SELECT * FROM adherence_logs WHERE dose_date = ?;',
      [date]
    );

    const logMap = new Map<string, DoseStatus>();
    for (const log of logs) {
      if (['taken', 'missed', 'skipped', 'upcoming'].includes(log.status)) {
        logMap.set(`${log.schedule_id}_${log.dose_time}`, log.status as DoseStatus);
      }
    }

    const doses: ScheduledDose[] = [];
    for (const schedule of schedules) {
      const medicine = medMap.get(schedule.medicineId);
      if (!medicine) continue;
      for (const reminderTime of schedule.times) {
        const loggedStatus = logMap.get(`${schedule.id}_${reminderTime.time}`);
        doses.push({
          id: `${schedule.id}_${reminderTime.id}_${date}`,
          scheduleId: schedule.id,
          medicineId: medicine.id,
          medicineName: medicine.name,
          strength: medicine.strength,
          dosageForm: medicine.dosageForm,
          date,
          time: reminderTime.time,
          amount: reminderTime.amount,
          // Explicit user logs win. Inferred overdue status is not persisted.
          status: loggedStatus ?? getDefaultDoseStatus(date, reminderTime.time),
        });
      }
    }
    return doses.sort((a, b) => a.time.localeCompare(b.time));
  },

  logDoseStatus(scheduleId: string, medicineId: string, date: string, time: string, status: DoseStatus): void {
    if (!parseDateParts(date)) throw new Error('Invalid dose date. Expected YYYY-MM-DD.');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Invalid dose time. Expected HH:mm.');
    if (!['taken', 'missed', 'skipped', 'upcoming'].includes(status)) throw new Error('Invalid dose status.');

    const schedule = scheduleRepository.getById(scheduleId);
    if (!schedule || schedule.medicineId !== medicineId) {
      throw new Error('Cannot log a dose for an unknown schedule or mismatched medicine.');
    }
    if (!isScheduleDueOnDate(schedule, date) || !schedule.times.some((entry) => entry.time === time)) {
      throw new Error('The selected schedule has no dose at that date and time.');
    }

    getDatabase().runSync(
      `INSERT OR REPLACE INTO adherence_logs (
        id, schedule_id, medicine_id, dose_date, dose_time, status, logged_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [`log_${scheduleId}_${date}_${time.replace(':', '')}`, scheduleId, medicineId, date, time, status, new Date().toISOString()]
    );
  },

  getDayAdherenceSummary(date: string): DayAdherenceSummary {
    return calculateDayAdherenceSummary(date, this.getDosesForDate(date));
  },

  getWeeklyAdherenceSummaries(endDateStr: string): DayAdherenceSummary[] {
    const parts = parseDateParts(endDateStr);
    if (!parts) return [];
    const endDate = new Date(parts[0], parts[1] - 1, parts[2]);
    const summaries: DayAdherenceSummary[] = [];
    for (let offset = 6; offset >= 0; offset--) {
      const date = new Date(endDate);
      date.setDate(date.getDate() - offset);
      const dateStr = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
      ].join('-');
      summaries.push(this.getDayAdherenceSummary(dateStr));
    }
    return summaries;
  },
};
