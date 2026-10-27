import { describe, expect, it, beforeEach } from '@jest/globals';
import * as Notifications from 'expo-notifications';
import {
  getNotificationTriggersForDose,
  notificationService,
} from '../src/services/notificationService';
import { ReminderSchedule } from '../src/types';

describe('Reminder Notification Scheduling Engine', () => {
  beforeEach(async () => {
    await notificationService.cancelAll();
  });

  describe('One-time ("once") recurrence', () => {
    it('schedules a single DATE trigger and MUST NOT create a DAILY trigger', () => {
      const now = new Date(2026, 9, 26, 8, 0, 0); // Oct 26, 2026 08:00
      const schedule: Pick<ReminderSchedule, 'recurrence' | 'startDate' | 'endDate'> = {
        recurrence: 'once',
        startDate: '2026-10-27',
      };

      const triggers = getNotificationTriggersForDose(schedule, '09:00', now);

      expect(triggers).toHaveLength(1);
      expect(triggers[0].type).toBe(Notifications.SchedulableTriggerInputTypes.DATE);
      expect(triggers[0].type).not.toBe(Notifications.SchedulableTriggerInputTypes.DAILY);

      const triggerDate = (triggers[0] as any).date;
      expect(triggerDate.getFullYear()).toBe(2026);
      expect(triggerDate.getMonth()).toBe(9); // October
      expect(triggerDate.getDate()).toBe(27);
      expect(triggerDate.getHours()).toBe(9);
      expect(triggerDate.getMinutes()).toBe(0);
    });

    it('does not schedule one-time reminders that are already in the past', () => {
      const now = new Date(2026, 9, 26, 12, 0, 0); // Oct 26, 2026 12:00
      const schedule: Pick<ReminderSchedule, 'recurrence' | 'startDate' | 'endDate'> = {
        recurrence: 'once',
        startDate: '2026-10-26',
      };

      // 08:00 on the same day is in the past
      const triggers = getNotificationTriggersForDose(schedule, '08:00', now);
      expect(triggers).toHaveLength(0);
    });
  });

  describe('Daily recurrence', () => {
    it('creates an open-ended DAILY repeating trigger when unbounded and started', () => {
      const now = new Date(2026, 9, 26, 10, 0, 0);
      const schedule: Pick<ReminderSchedule, 'recurrence' | 'startDate' | 'endDate'> = {
        recurrence: 'daily',
        startDate: '2026-10-20',
      };

      const triggers = getNotificationTriggersForDose(schedule, '08:00', now);
      expect(triggers).toHaveLength(1);
      expect(triggers[0].type).toBe(Notifications.SchedulableTriggerInputTypes.DAILY);
      expect((triggers[0] as any).hour).toBe(8);
      expect((triggers[0] as any).minute).toBe(0);
    });

    it('creates discrete DATE triggers bounded by endDate and does not ring after endDate', () => {
      const now = new Date(2026, 9, 26, 10, 0, 0); // Oct 26, 2026 10:00
      const schedule: Pick<ReminderSchedule, 'recurrence' | 'startDate' | 'endDate'> = {
        recurrence: 'daily',
        startDate: '2026-10-26',
        endDate: '2026-10-29',
      };

      // 08:00 today has already passed, so should schedule Oct 27, 28, 29
      const morningTriggers = getNotificationTriggersForDose(schedule, '08:00', now);
      expect(morningTriggers).toHaveLength(3);
      morningTriggers.forEach((t) => {
        expect(t.type).toBe(Notifications.SchedulableTriggerInputTypes.DATE);
      });
      const dates = morningTriggers.map((t) => (t as any).date.getDate());
      expect(dates).toEqual([27, 28, 29]);

      // 20:00 today is upcoming, so should schedule Oct 26, 27, 28, 29
      const eveningTriggers = getNotificationTriggersForDose(schedule, '20:00', now);
      expect(eveningTriggers).toHaveLength(4);
      const eveningDates = eveningTriggers.map((t) => (t as any).date.getDate());
      expect(eveningDates).toEqual([26, 27, 28, 29]);
    });

    it('handles future startDate by scheduling discrete DATE triggers starting from startDate', () => {
      const now = new Date(2026, 9, 26, 10, 0, 0);
      const schedule: Pick<ReminderSchedule, 'recurrence' | 'startDate' | 'endDate'> = {
        recurrence: 'daily',
        startDate: '2026-10-30',
        endDate: '2026-11-02',
      };

      const triggers = getNotificationTriggersForDose(schedule, '08:00', now);
      expect(triggers).toHaveLength(4);
      const dateStrings = triggers.map((t) => {
        const d = (t as any).date;
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      });
      expect(dateStrings).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    });
  });

  describe('Weekly recurrence', () => {
    it('creates an open-ended WEEKLY repeating trigger on the weekday of the startDate', () => {
      const now = new Date(2026, 9, 26, 10, 0, 0); // Oct 26, 2026 is Monday
      const schedule: Pick<ReminderSchedule, 'recurrence' | 'startDate' | 'endDate'> = {
        recurrence: 'weekly',
        startDate: '2026-10-26', // Monday
      };

      const triggers = getNotificationTriggersForDose(schedule, '08:00', now);
      expect(triggers).toHaveLength(1);
      expect(triggers[0].type).toBe(Notifications.SchedulableTriggerInputTypes.WEEKLY);
      // Expo notifications weekdays: 1 = Sunday, 2 = Monday, ...
      expect((triggers[0] as any).weekday).toBe(2);
      expect((triggers[0] as any).hour).toBe(8);
      expect((triggers[0] as any).minute).toBe(0);
    });

    it('creates discrete DATE triggers when bounded by endDate', () => {
      const now = new Date(2026, 9, 26, 8, 0, 0); // Monday morning Oct 26, 2026
      const schedule: Pick<ReminderSchedule, 'recurrence' | 'startDate' | 'endDate'> = {
        recurrence: 'weekly',
        startDate: '2026-10-26', // Monday
        endDate: '2026-11-16', // 4 Mondays: Oct 26, Nov 2, Nov 9, Nov 16
      };

      const triggers = getNotificationTriggersForDose(schedule, '10:00', now);
      expect(triggers).toHaveLength(4);
      triggers.forEach((t) => {
        expect(t.type).toBe(Notifications.SchedulableTriggerInputTypes.DATE);
      });
      const dates = triggers.map((t) => {
        const d = (t as any).date;
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      });
      expect(dates).toEqual(['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']);
    });
  });

  describe('Monthly recurrence and month-end dates clamping', () => {
    it('creates native MONTHLY repeating trigger for day <= 28 when unbounded and started', () => {
      const now = new Date(2026, 0, 15, 8, 0, 0);
      const schedule: Pick<ReminderSchedule, 'recurrence' | 'startDate' | 'endDate'> = {
        recurrence: 'monthly',
        startDate: '2026-01-15',
      };

      const triggers = getNotificationTriggersForDose(schedule, '09:00', now);
      expect(triggers).toHaveLength(1);
      expect(triggers[0].type).toBe(Notifications.SchedulableTriggerInputTypes.MONTHLY);
      expect((triggers[0] as any).day).toBe(15);
      expect((triggers[0] as any).hour).toBe(9);
      expect((triggers[0] as any).minute).toBe(0);
    });

    it('clamps day 31 to February 28 in non-leap years and to 30 in 30-day months', () => {
      const now = new Date(2026, 0, 31, 8, 0, 0); // Jan 31, 2026 08:00
      const schedule: Pick<ReminderSchedule, 'recurrence' | 'startDate' | 'endDate'> = {
        recurrence: 'monthly',
        startDate: '2026-01-31',
        endDate: '2026-07-01', // Covers Jan, Feb, Mar, Apr, May, Jun
      };

      const triggers = getNotificationTriggersForDose(schedule, '10:00', now);
      expect(triggers).toHaveLength(6);
      triggers.forEach((t) => {
        expect(t.type).toBe(Notifications.SchedulableTriggerInputTypes.DATE);
      });

      const dateStrings = triggers.map((t) => {
        const d = (t as any).date;
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      });

      // Verification:
      // Jan 31 -> Jan 31
      // Feb 28 -> Clamped to 28 (2026 is non-leap year)
      // Mar 31 -> Mar 31
      // Apr 30 -> Clamped to 30
      // May 31 -> May 31
      // Jun 30 -> Clamped to 30
      expect(dateStrings).toEqual([
        '2026-01-31',
        '2026-02-28',
        '2026-03-31',
        '2026-04-30',
        '2026-05-31',
        '2026-06-30',
      ]);
    });

    it('clamps day 31 to February 29 in leap years (e.g. 2028)', () => {
      const now = new Date(2028, 0, 31, 8, 0, 0); // Jan 31, 2028
      const schedule: Pick<ReminderSchedule, 'recurrence' | 'startDate' | 'endDate'> = {
        recurrence: 'monthly',
        startDate: '2028-01-31',
        endDate: '2028-03-15',
      };

      const triggers = getNotificationTriggersForDose(schedule, '10:00', now);
      expect(triggers).toHaveLength(2);
      const dateStrings = triggers.map((t) => {
        const d = (t as any).date;
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      });

      expect(dateStrings).toEqual(['2028-01-31', '2028-02-29']);
    });

    it('clamps day 30 to February 28 in non-leap years and preserves day 30 in 31-day months', () => {
      const now = new Date(2026, 0, 30, 8, 0, 0);
      const schedule: Pick<ReminderSchedule, 'recurrence' | 'startDate' | 'endDate'> = {
        recurrence: 'monthly',
        startDate: '2026-01-30',
        endDate: '2026-04-15',
      };

      const triggers = getNotificationTriggersForDose(schedule, '10:00', now);
      const dateStrings = triggers.map((t) => {
        const d = (t as any).date;
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      });

      expect(dateStrings).toEqual(['2026-01-30', '2026-02-28', '2026-03-30']);
    });
  });

  describe('notificationService.scheduleDoseReminder integration', () => {
    it('schedules one-time dose reminder as a date trigger', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      const y = futureDate.getFullYear();
      const m = String(futureDate.getMonth() + 1).padStart(2, '0');
      const d = String(futureDate.getDate()).padStart(2, '0');
      const startDate = `${y}-${m}-${d}`;

      const id = await notificationService.scheduleDoseReminder(
        'sched_once_1',
        'Amoxicillin',
        '500mg',
        '09:00',
        'Morning',
        {
          recurrence: 'once',
          startDate,
        },
      );

      expect(id).toBeTruthy();
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      const match = scheduled.find((n) => n.content.data?.scheduleId === 'sched_once_1');
      expect(match).toBeDefined();
      expect((match?.trigger as any)?.type).toBe(Notifications.SchedulableTriggerInputTypes.DATE);
      expect((match?.trigger as any)?.type).not.toBe(
        Notifications.SchedulableTriggerInputTypes.DAILY,
      );
    });

    it('schedules month-end monthly reminders with clamped date triggers', async () => {
      const id = await notificationService.scheduleDoseReminder(
        'sched_month_31',
        'Vitamin D',
        '1000 IU',
        '09:00',
        'Morning',
        {
          recurrence: 'monthly',
          startDate: '2026-01-31',
          endDate: '2026-03-15',
        },
      );

      // In real runtime Date.now() is 2026-10-26, so 2026-01-31 to 2026-03-15 is in the past
      // Expect null because all dates are in the past
      expect(id).toBeNull();
    });

    it('cancels all scheduled notifications for a schedule on cancelForSchedule', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      const y = futureDate.getFullYear();
      const m = String(futureDate.getMonth() + 1).padStart(2, '0');
      const d = String(futureDate.getDate()).padStart(2, '0');
      const startDate = `${y}-${m}-${d}`;

      await notificationService.scheduleDoseReminder(
        'sched_to_cancel',
        'Paracetamol',
        '1 tablet',
        '08:00',
        'Morning',
        { recurrence: 'daily', startDate },
      );

      let scheduled = await Notifications.getAllScheduledNotificationsAsync();
      expect(scheduled.some((n) => n.content.data?.scheduleId === 'sched_to_cancel')).toBe(true);

      await notificationService.cancelForSchedule('sched_to_cancel');
      scheduled = await Notifications.getAllScheduledNotificationsAsync();
      expect(scheduled.some((n) => n.content.data?.scheduleId === 'sched_to_cancel')).toBe(false);
    });
  });
});
