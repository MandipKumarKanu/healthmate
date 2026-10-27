import { afterEach, describe, expect, it } from '@jest/globals';
import { getDatabase } from '../src/database/client';
import {
  MISSED_SWEEP_LOOKBACK_DAYS,
  adherenceRepository,
} from '../src/database/repositories/adherenceRepository';
import { medicineRepository } from '../src/database/repositories/medicineRepository';
import { scheduleRepository } from '../src/database/repositories/scheduleRepository';
import { ReminderSchedule } from '../src/types';

// Fixed sweep moment: Nov 5 2026, 12:00 local — after the 09:00 dose time.
const SWEEP_NOW = new Date(2026, 10, 5, 12, 0, 0);

const MED_REAL_ID = 'med_sweep_real';
const MED_SAMPLE_ID = 'med_sweep_sample';
const SCHEDULE_ID = 'sched_sweep_daily';

function makeSchedule(
  medicineId: string,
  id: string,
  overrides: Partial<ReminderSchedule> = {},
): ReminderSchedule {
  return {
    id,
    medicineId,
    recurrence: 'daily',
    startDate: '2026-10-30', // one day inside the 7-day lookback
    times: [{ id: 't_morning', time: '09:00', amount: '1 tablet' }],
    enabled: true,
    notificationsEnabled: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMedicinesAndSchedule() {
  medicineRepository.create({
    id: MED_REAL_ID,
    name: 'Sweep Real Medicine',
    strength: '10 mg',
    dosageForm: 'tablet',
    category: 'Generic',
    packageDetails: {},
    isSample: false,
  });
  medicineRepository.create({
    id: MED_SAMPLE_ID,
    name: 'Sweep Sample Medicine',
    strength: '5 mg',
    dosageForm: 'tablet',
    category: 'Demo',
    packageDetails: {},
    isSample: true,
  });
  scheduleRepository.save(makeSchedule(MED_REAL_ID, SCHEDULE_ID));
  scheduleRepository.save(makeSchedule(MED_SAMPLE_ID, `${SCHEDULE_ID}_sample`));
}

describe('Missed-dose sweep (persistMissedDoses)', () => {
  afterEach(() => {
    scheduleRepository.delete(SCHEDULE_ID);
    scheduleRepository.delete(`${SCHEDULE_ID}_sample`);
    medicineRepository.delete(MED_REAL_ID);
    medicineRepository.delete(MED_SAMPLE_ID);
  });

  it('persists every overdue unlogged dose for a real, enabled schedule', () => {
    createMedicinesAndSchedule();

    const persisted = adherenceRepository.persistMissedDoses(SWEEP_NOW, MISSED_SWEEP_LOOKBACK_DAYS);

    // Lookback covers 2026-10-29..2026-11-05; the schedule starts 2026-10-30,
    // so 7 overdue doses qualify (10-30 through 11-05, all after 09:00).
    expect(persisted).toHaveLength(7);
    expect(persisted[0]).toBe(`log_${SCHEDULE_ID}_2026-10-30_0900`);
    expect(persisted.includes(`log_${SCHEDULE_ID}_2026-11-05_0900`)).toBe(true);

    // Persisted rows are real adherence_logs entries, not just inferred
    // display status (getDefaultDoseStatus would show 'missed' without one).
    const rows = getDatabase().getAllSync<{
      status: string;
      logged_at: string;
    }>('SELECT * FROM adherence_logs WHERE dose_date = ?;', ['2026-10-31']);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('missed');
    expect(rows[0]?.logged_at).toBeTruthy();

    const doses = adherenceRepository.getDosesForDate('2026-10-31');
    const swept = doses.find((d) => d.scheduleId === SCHEDULE_ID);
    expect(swept?.status).toBe('missed');
  });

  it('is idempotent: already-covered days are not re-contacted or duplicated', () => {
    createMedicinesAndSchedule();

    const first = adherenceRepository.persistMissedDoses(SWEEP_NOW, MISSED_SWEEP_LOOKBACK_DAYS);
    expect(first).toHaveLength(7);

    const second = adherenceRepository.persistMissedDoses(SWEEP_NOW, MISSED_SWEEP_LOOKBACK_DAYS);
    expect(second).toHaveLength(0);

    const doses = adherenceRepository.getDosesForDate('2026-10-31');
    expect(doses.filter((d) => d.scheduleId === SCHEDULE_ID).length).toBe(1);
  });

  it('never overwrites an explicit user log (taken/skipped/missed wins)', () => {
    createMedicinesAndSchedule();

    adherenceRepository.logDoseStatus(SCHEDULE_ID, MED_REAL_ID, '2026-11-01', '09:00', 'taken');

    const persisted = adherenceRepository.persistMissedDoses(SWEEP_NOW, MISSED_SWEEP_LOOKBACK_DAYS);
    expect(persisted).toHaveLength(6); // the taken day is skipped

    const doses = adherenceRepository.getDosesForDate('2026-11-01');
    const dose = doses.find((d) => d.scheduleId === SCHEDULE_ID);
    expect(dose?.status).toBe('taken');
  });

  it('skips sample/seed schedules and disabled schedules', () => {
    createMedicinesAndSchedule();
    scheduleRepository.toggleEnabled(SCHEDULE_ID, false);

    const persisted = adherenceRepository.persistMissedDoses(SWEEP_NOW, MISSED_SWEEP_LOOKBACK_DAYS);

    expect(persisted).toHaveLength(0);
  });
});
