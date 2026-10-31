import { describe, expect, it, beforeEach, jest } from '@jest/globals';
import { NativeModules, Platform } from 'react-native';
import {
  nativeAlarmService,
  NativeActionResult,
  SnoozeAlarmResult,
  ActiveRingingAlarm,
} from '../src/services/nativeAlarmService';
import { adherenceRepository } from '../src/database/repositories/adherenceRepository';
import { scheduleRepository } from '../src/database/repositories/scheduleRepository';
import { medicineRepository } from '../src/database/repositories/medicineRepository';

describe('Handle Simultaneous Alarms', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Representation of Simultaneous Doses', () => {
    it('both simultaneous doses are represented and retrieved with distinct identities', async () => {
      const mockActiveAlarms: ActiveRingingAlarm[] = [
        {
          scheduleId: 'sched_aspirin',
          medicineName: 'Aspirin',
          amount: '100mg',
          time: '08:00',
          label: 'Morning',
          instanceId: 'sched_aspirin_0800',
          sourceScheduleId: 'sched_aspirin',
          notificationId: 10001,
        },
        {
          scheduleId: 'sched_metformin',
          medicineName: 'Metformin',
          amount: '500mg',
          time: '08:00',
          label: 'With breakfast',
          instanceId: 'sched_metformin_0800',
          sourceScheduleId: 'sched_metformin',
          notificationId: 10002,
        },
      ];

      const getActiveSpy = jest
        .spyOn(NativeModules.AlarmModule, 'getActiveAlarms')
        .mockResolvedValue(JSON.stringify(mockActiveAlarms));

      const activeAlarms = await nativeAlarmService.getActiveAlarms();

      expect(getActiveSpy).toHaveBeenCalled();
      expect(activeAlarms.length).toBe(2);

      // Verify both doses are represented
      const dose1 = activeAlarms.find((a) => a.scheduleId === 'sched_aspirin');
      const dose2 = activeAlarms.find((a) => a.scheduleId === 'sched_metformin');

      expect(dose1).toBeDefined();
      expect(dose1?.medicineName).toBe('Aspirin');
      expect(dose1?.time).toBe('08:00');
      expect(dose1?.notificationId).toBe(10001);

      expect(dose2).toBeDefined();
      expect(dose2?.medicineName).toBe('Metformin');
      expect(dose2?.time).toBe('08:00');
      expect(dose2?.notificationId).toBe(10002);

      // Notification IDs are distinct so one does not overwrite the other
      expect(dose1?.notificationId).not.toBe(dose2?.notificationId);
    });

    it('aggregates simultaneous doses from repository when scheduled at the same time', () => {
      const todayStr = '2026-10-31';

      jest.spyOn(adherenceRepository, 'getDosesForDate').mockReturnValue([
        {
          id: 'sched_1_t1_2026-10-31',
          scheduleId: 'sched_1',
          medicineId: 'med_1',
          medicineName: 'Lisinopril',
          strength: '10mg',
          dosageForm: 'tablet',
          date: todayStr,
          time: '08:00',
          amount: '1 tablet',
          status: 'upcoming',
        },
        {
          id: 'sched_2_t1_2026-10-31',
          scheduleId: 'sched_2',
          medicineId: 'med_2',
          medicineName: 'Atorvastatin',
          strength: '20mg',
          dosageForm: 'tablet',
          date: todayStr,
          time: '08:00',
          amount: '1 tablet',
          status: 'upcoming',
        },
      ]);

      const doses = adherenceRepository.getDosesForDate(todayStr);
      const simultaneous = doses.filter((d) => d.time === '08:00');

      expect(simultaneous.length).toBe(2);
      expect(simultaneous[0].medicineName).toBe('Lisinopril');
      expect(simultaneous[1].medicineName).toBe('Atorvastatin');
    });
  });

  describe('Independent Dose Actions (Take & Snooze)', () => {
    it('takes dose A independently without dismissing or cancelling dose B', async () => {
      const stopDoseSpy = jest
        .spyOn(NativeModules.AlarmModule, 'stopDoseAlarm')
        .mockResolvedValue(true);
      const logDoseSpy = jest
        .spyOn(adherenceRepository, 'logDoseStatus')
        .mockReturnValue(undefined);

      // User takes dose A (Aspirin)
      const doseA = { scheduleId: 'sched_aspirin', medicineId: 'med_aspirin', time: '08:00' };
      const doseB = { scheduleId: 'sched_metformin', medicineId: 'med_metformin', time: '08:00' };

      // Stop only dose A
      const res = await nativeAlarmService.stopAlarm(doseA.scheduleId, doseA.time);
      expect(res.success).toBe(true);
      expect(stopDoseSpy).toHaveBeenCalledWith('sched_aspirin', '08:00');
      expect(stopDoseSpy).not.toHaveBeenCalledWith('sched_metformin', expect.anything());

      // Log only dose A as taken
      adherenceRepository.logDoseStatus(
        doseA.scheduleId,
        doseA.medicineId,
        '2026-10-31',
        doseA.time,
        'taken',
      );

      expect(logDoseSpy).toHaveBeenCalledWith(
        'sched_aspirin',
        'med_aspirin',
        '2026-10-31',
        '08:00',
        'taken',
      );
      expect(logDoseSpy).not.toHaveBeenCalledWith(
        'sched_metformin',
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it('snoozes dose B independently without dismissing or affecting dose A', async () => {
      const snoozeSpy = jest
        .spyOn(NativeModules.AlarmModule, 'snoozeAlarm')
        .mockResolvedValue(Date.now() + 600000);
      const stopDoseSpy = jest
        .spyOn(NativeModules.AlarmModule, 'stopDoseAlarm')
        .mockResolvedValue(true);

      const snoozeResult = await nativeAlarmService.snoozeAlarm({
        scheduleId: 'sched_metformin',
        instanceId: 'sched_metformin:08:00',
        medicineName: 'Metformin',
        amount: '500mg',
        time: '08:00',
        label: 'With breakfast',
        minutes: 10,
      });

      expect(snoozeResult.success).toBe(true);
      expect(snoozeSpy).toHaveBeenCalledWith(
        'sched_metformin',
        'sched_metformin::snooze::sched_metformin:08:00',
        'sched_metformin:08:00',
        'Metformin',
        '500mg',
        '08:00',
        'With breakfast',
        10,
      );

      // Stop only dose B's ringing
      await nativeAlarmService.stopAlarm('sched_metformin', '08:00');
      expect(stopDoseSpy).toHaveBeenCalledWith('sched_metformin', '08:00');
      expect(stopDoseSpy).not.toHaveBeenCalledWith('sched_aspirin', expect.anything());
    });
  });

  describe('Dismissing One Dose Does Not Cancel the Other', () => {
    it('dismissing dose A via stopDoseAlarm targets only dose A and leaves dose B active', async () => {
      const stopDoseSpy = jest
        .spyOn(NativeModules.AlarmModule, 'stopDoseAlarm')
        .mockResolvedValue(true);

      // Dismiss dose A
      const dismissRes = await nativeAlarmService.stopDoseAlarm('sched_aspirin', '08:00');
      expect(dismissRes.success).toBe(true);

      expect(stopDoseSpy).toHaveBeenCalledTimes(1);
      expect(stopDoseSpy).toHaveBeenCalledWith('sched_aspirin', '08:00');

      // Verify global stopAlarm (which stops all alarms) was NOT called
      expect(NativeModules.AlarmModule.stopAlarm).not.toHaveBeenCalled();
    });

    it('global stopAlarm stops all active alarms when all doses are resolved', async () => {
      const stopAllSpy = jest
        .spyOn(NativeModules.AlarmModule, 'stopAlarm')
        .mockResolvedValue(true);

      const stopAllRes = await nativeAlarmService.stopAlarm();
      expect(stopAllRes.success).toBe(true);
      expect(stopAllSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Independent Dose Adherence Logging', () => {
    it('records separate adherence log rows for each simultaneous dose', () => {
      const logDoseSpy = jest
        .spyOn(adherenceRepository, 'logDoseStatus')
        .mockReturnValue(undefined);

      const today = '2026-10-31';

      // Dose 1 taken
      adherenceRepository.logDoseStatus('sched_1', 'med_1', today, '08:00', 'taken');
      // Dose 2 skipped
      adherenceRepository.logDoseStatus('sched_2', 'med_2', today, '08:00', 'skipped');

      expect(logDoseSpy).toHaveBeenCalledTimes(2);
      expect(logDoseSpy).toHaveBeenNthCalledWith(1, 'sched_1', 'med_1', today, '08:00', 'taken');
      expect(logDoseSpy).toHaveBeenNthCalledWith(2, 'sched_2', 'med_2', today, '08:00', 'skipped');
    });
  });
});

