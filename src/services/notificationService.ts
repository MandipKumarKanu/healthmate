import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';
import { ReminderSchedule } from '../types';
import { parseDateParts, isScheduleDueOnDate } from '../database/repositories/adherenceRepository';

// Foreground notifications must remain visible and audible. Android 8+ uses the
// channel's sound/vibration settings for delivery behavior.
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
} catch (error) {
  // Expo Go and web may not expose the native notification module.
}

export function getNotificationTriggersForDose(
  schedule: Pick<ReminderSchedule, 'recurrence' | 'startDate' | 'endDate'> | undefined,
  time: string,
  now: Date = new Date()
): Notifications.SchedulableNotificationTriggerInput[] {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) return [];
  const hour = Number(match[1]);
  const minute = Number(match[2]);

  const todayStr = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');

  const effectiveSchedule = schedule ?? {
    recurrence: 'daily' as const,
    startDate: todayStr,
  };

  const start = parseDateParts(effectiveSchedule.startDate);
  if (!start) return [];

  if (effectiveSchedule.endDate) {
    const end = parseDateParts(effectiveSchedule.endDate);
    if (!end || effectiveSchedule.endDate < effectiveSchedule.startDate) {
      return [];
    }
  }

  const androidOptions =
    Platform.OS === 'android'
      ? { channelId: 'medication-reminders', delivery: 'alarmClock' as const }
      : {};

  const { recurrence, startDate, endDate } = effectiveSchedule;

  // 1. One-time schedule: must never become a repeating daily trigger
  if (recurrence === 'once') {
    const targetDate = new Date(start[0], start[1] - 1, start[2], hour, minute, 0, 0);
    if (targetDate.getTime() <= now.getTime()) {
      return [];
    }
    return [
      {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: targetDate,
        ...androidOptions,
      },
    ];
  }

  // 2. Daily schedule
  if (recurrence === 'daily') {
    // If unbounded and start date is not in the future, use native repeating DAILY trigger
    if (!endDate && startDate <= todayStr) {
      return [
        {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour,
          minute,
          ...androidOptions,
        },
      ];
    }

    // Bounded by endDate or future startDate: schedule discrete DATE triggers
    const triggers: Notifications.SchedulableNotificationTriggerInput[] = [];
    const [curY, curM, curD] = parseDateParts(startDate > todayStr ? startDate : todayStr)!;
    const cursor = new Date(curY, curM - 1, curD);
    const maxOccurrences = 60;

    while (triggers.length < maxOccurrences) {
      const y = cursor.getFullYear();
      const m = cursor.getMonth() + 1;
      const d = cursor.getDate();
      const dateStr = [y, String(m).padStart(2, '0'), String(d).padStart(2, '0')].join('-');

      if (endDate && dateStr > endDate) break;

      if (isScheduleDueOnDate(effectiveSchedule, dateStr)) {
        const targetDate = new Date(y, m - 1, d, hour, minute, 0, 0);
        if (targetDate.getTime() > now.getTime()) {
          triggers.push({
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: targetDate,
            ...androidOptions,
          });
        }
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    return triggers;
  }

  // 3. Weekly schedule
  if (recurrence === 'weekly') {
    const startJsWeekday = new Date(start[0], start[1] - 1, start[2]).getDay();
    const expoWeekday = startJsWeekday + 1; // 1 = Sunday ... 7 = Saturday

    if (!endDate && startDate <= todayStr) {
      return [
        {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: expoWeekday,
          hour,
          minute,
          ...androidOptions,
        },
      ];
    }

    // Bounded or future start date: schedule discrete DATE triggers
    const triggers: Notifications.SchedulableNotificationTriggerInput[] = [];
    const [startY, startM, startD] = parseDateParts(startDate > todayStr ? startDate : todayStr)!;
    const cursor = new Date(startY, startM - 1, startD);

    // Advance cursor to the first matching weekday
    while (cursor.getDay() !== startJsWeekday) {
      cursor.setDate(cursor.getDate() + 1);
    }

    const maxOccurrences = 52;
    while (triggers.length < maxOccurrences) {
      const y = cursor.getFullYear();
      const m = cursor.getMonth() + 1;
      const d = cursor.getDate();
      const dateStr = [y, String(m).padStart(2, '0'), String(d).padStart(2, '0')].join('-');

      if (endDate && dateStr > endDate) break;

      if (isScheduleDueOnDate(effectiveSchedule, dateStr)) {
        const targetDate = new Date(y, m - 1, d, hour, minute, 0, 0);
        if (targetDate.getTime() > now.getTime()) {
          triggers.push({
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: targetDate,
            ...androidOptions,
          });
        }
      }

      cursor.setDate(cursor.getDate() + 7);
    }

    return triggers;
  }

  // 4. Monthly schedule
  if (recurrence === 'monthly') {
    const startDay = start[2];

    // Native monthly repeating triggers can only be used if:
    // - There is no endDate
    // - startDate is not in the future
    // - startDay <= 28 (every month has at least 28 days so it will not miss shorter months)
    if (!endDate && startDate <= todayStr && startDay <= 28) {
      return [
        {
          type: Notifications.SchedulableTriggerInputTypes.MONTHLY,
          day: startDay,
          hour,
          minute,
          ...androidOptions,
        },
      ];
    }

    // Month-end dates (29, 30, 31), bounded schedules, or future start dates:
    // Generate discrete DATE triggers clamped to shorter months matching isScheduleDueOnDate.
    const triggers: Notifications.SchedulableNotificationTriggerInput[] = [];
    const currentRef =
      startDate > todayStr
        ? new Date(start[0], start[1] - 1, 1)
        : new Date(now.getFullYear(), now.getMonth(), 1);
    const maxMonths = 24;

    for (let i = 0; i < maxMonths; i++) {
      const year = currentRef.getFullYear();
      const month = currentRef.getMonth();
      const lastDay = new Date(year, month + 1, 0).getDate();
      const clampedDay = Math.min(startDay, lastDay);
      const targetDate = new Date(year, month, clampedDay, hour, minute, 0, 0);
      const dateStr = [
        year,
        String(month + 1).padStart(2, '0'),
        String(clampedDay).padStart(2, '0'),
      ].join('-');

      if (dateStr >= startDate) {
        if (endDate && dateStr > endDate) break;

        if (isScheduleDueOnDate(effectiveSchedule, dateStr) && targetDate.getTime() > now.getTime()) {
          triggers.push({
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: targetDate,
            ...androidOptions,
          });
        }
      }

      currentRef.setMonth(currentRef.getMonth() + 1);
    }

    return triggers;
  }

  return [];
}

export const notificationService = {
  async init(): Promise<void> {
    if (Platform.OS !== 'android') return;

    try {
      await Notifications.setNotificationChannelAsync('medication-reminders', {
        name: 'Medication Reminders',
        description: 'Time-sensitive medication dose alarms',
        importance: AndroidImportance.MAX,
        vibrationPattern: [0, 300, 200, 300, 200, 500],
        sound: 'default',
        enableVibrate: true,
        enableLights: true,
        lightColor: '#0788F5',
        bypassDnd: false,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    } catch (error) {
      console.warn('Unable to configure medication notification channel:', error);
    }
  },

  /**
   * Ask for notification display permission and Android's exact-alarm access.
   * A notification permission grant alone does not guarantee on-time alarms.
   */
  async requestPermissions(): Promise<boolean> {
    try {
      await this.init();

      const current = await Notifications.getPermissionsAsync();
      let notificationGranted = current.granted || current.status === 'granted';
      if (!notificationGranted) {
        const requested = await Notifications.requestPermissionsAsync();
        notificationGranted = requested.granted || requested.status === 'granted';
      }
      if (!notificationGranted) return false;

      if (Platform.OS === 'android') {
        const notificationsAny = Notifications as any;
        if (typeof notificationsAny.getExactAlarmPermissionsAsync === 'function') {
          let exactAlarm = await notificationsAny.getExactAlarmPermissionsAsync();
          if (exactAlarm && !exactAlarm.granted && typeof notificationsAny.requestExactAlarmPermissionsAsync === 'function') {
            try {
              exactAlarm = await notificationsAny.requestExactAlarmPermissionsAsync();
            } catch (error) {
              console.warn('Exact-alarm access was not granted:', error);
              return false;
            }
          }
          if (exactAlarm && !exactAlarm.granted) return false;
        }
      }

      return true;
    } catch (error) {
      console.warn('Unable to confirm reminder permissions:', error);
      return false;
    }
  },

  async hasReliableAlarmAccess(): Promise<boolean> {
    try {
      const notificationPermission = await Notifications.getPermissionsAsync();
      if (!(notificationPermission.granted || notificationPermission.status === 'granted')) {
        return false;
      }
      if (Platform.OS !== 'android') return true;
      const notificationsAny = Notifications as any;
      if (typeof notificationsAny.getExactAlarmPermissionsAsync === 'function') {
        const exactAlarm = await notificationsAny.getExactAlarmPermissionsAsync();
        return Boolean(exactAlarm?.granted);
      }
      return true;
    } catch {
      return false;
    }
  },

  async scheduleDoseReminder(
    scheduleId: string,
    medicineName: string,
    amount: string,
    time: string, // 'HH:mm'
    doseLabel?: string,
    scheduleConfig?: Pick<ReminderSchedule, 'recurrence' | 'startDate' | 'endDate'>
  ): Promise<string | null> {
    try {
      const [hourStr, minStr] = time.split(':');
      const hour = Number(hourStr);
      const minute = Number(minStr);
      if (
        !Number.isInteger(hour) || hour < 0 || hour > 23 ||
        !Number.isInteger(minute) || minute < 0 || minute > 59
      ) {
        throw new Error(`Invalid reminder time: ${time}`);
      }

      // Do not silently fall back to an inexact Android alarm. The caller must
      // first obtain exact-alarm access; otherwise report scheduling failure.
      if (!(await this.hasReliableAlarmAccess())) {
        console.warn('Reminder not scheduled: notification or exact-alarm permission is missing.');
        return null;
      }

      const triggers = getNotificationTriggersForDose(scheduleConfig, time);
      if (triggers.length === 0) {
        console.warn('Reminder not scheduled: no valid future triggers for schedule.', {
          scheduleId,
          time,
          scheduleConfig,
        });
        return null;
      }

      const identifiers: string[] = [];
      for (const trigger of triggers) {
        const identifier = await Notifications.scheduleNotificationAsync({
          content: {
            title: `Time to take ${medicineName}`,
            body: `${doseLabel ? `${doseLabel} · ` : ''}Scheduled dose: ${amount}`,
            data: { scheduleId, time, medicineName },
            sound: 'default',
            ...(Platform.OS === 'android' ? { channelId: 'medication-reminders' } : {}),
          },
          trigger,
        });
        identifiers.push(identifier);
      }

      return identifiers[0] ?? null;
    } catch (error) {
      console.warn('Failed to schedule medication alarm:', error);
      return null;
    }
  },

  async cancelNotification(notificationId: string): Promise<void> {
    try {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
    } catch (error) {
      console.warn('Failed to cancel notification:', error);
    }
  },

  async cancelForSchedule(scheduleId: string): Promise<void> {
    try {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      const matching = scheduled.filter(
        (notification) => notification.content.data?.scheduleId === scheduleId
      );
      await Promise.all(
        matching.map((notification) =>
          Notifications.cancelScheduledNotificationAsync(notification.identifier)
        )
      );
    } catch (error) {
      console.warn('Failed to cancel schedule notifications:', error);
    }
  },

  async cancelAll(): Promise<void> {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch (error) {
      console.warn('Failed to cancel all notifications:', error);
    }
  },
};
