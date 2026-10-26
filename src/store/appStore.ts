import { create } from "zustand";
import { UserProfile, UserPreferences, OnboardingDraft, SnoozeIntervalMinutes } from "../types";
import { profileRepository } from "../database/repositories/profileRepository";
import { seedInitialDataIfNeeded, getTodayDateString } from "../database/seed";
import { resetDatabase } from "../database/client";
import { notificationService } from "../services/notificationService";
import { useMedicineStore } from "./medicineStore";
import { useReminderStore } from "./reminderStore";

interface AppState {
  profile: UserProfile | null;
  preferences: UserPreferences;
  onboardingDraft: OnboardingDraft;
  selectedDate: string; // YYYY-MM-DD
  isInitialized: boolean;
  initApp: () => void;
  setOnboardingDraft: (draft: Partial<OnboardingDraft>) => void;
  clearOnboardingDraft: () => void;
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
  setSnoozeInterval: (minutes: SnoozeIntervalMinutes) => void;
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
    snoozeIntervalMinutes: 10,
    streakCount: 0,
    lastActiveDate: getTodayDateString(),
  },
  onboardingDraft: {
    name: "",
    age: "",
    gender: null,
    height: "",
    weight: "",
    unitSystem: "metric",
  },
  selectedDate: getTodayDateString(),
  isInitialized: false,

  initApp: () => {
    seedInitialDataIfNeeded(false);
    const profile = profileRepository.getProfile();
    const preferences = profileRepository.getPreferences();
    const savedDraft = profileRepository.getOnboardingDraft();
    const initialDraft: OnboardingDraft = savedDraft ?? {
      name: profile?.name || "",
      age: profile?.age ? String(profile.age) : "",
      gender: (profile?.gender as any) || null,
      height: profile?.height ? String(profile.height) : "",
      weight: profile?.weight ? String(profile.weight) : "",
      unitSystem: profile?.unitSystem || "metric",
    };
    set({
      profile,
      preferences,
      onboardingDraft: initialDraft,
      selectedDate: getTodayDateString(),
      isInitialized: true,
    });
  },

  setOnboardingDraft: (draft: Partial<OnboardingDraft>) => {
    const current = get().onboardingDraft;
    const updated: OnboardingDraft = { ...current, ...draft };
    profileRepository.saveOnboardingDraft(updated);
    set({ onboardingDraft: updated });
  },

  clearOnboardingDraft: () => {
    profileRepository.clearOnboardingDraft();
    set({
      onboardingDraft: {
        name: "",
        age: "",
        gender: null,
        height: "",
        weight: "",
        unitSystem: "metric",
      },
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
    get().clearOnboardingDraft();
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

  setSnoozeInterval: (minutes: SnoozeIntervalMinutes) => {
    const valid: SnoozeIntervalMinutes =
      minutes === 5 || minutes === 10 || minutes === 15 || minutes === 20
        ? minutes
        : 10;
    profileRepository.updatePreference("snooze_interval_minutes", String(valid));
    set((state) => ({
      preferences: {
        ...state.preferences,
        snoozeIntervalMinutes: valid,
      },
    }));
  },

  resetAllData: async () => {
    // Explicitly cancel all pending OS notifications and native alarms before clearing data
    await notificationService.cancelAll();
    resetDatabase();
    get().clearOnboardingDraft();
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
    get().clearOnboardingDraft();
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
        snoozeIntervalMinutes: 10,
      },
      selectedDate,
      isInitialized: false,
    });
    useMedicineStore.getState().loadMedicines();
    useReminderStore.getState().loadDosesForDate(selectedDate);
  },
}));
