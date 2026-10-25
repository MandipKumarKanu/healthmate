import { create } from 'zustand';
import { UserProfile, UserPreferences } from '../types';
import { profileRepository } from '../database/repositories/profileRepository';
import { seedInitialDataIfNeeded, getTodayDateString } from '../database/seed';

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
      unitSystem?: 'metric' | 'imperial';
    },
    onboardingCompleted?: boolean
  ) => void;
  setSelectedDate: (date: string) => void;
  togglePreference: (key: keyof UserPreferences) => void;
  resetAllData: () => void;
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

  setProfileName: (name: string, onboardingCompleted = true) => {
    const updated = profileRepository.saveProfile(name, undefined, onboardingCompleted);
    set({ profile: updated });
  },

  updateProfile: (name, details, onboardingCompleted = true) => {
    const updated = profileRepository.saveProfile(name, details, onboardingCompleted);
    set({ profile: updated });
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

  resetAllData: () => {
    seedInitialDataIfNeeded(true);
    const profile = profileRepository.getProfile();
    const preferences = profileRepository.getPreferences();
    set({
      profile,
      preferences,
      selectedDate: getTodayDateString(),
    });
  },
}));
