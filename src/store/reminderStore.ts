import { create } from 'zustand';
import { ScheduledDose, DoseStatus, DayAdherenceSummary, ReminderSchedule } from '../types';
import { adherenceRepository } from '../database/repositories/adherenceRepository';
import { scheduleRepository } from '../database/repositories/scheduleRepository';
import { medicineRepository } from '../database/repositories/medicineRepository';
import { notificationService } from '../services/notificationService';
import { getTodayDateString } from '../database/seed';

/**
 * Named, user-facing reasons a schedule could not arm its alarms.
 * `notification_permission`: OS notification permission is denied.
 * `exact_alarm`: Android exact-alarm ("Alarms & reminders") access is denied.
 * `internal`: permission state looks fine, but scheduling still failed
 *   (runtime, storage or network failure inside the scheduling path).
 */
export type ScheduleAlarmFailure = 'notification_permission' | 'exact_alarm' | 'internal';

export interface ScheduleSaveResult {
  /** The schedule row (and the visible date refresh) persisted successfully. */
  saved: boolean;
  /** Present only when at least one dose alarm could not be scheduled. */
  alarmFailure?: ScheduleAlarmFailure;
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
  ) => Promise<void>;
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
    get().loadDosesForDate(targetDate);
  },

  saveSchedule: async (schedule, refreshDate = schedule.startDate || getTodayDateString()) => {
    // Persist first, then refresh the visible date even when alarms are disabled
    // or Android refuses to schedule one of the notifications.
    await notificationService.cancelForSchedule(schedule.id);
    scheduleRepository.save(schedule);

    const refreshVisibleDate = () => get().loadDosesForDate(refreshDate);

    if (!schedule.enabled || !schedule.notificationsEnabled) {
      refreshVisibleDate();
      return { saved: true };
    }

    const medicine = medicineRepository.getById(schedule.medicineId);
    const medicineName = medicine?.name ?? 'Medicine';

    // A schedule can contain multiple dose times. Schedule those dose chains
    // concurrently; each native chain is keyed by scheduleId + time, and each
    // trigger list is internally batched by notificationService.
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
            startDate: schedule.startDate,
            endDate: schedule.endDate,
          },
        ),
      ),
    );

    if (scheduledIds.some((identifier) => !identifier)) {
      // Never leave a schedule marked notification-enabled when only some
      // of its alarms were scheduled. Cancel any partial OS/native work.
      await notificationService.cancelForSchedule(schedule.id);
      scheduleRepository.save({ ...schedule, notificationsEnabled: false });
      refreshVisibleDate();

      // Classify WHY scheduling failed so screens can show a named
      // reason (permission loss vs exact-alarm denial vs internal error).
      const diagnosis = await notificationService.diagnoseAlarmAccess();
      const alarmFailure: ScheduleAlarmFailure = !diagnosis.notificationPermission
        ? 'notification_permission'
        : !diagnosis.exactAlarm
          ? 'exact_alarm'
          : 'internal';
      return { saved: true, alarmFailure };
    }

    refreshVisibleDate();
    return { saved: true };
  },

  deleteSchedule: async (scheduleId, refreshDate = getTodayDateString()) => {
    await notificationService.cancelForSchedule(scheduleId);
    scheduleRepository.delete(scheduleId);
    get().loadDosesForDate(refreshDate);
  },

  toggleScheduleEnabled: async (scheduleId, enabled, refreshDate = getTodayDateString()) => {
    scheduleRepository.toggleEnabled(scheduleId, enabled);
    if (!enabled) {
      await notificationService.cancelForSchedule(scheduleId);
    } else {
      const schedule = scheduleRepository.getById(scheduleId);
      if (schedule && schedule.notificationsEnabled) {
        const medicine = medicineRepository.getById(schedule.medicineId);
        const medicineName = medicine?.name ?? 'Medicine';
        for (const dose of schedule.times) {
          await notificationService.scheduleDoseReminder(
            schedule.id,
            medicineName,
            dose.amount,
            dose.time,
            dose.label,
            {
              recurrence: schedule.recurrence,
              startDate: schedule.startDate,
              endDate: schedule.endDate,
            },
          );
        }
      }
    }
    get().loadDosesForDate(refreshDate);
  },
}));
