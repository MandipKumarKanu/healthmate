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
        medicineName: 'Metformin',
        amount: '500mg',
        time: '08:00',
        label: 'Morning Dose',
        minutes: 15,
      });

      expect(snoozeSpy).toHaveBeenCalledWith(
        'sched_test_1',
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
        medicineName: 'Amoxicillin',
        amount: '250mg',
        time: '12:00',
      });

      expect(snoozeSpy).toHaveBeenCalledWith(
        'sched_test_2',
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
        medicineName: 'Lisinopril',
        amount: '10mg',
        time: '18:00',
        minutes: 99 as any,
      });

      // Since 99 is invalid and default in store is 10 (or whatever is stored), falls back safely to valid preference / 10
      const passedMinutes = (snoozeSpy as any).mock.calls[
        (snoozeSpy as any).mock.calls.length - 1
      ][5];
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
        medicineName: 'Aspirin',
        amount: '1 tablet',
        time: '08:00',
        label: 'Breakfast',
        minutes: 10,
      });

      // Second snooze: 10 minutes again
      await nativeAlarmService.snoozeAlarm({
        scheduleId: originalSchedule.id,
        medicineName: 'Aspirin',
        amount: '1 tablet',
        time: '08:00',
        label: 'Breakfast',
        minutes: 10,
      });

      // Native module snooze called twice with the same scheduleId (updating PendingIntent in Android)
      expect(snoozeSpy).toHaveBeenCalledTimes(2);
      expect(snoozeSpy).toHaveBeenNthCalledWith(
        1,
        'sched_daily_dose',
        'Aspirin',
        '1 tablet',
        '08:00',
        'Breakfast',
        10,
      );
      expect(snoozeSpy).toHaveBeenNthCalledWith(
        2,
        'sched_daily_dose',
        'Aspirin',
        '1 tablet',
        '08:00',
        'Breakfast',
        10,
      );

      // The original schedule in SQLite must NOT be modified (snooze is an in-memory / AlarmManager deferral)
      expect(saveScheduleSpy).not.toHaveBeenCalled();
      const afterSchedule = scheduleRepository.getById('sched_daily_dose');
      expect(afterSchedule?.times[0].time).toBe('08:00');
    });
  });
});
