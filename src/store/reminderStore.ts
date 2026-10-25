import { create } from 'zustand';
import { ScheduledDose, DoseStatus, DayAdherenceSummary, ReminderSchedule } from '../types';
import { adherenceRepository } from '../database/repositories/adherenceRepository';
import { scheduleRepository } from '../database/repositories/scheduleRepository';
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
    scheduleRepository.save(schedule);
    // Schedule notification if enabled
    if (schedule.enabled && schedule.notificationsEnabled) {
      for (const t of schedule.times) {
        await notificationService.scheduleDoseReminder(
          schedule.id,
          'Medicine',
          t.amount,
          t.time
        );
      }
    }
  },

  deleteSchedule: async (scheduleId) => {
    scheduleRepository.delete(scheduleId);
  },
}));
