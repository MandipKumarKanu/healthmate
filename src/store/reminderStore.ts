import { create } from 'zustand';
import { ScheduledDose, DoseStatus, DayAdherenceSummary, ReminderSchedule } from '../types';
import { adherenceRepository } from '../database/repositories/adherenceRepository';
import { scheduleRepository } from '../database/repositories/scheduleRepository';
import { medicineRepository } from '../database/repositories/medicineRepository';
import { notificationService } from '../services/notificationService';

interface ReminderState {
  doses: ScheduledDose[];
  daySummary: DayAdherenceSummary | null;
  loadDosesForDate: (date: string) => void;
  markDoseStatus: (
    dose: ScheduledDose,
    status: DoseStatus,
    targetDate: string
  ) => void;
  saveSchedule: (schedule: ReminderSchedule) => Promise<void>;
  deleteSchedule: (scheduleId: string) => Promise<void>;
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
      status
    );
    get().loadDosesForDate(targetDate);
  },

  saveSchedule: async (schedule) => {
    // Cancel existing triggers before replacing a schedule to avoid duplicates
    // or stale times after an edit.
    await notificationService.cancelForSchedule(schedule.id);
    scheduleRepository.save(schedule);

    if (schedule.enabled && schedule.notificationsEnabled) {
      const medicine = medicineRepository.getById(schedule.medicineId);
      const medicineName = medicine?.name ?? 'Medicine';
      for (const t of schedule.times) {
        await notificationService.scheduleDoseReminder(
          schedule.id,
          medicineName,
          t.amount,
          t.time,
          t.label
        );
      }
    }
  },

  deleteSchedule: async (scheduleId) => {
    await notificationService.cancelForSchedule(scheduleId);
    scheduleRepository.delete(scheduleId);
  },
}));
