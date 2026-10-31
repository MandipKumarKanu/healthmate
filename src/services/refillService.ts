import { getDatabase } from '../database/client';
import { medicineRepository } from '../database/repositories/medicineRepository';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Medicine, RefillReminder } from '../types';

interface RefillReminderRow {
  id: string;
  medicine_id: string;
  threshold: number;
  current_stock: number;
  status: string;
  reminded_at: string | null;
  created_at: string;
}

function mapRow(row: RefillReminderRow): RefillReminder {
  return {
    id: row.id,
    medicineId: row.medicine_id,
    threshold: row.threshold,
    currentStock: row.current_stock,
    status: row.status === 'reminded' ? 'reminded' : 'pending',
    remindedAt: row.reminded_at ?? undefined,
    createdAt: row.created_at,
  };
}

/** True only when the medicine actively tracks stock AND has dropped to its threshold. */
export function isLowStock(
  medicine: Pick<Medicine, 'currentInventory' | 'refillThreshold'>,
): boolean {
  if (medicine.currentInventory == null || medicine.refillThreshold == null) {
    return false;
  }
  return medicine.currentInventory <= medicine.refillThreshold;
}

export interface StockChangeResult {
  stock: number;
  previousStock: number;
  thresholdCrossed: boolean;
}

export const refillService = {
  /**
   * Applies one unit of consumption (+1 undo / -1 dose) to a medicine's
   * tracked inventory. Returns null when stock tracking is not enabled for
   * the medicine, so callers can treat tracking as purely optional.
   *
   * Counts a threshold CROSS as `thresholdCrossed`: either the stock moved
   * from above the threshold to at/below it, or the row is created fresh for
   * a medicine that was already at/below its threshold. A dose below the
   * threshold when the row already exists does NOT re-notify.
   */
  applyStockChange(medicineId: string, delta: number): StockChangeResult | null {
    const medicine = medicineRepository.getById(medicineId);
    if (!medicine || medicine.currentInventory == null) return null;

    const previousStock = medicine.currentInventory;
    const newStock = Math.max(0, previousStock + delta);
    if (newStock !== previousStock) {
      medicineRepository.update(medicineId, { currentInventory: newStock });
    }

    const threshold = medicine.refillThreshold;
    if (threshold == null) {
      return { stock: newStock, previousStock, thresholdCrossed: false };
    }

    const db = getDatabase();
    const rowId = `refill_${medicineId}`;

    if (newStock <= threshold) {
      // Maintain a single refill row per medicine. An already-reminded row
      // keeps its status (no re-notify spam); future doses just refresh stock.
      const existing = db.getFirstSync<RefillReminderRow>(
        'SELECT * FROM refill_reminders WHERE id = ?;',
        [rowId],
      );
      if (existing) {
        db.runSync(`UPDATE refill_reminders SET current_stock = ?, threshold = ? WHERE id = ?;`, [
          newStock,
          threshold,
          rowId,
        ]);
        return { stock: newStock, previousStock, thresholdCrossed: false };
      } else {
        db.runSync(
          `INSERT OR REPLACE INTO refill_reminders (
            id, medicine_id, threshold, current_stock, status, reminded_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
          [rowId, medicineId, threshold, newStock, 'pending', null, new Date().toISOString()],
        );
        // Fresh alert: either a fresh cross (above → at/below) or the
        // medicine was created already at/below its threshold.
        return { stock: newStock, previousStock, thresholdCrossed: true };
      }
    } else {
      // Stock restored above the threshold: the pending alert no longer applies.
      db.runSync('DELETE FROM refill_reminders WHERE id = ?;', [rowId]);
      return { stock: newStock, previousStock, thresholdCrossed: false };
    }
  },

  /**
   * Schedules an immediate local notification announcing low stock. Best
   * effort: never throws, and is a no-op on runtimes without the native
   * notifications module (Expo Go, web).
   */
  async notifyRefillNeeded(
    medicineName: string,
    stock: number,
    unit: string | undefined,
  ): Promise<void> {
    try {
      const unitLabel = unit ? ` ${unit}` : ' doses';
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Refill soon',
          body: `${medicineName} stock is low (${stock}${unitLabel} left). Order a refill in time.`,
          data: { kind: 'refill', medicineName },
          sound: 'default',
          ...(Platform.OS === 'android' ? { channelId: 'medication-reminders' } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(Date.now() + 1000),
        },
      });
    } catch (error) {
      console.warn('Refill notification could not be scheduled:', error);
    }
  },

  getRefillRow(medicineId: string): RefillReminder | null {
    const row = getDatabase().getFirstSync<RefillReminderRow>(
      'SELECT * FROM refill_reminders WHERE id = ?;',
      [`refill_${medicineId}`],
    );
    return row ? mapRow(row) : null;
  },

  /** Marks a refill row reminded (used after the notification fires). */
  markReminded(medicineId: string): void {
    getDatabase().runSync(
      `UPDATE refill_reminders SET status = 'reminded', reminded_at = ? WHERE id = ?;`,
      [new Date().toISOString(), `refill_${medicineId}`],
    );
  },

  clearForMedicine(medicineId: string): void {
    getDatabase().runSync('DELETE FROM refill_reminders WHERE medicine_id = ?;', [medicineId]);
  },
};
