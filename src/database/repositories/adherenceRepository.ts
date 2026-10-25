import { getDatabase } from '../client';
import { medicineRepository } from './medicineRepository';
import { scheduleRepository } from './scheduleRepository';
import { ScheduledDose, DoseStatus, DayAdherenceSummary } from '../../types';

interface AdherenceLogRow {
  id: string;
  schedule_id: string;
  medicine_id: string;
  dose_date: string;
  dose_time: string;
  status: string;
  logged_at: string;
}

export const adherenceRepository = {
  getDosesForDate(date: string): ScheduledDose[] {
    const db = getDatabase();
    const schedules = scheduleRepository.getAll().filter((s) => s.enabled);
    const medicines = medicineRepository.getAll();
    const medMap = new Map(medicines.map((m) => [m.id, m]));

    const logs = db.getAllSync<AdherenceLogRow>(
      'SELECT * FROM adherence_logs WHERE dose_date = ?;',
      [date]
    );

    const logMap = new Map<string, DoseStatus>();
    for (const log of logs) {
      logMap.set(`${log.schedule_id}_${log.dose_time}`, log.status as DoseStatus);
    }

    const doses: ScheduledDose[] = [];

    for (const schedule of schedules) {
      const med = medMap.get(schedule.medicineId);
      if (!med) continue;

      // Check recurrence applicability for `date`
      if (schedule.startDate > date) continue;
      if (schedule.endDate && schedule.endDate < date) continue;

      if (schedule.recurrence === 'once' && schedule.startDate !== date) {
        continue;
      }

      for (const t of schedule.times) {
        const key = `${schedule.id}_${t.time}`;
        const loggedStatus = logMap.get(key);

        const status: DoseStatus = loggedStatus || 'upcoming';

        doses.push({
          id: `${schedule.id}_${t.id}_${date}`,
          scheduleId: schedule.id,
          medicineId: med.id,
          medicineName: med.name,
          strength: med.strength,
          dosageForm: med.dosageForm,
          date,
          time: t.time,
          amount: t.amount,
          status,
        });
      }
    }

    // Sort chronologically
    return doses.sort((a, b) => a.time.localeCompare(b.time));
  },

  logDoseStatus(
    scheduleId: string,
    medicineId: string,
    date: string,
    time: string,
    status: DoseStatus
  ): void {
    const db = getDatabase();
    const id = `log_${scheduleId}_${date}_${time.replace(':', '')}`;
    const now = new Date().toISOString();

    db.runSync(
      `INSERT OR REPLACE INTO adherence_logs (
        id, schedule_id, medicine_id, dose_date, dose_time, status, logged_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [id, scheduleId, medicineId, date, time, status, now]
    );
  },

  getDayAdherenceSummary(date: string): DayAdherenceSummary {
    const doses = this.getDosesForDate(date);
    const total = doses.length;
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

    const percentage = total > 0 ? Math.round((taken / total) * 100) : 0;

    return {
      date,
      total,
      taken,
      remaining,
      missed,
      skipped,
      percentage,
    };
  },

  getWeeklyAdherenceSummaries(endDateStr: string): DayAdherenceSummary[] {
    const summaries: DayAdherenceSummary[] = [];
    const endDate = new Date(endDateStr);

    for (let i = 6; i >= 0; i--) {
      const d = new Date(endDate);
      d.setDate(d.getDate() - i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${day}`;
      summaries.push(this.getDayAdherenceSummary(dateStr));
    }

    return summaries;
  },
};
