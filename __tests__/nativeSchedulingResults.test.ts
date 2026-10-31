import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { NativeModules, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  nativeAlarmService,
  mapNativeError,
  NativeAlarmErrorCode,
  NativeActionResult,
  SnoozeAlarmResult,
} from '../src/services/nativeAlarmService';
import { notificationService } from '../src/services/notificationService';
import { medicineRepository } from '../src/database/repositories/medicineRepository';
import { scheduleRepository } from '../src/database/repositories/scheduleRepository';
import { resetDatabase } from '../src/database/client';
import type { Medicine, ReminderSchedule } from '../src/types';

describe('Explicit Native Scheduling Results & Diagnostics', () => {
  const originalAlarmModule = NativeModules.AlarmModule;

  beforeEach(() => {
    resetDatabase();
    jest.clearAllMocks();
    (Notifications as any).__clearScheduledNotifications();
  });

  afterEach(() => {
    NativeModules.AlarmModule = originalAlarmModule;
    jest.restoreAllMocks();
  });

  describe('mapNativeError Diagnostics', () => {
    it.each([
      [{ code: 'EXACT_ALARM_DENIED', message: 'Exact alarm permission denied' }, 'exact_alarm_denied'],
      [{ message: 'Caller not allowed to schedule exact alarms' }, 'exact_alarm_denied'],
      [{ code: 'PERMISSION_DENIED', message: 'POST_NOTIFICATIONS not granted' }, 'permission_denied'],
      [{ code: 'INVALID_TRIGGER', message: 'Trigger time must be in future' }, 'invalid_trigger'],
      [{ message: 'Invalid trigger format' }, 'invalid_trigger'],
      [{ code: 'CANCELLATION_FAILED', message: 'PendingIntent could not be cancelled' }, 'cancellation_failed'],
      [{ code: 'REGISTRATION_FAILED', message: 'AlarmManager service error' }, 'registration_failed'],
      [{ message: 'Unknown native crash' }, 'unknown'],
    ])('maps %j to error code %s', (errorObj, expectedCode) => {
      const mapped = mapNativeError(errorObj);
      expect(mapped.code).toBe(expectedCode);
      expect(typeof mapped.message).toBe('string');
      expect(mapped.message.length).toBeGreaterThan(0);
    });
  });

  describe('Missing Native Module Handling (Module Unavailable)', () => {
    beforeEach(() => {
      // Simulate environment without native module
      (NativeModules as any).AlarmModule = undefined;
    });

    it('syncAlarmChain returns module_unavailable when native module is missing', async () => {
      const result = await nativeAlarmService.syncAlarmChain({
        scheduleId: 's1',
        medicineName: 'Aspirin',
        amount: '1 tablet',
        time: '08:00',
        recurrence: 'daily',
        startDate: '2026-10-31',
        triggerMillis: [Date.now() + 60000],
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('module_unavailable');
    });

    it('snoozeAlarm returns module_unavailable when native module is missing', async () => {
      const result = await nativeAlarmService.snoozeAlarm({
        scheduleId: 's1',
        instanceId: 'i1',
        medicineName: 'Aspirin',
        amount: '1 tablet',
        time: '08:00',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('module_unavailable');
      expect(result.data).toBeUndefined();
    });

    it('cancelAlarm returns module_unavailable when native module is missing', async () => {
      const result = await nativeAlarmService.cancelAlarm('s1');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('module_unavailable');
    });

    it('stopAlarm returns module_unavailable when native module is missing', async () => {
      const result = await nativeAlarmService.stopAlarm();
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('module_unavailable');
    });
  });

  describe('Native Registration Failure Visibility', () => {
    it('syncAlarmChain failure is visible to scheduleDoseReminder and cancels partial reminders', async () => {
      // Mock native sync failure with exact_alarm_denied
      jest.spyOn(NativeModules.AlarmModule, 'syncAlarmChain').mockRejectedValueOnce({
        code: 'EXACT_ALARM_DENIED',
        message: 'Exact alarm permission not granted',
      });

      const cancelSpy = jest.spyOn(Notifications, 'cancelScheduledNotificationAsync');

      const id = await notificationService.scheduleDoseReminder(
        'sched_reg_fail',
        'Amoxicillin',
        '500 mg',
        '08:00',
        'Morning',
        {
          recurrence: 'daily',
          startDate: '2026-10-31',
        },
      );

      // Registration failure causes scheduleDoseReminder to return null
      expect(id).toBeNull();
      // Partial OS notifications were rolled back / cancelled
      expect(cancelSpy).toHaveBeenCalled();
    });

    it('syncAlarmChain returns invalid_trigger when all triggers are filtered or past', async () => {
      jest.spyOn(NativeModules.AlarmModule, 'syncAlarmChain').mockResolvedValueOnce(false);

      const result = await nativeAlarmService.syncAlarmChain({
        scheduleId: 's1',
        medicineName: 'Aspirin',
        amount: '1',
        time: '08:00',
        recurrence: 'daily',
        startDate: '2026-10-31',
        triggerMillis: [],
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('invalid_trigger');
    });
  });

  describe('Failed Snooze Handling (UI Safety)', () => {
    it('snooze failure returns structured error without giving a valid timestamp', async () => {
      jest.spyOn(NativeModules.AlarmModule, 'snoozeAlarm').mockRejectedValueOnce({
        code: 'EXACT_ALARM_DENIED',
        message: 'SCHEDULE_EXACT_ALARM denied by user',
      });

      const result = await nativeAlarmService.snoozeAlarm({
        scheduleId: 'sched_snooze_fail',
        instanceId: 'inst_1',
        medicineName: 'Insulin',
        amount: '10 units',
        time: '07:30',
        minutes: 10,
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('exact_alarm_denied');
      expect(result.data).toBeUndefined();
      // Numeric evaluation is 0, which is <= Date.now()
      expect(Number(result)).toBe(0);
    });

    it('snooze failure with registration_failed when native returns past timestamp', async () => {
      // Mock returns invalid timestamp 0 or in the past
      jest.spyOn(NativeModules.AlarmModule, 'snoozeAlarm').mockResolvedValueOnce(1000); // 1970

      const result = await nativeAlarmService.snoozeAlarm({
        scheduleId: 'sched_snooze_past',
        instanceId: 'inst_2',
        medicineName: 'Lisinopril',
        amount: '10 mg',
        time: '08:00',
      });

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('registration_failed');
    });
  });

  describe('Cancellation Result Handling', () => {
    it('cancelAlarm handles native cancellation failure cleanly', async () => {
      jest.spyOn(NativeModules.AlarmModule, 'cancelAlarm').mockRejectedValueOnce({
        code: 'CANCELLATION_FAILED',
        message: 'Could not access SharedPreferences or AlarmManager',
      });

      const result = await nativeAlarmService.cancelAlarm('sched_cancel_fail');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('cancellation_failed');
    });

    it('cancelForSchedule reports cancellation failure and logs diagnostic code without sensitive data', async () => {
      jest.spyOn(NativeModules.AlarmModule, 'cancelAlarm').mockRejectedValueOnce({
        code: 'CANCELLATION_FAILED',
        message: 'Native cancellation failed',
      });

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const success = await notificationService.cancelForSchedule('sched_cancel_warn');
      expect(success).toBe(false);

      // Verify warning does not contain medication name or patient data
      const warnCalls = warnSpy.mock.calls.map((c) => c.join(' '));
      expect(warnCalls.some((c) => c.includes('sched_cancel_warn'))).toBe(true);
      expect(warnCalls.some((c) => c.includes('cancellation_failed'))).toBe(true);
      expect(warnCalls.every((c) => !c.includes('Aspirin') && !c.includes('Metformin'))).toBe(true);
    });
  });

  describe('Privacy & Sensitive Data Protection in Logs', () => {
    it('does not log medicineName or sensitive dose details when snooze fails', async () => {
      jest.spyOn(NativeModules.AlarmModule, 'snoozeAlarm').mockRejectedValueOnce(
        new Error('OS exact alarm limit reached'),
      );

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await nativeAlarmService.snoozeAlarm({
        scheduleId: 'sched_privacy_test',
        instanceId: 'inst_p',
        medicineName: 'HighlySensitiveMedicationX',
        amount: '500 mg',
        time: '08:00',
      });

      const warnOutput = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(warnOutput).not.toContain('HighlySensitiveMedicationX');
      expect(warnOutput).toContain('sched_privacy_test');
    });
  });
});
