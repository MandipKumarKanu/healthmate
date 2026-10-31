import { getDatabase, withTransaction } from '../client';
import { medicineRepository } from './medicineRepository';
import { scheduleRepository } from './scheduleRepository';
import { refillService } from '../../services/refillService';
import {
  parseDateParts,
  isScheduleDueOnDate,
  getTodayDateString,
} from '../../utils/scheduleRecurrence';
import { ScheduledDose, DoseStatus, DayAdherenceSummary, ReminderSchedule } from '../../types';

export { parseDateParts, isScheduleDueOnDate };

interface AdherenceLogRow {
  id: string;
  schedule_id: string;
  medicine_id: string;
  dose_date: string;
  dose_time: string;
  status: string;
  logged_at: string;
}

export function getDefaultDoseStatus(
  date: string,
  time: string,
  now: Date = new Date(),
): DoseStatus {
  if (!parseDateParts(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return 'upcoming';

  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  if (date < today) return 'missed';
  if (date > today) return 'upcoming';

  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes <= now.getHours() * 60 + now.getMinutes() ? 'missed' : 'upcoming';
}

export function calculateDayAdherenceSummary(
  date: string,
  doses: Pick<ScheduledDose, 'status'>[],
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
  return {
    date,
    total,
    taken,
    remaining,
    missed,
    skipped,
    percentage: total > 0 ? Math.round((taken / total) * 100) : 0,
  };
}

/** How many past days the missed-dose sweep covers (matches the insights weekly window). */
export const MISSED_SWEEP_LOOKBACK_DAYS = 7;

/**
 * True when a dose scheduled for `date`/`time` should already have been taken
 * (or flagged missed) as of `now` — including today's doses whose time passed.
 */
function isDoseOverdue(date: string, time: string, today: string, nowMinutes: number): boolean {
  if (date < today) return true;
  if (date > today) return false;
  const [hours, minutes] = time.split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return false;
  return hours * 60 + minutes <= nowMinutes;
}

export const adherenceRepository = {
  /**
   * Auto-miss sweep: writes overdue doses into `adherence_logs` so
   * adherence insights no longer depend on which dates the user happened to
   * open. Covers enabled, non-sample schedules over the last
   * `MISSED_SWEEP_LOOKBACK_DAYS` days plus today.
   *
   * Conservative by design:
   * - never overwrites an existing log row (user intent — taken / skipped /
   *   explicit missed rows — always wins),
   * - skips sample/seed schedules so demo data is not polluted,
   * - uses the same log id convention as `logDoseStatus` for stable identity.
   *
   * Returns the persisted log ids (empty when everything was already covered).
   */
  persistMissedDoses(
    now: Date = new Date(),
    lookbackDays: number = MISSED_SWEEP_LOOKBACK_DAYS,
  ): string[] {
    const today = getTodayDateString(now);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const dates: string[] = [];
    for (let offset = lookbackDays; offset >= 0; offset--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
      dates.push(getTodayDateString(d));
    }

    const db = getDatabase();
    const persisted: string[] = [];

    for (const schedule of scheduleRepository.getAll()) {
      if (!schedule.enabled || schedule.times.length === 0) continue;
      const medicine = medicineRepository.getById(schedule.medicineId);
      if (!medicine || medicine.isSample) continue;

      for (const date of dates) {
        if (!isScheduleDueOnDate(schedule, date)) continue;
        for (const timeEntry of schedule.times) {
          if (!isDoseOverdue(date, timeEntry.time, today, nowMinutes)) {
            continue;
          }
          const existing = db.getFirstSync<{ status: string }>(
            'SELECT status FROM adherence_logs WHERE dose_date = ? AND dose_time = ? AND schedule_id = ?;',
            [date, timeEntry.time, schedule.id],
          );
          if (existing) continue;

          const logId = `log_${schedule.id}_${date}_${timeEntry.time.replace(':', '')}`;
          db.runSync(
            `INSERT OR REPLACE INTO adherence_logs (
              id, schedule_id, medicine_id, dose_date, dose_time, status, logged_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
            [logId, schedule.id, medicine.id, date, timeEntry.time, 'missed', now.toISOString()],
          );
          persisted.push(logId);
        }
      }
    }

    return persisted;
  },

  getDosesForDate(date: string): ScheduledDose[] {
    if (!parseDateParts(date)) return [];
    const db = getDatabase();
    const schedules = scheduleRepository.getSchedulesForDate(date);
    const medicines = medicineRepository.getAll();
    const medMap = new Map(medicines.map((medicine) => [medicine.id, medicine]));
    const logs = db.getAllSync<AdherenceLogRow>(
      'SELECT * FROM adherence_logs WHERE dose_date = ?;',
      [date],
    );

    const logMap = new Map<string, DoseStatus>();
    const coveredLogKeys = new Set<string>();

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
        const key = `${schedule.id}_${reminderTime.time}`;
        const loggedStatus = logMap.get(key);
        if (loggedStatus) {
          coveredLogKeys.add(key);
        }
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

    // Preserve historical dose identity for ANY logged dose on this date
    // that was not covered by the current/historical schedule times
    // (e.g. ad-hoc logged doses, deleted doses, or doses logged before an edit).
    for (const log of logs) {
      const key = `${log.schedule_id}_${log.dose_time}`;
      if (!coveredLogKeys.has(key)) {
        const medicine = medMap.get(log.medicine_id);
        if (!medicine) continue;
        doses.push({
          id: `${log.schedule_id}_log_${log.dose_time.replace(':', '')}_${date}`,
          scheduleId: log.schedule_id,
          medicineId: log.medicine_id,
          medicineName: medicine.name,
          strength: medicine.strength,
          dosageForm: medicine.dosageForm,
          date,
          time: log.dose_time,
          amount: '1 dose',
          status: log.status as DoseStatus,
          loggedAt: log.logged_at,
        });
      }
    }

    return doses.sort((a, b) => a.time.localeCompare(b.time));
  },

  logDoseStatus(
    scheduleId: string,
    medicineId: string,
    date: string,
    time: string,
    status: DoseStatus,
  ): void {
    if (!parseDateParts(date)) throw new Error('Invalid dose date. Expected YYYY-MM-DD.');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
      throw new Error('Invalid dose time. Expected HH:mm.');
    if (!['taken', 'missed', 'skipped', 'upcoming'].includes(status))
      throw new Error('Invalid dose status.');

    const schedulesForDate = scheduleRepository.getSchedulesForDate(date);
    const schedule =
      schedulesForDate.find((s) => s.id === scheduleId) ?? scheduleRepository.getById(scheduleId);

    if (!schedule || schedule.medicineId !== medicineId) {
      throw new Error('Cannot log a dose for an unknown schedule or mismatched medicine.');
    }
    if (
      !isScheduleDueOnDate(schedule, date) ||
      !schedule.times.some((entry) => entry.time === time)
    ) {
      throw new Error('The selected schedule has no dose at that date and time.');
    }

    const logId = `log_${scheduleId}_${date}_${time.replace(':', '')}`;

    let refillAlertNeeded: { medName: string; stock: number; unitDosage?: string } | null = null;

    // Atomically update adherence log and inventory inside a single transaction
    withTransaction(() => {
      // Stock accounting: only transition into/out of 'taken' consumes a unit.
      // Re-logging an already-taken dose, or logging a never-taken dose again,
      // must not double-count (or compensate twice).
      const previousStatus = getDatabase().getFirstSync<{ status: DoseStatus }>(
        'SELECT status FROM adherence_logs WHERE dose_date = ? AND dose_time = ? AND schedule_id = ?;',
        [date, time, scheduleId],
      );
      let stockDelta: number | null = null;
      if (status === 'taken' && previousStatus?.status !== 'taken') stockDelta = -1;
      else if (status !== 'taken' && previousStatus?.status === 'taken') stockDelta = 1;

      getDatabase().runSync(
        `INSERT OR REPLACE INTO adherence_logs (
          id, schedule_id, medicine_id, dose_date, dose_time, status, logged_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
        [logId, scheduleId, medicineId, date, time, status, new Date().toISOString()],
      );

      if (stockDelta !== null) {
        const change = refillService.applyStockChange(medicineId, stockDelta);
        if (change?.thresholdCrossed) {
          const med = medicineRepository.getById(medicineId);
          refillAlertNeeded = {
            medName: med?.name ?? 'Your medicine',
            stock: change.stock,
            unitDosage: med?.unitDosage,
          };
        }
      }
    });

    // Fire refill notification outside the database transaction
    if (refillAlertNeeded) {
      const { medName, stock, unitDosage } = refillAlertNeeded;
      void refillService
        .notifyRefillNeeded(medName, stock, unitDosage)
        .then(() => refillService.markReminded(medicineId))
        .catch(() => undefined);
    }
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
