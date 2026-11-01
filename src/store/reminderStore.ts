import { create } from 'zustand';
import { Platform } from 'react-native';
import { ScheduledDose, DoseStatus, DayAdherenceSummary, ReminderSchedule } from '../types';
import { adherenceRepository } from '../database/repositories/adherenceRepository';
import { scheduleRepository } from '../database/repositories/scheduleRepository';
import { medicineRepository } from '../database/repositories/medicineRepository';
import { notificationService } from '../services/notificationService';
import { nativeAlarmService } from '../services/nativeAlarmService';
import { getTodayDateString } from '../database/seed';

/**
 * Named, user-facing reasons a schedule could not arm its alarms.
 * `notification_permission`: OS notification permission is denied.
 * `exact_alarm`: Android exact-alarm ("Alarms & reminders") access is denied.
 * `full_screen_intent`: Android cannot open the alarm UI automatically.
 * `internal`: permission state looks fine, but scheduling still failed
 *   (runtime, storage or network failure inside the scheduling path).
 */
export type ScheduleAlarmFailure =
  | 'notification_permission'
  | 'exact_alarm'
  | 'full_screen_intent'
  | 'internal';

export interface ScheduleSaveResult {
  /** The schedule row (and the visible date refresh) persisted successfully. */
  saved: boolean;
  /** Present only when at least one dose alarm could not be scheduled. */
  alarmFailure?: ScheduleAlarmFailure;
}

export interface ScheduleArmResult {
  armed: boolean;
  alarmFailure?: ScheduleAlarmFailure;
}

/**
 * Shared schedule-arming routine used by saveSchedule, edit, and toggleScheduleEnabled.
 * Checks all dose scheduling results concurrently, cancels partial alarms on any failure,
 * updates notificationsEnabled to false if arming failed, and diagnoses the reason.
 */
export async function armScheduleAlarms(
  schedule: ReminderSchedule,
): Promise<ScheduleArmResult> {
  if (!schedule.enabled || !schedule.notificationsEnabled) {
    return { armed: true };
  }

  const medicine = medicineRepository.getById(schedule.medicineId);
  const medicineName = medicine?.name ?? 'Medicine';

  // Schedule dose chains concurrently; each native chain is keyed by scheduleId + time
  const scheduledIds = await Promise.all(
    schedule.times.map((dose) =>
      notificationService.scheduleDoseReminder(
        schedule.id,
        medicineName,
        dose.amount,
        dose.time,
        dose.label,
        {
          recurrence: schedule.recurrence,
          daysOfWeek: schedule.daysOfWeek,
          startDate: schedule.startDate,
          endDate: schedule.endDate,
        },
      ),
    ),
  );

  if (scheduledIds.some((identifier) => !identifier)) {
    // Partial failure: cancel any partial OS/native alarms so state is not inconsistent
    await notificationService.cancelForSchedule(schedule.id);
    scheduleRepository.save({ ...schedule, notificationsEnabled: false });

    // Classify WHY scheduling failed (notificationPermission vs exactAlarm vs internal)
    const diagnosis = await notificationService.diagnoseAlarmAccess();
    const alarmFailure: ScheduleAlarmFailure = !diagnosis.notificationPermission
      ? 'notification_permission'
      : !diagnosis.exactAlarm
        ? 'exact_alarm'
        : !diagnosis.fullScreenIntent
          ? 'full_screen_intent'
          : 'internal';
    return { armed: false, alarmFailure };
  }

  return { armed: true };
}

interface ReminderState {
  doses: ScheduledDose[];
  daySummary: DayAdherenceSummary | null;
  loadDosesForDate: (date: string) => void;
  markDoseStatus: (dose: ScheduledDose, status: DoseStatus, targetDate: string) => void;
  saveSchedule: (schedule: ReminderSchedule, refreshDate?: string) => Promise<ScheduleSaveResult>;
  deleteSchedule: (scheduleId: string, refreshDate?: string) => Promise<void>;
  toggleScheduleEnabled: (
    scheduleId: string,
    enabled: boolean,
    refreshDate?: string,
  ) => Promise<ScheduleArmResult>;
}

export const useReminderStore = create<ReminderState>((set, get) => ({
  doses: [],
  daySummary: null,

  loadDosesForDate: (date: string) => {
    const doses = adherenceRepository.getDosesForDate(date);
    const daySummary = adherenceRepository.getDayAdherenceSummary(date);
    set({ doses, daySummary });
  },

  markDoseStatus: (dose, status, targetDate) => {
    adherenceRepository.logDoseStatus(
      dose.scheduleId,
      dose.medicineId,
      dose.date,
      dose.time,
      status,
    );
    if (status === 'taken' && Platform.OS === 'android') {
      nativeAlarmService.cancelSnoozesForSchedule(dose.scheduleId).catch(() => {});
    }
    get().loadDosesForDate(targetDate);
  },

  saveSchedule: async (schedule, refreshDate = schedule.startDate || getTodayDateString()) => {
    // Persist schedule changes first
    await notificationService.cancelForSchedule(schedule.id);
    scheduleRepository.save(schedule);

    const refreshVisibleDate = () => get().loadDosesForDate(refreshDate);

    const armResult = await armScheduleAlarms(schedule);
    refreshVisibleDate();

    if (!armResult.armed) {
      return { saved: true, alarmFailure: armResult.alarmFailure };
    }
    return { saved: true };
  },

  deleteSchedule: async (scheduleId, refreshDate = getTodayDateString()) => {
    await notificationService.cancelForSchedule(scheduleId);
    scheduleRepository.delete(scheduleId);
    get().loadDosesForDate(refreshDate);
  },

  toggleScheduleEnabled: async (scheduleId, enabled, refreshDate = getTodayDateString()) => {
    scheduleRepository.toggleEnabled(scheduleId, enabled);
    const refreshVisibleDate = () => get().loadDosesForDate(refreshDate);

    if (!enabled) {
      await notificationService.cancelForSchedule(scheduleId);
      refreshVisibleDate();
      return { armed: true };
    }

    const schedule = scheduleRepository.getById(scheduleId);
    if (!schedule) {
      refreshVisibleDate();
      return { armed: false };
    }

    const armResult = await armScheduleAlarms(schedule);
    refreshVisibleDate();
    return armResult;
  },
}));
