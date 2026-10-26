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

interface ReminderState {
  doses: ScheduledDose[];
  daySummary: DayAdherenceSummary | null;
  loadDosesForDate: (date: string) => void;
  markDoseStatus: (
    dose: ScheduledDose,
    status: DoseStatus,
    targetDate: string,
  ) => void;
  saveSchedule: (schedule: ReminderSchedule) => Promise<boolean>;
  deleteSchedule: (scheduleId: string) => Promise<void>;
  toggleScheduleEnabled: (
    scheduleId: string,
    enabled: boolean,
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

  saveSchedule: async (schedule) => {
    // Cancel old triggers before replacing a schedule to avoid duplicates or stale times.
    await notificationService.cancelForSchedule(schedule.id);
    scheduleRepository.save(schedule);

    if (!schedule.enabled || !schedule.notificationsEnabled) return true;

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
        // Never leave a schedule marked as notification-enabled when one or more
        // alarms failed. Roll back any partially scheduled notifications.
        await notificationService.cancelForSchedule(schedule.id);
        scheduleRepository.save({ ...schedule, notificationsEnabled: false });
        return false;
      }
      scheduledIds.push(identifier);
    }

    return scheduledIds.length === schedule.times.length;
  },

  deleteSchedule: async (scheduleId) => {
    await notificationService.cancelForSchedule(scheduleId);
    scheduleRepository.delete(scheduleId);
  },

  toggleScheduleEnabled: async (scheduleId, enabled) => {
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
  },
}));
