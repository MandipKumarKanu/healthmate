import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import * as Notifications from "expo-notifications";
import { resetDatabase } from "../src/database/client";
import { medicineRepository } from "../src/database/repositories/medicineRepository";
import { scheduleRepository } from "../src/database/repositories/scheduleRepository";
import { notificationService } from "../src/services/notificationService";
import type { Medicine, ReminderSchedule } from "../src/types";

const MEDICINE_ID = "med_identity_diff";
const SCHEDULE_ID = "sched_identity_diff";
const DOSE_TIME = "08:00";

function makeMedicine(name: string): Medicine {
  return {
    id: MEDICINE_ID,
    name,
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
  return {
    id: SCHEDULE_ID,
    medicineId: MEDICINE_ID,
    recurrence: "daily",
    startDate: new Date().toISOString().slice(0, 10),
    times: [{ id: "t1", time: DOSE_TIME, amount: "1 tablet" }],
    enabled: true,
    notificationsEnabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function scheduledForSchedule() {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  return scheduled.filter(
    (n) => n.content.data?.scheduleId === SCHEDULE_ID,
  );
}

async function cancelAll() {
  await notificationService.cancelAll();
}

beforeEach(() => {
  resetDatabase();
  medicineRepository.create(makeMedicine("Renamed Medicine"));
  scheduleRepository.save(makeSchedule());
});

afterEach(async () => {
  await cancelAll();
  jest.restoreAllMocks();
});

describe("reconcile diff-based identity", () => {
  it("replaces an OS notification whose stored identity no longer matches", async () => {
    // Seed an OS notification carrying a stale identity (old medicine name and
    // an amount that no longer matches the DB dose). Its trigger sits at the
    // required horizon (today + 60 for daily) so the window-extension
    // logic does NOT fire — replacement must come from the identity diff alone.
    const horizon = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    horizon.setHours(8, 0, 0, 0);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Time to take Old Medicine",
        body: "Scheduled dose: 9 tablets",
        data: {
          scheduleId: SCHEDULE_ID,
          time: DOSE_TIME,
          medicineName: "Old Medicine",
          amount: "9 tablets",
          doseLabel: "",
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: horizon,
      },
    });

    const result = await notificationService.reconcileScheduledReminders();

    expect(result.rescheduled).toBeGreaterThanOrEqual(1);

    const remaining = await scheduledForSchedule();
    expect(remaining.length).toBeGreaterThanOrEqual(1);
    const hasStale = remaining.some(
      (n) => n.content.data?.amount === "9 tablets",
    );
    expect(hasStale).toBe(false);
    const hasFresh = remaining.some(
      (n) =>
        n.content.data?.amount === "1 tablet" &&
        n.content.data?.medicineName === "Renamed Medicine",
    );
    expect(hasFresh).toBe(true);
  });

  it("leaves notifications alone when the stored identity matches", async () => {
    const id = await notificationService.scheduleDoseReminder(
      SCHEDULE_ID,
      "Renamed Medicine",
      "1 tablet",
      DOSE_TIME,
      undefined,
      {
        recurrence: "daily",
        startDate: new Date().toISOString().slice(0, 10),
      },
    );
    expect(id).toBeTruthy();

    const before = await scheduledForSchedule();
    expect(before.length).toBeGreaterThan(0);

    const result = await notificationService.reconcileScheduledReminders();

    // No churn: nothing rescheduled, nothing cancelled.
    expect(result.rescheduled).toBe(0);
    expect(result.cancelledStale).toBe(0);
    const after = await scheduledForSchedule();
    expect(after.length).toBe(before.length);
  });

  it("leaves legacy notifications without identity fields untouched", async () => {
    // Pre-reconcile notifications carry only scheduleId/time — no mismatch possible.
    // The trigger sits at the required horizon so the window-extension logic
    // also stays quiet: any rescheduling would come from a false
    // identity mismatch.
    const horizon = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    horizon.setHours(8, 0, 0, 0);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Time to take Renamed Medicine",
        body: "Scheduled dose: 1 tablet",
        data: { scheduleId: SCHEDULE_ID, time: DOSE_TIME },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: horizon,
      },
    });

    const result = await notificationService.reconcileScheduledReminders();

    // Coverage exists, so nothing is missing; without amount/label there is no
    // identity to diff against, so no replacement happens.
    expect(result.rescheduled).toBe(0);
    expect(await scheduledForSchedule()).toHaveLength(1);
  });

  it("coalesces concurrent reconcile calls into a single pass", async () => {
    const getAllSpy = jest
      .spyOn(Notifications, "getAllScheduledNotificationsAsync")
      .mockResolvedValue([]);
    // The mock module reuses one jest.fn across the file, so earlier tests'
    // calls are already in its history — start counting from zero here.
    getAllSpy.mockClear();

    const [first, second] = await Promise.all([
      notificationService.reconcileScheduledReminders(),
      notificationService.reconcileScheduledReminders(),
    ]);

    // Both callers observe the same single pass over the OS list.
    expect(getAllSpy).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);

    // Once settled, a later call starts a fresh pass (no stale cache).
    getAllSpy.mockClear();
    await notificationService.reconcileScheduledReminders();
    expect(getAllSpy).toHaveBeenCalledTimes(1);
  });
});