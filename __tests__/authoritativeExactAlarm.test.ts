import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as Notifications from 'expo-notifications';
import { NativeModules, Platform, AppState } from 'react-native';
import { medicineRepository } from '../src/database/repositories/medicineRepository';
import { scheduleRepository } from '../src/database/repositories/scheduleRepository';
import { nativeAlarmService } from '../src/services/nativeAlarmService';
import {
  notificationService,
  getNotificationTriggersForDose,
} from '../src/services/notificationService';
import { useReminderStore } from '../src/store/reminderStore';
import { Medicine, ReminderSchedule } from '../src/types';

const TEST_MED_ID = 'med_auth_exact';
const TEST_SCHED_ID = 'sched_auth_exact';

function createTestMedicine(): Medicine {
  return {
    id: TEST_MED_ID,
    name: 'Authoritative Test Medicine',
    strength: '25 mg',
    dosageForm: 'tablet',
    category: 'Cardiovascular',
    packageDetails: {},
    isSample: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createTestSchedule(notificationsEnabled = true): ReminderSchedule {
  const now = new Date();
  const todayStr = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');

  return {
    id: TEST_SCHED_ID,
    medicineId: TEST_MED_ID,
    recurrence: 'daily',
    startDate: todayStr,
    times: [{ id: 't_morning', time: '08:00', amount: '1 tablet' }],
    enabled: true,
    notificationsEnabled,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('Authoritative Exact-Alarm Permission & Safe Reconciliation', () => {
  beforeEach(() => {
    (Notifications as any).__clearScheduledNotifications();
    medicineRepository.create(createTestMedicine());
    (NativeModules.AlarmModule.canScheduleExactAlarms as any).mockResolvedValue(true);
    (NativeModules.AlarmModule.canUseFullScreenIntent as any).mockResolvedValue(true);
    (Notifications.getPermissionsAsync as any).mockResolvedValue({
      granted: true,
      status: 'granted',
      canAskAgain: true,
    });
    (Notifications.getExactAlarmPermissionsAsync as any).mockResolvedValue({
      granted: true,
      status: 'granted',
    });
  });

  afterEach(async () => {
    await notificationService.cancelAll();
    scheduleRepository.delete(TEST_SCHED_ID);
    medicineRepository.delete(TEST_MED_ID);
    (Notifications as any).__clearScheduledNotifications();
    jest.restoreAllMocks();
  });

  describe('Authoritative Android Check via AlarmManager', () => {
    it('uses Native AlarmModule.canScheduleExactAlarms() as authoritative on Android', async () => {
      const canScheduleSpy = NativeModules.AlarmModule.canScheduleExactAlarms;
      (canScheduleSpy as any).mockResolvedValue(true);

      const canExact = await nativeAlarmService.canScheduleExactAlarms();
      expect(canExact).toBe(true);
      expect(canScheduleSpy).toHaveBeenCalled();

      (canScheduleSpy as any).mockResolvedValue(false);
      const canExactFalse = await nativeAlarmService.canScheduleExactAlarms();
      expect(canExactFalse).toBe(false);
    });

    it('does NOT assume permission is granted because Expo getExactAlarmPermissionsAsync is absent or claims granted', async () => {
      // Even if Expo API claims granted or is bypassed, AlarmManager.canScheduleExactAlarms is authoritative
      (Notifications.getExactAlarmPermissionsAsync as any).mockResolvedValue({ granted: true });
      (NativeModules.AlarmModule.canScheduleExactAlarms as any).mockResolvedValue(false);

      const hasAccess = await notificationService.hasReliableAlarmAccess();
      expect(hasAccess).toBe(false);

      const diagnosis = await notificationService.diagnoseAlarmAccess();
      expect(diagnosis.exactAlarm).toBe(false);
      expect(diagnosis.notificationPermission).toBe(true);
    });

    it('does NOT assume permission is granted when native AlarmModule is missing on Android', async () => {
      const originalModule = (NativeModules as any).AlarmModule;
      try {
        (NativeModules as any).AlarmModule = undefined;

        const canExact = await nativeAlarmService.canScheduleExactAlarms();
        expect(canExact).toBe(false);

        const hasAccess = await notificationService.hasReliableAlarmAccess();
        expect(hasAccess).toBe(false);
      } finally {
        (NativeModules as any).AlarmModule = originalModule;
      }
    });

    it('requires full-screen intent access for reliable Android alarm presentation', async () => {
      (NativeModules.AlarmModule.canScheduleExactAlarms as any).mockResolvedValue(true);
      (NativeModules.AlarmModule.canUseFullScreenIntent as any).mockResolvedValue(false);

      expect(await notificationService.hasReliableAlarmAccess()).toBe(false);

      const diagnosis = await notificationService.diagnoseAlarmAccess();
      expect(diagnosis.notificationPermission).toBe(true);
      expect(diagnosis.exactAlarm).toBe(true);
      expect(diagnosis.fullScreenIntent).toBe(false);
    });

    it('represents denied exact-alarm permission distinctly from notification permission', async () => {
      // 1. Both granted
      (NativeModules.AlarmModule.canScheduleExactAlarms as any).mockResolvedValue(true);
      let diagnosis = await notificationService.diagnoseAlarmAccess();
      expect(diagnosis.notificationPermission).toBe(true);
      expect(diagnosis.exactAlarm).toBe(true);

      // 2. Notification granted, exact alarm denied
      (NativeModules.AlarmModule.canScheduleExactAlarms as any).mockResolvedValue(false);
      diagnosis = await notificationService.diagnoseAlarmAccess();
      expect(diagnosis.notificationPermission).toBe(true);
      expect(diagnosis.exactAlarm).toBe(false);

      // 3. Notification denied
      (Notifications as any).getPermissionsAsync.mockResolvedValueOnce({
        granted: false,
        status: 'denied',
        canAskAgain: true,
      });
      diagnosis = await notificationService.diagnoseAlarmAccess();
      expect(diagnosis.notificationPermission).toBe(false);
    });
  });

  describe('Precision Mode & Exact vs Inexact Fallback Triggers', () => {
    it('returns exact precision mode when permission is granted and inexact_fallback when denied', async () => {
      (NativeModules.AlarmModule.canScheduleExactAlarms as any).mockResolvedValue(true);
      expect(await nativeAlarmService.getAlarmPrecisionMode()).toBe('exact');

      (NativeModules.AlarmModule.canScheduleExactAlarms as any).mockResolvedValue(false);
      expect(await nativeAlarmService.getAlarmPrecisionMode()).toBe('inexact_fallback');
    });

    it('omits delivery: alarmClock option when exact scheduling is unavailable to avoid promising precision', () => {
      const schedule = {
        recurrence: 'daily' as const,
        startDate: '2026-10-31',
      };

      // When allowAlarmClock = true (exact allowed)
      const exactTriggers = getNotificationTriggersForDose(schedule, '08:00', new Date('2026-10-31T07:00:00'), true);
      expect(exactTriggers.length).toBeGreaterThan(0);
      expect((exactTriggers[0] as any).delivery).toBe('alarmClock');

      // When allowAlarmClock = false (inexact fallback)
      const inexactTriggers = getNotificationTriggersForDose(schedule, '08:00', new Date('2026-10-31T07:00:00'), false);
      expect(inexactTriggers.length).toBeGreaterThan(0);
      expect((inexactTriggers[0] as any).delivery).toBeUndefined();
    });
  });

  describe('Restoring Permission Triggers Safe Reconciliation', () => {
    it('re-enables notifications and reconciles alarms after exact alarm permission is restored', async () => {
      // Step 1: Save schedule while exact alarm access is denied
      (NativeModules.AlarmModule.canScheduleExactAlarms as any).mockResolvedValue(false);

      const saveResult = await useReminderStore.getState().saveSchedule(createTestSchedule());
      expect(saveResult.saved).toBe(true);
      expect(saveResult.alarmFailure).toBe('exact_alarm');

      // Schedule is saved in DB but marked notificationsEnabled = false because alarms could not be armed
      let storedSchedule = scheduleRepository.getById(TEST_SCHED_ID);
      expect(storedSchedule?.notificationsEnabled).toBe(false);
      expect(await Notifications.getAllScheduledNotificationsAsync()).toHaveLength(0);

      // Step 2: User goes to system settings and grants exact-alarm permission
      (NativeModules.AlarmModule.canScheduleExactAlarms as any).mockResolvedValue(true);

      // Step 3: App foregrounds, triggering reconciliation pass
      const reconcileResult = await notificationService.reconcileScheduledReminders();
      expect(reconcileResult.rescheduled).toBeGreaterThan(0);

      // Step 4: Schedule has notifications safely re-enabled and exact alarms scheduled
      storedSchedule = scheduleRepository.getById(TEST_SCHED_ID);
      expect(storedSchedule?.notificationsEnabled).toBe(true);

      const scheduledNotifs = await Notifications.getAllScheduledNotificationsAsync();
      expect(scheduledNotifs.length).toBeGreaterThan(0);
      expect(scheduledNotifs[0].content.data?.scheduleId).toBe(TEST_SCHED_ID);
    });

    it('coalesces multiple foreground events safely without creating duplicate alarms', async () => {
      (NativeModules.AlarmModule.canScheduleExactAlarms as any).mockResolvedValue(true);
      scheduleRepository.save(createTestSchedule(true));

      // Trigger 3 concurrent reconcile passes
      const [res1, res2, res3] = await Promise.all([
        notificationService.reconcileScheduledReminders(),
        notificationService.reconcileScheduledReminders(),
        notificationService.reconcileScheduledReminders(),
      ]);

      expect(res1).toBeDefined();
      expect(res2).toBeDefined();
      expect(res3).toBeDefined();

      const scheduledNotifs = await Notifications.getAllScheduledNotificationsAsync();
      const doseNotifs = scheduledNotifs.filter((n) => n.content.data?.scheduleId === TEST_SCHED_ID);
      // Ensure concurrent reconcile passes coalesce safely into a single set without duplicating alarms
      expect(doseNotifs.length).toBeGreaterThan(0);
      expect(doseNotifs.length).toBeLessThanOrEqual(60);
      const uniqueTriggerIds = new Set(doseNotifs.map((n) => n.identifier));
      expect(uniqueTriggerIds.size).toBe(doseNotifs.length);
    });
  });
});
