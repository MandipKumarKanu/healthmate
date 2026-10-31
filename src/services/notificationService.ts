import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';
import { ReminderSchedule, RecurrenceType } from '../types';
import { parseDateParts, isScheduleDueOnDate } from '../utils/scheduleRecurrence';
import { scheduleRepository } from '../database/repositories/scheduleRepository';
import { medicineRepository } from '../database/repositories/medicineRepository';
import { nativeAlarmService } from './nativeAlarmService';

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
  now: Date = new Date(),
  allowAlarmClock: boolean = true,
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
      ? allowAlarmClock
        ? { channelId: 'medication-reminders', delivery: 'alarmClock' as const }
        : { channelId: 'medication-reminders' }
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

        if (
          isScheduleDueOnDate(effectiveSchedule, dateStr) &&
          targetDate.getTime() > now.getTime()
        ) {
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

/**
 * Computes a discrete window of upcoming epoch-millis triggers for ONE dose of a
 * schedule, used for the native reboot-proof alarm chain: the JNI side stores
 * these and re-arms exact alarms at boot, so it needs concrete dates rather than
 * the repeating trigger types the OS-notification path may use.
 *
 * Caps per recurrence type mirror the OS-notification caps (60 daily occurrences,
 * 52 weekly, 24 monthly); unbounded recurring chains are extended natively dose
 * by dose after each firing.
 */
export function getNativeAlarmTriggerWindow(
  schedule: Pick<ReminderSchedule, 'recurrence' | 'startDate' | 'endDate'> | undefined,
  time: string,
  now: Date = new Date(),
): number[] {
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

  const { recurrence, startDate, endDate } = effectiveSchedule;
  const triggers: number[] = [];

  if (recurrence === 'once') {
    const targetDate = new Date(start[0], start[1] - 1, start[2], hour, minute, 0, 0);
    if (targetDate.getTime() > now.getTime()) triggers.push(targetDate.getTime());
    return triggers;
  }

  const scanStart = startDate > todayStr ? startDate : todayStr;

  if (recurrence === 'daily') {
    const [y, m, d] = parseDateParts(scanStart)!;
    const cursor = new Date(y, m - 1, d);
    while (triggers.length < 60) {
      const y = cursor.getFullYear();
      const month = cursor.getMonth();
      const day = cursor.getDate();
      const dateStr = [y, String(month + 1).padStart(2, '0'), String(day).padStart(2, '0')].join(
        '-',
      );
      if (endDate && dateStr > endDate) break;
      if (isScheduleDueOnDate(effectiveSchedule, dateStr)) {
        const targetDate = new Date(y, month, day, hour, minute, 0, 0);
        if (targetDate.getTime() > now.getTime()) triggers.push(targetDate.getTime());
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return triggers;
  }

  if (recurrence === 'weekly') {
    const startJsWeekday = new Date(start[0], start[1] - 1, start[2]).getDay();
    const [startY, startM, startD] = parseDateParts(scanStart)!;
    const cursor = new Date(startY, startM - 1, startD);
    while (cursor.getDay() !== startJsWeekday) {
      cursor.setDate(cursor.getDate() + 1);
    }
    while (triggers.length < 52) {
      const y = cursor.getFullYear();
      const month = cursor.getMonth();
      const day = cursor.getDate();
      const dateStr = [y, String(month + 1).padStart(2, '0'), String(day).padStart(2, '0')].join(
        '-',
      );
      if (endDate && dateStr > endDate) break;
      if (isScheduleDueOnDate(effectiveSchedule, dateStr)) {
        const targetDate = new Date(y, month, day, hour, minute, 0, 0);
        if (targetDate.getTime() > now.getTime()) triggers.push(targetDate.getTime());
      }
      cursor.setDate(cursor.getDate() + 7);
    }
    return triggers;
  }

  if (recurrence === 'monthly') {
    const startDay = start[2];
    const currentRef =
      startDate > todayStr
        ? new Date(start[0], start[1] - 1, 1)
        : new Date(now.getFullYear(), now.getMonth(), 1);
    for (let i = 0; i < 24; i++) {
      const year = currentRef.getFullYear();
      const month = currentRef.getMonth();
      const lastDay = new Date(year, month + 1, 0).getDate();
      const clampedDay = Math.min(startDay, lastDay);
      const dateStr = [
        year,
        String(month + 1).padStart(2, '0'),
        String(clampedDay).padStart(2, '0'),
      ].join('-');
      if (endDate && dateStr > endDate) break;
      if (dateStr >= startDate && isScheduleDueOnDate(effectiveSchedule, dateStr)) {
        const targetDate = new Date(year, month, clampedDay, hour, minute, 0, 0);
        if (targetDate.getTime() > now.getTime()) triggers.push(targetDate.getTime());
      }
      currentRef.setMonth(currentRef.getMonth() + 1);
    }
    return triggers;
  }

  return [];
}

// ---------------------------------------------------------------------------
// Trigger-window extension: bounded / future-start windows must not expire in
// silence. getNotificationTriggersForDose caps discrete windows at 60 daily /
// 52 weekly / 24 monthly DATE triggers; without reconcile-time extension a
// daily schedule bounded by an endDate 90 days out would stop notifying after
// day 60, and a future-start schedule would stop forever once its initial 60
// occurrences ran out. Reconcile compares each dose's latest covered date
// against a required horizon and re-arms the window before it runs out.
// (The Android native chain self-advances daily, so this mainly covers the OS
// notification layer, weekly/monthly bounded chains, and runtimes without the
// native alarm module such as iOS.)
// ---------------------------------------------------------------------------

type DatedRecurrence = Extract<RecurrenceType, 'daily' | 'weekly' | 'monthly'>;

/**
 * Elapsed-day equivalent of the occurrence caps inside
 * `getNotificationTriggersForDose` (60 daily / 52 weekly / 24 monthly):
 * how far into the future one generated date-trigger window can reach.
 */
const TRIGGER_WINDOW_CAP_DAYS: Record<DatedRecurrence, number> = {
  daily: 60,
  weekly: 364,
  monthly: 729,
};

/**
 * A window is considered "running out" — and gets extended at reconcile time —
 * once its latest covered date is closer than this many days from today.
 */
const EXTENSION_MARGIN_DAYS = 30;

function toDateStringOf(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * The last date through which an OS-notification window should exist for one
 * dose of a schedule: `min(schedule endDate, today + window cap)`.
 *
 * Returns null when no future coverage is required at all: `once` doses, or a
 * schedule whose endDate has already passed.
 */
export function getRequiredCoverageThroughDate(
  recurrence: RecurrenceType,
  endDate: string | undefined,
  now: Date = new Date(),
): string | null {
  if (recurrence === 'once') return null;

  const today = toDateStringOf(now);
  const capDays =
    recurrence === 'daily' || recurrence === 'weekly' || recurrence === 'monthly'
      ? TRIGGER_WINDOW_CAP_DAYS[recurrence]
      : 60;
  const horizon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + capDays);

  let requiredThrough = toDateStringOf(horizon);
  if (endDate) {
    if (endDate < today) return null;
    if (endDate < requiredThrough) requiredThrough = endDate;
  }
  return requiredThrough;
}

/**
 * Reads one scheduled notification's trigger and reports through which date a
 * dose is covered by it:
 * - `'forever'` for repeating triggers (native DAILY/WEEKLY/MONTHLY/YEARLY, or
 *   any explicitly repeating trigger): coverage never runs out.
 * - `'YYYY-MM-DD'` for a one-shot date trigger (its own firing date).
 * - null when the shape cannot be interpreted; treated conservatively as
 *   "unscheduled" so reconcile re-arms the dose.
 *
 * Tolerates both the trigger inputs this module creates (mocks/tests keep the
 * literal shape) and the normalized shapes expo-notifications returns
 * ({ type: 'date', timestamp: epoch-seconds } on Android/iOS).
 */
export function getTriggerCoveredThroughDate(trigger: unknown): 'forever' | string | null {
  const t = (trigger ?? null) as Record<string, unknown> | null;
  if (!t) return null;

  const type = String(t.type ?? '').toLowerCase();
  if (t.repeats === true) return 'forever';
  if (['daily', 'weekly', 'monthly', 'yearly'].includes(type)) {
    return 'forever';
  }

  const rawDate = t.date ?? t.timestamp ?? null;
  if (rawDate instanceof Date) {
    return toDateStringOf(rawDate);
  }
  if (typeof rawDate === 'number') {
    // Epoch seconds vs milliseconds — accept both.
    const ms = rawDate < 1e12 ? rawDate * 1000 : rawDate;
    return toDateStringOf(new Date(ms));
  }
  if (typeof rawDate === 'string') {
    const parsed = new Date(rawDate);
    return Number.isNaN(parsed.getTime()) ? null : toDateStringOf(parsed);
  }
  return null;
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
   * Ask for notification display permission and Android's alarm access.
   * A notification permission grant alone does not guarantee that an alarm
   * can open the full-screen alarm UI on Android 14+.
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
        let exactGranted = await nativeAlarmService.canScheduleExactAlarms();
        if (!exactGranted) {
          const notificationsAny = Notifications as any;
          if (typeof notificationsAny.requestExactAlarmPermissionsAsync === 'function') {
            try {
              await notificationsAny.requestExactAlarmPermissionsAsync();
            } catch (error) {
              console.warn('Exact-alarm permission request threw:', error);
            }
          }
          // Authoritative check via AlarmManager.canScheduleExactAlarms()
          exactGranted = await nativeAlarmService.canScheduleExactAlarms();
        }
        if (!exactGranted) return false;

        // Android 14+ can revoke USE_FULL_SCREEN_INTENT independently of
        // notification permission. Without it, Android intentionally downgrades
        // the alarm to a heads-up notification, which is the symptom users see
        // when the alarm screen only appears after tapping the notification.
        const fullScreenGranted = await nativeAlarmService.canUseFullScreenIntent();
        if (!fullScreenGranted) return false;
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

      // Authoritative check via AlarmManager.canScheduleExactAlarms().
      // Do not assume permission is granted because an Expo API is absent.
      const exactAlarm = await nativeAlarmService.canScheduleExactAlarms();
      if (!exactAlarm) return false;

      return await nativeAlarmService.canUseFullScreenIntent();
    } catch {
      return false;
    }
  },

  /**
   * Classifies why `scheduleDoseReminder` returned null so callers
   * can show a distinct, named reason to the user instead of one generic
   * "could not schedule" message.
   */
  async diagnoseAlarmAccess(): Promise<{
    notificationPermission: boolean;
    exactAlarm: boolean;
    fullScreenIntent: boolean;
  }> {
    try {
      const status = await Notifications.getPermissionsAsync();
      const notificationPermission = Boolean(status.granted || status.status === 'granted');
      let exactAlarm = true; // No exact-alarm concept outside Android.
      let fullScreenIntent = true; // No Android full-screen intent permission on iOS/web.
      if (Platform.OS === 'android') {
        // Authoritative check: AlarmManager.canScheduleExactAlarms()
        // Do not assume permission is granted because an Expo API is absent.
        exactAlarm = await nativeAlarmService.canScheduleExactAlarms();
        fullScreenIntent = await nativeAlarmService.canUseFullScreenIntent();
      }
      return { notificationPermission, exactAlarm, fullScreenIntent };
    } catch {
      return { notificationPermission: false, exactAlarm: false, fullScreenIntent: false };
    }
  },

  async scheduleDoseReminder(
    scheduleId: string,
    medicineName: string,
    amount: string,
    time: string, // 'HH:mm'
    doseLabel?: string,
    scheduleConfig?: Pick<ReminderSchedule, 'recurrence' | 'startDate' | 'endDate'>,
  ): Promise<string | null> {
    try {
      const [hourStr, minStr] = time.split(':');
      const hour = Number(hourStr);
      const minute = Number(minStr);
      if (
        !Number.isInteger(hour) ||
        hour < 0 ||
        hour > 23 ||
        !Number.isInteger(minute) ||
        minute < 0 ||
        minute > 59
      ) {
        throw new Error(`Invalid reminder time: ${time}`);
      }

      // Do not silently fall back to an inexact Android alarm. The caller must
      // first obtain exact-alarm access; otherwise report scheduling failure.
      if (!(await this.hasReliableAlarmAccess())) {
        console.warn('Reminder not scheduled: notification or exact-alarm permission is missing.');
        return null;
      }

      // Check exact-alarm permission capability
      let allowAlarmClock = true;
      if (Platform.OS === 'android') {
        const canExact = await nativeAlarmService.canScheduleExactAlarms();
        if (!canExact) {
          allowAlarmClock = false;
        }
      }

      const triggers = getNotificationTriggersForDose(
        scheduleConfig,
        time,
        new Date(),
        allowAlarmClock,
      );
      if (triggers.length === 0) {
        console.warn('Reminder not scheduled: no valid future triggers for schedule.', {
          scheduleId,
          time,
        });
        return null;
      }

      const identifiers: string[] = [];
      // Bounded/future schedules can contain 24-60 individual date triggers.
      // Scheduling each one sequentially made the Save Reminder spinner appear
      // stuck, so dispatch a small batch in parallel without flooding Android.
      const batchSize = 8;
      for (let index = 0; index < triggers.length; index += batchSize) {
        const batch = triggers.slice(index, index + batchSize);
        const batchIdentifiers = await Promise.all(
          batch.map((trigger) =>
            Notifications.scheduleNotificationAsync({
              content: {
                title: `Time to take ${medicineName}`,
                body: `${doseLabel ? `${doseLabel} · ` : ''}Scheduled dose: ${amount}`,
                data: {
                  scheduleId,
                  time,
                  medicineName,
                  // Identity fields reconcile diffs against, so a
                  // rename or edited dose replaces stale OS text.
                  amount,
                  doseLabel: doseLabel ?? '',
                },
                sound: 'default',
                ...(Platform.OS === 'android' ? { channelId: 'medication-reminders' } : {}),
              },
              trigger,
            }),
          ),
        );
        identifiers.push(...batchIdentifiers);
      }

      // Schedule the reboot-proof native alarm chain on Android: each dose's
      // full upcoming trigger window is persisted natively (and re-armed at
      // boot by AlarmArming), with the earliest trigger armed now.
      if (Platform.OS === 'android' && nativeAlarmService.isAvailable()) {
        try {
          const windowMillis = getNativeAlarmTriggerWindow(scheduleConfig, time, new Date());
          if (windowMillis.length > 0) {
            const syncResult = await nativeAlarmService.syncAlarmChain({
              scheduleId,
              medicineName,
              amount,
              time,
              label: doseLabel,
              recurrence: scheduleConfig?.recurrence ?? 'daily',
              // Schedule dates are ISO local calendar dates (YYYY-MM-DD), not UTC timestamps.
              startDate: scheduleConfig?.startDate ?? toDateStringOf(new Date()),
              endDate: scheduleConfig?.endDate,
              triggerMillis: windowMillis,
            });
            if (!syncResult.success) {
              console.warn(
                'Native alarm chain registration failed for schedule:',
                scheduleId,
                syncResult.error?.code,
              );
              await Promise.all(
                identifiers.map((id) => Notifications.cancelScheduledNotificationAsync(id)),
              );
              return null;
            }
          }
        } catch (alarmErr) {
          console.warn('Could not schedule native alarm chain for schedule:', scheduleId);
          await Promise.all(
            identifiers.map((id) => Notifications.cancelScheduledNotificationAsync(id)),
          );
          return null;
        }
      }

      return identifiers[0] ?? null;
    } catch (error) {
      console.warn('Failed to schedule medication alarm for schedule:', scheduleId);
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

  async cancelForSchedule(scheduleId: string): Promise<boolean | void> {
    try {
      const cancelResult = await nativeAlarmService.cancelAlarm(scheduleId);
      if (!cancelResult.success) {
        console.warn(
          'Native alarm cancellation failed for schedule:',
          scheduleId,
          cancelResult.error?.code,
        );
      }
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      const matching = scheduled.filter(
        (notification) => notification.content.data?.scheduleId === scheduleId,
      );
      await Promise.all(
        matching.map((notification) =>
          Notifications.cancelScheduledNotificationAsync(notification.identifier),
        ),
      );
      return cancelResult.success;
    } catch (error) {
      console.warn('Failed to cancel schedule notifications for schedule:', scheduleId);
      return false;
    }
  },

  async cancelAll(): Promise<void> {
    try {
      await nativeAlarmService.cancelAllAlarms();
      await Notifications.cancelAllScheduledNotificationsAsync();
    } catch (error) {
      console.warn('Failed to cancel all notifications:', error);
    }
  },

  /**
   * Reconciles database schedules against OS notifications and alarms:
   * 1. Cancels orphaned/stale OS notifications and native alarms (schedules deleted or disabled).
   * 2. Re-arms missing notifications for active, enabled schedules.
   * 3. Recovers alarms if permissions were restored.
   * 4. Extends one-shot trigger windows that are about to run out: bounded and
   *    future-start windows are capped at 60 daily / 52 weekly / 24 monthly
   *    DATE triggers, so without this a long schedule would silently stop
   *    notifying while the user still believes it is armed.
   */
  async reconcileScheduledReminders(): Promise<ReconcileResult> {
    // Coalesce concurrent calls: at cold start the launch path and
    // the AppState "active" listener both fire, and they used to race two full
    // passes over every OS notification. Overlapping calls now share one pass.
    if (reconcileInFlight) return reconcileInFlight;
    const task = performReconcile();
    reconcileInFlight = task;
    const settle = () => {
      if (reconcileInFlight === task) reconcileInFlight = null;
    };
    task.then(settle, settle);
    return task;
  },
};

type ReconcileResult = {
  cancelledStale: number;
  rescheduled: number;
  activeSchedules: number;
};

/** The single in-flight reconcile pass shared by overlapping callers. */
let reconcileInFlight: Promise<ReconcileResult> | null = null;

/**
 * Diff-based reconcile pass. Desired state is derived from the DB
 * once, observed state is read from the OS once, and only differences are
 * acted on:
 * - orphaned notifications are batch-cancelled (one native cancel per
 *   schedule, identifiers cancelled in parallel);
 * - doses are (re)armed only when coverage is missing, running out, or the
 *   stored identity (medicine name / amount / label) no longer matches;
 * - medicine lookups are memoized instead of hitting the DB per loop visit.
 */
async function performReconcile(): Promise<ReconcileResult> {
  let cancelledStale = 0;
  let rescheduled = 0;

  try {
    const hasAccess = await notificationService.hasReliableAlarmAccess();
    const allSchedules = scheduleRepository.getAll();
    const activeSchedules = allSchedules.filter((s) => s.enabled);

    // If reliable alarm access is available, re-enable notifications for enabled schedules
    // that were temporarily marked notificationsEnabled=false during permission loss.
    if (hasAccess) {
      for (const s of activeSchedules) {
        if (!s.notificationsEnabled) {
          scheduleRepository.save({ ...s, notificationsEnabled: true });
          s.notificationsEnabled = true;
        }
      }
    }

    // Memoize medicine lookups — the same medicine was previously
    // fetched once per filter visit and again per scheduling loop visit.
    const medicineCache = new Map<string, ReturnType<typeof medicineRepository.getById>>();
    const getMedicine = (id: string) => {
      let med = medicineCache.get(id);
      if (med === undefined) {
        med = medicineRepository.getById(id);
        medicineCache.set(id, med);
      }
      return med;
    };

    // Valid active schedules: must be enabled, notification-enabled, and medicine must exist
    const validActiveSchedules = activeSchedules.filter((s) => {
      if (!s.notificationsEnabled) return false;
      return Boolean(getMedicine(s.medicineId));
    });

    const validScheduleIdSet = new Set(validActiveSchedules.map((s) => s.id));

    // Desired identity per dose: what each OS notification's
    // stored data must say (medicine name, amount, label). A mismatch means a
    // rename/edit reached the OS untouched, so the window is replaced.
    const doseIdentity = (medicineName: string, amount: string, label?: string) =>
      `${medicineName}|${amount}|${label ?? ''}`;
    const desiredIdentityByKey = new Map<string, string>();
    for (const s of validActiveSchedules) {
      const medName = getMedicine(s.medicineId)?.name ?? 'Medicine';
      for (const dose of s.times) {
        desiredIdentityByKey.set(
          `${s.id}:${dose.time}`,
          doseIdentity(medName, dose.amount, dose.label),
        );
      }
    }

    // 1. Fetch currently scheduled notifications from OS
    const scheduledNotifications = await Notifications.getAllScheduledNotificationsAsync();

    // Track per-dose OS coverage and the notification entries behind it.
    // Coverage is 'forever' for repeating triggers, or the latest
    // 'YYYY-MM-DD' covered by any one-shot DATE trigger for the dose.
    const existingCoverage = new Map<string, 'forever' | string | null>();
    const notificationsByKey = new Map<string, typeof scheduledNotifications>();

    // Collect orphans first, cancel in one batch afterwards:
    // identifiers in parallel, one native alarm cancel per schedule instead
    // of one per notification.
    const orphanNotificationIds: string[] = [];
    const orphanScheduleIds = new Set<string>();
    const mismatchedKeys = new Set<string>();

    for (const notif of scheduledNotifications) {
      const notifScheduleId = notif.content.data?.scheduleId as string | undefined;
      const notifTime = notif.content.data?.time as string | undefined;

      if (notifScheduleId) {
        if (!validScheduleIdSet.has(notifScheduleId)) {
          // Orphaned / stale notification (schedule deleted or disabled).
          orphanNotificationIds.push(notif.identifier);
          orphanScheduleIds.add(notifScheduleId);
        } else if (notifTime) {
          const key = `${notifScheduleId}:${notifTime}`;
          const coveredThrough = getTriggerCoveredThroughDate(notif.trigger);

          let merged: 'forever' | string | null = existingCoverage.get(key) ?? null;
          if (coveredThrough === 'forever' || merged === 'forever') {
            merged = 'forever';
          } else if (typeof coveredThrough === 'string') {
            merged =
              typeof merged === 'string' && merged > coveredThrough ? merged : coveredThrough;
          }
          existingCoverage.set(key, merged);

          // Identity diff — only trust notifications that actually carry the
          // identity fields; legacy ones without them are left alone.
          const data = notif.content.data ?? {};
          if (typeof data.amount === 'string') {
            const stored = doseIdentity(
              String(data.medicineName ?? ''),
              data.amount,
              typeof data.doseLabel === 'string' ? data.doseLabel : undefined,
            );
            const desired = desiredIdentityByKey.get(key);
            if (desired !== undefined && stored !== desired) {
              mismatchedKeys.add(key);
            }
          }

          const entries = notificationsByKey.get(key) ?? [];
          entries.push(notif);
          notificationsByKey.set(key, entries);
        }
      }
    }

    if (orphanNotificationIds.length > 0) {
      await Promise.all(
        orphanNotificationIds.map((identifier) =>
          Notifications.cancelScheduledNotificationAsync(identifier),
        ),
      );
      for (const orphanScheduleId of orphanScheduleIds) {
        await nativeAlarmService.cancelAlarm(orphanScheduleId);
      }
      cancelledStale = orphanNotificationIds.length;
    }

    // 2. If we don't have reliable alarm access, we cannot schedule new exact alarms right now.
    if (!hasAccess) {
      return {
        cancelledStale,
        rescheduled: 0,
        activeSchedules: validActiveSchedules.length,
      };
    }

    // 3. For all valid active schedules, ensure each dose time is scheduled
    // — and extend one-shot trigger windows that are about to run out.
    const nowForExtension = new Date();
    const extensionDeadline = toDateStringOf(
      new Date(
        nowForExtension.getFullYear(),
        nowForExtension.getMonth(),
        nowForExtension.getDate() + EXTENSION_MARGIN_DAYS,
      ),
    );

    for (const schedule of validActiveSchedules) {
      const medicine = getMedicine(schedule.medicineId);
      const medicineName = medicine?.name ?? 'Medicine';

      for (const dose of schedule.times) {
        const key = `${schedule.id}:${dose.time}`;
        const coverage = existingCoverage.get(key);
        const requiredThrough = getRequiredCoverageThroughDate(
          schedule.recurrence,
          schedule.endDate,
          new Date(),
        );

        // Extend when required dates remain beyond the current window AND
        // the remaining covered margin has dropped under the threshold.
        const needsExtension =
          typeof coverage === 'string' &&
          requiredThrough !== null &&
          coverage < requiredThrough &&
          coverage < extensionDeadline;

        // Diff decision: arm when coverage is missing, extend when
        // the window runs out, replace when the stored identity no longer
        // matches (medicine renamed / dose edited outside saveSchedule).
        const identityMismatch = mismatchedKeys.has(key);

        // Overhanging coverage occurs when:
        // 1. The schedule has expired or requires no coverage (requiredThrough === null), but triggers exist.
        // 2. The schedule has an endDate, but coverage is currently 'forever' (was previously unbounded).
        // 3. The schedule's endDate was moved earlier than current coverage (coverage > requiredThrough).
        const hasOverhangingCoverage =
          (coverage !== undefined && requiredThrough === null) ||
          (coverage === 'forever' && Boolean(schedule.endDate)) ||
          (typeof coverage === 'string' &&
            coverage !== 'forever' &&
            requiredThrough !== null &&
            coverage > requiredThrough);

        if (
          coverage === undefined ||
          needsExtension ||
          identityMismatch ||
          hasOverhangingCoverage
        ) {
          if (needsExtension || identityMismatch || hasOverhangingCoverage) {
            // Replace the expiring/mismatched/overhanging window in full: cancel its
            // entries first, then arm a fresh window from today.
            const expiring = notificationsByKey.get(key) ?? [];
            await Promise.all(
              expiring.map((notif) =>
                Notifications.cancelScheduledNotificationAsync(notif.identifier),
              ),
            );
          }

          if (requiredThrough === null) {
            // Schedule expired or requires no future triggers: cancel native alarm too
            await nativeAlarmService.cancelAlarm(schedule.id);
            existingCoverage.delete(key);
            cancelledStale++;
          } else {
            const id = await notificationService.scheduleDoseReminder(
              schedule.id,
              medicineName,
              dose.amount,
              dose.time,
              dose.label,
              {
                recurrence: schedule.recurrence,
                startDate: schedule.startDate,
                endDate: schedule.endDate,
              },
            );
            if (id) {
              rescheduled++;
              if ((needsExtension || hasOverhangingCoverage) && requiredThrough) {
                // The fresh window reaches the required horizon; record it so
                // the extension is idempotent across reconcile passes.
                existingCoverage.set(key, requiredThrough);
              }
            }
          }
        }
      }
    }

    return {
      cancelledStale,
      rescheduled,
      activeSchedules: validActiveSchedules.length,
    };
  } catch (error) {
    console.warn('Reconcile scheduled reminders failed:', error);
    return {
      cancelledStale,
      rescheduled,
      activeSchedules: 0,
    };
  }
}
