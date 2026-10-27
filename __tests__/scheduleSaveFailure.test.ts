import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import * as Notifications from "expo-notifications";
import { medicineRepository } from "../src/database/repositories/medicineRepository";
import { scheduleRepository } from "../src/database/repositories/scheduleRepository";
import { notificationService } from "../src/services/notificationService";
import { useReminderStore } from "../src/store/reminderStore";
import { Medicine, ReminderSchedule } from "../src/types";

const MEDICINE_ID = "med_save_failure";
const SCHEDULE_ID = "sched_save_failure";

function makeMedicine(): Medicine {
  return {
    id: MEDICINE_ID,
    name: "Save Failure Medicine",
    strength: "10 mg",
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
    startDate: "2026-10-20", // started in the past: next trigger is later today/tomorrow
    times: [{ id: "t_evening", time: "23:30", amount: "1 tablet" }],
    enabled: true,
    notificationsEnabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const mockAny = Notifications as any;

function mockPermissions(
  granted: boolean,
  exactAlarmGranted: boolean = true,
): void {
  // Set implementations explicitly (never rely on spy/restore semantics —
  // the factory-owned jest.fn mocks must be addressed directly).
  mockAny.getPermissionsAsync.mockResolvedValue({
    granted,
    status: granted ? "granted" : "denied",
    ios: undefined,
    android: {},
    canAskAgain: true,
  });
  mockAny.getExactAlarmPermissionsAsync.mockResolvedValue({
    granted: exactAlarmGranted,
    status: exactAlarmGranted ? "granted" : "denied",
  });
}

describe("saveSchedule failure classification", () => {
  beforeEach(() => {
    (Notifications as any).__clearScheduledNotifications();
    medicineRepository.create(makeMedicine());
  });

  afterEach(async () => {
    await notificationService.cancelAll();
    scheduleRepository.delete(SCHEDULE_ID);
    medicineRepository.delete(MEDICINE_ID);
    (Notifications as any).__clearScheduledNotifications();
  });

  it("reports notification_permission when OS notification access is denied", async () => {
    mockPermissions(false);

    const result = await useReminderStore.getState().saveSchedule(makeSchedule());

    expect(result.saved).toBe(true);
    expect(result.alarmFailure).toBe("notification_permission");

    // The schedule must never stay notification-enabled with no armed alarms.
    const saved = scheduleRepository.getById(SCHEDULE_ID);
    expect(saved?.notificationsEnabled).toBe(false);
    expect(await Notifications.getAllScheduledNotificationsAsync()).toHaveLength(0);
  });

  it("reports exact_alarm when notification permission is granted but exact alarms are denied", async () => {
    mockPermissions(true, false);

    const result = await useReminderStore.getState().saveSchedule(makeSchedule());

    expect(result.saved).toBe(true);
    expect(result.alarmFailure).toBe("exact_alarm");
    expect(await Notifications.getAllScheduledNotificationsAsync()).toHaveLength(0);
  });

  it("returns success with no failure reason when every alarm schedules", async () => {
    mockPermissions(true, true); // both granted explicitly

    const result = await useReminderStore.getState().saveSchedule(makeSchedule());

    expect(result.saved).toBe(true);
    expect(result.alarmFailure).toBeUndefined();

    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    expect(
      scheduled.filter((n) => n.content.data?.scheduleId === SCHEDULE_ID).length,
    ).toBeGreaterThan(0);

    expect(scheduleRepository.getById(SCHEDULE_ID)?.notificationsEnabled).toBe(
      true,
    );
  });
});
