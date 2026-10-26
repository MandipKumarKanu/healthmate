import { create } from "zustand";
import { UserProfile, UserPreferences } from "../types";
import { profileRepository } from "../database/repositories/profileRepository";
import { seedInitialDataIfNeeded, getTodayDateString } from "../database/seed";
import { resetDatabase } from "../database/client";
import { notificationService } from "../services/notificationService";
import { useMedicineStore } from "./medicineStore";
import { useReminderStore } from "./reminderStore";

interface AppState {
  profile: UserProfile | null;
  preferences: UserPreferences;
  selectedDate: string; // YYYY-MM-DD
  isInitialized: boolean;
  initApp: () => void;
  setProfileName: (name: string, onboardingCompleted?: boolean) => void;
  updateProfile: (
    name: string,
    details?: {
      email?: string;
      age?: number;
      gender?: string;
      height?: number;
      weight?: number;
      unitSystem?: "metric" | "imperial";
    },
    onboardingCompleted?: boolean,
  ) => void;
  completeOnboarding: () => void;
  setOnboardingStep: (step: string) => void;
  setSelectedDate: (date: string) => void;
  togglePreference: (key: keyof UserPreferences) => void;
  resetAllData: () => Promise<void>;
  clearAllData: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  profile: null,
  preferences: {
    inAppReminders: true,
    aiAssistantEnabled: true,
    cameraPermissionsGranted: false,
    notificationsEnabled: true,
    streakCount: 0,
    lastActiveDate: getTodayDateString(),
  },
  selectedDate: getTodayDateString(),
  isInitialized: false,

  initApp: () => {
    seedInitialDataIfNeeded(false);
    const profile = profileRepository.getProfile();
    const preferences = profileRepository.getPreferences();
    set({
      profile,
      preferences,
      selectedDate: getTodayDateString(),
      isInitialized: true,
    });
  },

  setProfileName: (name: string, onboardingCompleted?: boolean) => {
    const existing = get().profile;
    const isCompleted =
      onboardingCompleted !== undefined
        ? onboardingCompleted
        : existing
          ? existing.onboardingCompleted
          : false;
    const updated = profileRepository.saveProfile(name, undefined, isCompleted);
    set({ profile: updated });
  },

  updateProfile: (name, details, onboardingCompleted) => {
    const existing = get().profile;
    const isCompleted =
      onboardingCompleted !== undefined
        ? onboardingCompleted
        : existing
          ? existing.onboardingCompleted
          : false;
    const updated = profileRepository.saveProfile(name, details, isCompleted);
    set({ profile: updated });
  },

  completeOnboarding: () => {
    profileRepository.setOnboardingCompleted(true);
    profileRepository.setOnboardingStep("completed");
    const updated = profileRepository.getProfile();
    set({ profile: updated });
  },

  setOnboardingStep: (step: string) => {
    profileRepository.setOnboardingStep(step);
  },

  setSelectedDate: (date: string) => {
    set({ selectedDate: date });
  },

  togglePreference: (key: keyof UserPreferences) => {
    const current = get().preferences;
    const newVal = !current[key];
    profileRepository.updatePreference(String(key), String(newVal));
    set({
      preferences: {
        ...current,
        [key]: newVal,
      },
    });
  },

  resetAllData: async () => {
    // Explicitly cancel all pending OS notifications and native alarms before clearing data
    await notificationService.cancelAll();
    resetDatabase();
    seedInitialDataIfNeeded(true);
    const profile = profileRepository.getProfile();
    const preferences = profileRepository.getPreferences();
    const selectedDate = getTodayDateString();
    set({ profile, preferences, selectedDate, isInitialized: true });
    useMedicineStore.getState().loadMedicines();
    useReminderStore.getState().loadDosesForDate(selectedDate);
    // Reconcile and arm the newly seeded sample schedules
    await notificationService.reconcileScheduledReminders();
  },

  clearAllData: async () => {
    // Explicitly cancel all pending OS notifications and native alarms before clearing data
    await notificationService.cancelAll();
    resetDatabase();
    const selectedDate = getTodayDateString();
    set({
      profile: null,
      preferences: {
        inAppReminders: true,
        aiAssistantEnabled: true,
        cameraPermissionsGranted: false,
        notificationsEnabled: true,
        streakCount: 0,
        lastActiveDate: selectedDate,
      },
      selectedDate,
      isInitialized: false,
    });
    useMedicineStore.getState().loadMedicines();
    useReminderStore.getState().loadDosesForDate(selectedDate);
  },
}));
