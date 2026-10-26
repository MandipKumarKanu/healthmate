import { describe, expect, it } from "@jest/globals";
import {
  parseDateParts,
  isScheduleDueOnDate,
  hasReminderForDate,
  formatScheduleDateLabel,
} from "../src/utils/scheduleRecurrence";
import { ReminderSchedule } from "../src/types";

describe("Shared Recurrence & Calendar Consistency", () => {
  describe("parseDateParts", () => {
    it("parses valid dates correctly", () => {
      expect(parseDateParts("2026-10-26")).toEqual([2026, 10, 26]);
      expect(parseDateParts("2028-02-29")).toEqual([2028, 2, 29]); // leap year
    });

    it("rejects invalid or non-existent calendar dates", () => {
      expect(parseDateParts("2026-02-29")).toBeNull(); // 2026 is not leap
      expect(parseDateParts("2026-04-31")).toBeNull(); // April has 30 days
      expect(parseDateParts("invalid-date")).toBeNull();
    });
  });

  describe("isScheduleDueOnDate", () => {
    it("matches one-time schedule only on its exact start date", () => {
      const schedule: Pick<
        ReminderSchedule,
        "recurrence" | "startDate" | "endDate"
      > = {
        recurrence: "once",
        startDate: "2026-10-28",
      };
      expect(isScheduleDueOnDate(schedule, "2026-10-27")).toBe(false);
      expect(isScheduleDueOnDate(schedule, "2026-10-28")).toBe(true);
      expect(isScheduleDueOnDate(schedule, "2026-10-29")).toBe(false);
    });

    it("matches weekly schedule on matching weekdays within bounds", () => {
      // 2026-10-26 is Monday
      const schedule: Pick<
        ReminderSchedule,
        "recurrence" | "startDate" | "endDate"
      > = {
        recurrence: "weekly",
        startDate: "2026-10-26",
        endDate: "2026-11-09",
      };
      expect(isScheduleDueOnDate(schedule, "2026-10-26")).toBe(true); // Monday 1
      expect(isScheduleDueOnDate(schedule, "2026-10-27")).toBe(false); // Tuesday
      expect(isScheduleDueOnDate(schedule, "2026-11-02")).toBe(true); // Monday 2
      expect(isScheduleDueOnDate(schedule, "2026-11-09")).toBe(true); // Monday 3
      expect(isScheduleDueOnDate(schedule, "2026-11-16")).toBe(false); // Beyond endDate
    });

    it("matches monthly schedule applying end-of-month clamping rules", () => {
      const schedule: Pick<
        ReminderSchedule,
        "recurrence" | "startDate" | "endDate"
      > = {
        recurrence: "monthly",
        startDate: "2026-01-31",
      };
      // In January (31 days) -> Jan 31
      expect(isScheduleDueOnDate(schedule, "2026-01-31")).toBe(true);
      expect(isScheduleDueOnDate(schedule, "2026-01-30")).toBe(false);

      // In February 2026 (28 days non-leap) -> clamped to Feb 28
      expect(isScheduleDueOnDate(schedule, "2026-02-28")).toBe(true);
      expect(isScheduleDueOnDate(schedule, "2026-02-27")).toBe(false);

      // In March 2026 (31 days) -> Mar 31
      expect(isScheduleDueOnDate(schedule, "2026-03-31")).toBe(true);

      // In April 2026 (30 days) -> clamped to Apr 30
      expect(isScheduleDueOnDate(schedule, "2026-04-30")).toBe(true);
      expect(isScheduleDueOnDate(schedule, "2026-04-29")).toBe(false);
    });

    it("clamps monthly day 31 to Feb 29 in leap years", () => {
      const schedule: Pick<
        ReminderSchedule,
        "recurrence" | "startDate" | "endDate"
      > = {
        recurrence: "monthly",
        startDate: "2028-01-31",
      };
      expect(isScheduleDueOnDate(schedule, "2028-02-29")).toBe(true);
      expect(isScheduleDueOnDate(schedule, "2028-02-28")).toBe(false);
    });
  });

  describe("hasReminderForDate (Calendar Dot Consistency)", () => {
    const schedules: ReminderSchedule[] = [
      {
        id: "s1",
        medicineId: "m1",
        recurrence: "monthly",
        startDate: "2026-01-31",
        times: [{ id: "t1", time: "09:00", amount: "1 pill" }],
        enabled: true,
        notificationsEnabled: false, // Even if notifications disabled, it is a scheduled dose!
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
      {
        id: "s2",
        medicineId: "m2",
        recurrence: "weekly",
        startDate: "2026-10-26", // Monday
        times: [{ id: "t2", time: "20:00", amount: "2 drops" }],
        enabled: false, // Disabled schedule should not produce a calendar dot
        notificationsEnabled: false,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    ];

    it("shows calendar dot on clamped month-end date for monthly schedule", () => {
      expect(hasReminderForDate(schedules, "2026-02-28")).toBe(true);
      expect(hasReminderForDate(schedules, "2026-02-27")).toBe(false);
      expect(hasReminderForDate(schedules, "2026-04-30")).toBe(true);
    });

    it("does not show dot for disabled schedule", () => {
      // 2026-11-02 is Monday, but s2 is disabled
      expect(hasReminderForDate([schedules[1]], "2026-11-02")).toBe(false);
    });
  });

  describe("formatScheduleDateLabel", () => {
    it('returns "Today\'s Schedule" when selected date matches today', () => {
      expect(formatScheduleDateLabel("2026-10-26", "2026-10-26")).toBe(
        "Today's Schedule",
      );
    });

    it('returns "Schedule for <Date>" when selected date differs from today', () => {
      expect(formatScheduleDateLabel("2026-10-29", "2026-10-26")).toBe(
        "Schedule for Oct 29",
      );
      expect(formatScheduleDateLabel("2026-11-05", "2026-10-26")).toBe(
        "Schedule for Nov 5",
      );
    });
  });
});
