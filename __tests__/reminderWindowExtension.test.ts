import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import * as Notifications from "expo-notifications";
import {
  getRequiredCoverageThroughDate,
  getTriggerCoveredThroughDate,
  notificationService,
} from "../src/services/notificationService";
import { medicineRepository } from "../src/database/repositories/medicineRepository";
import { scheduleRepository } from "../src/database/repositories/scheduleRepository";
import { Medicine, ReminderSchedule, ReminderTime } from "../src/types";

const FIXED_NOW = new Date(2026, 9, 27, 10, 0, 0); // Oct 27 2026, 10:00

function dateStr(offsetDays: number, base: Date = FIXED_NOW): string {
  const d = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() + offsetDays,
  );
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

describe("Notification trigger-window extension (cap fix)", () => {
  describe("getRequiredCoverageThroughDate", () => {
    it("uses the recurrence window cap for unbounded schedules", () => {
      expect(
        getRequiredCoverageThroughDate("daily", undefined, FIXED_NOW),
      ).toBe(dateStr(60));
      expect(
        getRequiredCoverageThroughDate("weekly", undefined, FIXED_NOW),
      ).toBe(dateStr(364));
      expect(
        getRequiredCoverageThroughDate("monthly", undefined, FIXED_NOW),
      ).toBe(dateStr(729));
    });

    it("clamps to endDate when it lies inside the window cap", () => {
      expect(
        getRequiredCoverageThroughDate("daily", dateStr(45), FIXED_NOW),
      ).toBe(dateStr(45));
    });

    it("uses the window cap when endDate lies beyond it (long bounded schedule)", () => {
      expect(
        getRequiredCoverageThroughDate("daily", dateStr(90), FIXED_NOW),
      ).toBe(dateStr(60));
    });

    it("returns null for once doses and for schedules that are already over", () => {
      expect(getRequiredCoverageThroughDate("once", dateStr(90), FIXED_NOW)).toBe(
        null,
      );
      expect(
        getRequiredCoverageThroughDate("daily", dateStr(-1), FIXED_NOW),
      ).toBe(null);
    });
  });

  describe("getTriggerCoveredThroughDate", () => {
    it("maps a one-shot DATE trigger (Date object) to its date string", () => {
      const covered = getTriggerCoveredThroughDate({
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(2026, 10, 15, 8, 0),
      });
      expect(covered).toBe("2026-11-15");
    });

    it("maps expo-normalized DATE triggers (epoch seconds) to a date string", () => {
      const seconds = Math.floor(
        new Date(2026, 10, 15, 8, 0).getTime() / 1000,
      );
      const covered = getTriggerCoveredThroughDate({
        type: "date",
        timestamp: seconds,
      });
      expect(covered).toBe("2026-11-15");
    });

    it("tells repeating triggers apart: they are covered forever", () => {
      expect(
        getTriggerCoveredThroughDate({
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: 8,
          minute: 0,
        }),
      ).toBe("forever");
      expect(
        getTriggerCoveredThroughDate({
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday: 2,
          hour: 8,
          minute: 0,
        }),
      ).toBe("forever");
      expect(getTriggerCoveredThroughDate({ repeats: true })).toBe("forever");
    });

    it("returns null for unusable trigger shapes so the dose gets re-armed", () => {
      expect(getTriggerCoveredThroughDate(null)).toBe(null);
      expect(getTriggerCoveredThroughDate({})).toBe(null);
    });
  });

  describe("reconcileScheduledReminders extension behavior", () => {
    const MEDICINE_ID = "med_cap_extension";
    const SCHEDULE_ID = "sched_cap_extension";

    // Integration tests exercise scheduleDoseReminder + reconcile, which both
    // use the real current time — derive all dates from it.
    const now = new Date();

    function makeMedicine(): Medicine {
      return {
        id: MEDICINE_ID,
        name: "Cap Extension Test Medicine",
        strength: "500 mg",
        dosageForm: "tablet",
        category: "Generic",
        packageDetails: {},
        isSample: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    function makeSchedule(): ReminderSchedule {
      // A daily schedule bounded 90 days out: the initial window is capped at
      // 60 occurrences (min(endDate, today + 60)).
      const time: ReminderTime = {
        id: "t_cap",
        time: "23:30",
        amount: "1 tablet",
      };
      return {
        id: SCHEDULE_ID,
        medicineId: MEDICINE_ID,
        recurrence: "daily",
        startDate: dateStr(0, now),
        endDate: dateStr(90, now),
        times: [time],
        enabled: true,
        notificationsEnabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    async function scheduleCountForSchedule(): Promise<number> {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      return scheduled.filter(
        (n) => n.content.data?.scheduleId === SCHEDULE_ID,
      ).length;
    }

    async function coveredDatesForSchedule(): Promise<string[]> {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      const dates: string[] = [];
      for (const n of scheduled) {
        if (n.content.data?.scheduleId !== SCHEDULE_ID) continue;
        const covered = getTriggerCoveredThroughDate((n as any).trigger);
        if (typeof covered === "string") dates.push(covered);
      }
      return dates.sort();
    }

    function addDays(dateStr_: string, days: number): string {
      const [y, m, d] = dateStr_.split("-").map(Number);
      const out = new Date(y!, m! - 1, d! + days);
      return [
        out.getFullYear(),
        String(out.getMonth() + 1).padStart(2, "0"),
        String(out.getDate()).padStart(2, "0"),
      ].join("-");
    }

    beforeEach(async () => {
      (Notifications as any).__clearScheduledNotifications();
      medicineRepository.create(makeMedicine());
      scheduleRepository.save(makeSchedule());
    });

    afterEach(async () => {
      await notificationService.cancelAll();
      scheduleRepository.delete(SCHEDULE_ID);
      medicineRepository.delete(MEDICINE_ID);
      (Notifications as any).__clearScheduledNotifications();
    });

    it("extends a running-out bounded window during reconcile", async () => {
      const id = await notificationService.scheduleDoseReminder(
        SCHEDULE_ID,
        "Cap Extension Test Medicine",
        "1 tablet",
        "23:30",
        undefined,
        { recurrence: "daily", startDate: dateStr(0, now), endDate: dateStr(90, now) },
      );
      expect(id).toBeTruthy();
      expect(await scheduleCountForSchedule()).toBe(60); // capped at 60 occurrences

      // Simulate an aged window: cancel everything, then leave only 4 one-shot
      // DATE triggers for the same dose within the next 4 days.
      (Notifications as any).__clearScheduledNotifications();
      for (let i = 1; i <= 4; i++) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: "Time to take Cap Extension Test Medicine",
            body: "Scheduled dose: 1 tablet",
            data: { scheduleId: SCHEDULE_ID, time: "23:30" },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: new Date(
              now.getFullYear(),
              now.getMonth(),
              now.getDate() + i,
              23,
              30,
            ),
          },
        });
      }
      expect(await scheduleCountForSchedule()).toBe(4);

      const result = await notificationService.reconcileScheduledReminders();

      // The old window ends at day 4 (far inside the 30-day extension margin)
      // while the schedule requires coverage through min(endDate, cap) = day
      // 60, so reconcile must re-arm the full expired window.
      expect(result.rescheduled).toBeGreaterThanOrEqual(1);

      // The fresh window must be full: 60 consecutive daily DATE triggers
      // starting from its first occurrence (today if the dose time is still
      // ahead of the clock, tomorrow otherwise).
      const dates = await coveredDatesForSchedule();
      expect(dates).toHaveLength(60);
      expect(dates[dates.length - 1]).toBe(addDays(dates[0], 59));
    });

    it("does not re-extend an already-full window (idempotent reconcile)", async () => {
      const id = await notificationService.scheduleDoseReminder(
        SCHEDULE_ID,
        "Cap Extension Test Medicine",
        "1 tablet",
        "23:30",
        undefined,
        { recurrence: "daily", startDate: dateStr(0, now), endDate: dateStr(90, now) },
      );
      expect(id).toBeTruthy();

      const first = await notificationService.reconcileScheduledReminders();
      expect(first.rescheduled).toBe(0); // window already reaches the horizon

      const second = await notificationService.reconcileScheduledReminders();
      expect(second.rescheduled).toBe(0);
      expect(await scheduleCountForSchedule()).toBe(60);
    });

    it("leaves repeating (native DAILY) triggers untouched", async () => {
      // Unbounded started daily schedule -> native repeating DAILY trigger.
      const id = await notificationService.scheduleDoseReminder(
        SCHEDULE_ID,
        "Cap Extension Test Medicine",
        "1 tablet",
        "23:30",
        undefined,
        { recurrence: "daily", startDate: dateStr(0, now) },
      );
      expect(id).toBeTruthy();

      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      expect(scheduled).toHaveLength(1);
      expect((scheduled[0] as any).trigger.type).toBe(
        Notifications.SchedulableTriggerInputTypes.DAILY,
      );

      const result = await notificationService.reconcileScheduledReminders();
      expect(result.rescheduled).toBe(0);

      const after = await Notifications.getAllScheduledNotificationsAsync();
      expect(after).toHaveLength(1); // no duplicate churn
      expect((after[0] as any).trigger.type).toBe(
        Notifications.SchedulableTriggerInputTypes.DAILY,
      );
    });
  });
});
