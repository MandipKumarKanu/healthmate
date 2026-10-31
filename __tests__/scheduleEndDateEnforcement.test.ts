import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Notifications from 'expo-notifications';
import {
  getNativeAlarmTriggerWindow,
  getNotificationTriggersForDose,
  getRequiredCoverageThroughDate,
  notificationService,
} from '../src/services/notificationService';
import { nativeAlarmService } from '../src/services/nativeAlarmService';
import { medicineRepository } from '../src/database/repositories/medicineRepository';
import { scheduleRepository } from '../src/database/repositories/scheduleRepository';
import { resetDatabase } from '../src/database/client';
import type { Medicine, ReminderSchedule } from '../src/types';

const MEDICINE_ID = 'med_end_date_enforcement';
const SCHEDULE_ID = 'sched_end_date_enforcement';

function makeMedicine(): Medicine {
  return {
    id: MEDICINE_ID,
    name: 'End Date Test Medicine',
    strength: '250 mg',
    dosageForm: 'capsule',
    category: 'Antibiotic',
    packageDetails: {},
    isSample: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeSchedule(overrides?: Partial<ReminderSchedule>): ReminderSchedule {
  return {
    id: SCHEDULE_ID,
    medicineId: MEDICINE_ID,
    recurrence: 'daily',
    startDate: '2026-10-25',
    endDate: '2026-10-31',
    times: [{ id: 't1', time: '08:00', amount: '1 capsule' }],
    enabled: true,
    notificationsEnabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function millisToDateString(epochMillis: number): string {
  const d = new Date(epochMillis);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

function millisToTimeString(epochMillis: number): string {
  const d = new Date(epochMillis);
  return [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
  ].join(':');
}

describe('Schedule End Date Enforcement', () => {
  beforeEach(() => {
    resetDatabase();
    (Notifications as any).__clearScheduledNotifications();
    medicineRepository.create(makeMedicine());
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await notificationService.cancelAll();
    (Notifications as any).__clearScheduledNotifications();
    jest.restoreAllMocks();
  });

  describe('1. Daily alarms never fire or generate triggers after end date', () => {
    it('stops generating native alarm triggers on or before endDate', () => {
      const fixedNow = new Date(2026, 9, 25, 6, 0); // Oct 25, 2026, 06:00
      const triggers = getNativeAlarmTriggerWindow(
        {
          recurrence: 'daily',
          startDate: '2026-10-25',
          endDate: '2026-10-28',
        },
        '08:00',
        fixedNow,
      );

      // Expected occurrences: Oct 25, 26, 27, 28 = 4 triggers
      expect(triggers.length).toBe(4);
      const dates = triggers.map(millisToDateString);
      expect(dates).toEqual(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28']);
      expect(dates[dates.length - 1]).toBe('2026-10-28');

      // None past 2026-10-28
      expect(triggers.every((ms) => millisToDateString(ms) <= '2026-10-28')).toBe(true);
    });

    it('stops generating OS notification triggers on or before endDate', () => {
      const fixedNow = new Date(2026, 9, 25, 6, 0); // Oct 25, 2026, 06:00
      const triggers = getNotificationTriggersForDose(
        {
          recurrence: 'daily',
          startDate: '2026-10-25',
          endDate: '2026-10-27',
        },
        '08:00',
        fixedNow,
        true,
      );

      // Should be discrete DATE triggers for Oct 25, 26, 27
      expect(triggers.length).toBe(3);
      for (const t of triggers) {
        expect((t as any).type).toBe(Notifications.SchedulableTriggerInputTypes.DATE);
        const triggerDate = millisToDateString((t as any).date.getTime());
        expect(triggerDate <= '2026-10-27').toBe(true);
      }
    });
  });

  describe('2. Weekly alarms never fire or generate triggers after end date', () => {
    it('stops generating weekly native triggers strictly at endDate', () => {
      // Oct 25, 2026 is a Sunday.
      // Next Sundays: Nov 1, Nov 8, Nov 15, Nov 22.
      // If endDate is Nov 10, triggers must only include Oct 25, Nov 1, Nov 8.
      const fixedNow = new Date(2026, 9, 25, 6, 0); // Sunday Oct 25, 06:00
      const triggers = getNativeAlarmTriggerWindow(
        {
          recurrence: 'weekly',
          startDate: '2026-10-25',
          endDate: '2026-11-10',
        },
        '10:00',
        fixedNow,
      );

      const dates = triggers.map(millisToDateString);
      expect(dates).toEqual(['2026-10-25', '2026-11-01', '2026-11-08']);
      expect(dates.every((d) => d <= '2026-11-10')).toBe(true);
    });

    it('generates no triggers if endDate is before the next weekly occurrence', () => {
      // Sunday Oct 25, 06:00. Time is 10:00.
      // If startDate is Oct 25, but endDate is Oct 24:
      const fixedNow = new Date(2026, 9, 25, 6, 0);
      const triggers = getNativeAlarmTriggerWindow(
        {
          recurrence: 'weekly',
          startDate: '2026-10-25',
          endDate: '2026-10-24', // invalid/past range
        },
        '10:00',
        fixedNow,
      );

      expect(triggers).toEqual([]);
    });
  });

  describe('3. Unbounded schedules continue according to recurrence', () => {
    it('generates the maximum trigger window cap for unbounded daily schedules', () => {
      const fixedNow = new Date(2026, 9, 25, 6, 0);
      const triggers = getNativeAlarmTriggerWindow(
        {
          recurrence: 'daily',
          startDate: '2026-10-25',
          endDate: undefined,
        },
        '08:00',
        fixedNow,
      );

      expect(triggers.length).toBe(60);
      expect(millisToDateString(triggers[0])).toBe('2026-10-25');
      // Consecutive 24 hour intervals
      for (let i = 1; i < triggers.length; i++) {
        expect(triggers[i] - triggers[i - 1]).toBe(24 * 60 * 60 * 1000);
      }
    });

    it('generates the maximum trigger window cap for unbounded weekly schedules', () => {
      const fixedNow = new Date(2026, 9, 25, 6, 0);
      const triggers = getNativeAlarmTriggerWindow(
        {
          recurrence: 'weekly',
          startDate: '2026-10-25',
          endDate: undefined,
        },
        '09:00',
        fixedNow,
      );

      expect(triggers.length).toBe(52);
      for (let i = 1; i < triggers.length; i++) {
        expect(triggers[i] - triggers[i - 1]).toBe(7 * 24 * 60 * 60 * 1000);
      }
    });
  });

  describe('4. Once schedules never become recurring', () => {
    it('generates exactly one trigger in the future, never repeats', () => {
      const fixedNow = new Date(2026, 9, 25, 6, 0);
      const triggers = getNativeAlarmTriggerWindow(
        {
          recurrence: 'once',
          startDate: '2026-10-25',
        },
        '08:00',
        fixedNow,
      );

      expect(triggers.length).toBe(1);
      expect(millisToDateString(triggers[0])).toBe('2026-10-25');
      expect(millisToTimeString(triggers[0])).toBe('08:00');
    });

    it('returns empty trigger list when the once date has already passed', () => {
      const fixedNow = new Date(2026, 9, 25, 12, 0); // 12:00
      const triggers = getNativeAlarmTriggerWindow(
        {
          recurrence: 'once',
          startDate: '2026-10-25',
        },
        '08:00', // in past
        fixedNow,
      );

      expect(triggers.length).toBe(0);
    });

    it('required coverage is null for once schedules', () => {
      const coverage = getRequiredCoverageThroughDate('once', undefined, new Date());
      expect(coverage).toBeNull();
    });
  });

  describe('5. Reboot / reconcile does not restore expired alarms', () => {
    it('returns null requiredCoverage when endDate has already passed', () => {
      const today = new Date(2026, 9, 30, 10, 0); // Oct 30, 2026
      const pastEnd = '2026-10-29';
      expect(getRequiredCoverageThroughDate('daily', pastEnd, today)).toBeNull();
      expect(getRequiredCoverageThroughDate('weekly', pastEnd, today)).toBeNull();
    });

    it('cleans up OS notifications and cancels native alarms for expired schedules during reconcile', async () => {
      const pastSchedule = makeSchedule({
        startDate: '2026-10-01',
        endDate: '2026-10-10', // already in the past
      });
      scheduleRepository.save(pastSchedule);

      // Seed an existing notification in OS
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Expired alarm',
          body: 'Should be cancelled',
          data: {
            scheduleId: SCHEDULE_ID,
            time: '08:00',
            medicineName: 'End Date Test Medicine',
            amount: '1 capsule',
            doseLabel: '',
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(2026, 9, 10, 8, 0),
        },
      });

      const cancelAlarmSpy = jest.spyOn(nativeAlarmService, 'cancelAlarm');

      const result = await notificationService.reconcileScheduledReminders();
      expect(result.cancelledStale).toBeGreaterThanOrEqual(1);
      expect(result.rescheduled).toBe(0);
      expect(cancelAlarmSpy).toHaveBeenCalledWith(SCHEDULE_ID);

      const remaining = await Notifications.getAllScheduledNotificationsAsync();
      expect(remaining.filter((n) => n.content.data?.scheduleId === SCHEDULE_ID)).toHaveLength(0);
    });
  });

  describe('6. Editing dates updates and reconciles native triggers', () => {
    it('shortening endDate cancels overhanging notifications and syncs shortened native trigger chain', async () => {
      const syncAlarmChainSpy = jest.spyOn(nativeAlarmService, 'syncAlarmChain');

      // Schedule starts as bounded through 60 days out
      const longSchedule = makeSchedule({
        startDate: '2026-10-25',
        endDate: '2026-12-31',
      });
      scheduleRepository.save(longSchedule);

      // Seed OS notifications up to Dec 31
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Long dose',
          body: 'Dose',
          data: {
            scheduleId: SCHEDULE_ID,
            time: '08:00',
            medicineName: 'End Date Test Medicine',
            amount: '1 capsule',
            doseLabel: '',
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(2026, 11, 31, 8, 0), // Dec 31
        },
      });

      // Now user shortens endDate to tomorrow
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const shortenedEnd = [
        tomorrow.getFullYear(),
        String(tomorrow.getMonth() + 1).padStart(2, '0'),
        String(tomorrow.getDate()).padStart(2, '0'),
      ].join('-');

      const updatedSchedule = {
        ...longSchedule,
        endDate: shortenedEnd,
      };
      scheduleRepository.save(updatedSchedule);

      // Reconcile must detect overhanging coverage and reschedule
      const result = await notificationService.reconcileScheduledReminders();
      expect(result.rescheduled).toBe(1);

      // Verify native alarm chain was updated with the shortened endDate
      expect(syncAlarmChainSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduleId: SCHEDULE_ID,
          endDate: shortenedEnd,
        }),
      );

      // Verify no remaining OS notifications exceed the new shortened endDate
      const remaining = await Notifications.getAllScheduledNotificationsAsync();
      const matching = remaining.filter((n) => n.content.data?.scheduleId === SCHEDULE_ID);
      expect(matching.length).toBeGreaterThan(0);
      for (const n of matching) {
        if (n.trigger && (n.trigger as any).date) {
          const d = millisToDateString((n.trigger as any).date.getTime());
          expect(d <= shortenedEnd).toBe(true);
        }
      }
    });
  });

  describe('7. Tests cover midnight, month-end, and year-end boundaries', () => {
    it('handles midnight boundary (00:00 vs 23:59)', () => {
      // Dose at 00:00 (start of day)
      const fixedNow1 = new Date(2026, 9, 25, 23, 30); // Oct 25, 23:30
      const midnightTriggers = getNativeAlarmTriggerWindow(
        {
          recurrence: 'daily',
          startDate: '2026-10-25',
          endDate: '2026-10-27',
        },
        '00:00',
        fixedNow1,
      );

      // Oct 25 00:00 is in the past. Oct 26 00:00 and Oct 27 00:00 are valid.
      expect(midnightTriggers.length).toBe(2);
      expect(millisToDateString(midnightTriggers[0])).toBe('2026-10-26');
      expect(millisToTimeString(midnightTriggers[0])).toBe('00:00');
      expect(millisToDateString(midnightTriggers[1])).toBe('2026-10-27');
      expect(millisToTimeString(midnightTriggers[1])).toBe('00:00');

      // Dose at 23:59 (end of day)
      const lateTriggers = getNativeAlarmTriggerWindow(
        {
          recurrence: 'daily',
          startDate: '2026-10-25',
          endDate: '2026-10-27',
        },
        '23:59',
        fixedNow1,
      );

      // Oct 25 23:59 (in 29 min), Oct 26 23:59, Oct 27 23:59
      expect(lateTriggers.length).toBe(3);
      expect(millisToDateString(lateTriggers[0])).toBe('2026-10-25');
      expect(millisToTimeString(lateTriggers[0])).toBe('23:59');
      expect(millisToDateString(lateTriggers[2])).toBe('2026-10-27');
      expect(millisToTimeString(lateTriggers[2])).toBe('23:59');
    });

    it('handles month-end boundary: Oct 31 -> Nov 01', () => {
      const fixedNow = new Date(2026, 9, 30, 20, 0); // Oct 30, 2026, 20:00
      const triggers = getNativeAlarmTriggerWindow(
        {
          recurrence: 'daily',
          startDate: '2026-10-30',
          endDate: '2026-11-02',
        },
        '08:00',
        fixedNow,
      );

      const dates = triggers.map(millisToDateString);
      // Oct 30 08:00 is past. Future: Oct 31, Nov 01, Nov 02
      expect(dates).toEqual(['2026-10-31', '2026-11-01', '2026-11-02']);
      expect(dates.every((d) => d <= '2026-11-02')).toBe(true);
    });

    it('handles leap year / February month-end boundary: Feb 28 -> Mar 01', () => {
      const fixedNow = new Date(2027, 1, 27, 20, 0); // Feb 27, 2027 (non-leap year)
      const triggers = getNativeAlarmTriggerWindow(
        {
          recurrence: 'daily',
          startDate: '2027-02-27',
          endDate: '2027-03-02',
        },
        '08:00',
        fixedNow,
      );

      const dates = triggers.map(millisToDateString);
      // Future: Feb 28, Mar 01, Mar 02
      expect(dates).toEqual(['2027-02-28', '2027-03-01', '2027-03-02']);
    });

    it('handles year-end boundary: Dec 31 -> Jan 01', () => {
      const fixedNow = new Date(2026, 11, 30, 20, 0); // Dec 30, 2026, 20:00
      const triggers = getNativeAlarmTriggerWindow(
        {
          recurrence: 'daily',
          startDate: '2026-12-30',
          endDate: '2027-01-02',
        },
        '08:00',
        fixedNow,
      );

      const dates = triggers.map(millisToDateString);
      // Future: Dec 31 2026, Jan 01 2027, Jan 02 2027
      expect(dates).toEqual(['2026-12-31', '2027-01-01', '2027-01-02']);
      expect(dates[dates.length - 1]).toBe('2027-01-02');

      // If endDate is Dec 31 2026, Jan 01 2027 must NOT be generated
      const boundedTriggers = getNativeAlarmTriggerWindow(
        {
          recurrence: 'daily',
          startDate: '2026-12-30',
          endDate: '2026-12-31',
        },
        '08:00',
        fixedNow,
      );
      const boundedDates = boundedTriggers.map(millisToDateString);
      expect(boundedDates).toEqual(['2026-12-31']);
    });
  });
});

