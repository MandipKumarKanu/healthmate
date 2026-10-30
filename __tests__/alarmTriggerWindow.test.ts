import { describe, expect, it, jest } from '@jest/globals';
import * as Notifications from 'expo-notifications';
import { getNativeAlarmTriggerWindow } from '../src/services/notificationService';
import { nativeAlarmService } from '../src/services/nativeAlarmService';
import { notificationService } from '../src/services/notificationService';

describe('Native alarm trigger window (reboot-proof chains)', () => {
  const fixedNow = new Date(2026, 9, 26, 6, 0); // Oct 26 2026, 06:00

  const millisToDateStr = (ms: number) =>
    (() => {
      const d = new Date(ms);
      return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, '0'),
        String(d.getDate()).padStart(2, '0'),
      ].join('-');
    })();

  it('never arms alarms in the past: a daily schedule started yesterday begins at the next occurrence', () => {
    const triggers = getNativeAlarmTriggerWindow(
      { recurrence: 'daily', startDate: '2026-01-01' },
      '08:00',
      fixedNow,
    );

    expect(triggers.length).toBe(60); // unbounded daily: capped at 60 occurrences
    expect(new Date(triggers[0]).getHours()).toBe(8);
    expect(new Date(triggers[0]).getDate()).toBe(26); // today, not the past
    expect(triggers.every((t) => t > fixedNow.getTime())).toBe(true);
  });

  it('extends and reschedules daily chains natively dose by dose (chain advance support)', () => {
    const triggers = getNativeAlarmTriggerWindow(
      { recurrence: 'daily', startDate: '2026-10-20' },
      '22:00',
      fixedNow,
    );

    // All triggers are on the requested time of day, exactly 24h apart
    // (timestamp diff survives month boundaries like Oct 31 → Nov 1)
    for (let i = 1; i < triggers.length; i++) {
      expect(triggers[i] - triggers[i - 1]).toBe(24 * 60 * 60 * 1000);
    }
  });

  it("stops the daily chain at the schedule's end date", () => {
    const triggers = getNativeAlarmTriggerWindow(
      {
        recurrence: 'daily',
        startDate: '2026-10-01',
        endDate: '2026-10-28',
      },
      '08:00',
      fixedNow,
    );

    expect(triggers.length).toBe(3); // 26, 27, 28 Oct (after fixedNow)
    expect(millisToDateStr(triggers[triggers.length - 1])).toBe('2026-10-28');
  });

  it('returns a single trigger for one-time schedules only when in the future', () => {
    const future = getNativeAlarmTriggerWindow(
      { recurrence: 'once', startDate: '2026-10-27' },
      '09:00',
      fixedNow,
    );
    expect(future.length).toBe(1);
    expect(millisToDateStr(future[0])).toBe('2026-10-27');

    const past = getNativeAlarmTriggerWindow(
      { recurrence: 'once', startDate: '2026-10-25' },
      '09:00',
      fixedNow,
    );
    expect(past.length).toBe(0);
  });

  it("spaces weekly chains seven days apart starting on the schedule's weekday", () => {
    const triggers = getNativeAlarmTriggerWindow(
      { recurrence: 'weekly', startDate: '2026-10-26' }, // Oct 26 2026 is a Monday
      '10:00',
      fixedNow,
    );
    expect(triggers.length).toBe(52); // unbounded weekly: capped at 52
    const dates = triggers.map(millisToDateStr);
    expect(dates[0]).toBe('2026-10-26'); // start-date Monday, later than fixedNow

    for (let i = 1; i < triggers.length; i++) {
      expect(triggers[i] - triggers[i - 1]).toBe(7 * 24 * 60 * 60 * 1000);
    }
  });

  it('clamps month-end day 31 to the last day of shorter months', () => {
    // An anchor day of 31 exercises clamping (start date = the anchor day)
    const triggers = getNativeAlarmTriggerWindow(
      { recurrence: 'monthly', startDate: '2026-10-31' },
      '09:00',
      fixedNow,
    );

    expect(triggers.length).toBe(24); // capped at 24 months
    // November 2026: day 31 clamps to 30; February 2027 clamps to 28 (non-leap)
    expect(millisToDateStr(triggers[1])).toBe('2026-11-30');
    expect(millisToDateStr(triggers[4])).toBe('2027-02-28');
    // Between Oct 2026 and Sep 2028 there are exactly 14 months with a real
    // day 31; the other 8 clamp to day 30 and the 2 Februarys to 28/29 (2028 is a leap year).
    expect(triggers.filter((t) => new Date(t).getDate() === 31).length).toBe(14);
    expect(triggers.filter((t) => new Date(t).getDate() === 30).length).toBe(8);
    expect(
      millisToDateStr(
        triggers.find((t) => new Date(t).getFullYear() === 2028 && new Date(t).getMonth() === 1)!,
      ),
    ).toBe('2028-02-29');
  });

  it('keeps a daily end date inclusive across a month boundary', () => {
    const triggers = getNativeAlarmTriggerWindow(
      { recurrence: 'daily', startDate: '2026-10-30', endDate: '2026-11-01' },
      '08:00',
      new Date(2026, 9, 30, 6, 0),
    );

    expect(triggers.map(millisToDateStr)).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
    ]);
  });

  it('does not create a daily occurrence after a year-end end date', () => {
    const triggers = getNativeAlarmTriggerWindow(
      { recurrence: 'daily', startDate: '2026-12-30', endDate: '2026-12-31' },
      '08:00',
      new Date(2026, 11, 30, 6, 0),
    );

    expect(triggers.map(millisToDateStr)).toEqual(['2026-12-30', '2026-12-31']);
    expect(
      getNativeAlarmTriggerWindow(
        { recurrence: 'daily', startDate: '2026-12-30', endDate: '2026-12-31' },
        '08:00',
        new Date(2026, 11, 31, 9, 0),
      ),
    ).toEqual([]);
  });

  it('keeps weekly occurrences within an inclusive end date', () => {
    const triggers = getNativeAlarmTriggerWindow(
      { recurrence: 'weekly', startDate: '2026-10-26', endDate: '2026-11-09' },
      '10:00',
      fixedNow,
    );

    expect(triggers.map(millisToDateStr)).toEqual([
      '2026-10-26',
      '2026-11-02',
      '2026-11-09',
    ]);
  });


  it('does not carry a schedule past midnight when its end date is today', () => {
    const justBeforeMidnight = new Date(2026, 9, 28, 23, 59, 59, 999);
    const triggers = getNativeAlarmTriggerWindow(
      {
        recurrence: 'daily',
        startDate: '2026-10-01',
        endDate: '2026-10-28',
      },
      '08:00',
      justBeforeMidnight,
    );

    // The final occurrence for Oct 28 has already passed. Oct 29 is outside
    // the inclusive end date, so the next day's midnight must not revive it.
    expect(triggers).toEqual([]);
  });

  it('keeps an occurrence at the start of the end date valid across midnight', () => {
    const justAfterMidnight = new Date(2026, 9, 29, 0, 0, 0, 0);
    const triggers = getNativeAlarmTriggerWindow(
      {
        recurrence: 'daily',
        startDate: '2026-10-28',
        endDate: '2026-10-29',
      },
      '08:00',
      justAfterMidnight,
    );

    expect(triggers.map(millisToDateStr)).toEqual(['2026-10-29']);
  });

  it('returns an empty window for invalid times', () => {
    expect(
      getNativeAlarmTriggerWindow(
        { recurrence: 'daily', startDate: '2026-10-26' },
        '8:00',
        fixedNow,
      ),
    ).toEqual([]);
    expect(
      getNativeAlarmTriggerWindow(
        { recurrence: 'daily', startDate: '2026-10-26' },
        '24:30',
        fixedNow,
      ),
    ).toEqual([]);
  });

  it('falls back to a daily-today schedule when no config is passed', () => {
    const triggers = getNativeAlarmTriggerWindow(undefined, '20:00', fixedNow);
    expect(triggers.length).toBe(60);
    expect(new Date(triggers[0]).getHours()).toBe(20);
  });

  it('scheduleDoseReminder arms the native reboot-proof chain and schedules the OS notification', async () => {
    const scheduledSpy = jest.spyOn(Notifications, 'scheduleNotificationAsync');
    const result = await notificationService.scheduleDoseReminder(
      'sched_chain_test',
      'Aspirin',
      '1 tablet',
      '20:00',
    );
    expect(result).not.toBeNull();
    expect(scheduledSpy).toHaveBeenCalled();
  });
});
