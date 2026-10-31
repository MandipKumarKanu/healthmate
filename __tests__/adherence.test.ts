import { describe, expect, it } from '@jest/globals';
import {
  calculateDayAdherenceSummary,
  getDefaultDoseStatus,
  isScheduleDueOnDate,
} from '../src/database/repositories/adherenceRepository';
import { ReminderSchedule, ScheduledDose } from '../src/types';

const schedule = (
  recurrence: ReminderSchedule['recurrence'],
  startDate = '2026-04-22',
  endDate?: string,
): Pick<ReminderSchedule, 'recurrence' | 'startDate' | 'endDate'> => ({
  recurrence,
  startDate,
  endDate,
});

const dose = (status: ScheduledDose['status']) => ({ status });

describe('Adherence recurrence rules', () => {
  it('includes daily schedules from start through inclusive end date', () => {
    expect(isScheduleDueOnDate(schedule('daily'), '2026-04-22')).toBe(true);
    expect(isScheduleDueOnDate(schedule('daily'), '2026-04-23')).toBe(true);
    expect(isScheduleDueOnDate(schedule('daily', '2026-04-22', '2026-04-23'), '2026-04-24')).toBe(
      false,
    );
    expect(isScheduleDueOnDate(schedule('daily'), '2026-04-21')).toBe(false);
  });

  it('repeats weekly on the weekday of the start date', () => {
    expect(isScheduleDueOnDate(schedule('weekly', '2026-04-22'), '2026-04-29')).toBe(true);
    expect(isScheduleDueOnDate(schedule('weekly', '2026-04-22'), '2026-04-28')).toBe(false);
  });

  it('repeats monthly on the same day and clamps month-end dates', () => {
    expect(isScheduleDueOnDate(schedule('monthly', '2026-04-15'), '2026-05-15')).toBe(true);
    expect(isScheduleDueOnDate(schedule('monthly', '2026-01-31'), '2026-02-28')).toBe(true);
    expect(isScheduleDueOnDate(schedule('monthly', '2026-01-31'), '2026-02-27')).toBe(false);
  });

  it('only includes one-time schedules on their start date', () => {
    expect(isScheduleDueOnDate(schedule('once'), '2026-04-22')).toBe(true);
    expect(isScheduleDueOnDate(schedule('once'), '2026-04-23')).toBe(false);
  });

  it('does not silently interpret custom recurrence as daily', () => {
    expect(isScheduleDueOnDate(schedule('custom'), '2026-04-22')).toBe(false);
  });

  it('rejects invalid calendar dates and end dates before the start date', () => {
    expect(isScheduleDueOnDate(schedule('daily'), '2026-02-30')).toBe(false);
    expect(isScheduleDueOnDate(schedule('daily', '2026-04-22', '2026-04-20'), '2026-04-22')).toBe(
      false,
    );
  });
});

describe('Overdue dose status', () => {
  it('marks unlogged doses in the past as missed', () => {
    expect(getDefaultDoseStatus('2026-04-21', '08:00', new Date(2026, 3, 22, 10, 0))).toBe(
      'missed',
    );
  });
  it('marks today doses before current time as missed', () => {
    expect(getDefaultDoseStatus('2026-04-22', '08:00', new Date(2026, 3, 22, 10, 0))).toBe(
      'missed',
    );
  });
  it('keeps future doses upcoming', () => {
    expect(getDefaultDoseStatus('2026-04-22', '18:00', new Date(2026, 3, 22, 10, 0))).toBe(
      'upcoming',
    );
    expect(getDefaultDoseStatus('2026-04-23', '08:00', new Date(2026, 3, 22, 10, 0))).toBe(
      'upcoming',
    );
  });
  it('returns upcoming for malformed date/time input', () => {
    expect(getDefaultDoseStatus('2026-02-30', '08:00', new Date())).toBe('upcoming');
    expect(getDefaultDoseStatus('2026-04-22', '25:00', new Date())).toBe('upcoming');
  });
});

describe('Adherence summary calculation', () => {
  it('counts statuses and computes taken / all scheduled doses', () => {
    const summary = calculateDayAdherenceSummary('2026-04-22', [
      dose('taken'),
      dose('taken'),
      dose('missed'),
      dose('skipped'),
      dose('upcoming'),
      dose('upcoming'),
    ]);
    expect(summary).toEqual({
      date: '2026-04-22',
      total: 6,
      taken: 2,
      remaining: 2,
      missed: 1,
      skipped: 1,
      percentage: 33,
    });
  });
  it('returns zero percent for an empty day', () => {
    expect(calculateDayAdherenceSummary('2026-04-22', [])).toEqual({
      date: '2026-04-22',
      total: 0,
      taken: 0,
      remaining: 0,
      missed: 0,
      skipped: 0,
      percentage: 0,
    });
  });
});
