import { describe, it, expect } from '@jest/globals';
import { DayAdherenceSummary, ScheduledDose } from '../src/types';

describe('Adherence Calculation & Status Logic', () => {
  function calculateAdherenceSummary(doses: ScheduledDose[]): DayAdherenceSummary {
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
      date: '2026-04-22',
      total,
      taken,
      remaining,
      missed,
      skipped,
      percentage,
    };
  }

  it('calculates 50% adherence for 3 taken out of 6 doses matching reference screenshot', () => {
    const doses: ScheduledDose[] = [
      {
        id: '1',
        scheduleId: 's1',
        medicineId: 'm1',
        medicineName: 'Metformin',
        strength: '500 mg',
        dosageForm: 'tablet',
        date: '2026-04-22',
        time: '08:00',
        amount: '1 tablet',
        status: 'taken',
      },
      {
        id: '2',
        scheduleId: 's2',
        medicineId: 'm2',
        medicineName: 'Vitamin D3',
        strength: '1,000 IU',
        dosageForm: 'softgel',
        date: '2026-04-22',
        time: '08:00',
        amount: '1 softgel',
        status: 'taken',
      },
      {
        id: '3',
        scheduleId: 's3',
        medicineId: 'm3',
        medicineName: 'Cetirizine',
        strength: '10 mg',
        dosageForm: 'tablet',
        date: '2026-04-22',
        time: '09:00',
        amount: '1 tablet',
        status: 'taken',
      },
      {
        id: '4',
        scheduleId: 's4',
        medicineId: 'm4',
        medicineName: 'Lubricating eye drops',
        strength: '0.5%',
        dosageForm: 'eye_drop',
        date: '2026-04-22',
        time: '12:00',
        amount: 'Saved label directions',
        status: 'missed',
      },
      {
        id: '5',
        scheduleId: 's4',
        medicineId: 'm4',
        medicineName: 'Lubricating eye drops',
        strength: '0.5%',
        dosageForm: 'eye_drop',
        date: '2026-04-22',
        time: '13:00',
        amount: 'Saved label directions',
        status: 'skipped',
      },
      {
        id: '6',
        scheduleId: 's1',
        medicineId: 'm1',
        medicineName: 'Metformin',
        strength: '500 mg',
        dosageForm: 'tablet',
        date: '2026-04-22',
        time: '18:00',
        amount: '1 tablet',
        status: 'upcoming',
      },
    ];

    const summary = calculateAdherenceSummary(doses);

    expect(summary.total).toBe(6);
    expect(summary.taken).toBe(3);
    expect(summary.remaining).toBe(1);
    expect(summary.missed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.percentage).toBe(50);
  });

  it('handles 100% adherence when all doses are taken', () => {
    const doses: ScheduledDose[] = [
      {
        id: '1',
        scheduleId: 's1',
        medicineId: 'm1',
        medicineName: 'Metformin',
        strength: '500 mg',
        dosageForm: 'tablet',
        date: '2026-04-22',
        time: '08:00',
        amount: '1 tablet',
        status: 'taken',
      },
      {
        id: '2',
        scheduleId: 's1',
        medicineId: 'm1',
        medicineName: 'Metformin',
        strength: '500 mg',
        dosageForm: 'tablet',
        date: '2026-04-22',
        time: '18:00',
        amount: '1 tablet',
        status: 'taken',
      },
    ];

    const summary = calculateAdherenceSummary(doses);
    expect(summary.percentage).toBe(100);
    expect(summary.taken).toBe(2);
    expect(summary.remaining).toBe(0);
  });

  it('returns 0% adherence when no doses have been taken', () => {
    const doses: ScheduledDose[] = [
      {
        id: '1',
        scheduleId: 's1',
        medicineId: 'm1',
        medicineName: 'Metformin',
        strength: '500 mg',
        dosageForm: 'tablet',
        date: '2026-04-22',
        time: '08:00',
        amount: '1 tablet',
        status: 'missed',
      },
    ];

    const summary = calculateAdherenceSummary(doses);
    expect(summary.percentage).toBe(0);
    expect(summary.missed).toBe(1);
  });

  it('handles empty dose list safely', () => {
    const summary = calculateAdherenceSummary([]);
    expect(summary.total).toBe(0);
    expect(summary.percentage).toBe(0);
  });
});
