import { describe, it, expect } from "@jest/globals";
import { profileRepository } from "../src/database/repositories/profileRepository";
import { GenderOption, UnitSystem } from "../src/types";

describe("Onboarding Profile Validation & Persistence", () => {
  function validateProfileForm(params: {
    name: string;
    age?: string;
    height?: string;
    weight?: string;
    unitSystem: UnitSystem;
  }): { isValid: boolean; errors: Record<string, string> } {
    const errors: Record<string, string> = {};

    // 1. Required Name
    const trimmedName = params.name.trim();
    if (!trimmedName) {
      errors.name = "Please enter your full name";
    }

    // 2. Optional Age validation (only validate if provided)
    if (params.age && params.age.trim()) {
      const parsedAge = Number(params.age.trim());
      if (
        isNaN(parsedAge) ||
        parsedAge < 1 ||
        parsedAge > 120 ||
        !Number.isInteger(parsedAge)
      ) {
        errors.age = "Enter a valid age (1-120)";
      }
    }

    // 3. Optional Height validation (only validate if provided)
    if (params.height && params.height.trim()) {
      const parsedHeight = Number(params.height.trim());
      if (isNaN(parsedHeight) || parsedHeight <= 0) {
        errors.height = "Enter a positive number";
      } else if (
        params.unitSystem === "metric" &&
        (parsedHeight < 30 || parsedHeight > 300)
      ) {
        errors.height = "Height should be 30–300 cm";
      } else if (
        params.unitSystem === "imperial" &&
        (parsedHeight < 1 || parsedHeight > 9)
      ) {
        errors.height = "Height should be 1–9 ft";
      }
    }

    // 4. Optional Weight validation (only validate if provided)
    if (params.weight && params.weight.trim()) {
      const parsedWeight = Number(params.weight.trim());
      if (isNaN(parsedWeight) || parsedWeight <= 0) {
        errors.weight = "Enter a positive number";
      } else if (
        params.unitSystem === "metric" &&
        (parsedWeight < 1 || parsedWeight > 500)
      ) {
        errors.weight = "Weight should be 1–500 kg";
      } else if (
        params.unitSystem === "imperial" &&
        (parsedWeight < 2 || parsedWeight > 1000)
      ) {
        errors.weight = "Weight should be 2–1000 lb";
      }
    }

    return { isValid: Object.keys(errors).length === 0, errors };
  }

  describe("Form Validation Rules", () => {
    it("requires full name and rejects empty or whitespace-only names", () => {
      const empty = validateProfileForm({ name: "", unitSystem: "metric" });
      expect(empty.isValid).toBe(false);
      expect(empty.errors.name).toBe("Please enter your full name");

      const whitespace = validateProfileForm({
        name: "   ",
        unitSystem: "metric",
      });
      expect(whitespace.isValid).toBe(false);
      expect(whitespace.errors.name).toBe("Please enter your full name");
    });

    it("accepts valid name with all optional fields empty", () => {
      const valid = validateProfileForm({
        name: "Alex Morgan",
        unitSystem: "metric",
      });
      expect(valid.isValid).toBe(true);
      expect(valid.errors).toEqual({});
    });

    it("validates optional age only when entered", () => {
      const validAge = validateProfileForm({
        name: "Alex",
        age: "28",
        unitSystem: "metric",
      });
      expect(validAge.isValid).toBe(true);

      const invalidAge = validateProfileForm({
        name: "Alex",
        age: "150",
        unitSystem: "metric",
      });
      expect(invalidAge.isValid).toBe(false);
      expect(invalidAge.errors.age).toBe("Enter a valid age (1-120)");

      const nonNumericAge = validateProfileForm({
        name: "Alex",
        age: "abc",
        unitSystem: "metric",
      });
      expect(nonNumericAge.isValid).toBe(false);
    });

    it("validates optional height based on metric and imperial units", () => {
      // Metric (cm)
      const validMetricHeight = validateProfileForm({
        name: "Alex",
        height: "175",
        unitSystem: "metric",
      });
      expect(validMetricHeight.isValid).toBe(true);

      const invalidMetricHeight = validateProfileForm({
        name: "Alex",
        height: "500",
        unitSystem: "metric",
      });
      expect(invalidMetricHeight.isValid).toBe(false);
      expect(invalidMetricHeight.errors.height).toBe(
        "Height should be 30–300 cm",
      );

      // Imperial (ft)
      const validImperialHeight = validateProfileForm({
        name: "Alex",
        height: "5.9",
        unitSystem: "imperial",
      });
      expect(validImperialHeight.isValid).toBe(true);

      const invalidImperialHeight = validateProfileForm({
        name: "Alex",
        height: "12",
        unitSystem: "imperial",
      });
      expect(invalidImperialHeight.isValid).toBe(false);
      expect(invalidImperialHeight.errors.height).toBe(
        "Height should be 1–9 ft",
      );
    });

    it("validates optional weight based on metric and imperial units", () => {
      // Metric (kg)
      const validMetricWeight = validateProfileForm({
        name: "Alex",
        weight: "68",
        unitSystem: "metric",
      });
      expect(validMetricWeight.isValid).toBe(true);

      const invalidMetricWeight = validateProfileForm({
        name: "Alex",
        weight: "600",
        unitSystem: "metric",
      });
      expect(invalidMetricWeight.isValid).toBe(false);
      expect(invalidMetricWeight.errors.weight).toBe(
        "Weight should be 1–500 kg",
      );

      // Imperial (lb)
      const validImperialWeight = validateProfileForm({
        name: "Alex",
        weight: "150",
        unitSystem: "imperial",
      });
      expect(validImperialWeight.isValid).toBe(true);

      const invalidImperialWeight = validateProfileForm({
        name: "Alex",
        weight: "1500",
        unitSystem: "imperial",
      });
      expect(invalidImperialWeight.isValid).toBe(false);
      expect(invalidImperialWeight.errors.weight).toBe(
        "Weight should be 2–1000 lb",
      );
    });
  });

  describe("Local Profile Repository Persistence", () => {
    it("persists and retrieves profile with optional demographics and unit system", () => {
      const saved = profileRepository.saveProfile(
        "Sarah Connor",
        {
          age: 34,
          gender: "Female" as GenderOption,
          height: 168,
          weight: 60,
          unitSystem: "metric",
        },
        true,
      );

      expect(saved.name).toBe("Sarah Connor");
      expect(saved.age).toBe(34);
      expect(saved.gender).toBe("Female");
      expect(saved.height).toBe(168);
      expect(saved.weight).toBe(60);
      expect(saved.unitSystem).toBe("metric");
      expect(saved.onboardingCompleted).toBe(true);

      const loaded = profileRepository.getProfile();
      expect(loaded).not.toBeNull();
      expect(loaded?.name).toBe("Sarah Connor");
      expect(loaded?.age).toBe(34);
      expect(loaded?.gender).toBe("Female");
      expect(loaded?.height).toBe(168);
      expect(loaded?.weight).toBe(60);
      expect(loaded?.unitSystem).toBe("metric");
      expect(loaded?.onboardingCompleted).toBe(true);
    });

    it("persists profile with only required name leaving optional fields undefined", () => {
      const saved = profileRepository.saveProfile("John Doe", undefined, true);
      expect(saved.name).toBe("John Doe");
      expect(saved.onboardingCompleted).toBe(true);

      const loaded = profileRepository.getProfile();
      expect(loaded?.name).toBe("John Doe");
      expect(loaded?.onboardingCompleted).toBe(true);
    });

    it("does not mark onboarding completed when profile step is saved with false", () => {
      const saved = profileRepository.saveProfile(
        "Jane Explorer",
        { age: 29, gender: "Female" as GenderOption, unitSystem: "metric" },
        false,
      );
      expect(saved.onboardingCompleted).toBe(false);

      const loaded = profileRepository.getProfile();
      expect(loaded?.name).toBe("Jane Explorer");
      expect(loaded?.onboardingCompleted).toBe(false);
    });

    it("persists and retrieves onboarding step progress separately", () => {
      profileRepository.setOnboardingStep("permissions");
      expect(profileRepository.getOnboardingStep()).toBe("permissions");

      profileRepository.setOnboardingStep("completed");
      expect(profileRepository.getOnboardingStep()).toBe("completed");
    });

    it("marks onboarding completed only after permissions step is completed or skipped", () => {
      // Step 2: User completes profile form, onboardingCompleted remains false
      profileRepository.saveProfile("Alex Morgan", { age: 25 }, false);
      profileRepository.setOnboardingStep("permissions");

      let current = profileRepository.getProfile();
      expect(current?.onboardingCompleted).toBe(false);
      expect(profileRepository.getOnboardingStep()).toBe("permissions");

      // Startup route decision if app is closed while at permissions screen:
      const resolveStartupRoute = (
        p: { name?: string; onboardingCompleted: boolean } | null,
        step: string | null,
      ) => {
        if (p && p.onboardingCompleted) return "/(tabs)/home";
        if (
          step === "permissions" ||
          (p && p.name && p.name.trim().length > 0)
        ) {
          return "/onboarding/permissions";
        }
        return "/onboarding";
      };

      // Ensure it resumes at permissions step instead of skipping directly to Home
      expect(
        resolveStartupRoute(current, profileRepository.getOnboardingStep()),
      ).toBe("/onboarding/permissions");

      // Step 3: Permissions step is finished or skipped
      profileRepository.setOnboardingCompleted(true);
      profileRepository.setOnboardingStep("completed");

      current = profileRepository.getProfile();
      expect(current?.onboardingCompleted).toBe(true);
      expect(profileRepository.getOnboardingStep()).toBe("completed");

      // Subsequent launch correctly routes to Home
      expect(
        resolveStartupRoute(current, profileRepository.getOnboardingStep()),
      ).toBe("/(tabs)/home");
    });
  });
});
