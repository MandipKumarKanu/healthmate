import { describe, expect, it, beforeEach, jest } from "@jest/globals";
import * as Notifications from "expo-notifications";
import {
  notificationService,
  getNotificationTriggersForDose,
} from "../src/services/notificationService";
import { nativeAlarmService } from "../src/services/nativeAlarmService";
import { scheduleRepository } from "../src/database/repositories/scheduleRepository";
import { medicineRepository } from "../src/database/repositories/medicineRepository";
import { useAppStore } from "../src/store/appStore";
import { useReminderStore } from "../src/store/reminderStore";

describe("Alarm Lifecycle & Failure Recovery", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await notificationService.cancelAll();
  });

  describe("Cancellation on Deletion & Reset", () => {
    it("notificationService.cancelAll cancels both native alarms and OS notifications", async () => {
      const cancelAllAlarmsSpy = jest.spyOn(
        nativeAlarmService,
        "cancelAllAlarms",
      );
      const cancelAllNotifsSpy = jest.spyOn(
        Notifications,
        "cancelAllScheduledNotificationsAsync",
      );

      await notificationService.cancelAll();

      expect(cancelAllAlarmsSpy).toHaveBeenCalled();
      expect(cancelAllNotifsSpy).toHaveBeenCalled();
    });

    it("useAppStore.resetAllData cancels stale alarms and reconciles newly seeded demo schedules", async () => {
      const cancelAllSpy = jest.spyOn(notificationService, "cancelAll");
      const reconcileSpy = jest.spyOn(
        notificationService,
        "reconcileScheduledReminders",
      );

      await useAppStore.getState().resetAllData();

      expect(cancelAllSpy).toHaveBeenCalled();
      expect(reconcileSpy).toHaveBeenCalled();
    });

    it("useAppStore.clearAllData explicitly cancels all pending OS notifications and alarms", async () => {
      const cancelAllSpy = jest.spyOn(notificationService, "cancelAll");

      await useAppStore.getState().clearAllData();

      expect(cancelAllSpy).toHaveBeenCalled();
    });

    it("useReminderStore.toggleScheduleEnabled(false) cancels alarms for disabled schedule", async () => {
      const cancelForScheduleSpy = jest.spyOn(
        notificationService,
        "cancelForSchedule",
      );

      await useReminderStore
        .getState()
        .toggleScheduleEnabled("test_sched_toggle", false);

      expect(cancelForScheduleSpy).toHaveBeenCalledWith("test_sched_toggle");
    });
  });

  describe("Reconciliation Engine (reconcileScheduledReminders)", () => {
    it("cancels orphaned OS notifications for deleted or non-existent schedules", async () => {
      // Mock existing notifications in OS: one valid, one orphaned
      jest
        .spyOn(Notifications, "getAllScheduledNotificationsAsync")
        .mockResolvedValueOnce([
          {
            identifier: "notif_valid_1",
            content: {
              title: "Valid Dose",
              body: "Take 1 pill",
              data: { scheduleId: "sched_med_1", time: "08:00" },
            } as any,
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DAILY,
            } as any,
          },
          {
            identifier: "notif_orphaned_2",
            content: {
              title: "Ghost Dose",
              body: "Take 2 pills",
              data: { scheduleId: "ghost_deleted_schedule", time: "14:00" },
            } as any,
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DAILY,
            } as any,
          },
        ]);

      // Mock repository: only sched_med_1 is valid and enabled
      jest.spyOn(scheduleRepository, "getAll").mockReturnValue([
        {
          id: "sched_med_1",
          medicineId: "med_1",
          recurrence: "daily",
          startDate: "2026-01-01",
          times: [{ id: "t1", time: "08:00", amount: "1 pill" }],
          enabled: true,
          notificationsEnabled: true,
          createdAt: "2026-01-01",
          updatedAt: "2026-01-01",
        },
      ]);

      jest
        .spyOn(medicineRepository, "getById")
        .mockImplementation((id: string) => {
          if (id === "med_1") {
            return {
              id: "med_1",
              name: "Aspirin",
              strength: "100mg",
              dosageForm: "tablet",
              category: "Pain Relief",
              packageDetails: {},
              createdAt: "2026-01-01",
              updatedAt: "2026-01-01",
            };
          }
          return null;
        });

      const cancelNotifSpy = jest.spyOn(
        Notifications,
        "cancelScheduledNotificationAsync",
      );
      const cancelNativeSpy = jest.spyOn(nativeAlarmService, "cancelAlarm");

      const result = await notificationService.reconcileScheduledReminders();

      expect(result.cancelledStale).toBe(1);
      expect(cancelNotifSpy).toHaveBeenCalledWith("notif_orphaned_2");
      expect(cancelNativeSpy).toHaveBeenCalledWith("ghost_deleted_schedule");
    });

    it("re-schedules missing notifications for active schedules", async () => {
      // No notifications currently scheduled in OS
      jest
        .spyOn(Notifications, "getAllScheduledNotificationsAsync")
        .mockResolvedValueOnce([]);

      jest.spyOn(scheduleRepository, "getAll").mockReturnValue([
        {
          id: "sched_missing_1",
          medicineId: "med_missing_1",
          recurrence: "daily",
          startDate: "2026-01-01",
          times: [{ id: "t2", time: "09:00", amount: "1 capsule" }],
          enabled: true,
          notificationsEnabled: true,
          createdAt: "2026-01-01",
          updatedAt: "2026-01-01",
        },
      ]);

      jest.spyOn(medicineRepository, "getById").mockReturnValue({
        id: "med_missing_1",
        name: "Amoxicillin",
        strength: "500mg",
        dosageForm: "capsule",
        category: "Antibiotic",
        packageDetails: {},
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      });

      const scheduleDoseSpy = jest.spyOn(
        notificationService,
        "scheduleDoseReminder",
      );

      const result = await notificationService.reconcileScheduledReminders();

      expect(result.rescheduled).toBe(1);
      expect(scheduleDoseSpy).toHaveBeenCalledWith(
        "sched_missing_1",
        "Amoxicillin",
        "1 capsule",
        "09:00",
        undefined,
        expect.objectContaining({ recurrence: "daily" }),
      );
    });
  });

  describe("Exact Alarm Permission Fallback", () => {
    it("uses standard channel notifications without alarmClock delivery when allowAlarmClock is false", () => {
      const schedule = {
        recurrence: "daily" as const,
        startDate: "2026-10-26",
      };

      const triggersExact = getNotificationTriggersForDose(
        schedule,
        "10:00",
        new Date(2026, 9, 26, 8, 0),
        true,
      );
      const triggersFallback = getNotificationTriggersForDose(
        schedule,
        "10:00",
        new Date(2026, 9, 26, 8, 0),
        false,
      );

      expect(triggersExact.length).toBeGreaterThan(0);
      expect(triggersFallback.length).toBeGreaterThan(0);

      // Exact trigger on Android has delivery: 'alarmClock'
      expect((triggersExact[0] as any).delivery).toBe("alarmClock");
      // Fallback trigger does NOT have delivery: 'alarmClock'
      expect((triggersFallback[0] as any).delivery).toBeUndefined();
    });
  });
});
