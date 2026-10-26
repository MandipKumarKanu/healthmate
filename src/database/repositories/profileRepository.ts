import { getDatabase } from "../client";
import { UserProfile, UserPreferences, OnboardingDraft, SnoozeIntervalMinutes } from "../../types";

interface ProfileRow {
  id: string;
  name: string;
  email: string | null;
  age: number | null;
  gender: string | null;
  height: number | null;
  weight: number | null;
  unit_system: string | null;
  created_at: string;
  onboarding_completed: number;
}

export const profileRepository = {
  getProfile(): UserProfile | null {
    const db = getDatabase();
    const row = db.getFirstSync<ProfileRow>("SELECT * FROM profiles LIMIT 1;");
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      email: row.email ?? undefined,
      age: row.age ?? undefined,
      gender: row.gender ?? undefined,
      height: row.height ?? undefined,
      weight: row.weight ?? undefined,
      unitSystem: (row.unit_system as "metric" | "imperial") || "metric",
      createdAt: row.created_at,
      onboardingCompleted: row.onboarding_completed === 1,
    };
  },

  saveProfile(
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
  ): UserProfile {
    const db = getDatabase();
    const existing = this.getProfile();
    const now = new Date().toISOString();
    const id = existing ? existing.id : "default-user";
    const isCompleted =
      onboardingCompleted !== undefined
        ? onboardingCompleted
        : existing
          ? existing.onboardingCompleted
          : false;

    const email = details?.email ?? existing?.email ?? null;
    const age =
      details?.age !== undefined ? details.age : (existing?.age ?? null);
    const gender =
      details?.gender !== undefined
        ? details.gender
        : (existing?.gender ?? null);
    const height =
      details?.height !== undefined
        ? details.height
        : (existing?.height ?? null);
    const weight =
      details?.weight !== undefined
        ? details.weight
        : (existing?.weight ?? null);
    const unitSystem = details?.unitSystem ?? existing?.unitSystem ?? "metric";

    db.runSync(
      `INSERT OR REPLACE INTO profiles (
        id, name, email, age, gender, height, weight, unit_system, created_at, onboarding_completed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        id,
        name,
        email,
        age,
        gender,
        height,
        weight,
        unitSystem,
        existing?.createdAt ?? now,
        isCompleted ? 1 : 0,
      ],
    );

    return {
      id,
      name,
      email: email ?? undefined,
      age: age ?? undefined,
      gender: gender ?? undefined,
      height: height ?? undefined,
      weight: weight ?? undefined,
      unitSystem,
      createdAt: existing?.createdAt ?? now,
      onboardingCompleted: isCompleted,
    };
  },

  setOnboardingCompleted(completed: boolean): void {
    const db = getDatabase();
    const existing = this.getProfile();
    if (!existing) {
      this.saveProfile("User", undefined, completed);
      return;
    }
    db.runSync("UPDATE profiles SET onboarding_completed = ?;", [
      completed ? 1 : 0,
    ]);
  },

  getPreference(key: string): string | null {
    const db = getDatabase();
    const rows = db.getAllSync<{ key: string; value: string }>(
      "SELECT key, value FROM preferences;",
    );
    const row = rows.find((r) => r.key === key);
    return row ? row.value : null;
  },

  getOnboardingStep(): string | null {
    return this.getPreference("onboarding_step");
  },

  setOnboardingStep(step: string): void {
    this.updatePreference("onboarding_step", step);
  },

  getOnboardingDraft(): OnboardingDraft | null {
    const raw = this.getPreference("onboarding_draft");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as OnboardingDraft;
    } catch {
      return null;
    }
  },

  saveOnboardingDraft(draft: OnboardingDraft): void {
    this.updatePreference("onboarding_draft", JSON.stringify(draft));
  },

  clearOnboardingDraft(): void {
    const db = getDatabase();
    db.runSync("DELETE FROM preferences WHERE key = ?;", ["onboarding_draft"]);
  },

  validateSnoozeInterval(val: any): SnoozeIntervalMinutes {
    if (typeof val !== "number") return 10;
    if (val === 5 || val === 10 || val === 15 || val === 20) {
      return val;
    }
    return 10;
  },

  getPreferences(): UserPreferences {
    const db = getDatabase();
    const rows = db.getAllSync<{ key: string; value: string }>(
      "SELECT key, value FROM preferences;",
    );
    const map = new Map(rows.map((r) => [r.key, r.value]));

    const rawSnooze = parseInt(map.get("snooze_interval_minutes") || "10", 10);
    const snoozeIntervalMinutes = this.validateSnoozeInterval(rawSnooze);

    return {
      inAppReminders: map.get("in_app_reminders") !== "false",
      aiAssistantEnabled: map.get("ai_assistant_enabled") !== "false",
      cameraPermissionsGranted:
        map.get("camera_permissions_granted") === "true",
      notificationsEnabled: map.get("notifications_enabled") !== "false",
      snoozeIntervalMinutes,
      streakCount: parseInt(map.get("streak_count") || "0", 10),
      lastActiveDate:
        map.get("last_active_date") || new Date().toISOString().split("T")[0],
    };
  },

  updatePreference(key: string, value: string): void {
    const db = getDatabase();
    db.runSync(
      "INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?);",
      [key, value],
    );
  },
};
