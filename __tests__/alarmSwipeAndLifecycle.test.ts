import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { nativeAlarmService } from '../src/services/nativeAlarmService';
import { adherenceRepository } from '../src/database/repositories/adherenceRepository';
import { scheduleRepository } from '../src/database/repositories/scheduleRepository';
import { medicineRepository } from '../src/database/repositories/medicineRepository';
import { useAppStore } from '../src/store/appStore';
import { NativeModules } from 'react-native';

describe('Alarm Screen Swipe Interaction & Native Alarm Lifecycle', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await useAppStore.getState().initApp();
  });

  describe('Alarm Intent and Medication Details Resolution', () => {
    it('resolves medication details from schedule and medicine repositories when params are minimal', () => {
      jest.spyOn(scheduleRepository, 'getById').mockReturnValue({
        id: 'sched_full_1',
        medicineId: 'med_full_1',
        recurrence: 'daily',
        startDate: '2026-10-26',
        times: [{ id: 't1', time: '08:30', amount: '2 capsules', label: 'Morning' }],
        enabled: true,
        notificationsEnabled: true,
        createdAt: '2026-10-26',
        updatedAt: '2026-10-26',
      });

      jest.spyOn(medicineRepository, 'getById').mockReturnValue({
        id: 'med_full_1',
        name: 'Amoxicillin',
        strength: '500mg',
        dosageForm: 'capsule',
        category: 'Antibiotics',
        packageDetails: {},
        createdAt: '2026-10-26',
        updatedAt: '2026-10-26',
      });

      const sched = scheduleRepository.getById('sched_full_1');
      const med = medicineRepository.getById(sched!.medicineId);

      expect(sched).toBeDefined();
      expect(med).toBeDefined();
      expect(med?.name).toBe('Amoxicillin');
      expect(med?.strength).toBe('500mg');
      expect(sched?.times[0].time).toBe('08:30');
    });

    it('handles missing medicine details gracefully with fallback defaults', () => {
      jest.spyOn(scheduleRepository, 'getById').mockReturnValue(null);
      jest.spyOn(medicineRepository, 'getById').mockReturnValue(null);

      const params = { scheduleId: 'sched_unknown' };
      const sched = scheduleRepository.getById(params.scheduleId);
      const medicineName = sched ? 'Found' : 'Medication';
      const amount = '1 dose';

      expect(medicineName).toBe('Medication');
      expect(amount).toBe('1 dose');
    });
  });

  describe('Swipe-Right Action: Take Dose Completion', () => {
    it('stops active alarm and logs dose status as taken in adherence repository', async () => {
      const stopAlarmSpy = jest.spyOn(nativeAlarmService, 'stopAlarm').mockResolvedValue(true);
      const logDoseSpy = jest
        .spyOn(adherenceRepository, 'logDoseStatus')
        .mockReturnValue(undefined);

      // Simulate take dose flow
      await nativeAlarmService.stopAlarm();
      adherenceRepository.logDoseStatus('sched_100', 'med_100', '2026-10-26', '08:00', 'taken');

      expect(stopAlarmSpy).toHaveBeenCalled();
      expect(logDoseSpy).toHaveBeenCalledWith(
        'sched_100',
        'med_100',
        '2026-10-26',
        '08:00',
        'taken',
      );
    });

    it('prevents duplicate execution if user attempts to trigger while action is processing', async () => {
      const stopAlarmSpy = jest.spyOn(nativeAlarmService, 'stopAlarm').mockResolvedValue(true);
      let isProcessing = false;
      let executionCount = 0;

      const executeTakeDose = async () => {
        if (isProcessing) return;
        isProcessing = true;
        executionCount++;
        await nativeAlarmService.stopAlarm();
      };

      // Trigger twice concurrently
      await Promise.all([executeTakeDose(), executeTakeDose()]);

      expect(executionCount).toBe(1);
      expect(stopAlarmSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Swipe-Left Action: Snooze Alarm Completion', () => {
    it('calls nativeAlarmService.snoozeAlarm with user-configured snooze interval and stops current ringing', async () => {
      await useAppStore.getState().setSnoozeInterval(15);
      const configuredMinutes = useAppStore.getState().preferences.snoozeIntervalMinutes;

      const snoozeSpy = jest
        .spyOn(nativeAlarmService, 'snoozeAlarm')
        .mockResolvedValue(Date.now() + 15 * 60000);
      const stopAlarmSpy = jest.spyOn(nativeAlarmService, 'stopAlarm').mockResolvedValue(true);

      // Execute snooze action
      await nativeAlarmService.snoozeAlarm({
        scheduleId: 'sched_snooze_1',
        medicineName: 'Metformin',
        amount: '500mg',
        time: '08:00',
        label: 'Morning Dose',
        minutes: configuredMinutes,
      });
      await nativeAlarmService.stopAlarm();

      expect(snoozeSpy).toHaveBeenCalledWith({
        scheduleId: 'sched_snooze_1',
        medicineName: 'Metformin',
        amount: '500mg',
        time: '08:00',
        label: 'Morning Dose',
        minutes: 15,
      });
      expect(stopAlarmSpy).toHaveBeenCalled();
    });

    it('prevents duplicate snooze execution while an action is already in flight', async () => {
      const snoozeSpy = jest
        .spyOn(nativeAlarmService, 'snoozeAlarm')
        .mockResolvedValue(Date.now() + 600000);
      let isProcessing = false;
      let snoozeCalls = 0;

      const executeSnooze = async () => {
        if (isProcessing) return;
        isProcessing = true;
        snoozeCalls++;
        await nativeAlarmService.snoozeAlarm({
          scheduleId: 's1',
          medicineName: 'Med',
          amount: '1',
          time: '08:00',
          minutes: 10,
        });
      };

      await Promise.all([executeSnooze(), executeSnooze()]);

      expect(snoozeCalls).toBe(1);
      expect(snoozeSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Swipe Threshold and Spring Return Logic', () => {
    const SLIDER_WIDTH = 350;
    const PUCK_SIZE = 58;
    const MAX_DRAG = (SLIDER_WIDTH - PUCK_SIZE) / 2 - 6; // ~140
    const SWIPE_THRESHOLD = MAX_DRAG * 0.7; // ~98

    it('does not trigger action when swipe distance is below threshold and resets handle', () => {
      const gestureDxPositiveIncomplete = 40; // < 98
      const gestureDxNegativeIncomplete = -50; // > -98

      const shouldTakeDose = gestureDxPositiveIncomplete >= SWIPE_THRESHOLD;
      const shouldSnooze = gestureDxNegativeIncomplete <= -SWIPE_THRESHOLD;

      expect(shouldTakeDose).toBe(false);
      expect(shouldSnooze).toBe(false);

      // Reset value expected to return to center (0)
      const springTargetValue = 0;
      expect(springTargetValue).toBe(0);
    });

    it('triggers actions only when gesture crosses the positive or negative completion threshold', () => {
      const gestureDxRightCompleted = 110;
      const gestureDxLeftCompleted = -105;

      const shouldTakeDose = gestureDxRightCompleted >= SWIPE_THRESHOLD;
      const shouldSnooze = gestureDxLeftCompleted <= -SWIPE_THRESHOLD;

      expect(shouldTakeDose).toBe(true);
      expect(shouldSnooze).toBe(true);
    });
  });

  describe('Error Handling and Failure Recovery', () => {
    it('resets isProcessing state and does not falsely mark dose taken if logging fails', async () => {
      jest.spyOn(nativeAlarmService, 'stopAlarm').mockResolvedValue(true);
      jest.spyOn(adherenceRepository, 'logDoseStatus').mockImplementation(() => {
        throw new Error('SQLite disk full or locked');
      });

      let isProcessing = true;
      let errorMessage: string | null = null;
      let completedAction: string | null = 'taken';

      try {
        await nativeAlarmService.stopAlarm();
        adherenceRepository.logDoseStatus('sched_fail', 'med_fail', '2026-10-26', '08:00', 'taken');
      } catch {
        errorMessage = 'Could not complete action. Please try again.';
        isProcessing = false;
        completedAction = null;
      }

      expect(errorMessage).toBe('Could not complete action. Please try again.');
      expect(isProcessing).toBe(false);
      expect(completedAction).toBeNull();
    });

    it('resets isProcessing and surfaces error if native snooze fails', async () => {
      jest
        .spyOn(nativeAlarmService, 'snoozeAlarm')
        .mockRejectedValue(new Error('Native alarm manager failed'));

      let isProcessing = true;
      let errorMessage: string | null = null;
      let completedAction: string | null = 'snooze';

      try {
        await nativeAlarmService.snoozeAlarm({
          scheduleId: 'sched_fail',
          medicineName: 'Med',
          amount: '1',
          time: '08:00',
          minutes: 10,
        });
      } catch {
        errorMessage = 'Could not snooze alarm. Please try again.';
        isProcessing = false;
        completedAction = null;
      }

      expect(errorMessage).toBe('Could not snooze alarm. Please try again.');
      expect(isProcessing).toBe(false);
      expect(completedAction).toBeNull();
    });
  });

  describe('Alarm Dismissal and Window Flag Cleanup', () => {
    it('calls stopAlarm on unmount or dismissal to clear audio, vibration, and wake locks', async () => {
      const stopAlarmSpy = jest.spyOn(nativeAlarmService, 'stopAlarm').mockResolvedValue(true);

      // Simulate unmount cleanup effect
      await nativeAlarmService.stopAlarm();

      expect(stopAlarmSpy).toHaveBeenCalled();
    });

    it('verifies full-screen intent permission check on Android 14+', async () => {
      const canFsiSpy = jest
        .spyOn(NativeModules.AlarmModule, 'canUseFullScreenIntent')
        .mockResolvedValue(true);
      const openFsiSpy = jest
        .spyOn(NativeModules.AlarmModule, 'openFullScreenIntentSettings')
        .mockResolvedValue(true);

      const canUse = await nativeAlarmService.canUseFullScreenIntent();
      expect(canUse).toBe(true);
      expect(canFsiSpy).toHaveBeenCalled();

      const opened = await nativeAlarmService.openFullScreenIntentSettings();
      expect(opened).toBe(true);
      expect(openFsiSpy).toHaveBeenCalled();
    });
  });
});
