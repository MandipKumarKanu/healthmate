import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import * as Notifications from 'expo-notifications';
import { medicineRepository } from '../src/database/repositories/medicineRepository';
import { scheduleRepository } from '../src/database/repositories/scheduleRepository';
import { adherenceRepository } from '../src/database/repositories/adherenceRepository';
import { refillService, isLowStock } from '../src/services/refillService';
import { getDatabase, resetDatabase } from '../src/database/client';

function todayString(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

function seedTrackedMedicine(
  overrides: Partial<Parameters<typeof medicineRepository.create>[0]> = {},
) {
  return medicineRepository.create({
    id: 'med_refill_test',
    name: 'Metformin',
    strength: '500 mg',
    dosageForm: 'tablet',
    category: 'Diabetes',
    packageDetails: {},
    currentInventory: 10,
    refillThreshold: 3,
    unitDosage: 'tablets',
    ...overrides,
  } as Parameters<typeof medicineRepository.create>[0]);
}

function seedDailySchedule(medicineId: string): string {
  const schedule = {
    id: 'sched_refill_test',
    medicineId,
    recurrence: 'daily' as const,
    startDate: todayString(),
    times: [{ id: 'dose_1', time: '10:00', amount: '1 tablet' }],
    enabled: true,
    notificationsEnabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  scheduleRepository.save(schedule);
  return schedule.id;
}

describe('Refill & Inventory Tracking (migration 003 wiring)', () => {
  beforeEach(() => {
    resetDatabase();
    jest.clearAllMocks();
  });

  describe('Persisted stock columns', () => {
    it('stores and reads inventory columns through create and update', () => {
      const med = seedTrackedMedicine();
      expect(med.currentInventory).toBe(10);
      expect(med.refillThreshold).toBe(3);
      expect(med.unitDosage).toBe('tablets');

      medicineRepository.update(med.id, { currentInventory: 25 });
      const reloaded = medicineRepository.getById(med.id);
      expect(reloaded?.currentInventory).toBe(25);
      expect(reloaded?.refillThreshold).toBe(3);
    });

    it('treats missing stock columns as untracked', () => {
      const med = seedTrackedMedicine({ currentInventory: undefined, refillThreshold: undefined });
      expect(med.currentInventory).toBeUndefined();
      expect(isLowStock(med)).toBe(false);
      expect(refillService.applyStockChange(med.id, -1)).toBeNull();
    });
  });

  describe('Stock consumption on dose logging', () => {
    it('ignores missed status for stock', () => {
      seedTrackedMedicine();
      const scheduleId = seedDailySchedule('med_refill_test');

      adherenceRepository.logDoseStatus(
        scheduleId,
        'med_refill_test',
        todayString(),
        '10:00',
        'missed',
      );

      expect(medicineRepository.getById('med_refill_test')?.currentInventory).toBe(10);
    });

    it('decrements one unit per taken dose and never double-decrements a re-log', () => {
      seedTrackedMedicine();
      const scheduleId = seedDailySchedule('med_refill_test');

      adherenceRepository.logDoseStatus(
        scheduleId,
        'med_refill_test',
        todayString(),
        '10:00',
        'taken',
      );
      adherenceRepository.logDoseStatus(
        scheduleId,
        'med_refill_test',
        todayString(),
        '10:00',
        'taken',
      );
      adherenceRepository.logDoseStatus(
        scheduleId,
        'med_refill_test',
        todayString(),
        '10:00',
        'taken',
      );

      expect(medicineRepository.getById('med_refill_test')?.currentInventory).toBe(9);
    });

    it('restores one unit when a taken dose is re-logged as missed or skipped', () => {
      seedTrackedMedicine();
      const scheduleId = seedDailySchedule('med_refill_test');

      adherenceRepository.logDoseStatus(
        scheduleId,
        'med_refill_test',
        todayString(),
        '10:00',
        'taken',
      );
      expect(medicineRepository.getById('med_refill_test')?.currentInventory).toBe(9);

      adherenceRepository.logDoseStatus(
        scheduleId,
        'med_refill_test',
        todayString(),
        '10:00',
        'skipped',
      );
      expect(medicineRepository.getById('med_refill_test')?.currentInventory).toBe(10);

      adherenceRepository.logDoseStatus(
        scheduleId,
        'med_refill_test',
        todayString(),
        '10:00',
        'taken',
      );
      expect(medicineRepository.getById('med_refill_test')?.currentInventory).toBe(9);
    });

    it('rolls back adherence log if stock update fails atomically', () => {
      seedTrackedMedicine({ currentInventory: 10 });
      const scheduleId = seedDailySchedule('med_refill_test');

      jest.spyOn(refillService, 'applyStockChange').mockImplementationOnce(() => {
        throw new Error('Simulated stock update database failure');
      });

      expect(() => {
        adherenceRepository.logDoseStatus(
          scheduleId,
          'med_refill_test',
          todayString(),
          '10:00',
          'taken',
        );
      }).toThrow(/Simulated stock update/);

      // Verify stock was NOT changed
      expect(medicineRepository.getById('med_refill_test')?.currentInventory).toBe(10);
      // Verify adherence log was rolled back
      const doses = adherenceRepository.getDosesForDate(todayString());
      const dose = doses.find((d) => d.scheduleId === scheduleId);
      expect(dose?.status).not.toBe('taken');
    });
  });

  describe('Threshold crossing & refill rows', () => {
    it('creates a pending refill row and notifies on crossing, without re-notifying', async () => {
      seedTrackedMedicine({ currentInventory: 4 });
      const scheduleId = seedDailySchedule('med_refill_test');

      const scheduleSpy = jest
        .spyOn(Notifications, 'scheduleNotificationAsync')
        .mockResolvedValue('notif_1');

      adherenceRepository.logDoseStatus(
        scheduleId,
        'med_refill_test',
        todayString(),
        '10:00',
        'taken',
      );
      expect(medicineRepository.getById('med_refill_test')?.currentInventory).toBe(3);

      // Allow the fire-and-forget notification + markReminded to settle
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(scheduleSpy).toHaveBeenCalledTimes(1);
      const row = refillService.getRefillRow('med_refill_test');
      expect(row).not.toBeNull();
      expect(row?.status).toBe('reminded');
      expect(row?.currentStock).toBe(3);

      // A different dose on the same medicine consumes another unit but must
      // NOT re-notify and must keep the already-reminded row status
      scheduleRepository.save({
        id: 'sched_refill_test_2',
        medicineId: 'med_refill_test',
        recurrence: 'daily',
        startDate: todayString(),
        times: [{ id: 'dose_2', time: '20:00', amount: '1 tablet' }],
        enabled: true,
        notificationsEnabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      adherenceRepository.logDoseStatus(
        'sched_refill_test_2',
        'med_refill_test',
        todayString(),
        '20:00',
        'taken',
      );
      expect(medicineRepository.getById('med_refill_test')?.currentInventory).toBe(2);
      expect(scheduleSpy).toHaveBeenCalledTimes(1);
      const stillSameRow = refillService.getRefillRow('med_refill_test');
      expect(stillSameRow?.status).toBe('reminded');
      expect(stillSameRow?.currentStock).toBe(2);
      scheduleSpy.mockRestore();
    });

    it('clears the refill row when stock is restored above the threshold', () => {
      seedTrackedMedicine({ currentInventory: 3 });
      refillService.applyStockChange('med_refill_test', 5);

      expect(medicineRepository.getById('med_refill_test')?.currentInventory).toBe(8);
      expect(refillService.getRefillRow('med_refill_test')).toBeNull();
    });

    it('applyStockChange floors stock at zero and reports crossings only on the way down', () => {
      seedTrackedMedicine({ currentInventory: 1 });

      expect(refillService.applyStockChange('med_refill_test', -5)).toEqual({
        stock: 0,
        previousStock: 1,
        thresholdCrossed: true,
      });

      expect(refillService.applyStockChange('med_refill_test', -1)?.thresholdCrossed).toBe(false);
    });

    it('removes refill rows when the medicine is deleted', () => {
      seedTrackedMedicine({ currentInventory: 3 });
      refillService.applyStockChange('med_refill_test', -1);
      expect(refillService.getRefillRow('med_refill_test')).not.toBeNull();

      medicineRepository.delete('med_refill_test');
      expect(refillService.getRefillRow('med_refill_test')).toBeNull();
    });
  });

  describe('Refill reminder row shape', () => {
    it('persists all migration-003 fields', () => {
      seedTrackedMedicine({ currentInventory: 3 });
      refillService.applyStockChange('med_refill_test', -1);
      const db = getDatabase();
      const row = db.getFirstSync<{
        medicine_id: string;
        threshold: number;
        current_stock: number;
        status: string;
      }>('SELECT * FROM refill_reminders;');
      expect(row).toMatchObject({
        medicine_id: 'med_refill_test',
        threshold: 3,
        current_stock: 2,
        status: 'pending',
      });
    });
  });
});
