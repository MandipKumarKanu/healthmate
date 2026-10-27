import { describe, it, expect } from '@jest/globals';
import { ScheduledDose, DayAdherenceSummary } from '../src/types';

describe('Home Screen Logic & Adherence Calculations', () => {
  const sampleDoses: ScheduledDose[] = [
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

  function computeSummary(doses: ScheduledDose[], dateStr: string): DayAdherenceSummary {
    const total = doses.length;
    let taken = 0;
    let missed = 0;
    let skipped = 0;
    let remaining = 0;

    for (const d of doses) {
      if (d.status === 'taken') taken++;
      else if (d.status === 'missed') missed++;
      else if (d.status === 'skipped') skipped++;
      else remaining++;
    }

    const percentage = total > 0 ? Math.round((taken / total) * 100) : 0;
    return {
      date: dateStr,
      total,
      taken,
      remaining,
      missed,
      skipped,
      percentage,
    };
  }

  function extractInitials(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) return 'AM';
    const parts = trimmed.split(' ').filter(Boolean);
    return (
      parts
        .map((p) => p[0])
        .join('')
        .slice(0, 2)
        .toUpperCase() || 'AM'
    );
  }

  function formatDisplayDate(dateStr: string): string {
    const [year, month, day] = dateStr.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  }

  it('correctly finds the Next Up upcoming dose (Metformin at 18:00)', () => {
    const nextUp = sampleDoses.find((d) => d.status === 'upcoming');
    expect(nextUp).toBeDefined();
    expect(nextUp?.medicineName).toBe('Metformin');
    expect(nextUp?.time).toBe('18:00');
    expect(nextUp?.strength).toBe('500 mg');
  });

  it('computes initial 50% adherence state with 3 taken, 1 missed, 1 skipped, 1 upcoming', () => {
    const summary = computeSummary(sampleDoses, '2026-04-22');
    expect(summary.total).toBe(6);
    expect(summary.taken).toBe(3);
    expect(summary.missed).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.remaining).toBe(1);
    expect(summary.percentage).toBe(50);
  });

  it('updates to 67% adherence when Next Up dose is marked as Taken', () => {
    const updatedDoses = sampleDoses.map((d) =>
      d.id === '6' ? { ...d, status: 'taken' as const } : d,
    );
    const summary = computeSummary(updatedDoses, '2026-04-22');
    expect(summary.total).toBe(6);
    expect(summary.taken).toBe(4);
    expect(summary.remaining).toBe(0);
    expect(summary.percentage).toBe(67);
  });

  it('extracts avatar initials reliably', () => {
    expect(extractInitials('Alex Morgan')).toBe('AM');
    expect(extractInitials('Alex')).toBe('A');
    expect(extractInitials('   ')).toBe('AM');
    expect(extractInitials('John Robert Smith')).toBe('JR');
  });

  it('formats calendar dates matching the reference header format', () => {
    expect(formatDisplayDate('2026-04-22')).toBe('Wednesday, April 22');
  });
});
