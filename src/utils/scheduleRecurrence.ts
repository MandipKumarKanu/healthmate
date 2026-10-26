import { ReminderSchedule } from "../types";

/**
 * Parses a YYYY-MM-DD date string into [year, month, day] numeric tuple.
 * Validates that the date actually exists on the calendar (e.g. 2026-02-29 returns null in non-leap years).
 */
export function parseDateParts(value: string): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const parts: [number, number, number] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ];
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  if (
    date.getUTCFullYear() !== parts[0] ||
    date.getUTCMonth() !== parts[1] - 1 ||
    date.getUTCDate() !== parts[2]
  ) {
    return null;
  }
  return parts;
}

/**
 * Formats numeric year, month (1-12), and day into a YYYY-MM-DD string.
 */
export function formatDateParts(
  year: number,
  month: number,
  day: number,
): string {
  return [
    year,
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

/**
 * Returns today's date formatted as YYYY-MM-DD.
 */
export function getTodayDateString(now: Date = new Date()): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Returns the date string immediately preceding the given date (date - 1 day).
 */
export function getPreviousDayString(dateStr: string): string {
  const parts = parseDateParts(dateStr);
  if (!parts) return dateStr;
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] - 1));
  return [
    d.getUTCFullYear(),
    String(d.getUTCMonth() + 1).padStart(2, "0"),
    String(d.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Single, unified recurrence engine used across calendar dots, adherence records,
 * and notification scheduling.
 *
 * Recurrence rules:
 * - "once": only matches the exact startDate
 * - "daily": matches every day from startDate up to endDate (if defined)
 * - "weekly": matches the same day-of-week as startDate
 * - "monthly": matches the day-of-month of startDate, clamping to the last day
 *              for shorter months (e.g. day 31 -> Feb 28/29, Apr 30, Jun 30, etc.)
 */
export function isScheduleDueOnDate(
  schedule: Pick<ReminderSchedule, "recurrence" | "startDate" | "endDate">,
  date: string,
): boolean {
  const target = parseDateParts(date);
  const start = parseDateParts(schedule.startDate);
  if (!target || !start) return false;

  if (
    schedule.endDate &&
    (!parseDateParts(schedule.endDate) || schedule.endDate < schedule.startDate)
  ) {
    return false;
  }

  if (
    date < schedule.startDate ||
    (schedule.endDate && date > schedule.endDate)
  ) {
    return false;
  }

  if (schedule.recurrence === "once") return date === schedule.startDate;
  if (schedule.recurrence === "daily") return true;
  if (schedule.recurrence === "weekly") {
    return (
      new Date(target[0], target[1] - 1, target[2]).getDay() ===
      new Date(start[0], start[1] - 1, start[2]).getDay()
    );
  }
  if (schedule.recurrence === "monthly") {
    const lastDay = new Date(target[0], target[1], 0).getDate();
    return target[2] === Math.min(start[2], lastDay);
  }

  return false;
}

/**
 * Returns whether any active, enabled schedule with doses is due on a given date.
 * Shared directly by CalendarGrid to ensure calendar dots match adherence records 1:1.
 */
export function hasReminderForDate(
  schedules: ReminderSchedule[],
  date: string,
): boolean {
  return schedules.some(
    (schedule) =>
      schedule.enabled &&
      schedule.times.length > 0 &&
      isScheduleDueOnDate(schedule, date),
  );
}

/**
 * Decides what tapping a calendar date should do:
 * - "select" when reminders exist on that date: select it in place and show only
 *   that date's doses, without navigating away.
 * - "openCreate" when the date has no reminders: open Add Reminder with the
 *   date prefilled so the user can schedule straight into it.
 */
export function getDateTapAction(
  schedules: ReminderSchedule[],
  date: string,
): "select" | "openCreate" {
  return hasReminderForDate(schedules, date) ? "select" : "openCreate";
}

/**
 * Formats the schedule section header title:
 * - If selectedDate is today: "Today's Schedule"
 * - If selectedDate is not today: "Schedule for <Month> <Day>" (e.g. "Schedule for Oct 29")
 */
export function formatScheduleDateLabel(
  dateStr: string,
  todayStr?: string,
): string {
  const effectiveToday = todayStr ?? getTodayDateString();

  if (dateStr === effectiveToday) {
    return "Today's Schedule";
  }

  const parts = parseDateParts(dateStr);
  if (!parts) return "Schedule";

  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const formatted = d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return `Schedule for ${formatted}`;
}
