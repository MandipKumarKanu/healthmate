import { create } from "zustand";
import {
  ScheduledDose,
  DoseStatus,
  DayAdherenceSummary,
  ReminderSchedule,
} from "../types";
import { adherenceRepository } from "../database/repositories/adherenceRepository";
import { scheduleRepository } from "../database/repositories/scheduleRepository";
import { medicineRepository } from "../database/repositories/medicineRepository";
import { notificationService } from "../services/notificationService";
import { getTodayDateString } from "../database/seed";

interface ReminderState {
  doses: ScheduledDose[];
  daySummary: DayAdherenceSummary | null;
  loadDosesForDate: (date: string) => void;
  markDoseStatus: (
    dose: ScheduledDose,
    status: DoseStatus,
    targetDate: string,
  ) => void;
  saveSchedule: (schedule: ReminderSchedule, refreshDate?: string) => Promise<boolean>;
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
      return true;
    }

    const medicine = medicineRepository.getById(schedule.medicineId);
    const medicineName = medicine?.name ?? "Medicine";
    const scheduledIds: string[] = [];

    for (const dose of schedule.times) {
      const identifier = await notificationService.scheduleDoseReminder(
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

      if (!identifier) {
        // Never leave a schedule marked notification-enabled when only some
        // of its alarms were scheduled. Refresh the UI after the rollback too.
        await notificationService.cancelForSchedule(schedule.id);
        scheduleRepository.save({ ...schedule, notificationsEnabled: false });
        refreshVisibleDate();
        return false;
      }

      scheduledIds.push(identifier);
    }

    refreshVisibleDate();
    return scheduledIds.length === schedule.times.length;
  },

  deleteSchedule: async (scheduleId, refreshDate = getTodayDateString()) => {
    await notificationService.cancelForSchedule(scheduleId);
    scheduleRepository.delete(scheduleId);
    get().loadDosesForDate(refreshDate);
  },

  toggleScheduleEnabled: async (
    scheduleId,
    enabled,
    refreshDate = getTodayDateString(),
  ) => {
    scheduleRepository.toggleEnabled(scheduleId, enabled);
    if (!enabled) {
      await notificationService.cancelForSchedule(scheduleId);
    } else {
      const schedule = scheduleRepository.getById(scheduleId);
      if (schedule && schedule.notificationsEnabled) {
        const medicine = medicineRepository.getById(schedule.medicineId);
        const medicineName = medicine?.name ?? "Medicine";
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
