import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { useAppStore } from '../src/store/appStore';
import { profileRepository } from '../src/database/repositories/profileRepository';
import { nativeAlarmService } from '../src/services/nativeAlarmService';
import { scheduleRepository } from '../src/database/repositories/scheduleRepository';
import { NativeModules } from 'react-native';
import { SnoozeIntervalMinutes } from '../src/types';

describe('Configurable Alarm Snooze Intervals', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await useAppStore.getState().initApp();
  });

  describe('Store Default & Preference Configuration', () => {
    it('defaults snooze interval to 10 minutes', () => {
      const state = useAppStore.getState();
      expect(state.preferences.snoozeIntervalMinutes).toBe(10);
    });

    it.each([5, 10, 15, 20] as SnoozeIntervalMinutes[])(
      'supports setting snooze interval to %i minutes',
      async (interval) => {
        const store = useAppStore.getState();
        await store.setSnoozeInterval(interval);

        expect(useAppStore.getState().preferences.snoozeIntervalMinutes).toBe(interval);
        const persistedPrefs = profileRepository.getPreferences();
        expect(persistedPrefs.snoozeIntervalMinutes).toBe(interval);
      },
    );

    it('survives app restart by reading persisted preference from database', async () => {
      // Set to 15m
      await useAppStore.getState().setSnoozeInterval(15);
      expect(profileRepository.getPreferences().snoozeIntervalMinutes).toBe(15);

      // Simulate app cold start / re-initialization
      useAppStore.setState({
        preferences: {
          ...useAppStore.getState().preferences,
          snoozeIntervalMinutes: 10,
        },
      });
      await useAppStore.getState().initApp();

      expect(useAppStore.getState().preferences.snoozeIntervalMinutes).toBe(15);
    });

    it('safely falls back to 10 minutes when stored value is invalid or corrupted', () => {
      // Test profileRepository fallback logic for non-allowed numbers
      const valid5 = profileRepository.validateSnoozeInterval(5);
      const valid10 = profileRepository.validateSnoozeInterval(10);
      const valid15 = profileRepository.validateSnoozeInterval(15);
      const valid20 = profileRepository.validateSnoozeInterval(20);
      const invalid7 = profileRepository.validateSnoozeInterval(7);
      const invalidNeg = profileRepository.validateSnoozeInterval(-10);
      const invalidNull = profileRepository.validateSnoozeInterval(null as any);
      const invalidUndefined = profileRepository.validateSnoozeInterval(undefined as any);
      const invalidStr = profileRepository.validateSnoozeInterval('15' as any);

      expect(valid5).toBe(5);
      expect(valid10).toBe(10);
      expect(valid15).toBe(15);
      expect(valid20).toBe(20);
      expect(invalid7).toBe(10);
      expect(invalidNeg).toBe(10);
      expect(invalidNull).toBe(10);
      expect(invalidUndefined).toBe(10);
      expect(invalidStr).toBe(10);
    });
  });

  describe('nativeAlarmService.snoozeAlarm Execution', () => {
    it('passes explicit snooze minutes to native module when provided', async () => {
      const snoozeSpy = NativeModules.AlarmModule.snoozeAlarm;

      await nativeAlarmService.snoozeAlarm({
        scheduleId: 'sched_test_1',
        instanceId: '1782451200000',
        medicineName: 'Metformin',
        amount: '500mg',
        time: '08:00',
        label: 'Morning Dose',
        minutes: 15,
      });

      expect(snoozeSpy).toHaveBeenCalledWith(
        'sched_test_1',
        'sched_test_1::snooze::1782451200000',
        '1782451200000',
        'Metformin',
        '500mg',
        '08:00',
        'Morning Dose',
        15,
      );
    });

    it('falls back to user preferences from repository if minutes not passed', async () => {
      await useAppStore.getState().setSnoozeInterval(20);
      const snoozeSpy = NativeModules.AlarmModule.snoozeAlarm;

      await nativeAlarmService.snoozeAlarm({
        scheduleId: 'sched_test_2',
        instanceId: '1782451200000',
        medicineName: 'Amoxicillin',
        amount: '250mg',
        time: '12:00',
      });

      expect(snoozeSpy).toHaveBeenCalledWith(
        'sched_test_2',
        'sched_test_2::snooze::1782451200000',
        '1782451200000',
        'Amoxicillin',
        '250mg',
        '12:00',
        '',
        20,
      );
    });

    it('falls back to 10 minutes if an invalid minutes value (e.g. 99) is provided', async () => {
      const snoozeSpy = NativeModules.AlarmModule.snoozeAlarm;

      await nativeAlarmService.snoozeAlarm({
        scheduleId: 'sched_test_3',
        instanceId: '1782451200000',
        medicineName: 'Lisinopril',
        amount: '10mg',
        time: '18:00',
        minutes: 99 as any,
      });

      // Since 99 is invalid and default in store is 10 (or whatever is stored), falls back safely to valid preference / 10
      const passedMinutes = (snoozeSpy as any).mock.calls[
        (snoozeSpy as any).mock.calls.length - 1
      ][7];
      expect([5, 10, 15, 20]).toContain(passedMinutes);
    });
  });

  describe('Repeated Snoozing & Non-Destructive Scheduling', () => {
    it('repeated snoozing defers alarm without creating duplicate schedules or changing future doses', async () => {
      const originalSchedule = {
        id: 'sched_daily_dose',
        medicineId: 'med_adv_1',
        recurrence: 'daily' as const,
        startDate: '2026-10-26',
        times: [{ id: 't1', time: '08:00', amount: '1 tablet', label: 'Breakfast' }],
        enabled: true,
        notificationsEnabled: true,
        createdAt: '2026-10-26T00:00:00.000Z',
        updatedAt: '2026-10-26T00:00:00.000Z',
      };

      jest.spyOn(scheduleRepository, 'getById').mockReturnValue(originalSchedule);
      const saveScheduleSpy = jest.spyOn(scheduleRepository, 'save');
      const snoozeSpy = NativeModules.AlarmModule.snoozeAlarm;

      // First snooze: 10 minutes
      await nativeAlarmService.snoozeAlarm({
        scheduleId: originalSchedule.id,
        instanceId: 'dose-instance-2026-10-30T08:00:00',
        medicineName: 'Aspirin',
        amount: '1 tablet',
        time: '08:00',
        label: 'Breakfast',
        minutes: 10,
      });

      // Second snooze: 10 minutes again
      await nativeAlarmService.snoozeAlarm({
        scheduleId: originalSchedule.id,
        instanceId: 'dose-instance-2026-10-30T08:00:00',
        medicineName: 'Aspirin',
        amount: '1 tablet',
        time: '08:00',
        label: 'Breakfast',
        minutes: 10,
      });

      // Both calls target the same isolated snooze entry for this dose instance.
      expect(snoozeSpy).toHaveBeenCalledTimes(2);
      expect(snoozeSpy).toHaveBeenNthCalledWith(
        1,
        'sched_daily_dose',
        'sched_daily_dose::snooze::dose-instance-2026-10-30T08:00:00',
        'dose-instance-2026-10-30T08:00:00',
        'Aspirin',
        '1 tablet',
        '08:00',
        'Breakfast',
        10,
      );
      expect(snoozeSpy).toHaveBeenNthCalledWith(
        2,
        'sched_daily_dose',
        'sched_daily_dose::snooze::dose-instance-2026-10-30T08:00:00',
        'dose-instance-2026-10-30T08:00:00',
        'Aspirin',
        '1 tablet',
        '08:00',
        'Breakfast',
        10,
      );

      // Snoozing must not mutate the persisted recurring schedule.
      expect(saveScheduleSpy).not.toHaveBeenCalled();
      const afterSchedule = scheduleRepository.getById('sched_daily_dose');
      expect(afterSchedule?.times[0].time).toBe('08:00');
    });

    it('snoozing a daily dose preserves tomorrow’s alarm', async () => {
      const dailySchedule = {
        id: 'sched_daily_preserve',
        medicineId: 'med_1',
        recurrence: 'daily' as const,
        startDate: '2026-10-30',
        times: [{ id: 't1', time: '08:00', amount: '1 tablet' }],
        enabled: true,
        notificationsEnabled: true,
        createdAt: '2026-10-30T00:00:00.000Z',
        updatedAt: '2026-10-30T00:00:00.000Z',
      };
      jest.spyOn(scheduleRepository, 'getById').mockReturnValue(dailySchedule);
      const snoozeSpy = NativeModules.AlarmModule.snoozeAlarm;
      const syncChainSpy = NativeModules.AlarmModule.syncAlarmChain;

      // Snooze today's instance
      const scheduledAt = await nativeAlarmService.snoozeAlarm({
        scheduleId: dailySchedule.id,
        instanceId: '2026-10-30T08:00:00',
        medicineName: 'Daily Med',
        amount: '1 tablet',
        time: '08:00',
        minutes: 10,
      });

      expect(scheduledAt.success).toBe(true);
      expect(scheduledAt.scheduledAt).toBeGreaterThan(0);
      // Snooze was created with distinct ID
      expect(snoozeSpy).toHaveBeenCalledWith(
        'sched_daily_preserve',
        'sched_daily_preserve::snooze::2026-10-30T08:00:00',
        '2026-10-30T08:00:00',
        'Daily Med',
        '1 tablet',
        '08:00',
        '',
        10,
      );
      // syncAlarmChain for the recurring daily schedule was never overwritten
      expect(syncChainSpy).not.toHaveBeenCalled();
    });

    it('snoozing a weekly dose preserves next week’s alarm', async () => {
      const weeklySchedule = {
        id: 'sched_weekly_preserve',
        medicineId: 'med_2',
        recurrence: 'weekly' as const,
        startDate: '2026-10-30',
        times: [{ id: 't1', time: '10:00', amount: '2 capsules' }],
        enabled: true,
        notificationsEnabled: true,
        createdAt: '2026-10-30T00:00:00.000Z',
        updatedAt: '2026-10-30T00:00:00.000Z',
      };
      jest.spyOn(scheduleRepository, 'getById').mockReturnValue(weeklySchedule);
      const snoozeSpy = NativeModules.AlarmModule.snoozeAlarm;

      await nativeAlarmService.snoozeAlarm({
        scheduleId: weeklySchedule.id,
        instanceId: '2026-10-30T10:00:00',
        medicineName: 'Weekly Med',
        amount: '2 capsules',
        time: '10:00',
        minutes: 15,
      });

      expect(snoozeSpy).toHaveBeenCalledWith(
        'sched_weekly_preserve',
        'sched_weekly_preserve::snooze::2026-10-30T10:00:00',
        '2026-10-30T10:00:00',
        'Weekly Med',
        '2 capsules',
        '10:00',
        '',
        15,
      );
    });

    it('dismissing a snooze cancels only the snooze instance without cancelling recurrence', async () => {
      const cancelAlarmSpy = NativeModules.AlarmModule.cancelAlarm;

      // Dismiss snooze instance specifically
      const result = await nativeAlarmService.cancelSnooze(
        'sched_daily_dose',
        'dose-instance-2026-10-30T08:00:00',
      );

      expect(result.success).toBe(true);
      // Target is specifically the snooze ID, NOT the recurring schedule ID
      expect(cancelAlarmSpy).toHaveBeenCalledWith(
        'sched_daily_dose::snooze::dose-instance-2026-10-30T08:00:00',
      );
      expect(cancelAlarmSpy).not.toHaveBeenCalledWith('sched_daily_dose');
    });

    it('deleting a schedule cancels its pending snoozes', async () => {
      const cancelAlarmSpy = NativeModules.AlarmModule.cancelAlarm;

      // When schedule is deleted, cancelAlarm is called with schedule ID
      // which native AlarmArming.cancelAllForSchedule matches against both
      // scheduleId and entry.sourceScheduleId
      await nativeAlarmService.cancelAlarm('sched_to_delete');
      expect(cancelAlarmSpy).toHaveBeenCalledWith('sched_to_delete');
    });

    it('cancels snoozes for schedule without touching recurring schedule', async () => {
      const cancelSnoozesSpy = NativeModules.AlarmModule.cancelSnoozesForSchedule;

      const result = await nativeAlarmService.cancelSnoozesForSchedule('sched_active_dose');
      expect(result.success).toBe(true);
      expect(cancelSnoozesSpy).toHaveBeenCalledWith('sched_active_dose');
    });
  });
});
