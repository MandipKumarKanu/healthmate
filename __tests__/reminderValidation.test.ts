import { describe, expect, it } from "@jest/globals";
import {
  validateDoseAmount,
  validateReminderTimes,
  isDuplicateReminderTime,
  formatTime12Hour,
  getTimeLabel,
} from "../src/utils/reminderValidation";

describe("reminderValidation", () => {
  describe("validateDoseAmount", () => {
    it("accepts valid dose amounts", () => {
      expect(validateDoseAmount("1 tablet").valid).toBe(true);
      expect(validateDoseAmount("2 capsules").valid).toBe(true);
      expect(validateDoseAmount("5 ml").valid).toBe(true);
      expect(validateDoseAmount("10 mg").valid).toBe(true);
      expect(validateDoseAmount("0.5 tablet").valid).toBe(true);
      expect(validateDoseAmount("2.5 ml").valid).toBe(true);
      expect(validateDoseAmount("1").valid).toBe(true);
      expect(validateDoseAmount("1 puff").valid).toBe(true);
      expect(validateDoseAmount("One spoonful").valid).toBe(true);
    });

    it("rejects empty, null, or whitespace amounts", () => {
      expect(validateDoseAmount("").valid).toBe(false);
      expect(validateDoseAmount("   ").valid).toBe(false);
      expect(validateDoseAmount(null).valid).toBe(false);
      expect(validateDoseAmount(undefined).valid).toBe(false);
    });

    it("rejects zero or negative amounts", () => {
      const resZero = validateDoseAmount("0");
      expect(resZero.valid).toBe(false);
      expect(resZero.error).toContain("greater than zero");

      const resZeroTablet = validateDoseAmount("0 tablets");
      expect(resZeroTablet.valid).toBe(false);
      expect(resZeroTablet.error).toContain("greater than zero");

      const resZeroDec = validateDoseAmount("0.00 ml");
      expect(resZeroDec.valid).toBe(false);
      expect(resZeroDec.error).toContain("greater than zero");

      const resNegative = validateDoseAmount("-2 pills");
      expect(resNegative.valid).toBe(false);
      expect(resNegative.error).toContain("greater than zero");
    });

    it("rejects pure punctuation and symbols", () => {
      const resSymbol = validateDoseAmount("???");
      expect(resSymbol.valid).toBe(false);

      const resDashes = validateDoseAmount("---");
      expect(resDashes.valid).toBe(false);
    });
  });

  describe("validateReminderTimes", () => {
    it("accepts valid distinct reminder times", () => {
      const times = [
        { id: "1", time: "08:00", amount: "1 tablet" },
        { id: "2", time: "14:00", amount: "1 tablet" },
        { id: "3", time: "20:30", amount: "2 tablets" },
      ];
      const result = validateReminderTimes(times);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("rejects empty times list", () => {
      const result = validateReminderTimes([]);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("At least one reminder time is required");
    });

    it("rejects duplicate reminder times", () => {
      const times = [
        { id: "1", time: "08:00", amount: "1 tablet" },
        { id: "2", time: "12:00", amount: "1 tablet" },
        { id: "3", time: "08:00", amount: "1 tablet" },
      ];
      const result = validateReminderTimes(times);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Duplicate reminder time detected");
      expect(result.error).toContain("8:00 AM");
    });

    it("rejects invalid time formats", () => {
      const invalidFormats = ["25:00", "12:60", "8:00", "morning", "12:0"];
      for (const fmt of invalidFormats) {
        const result = validateReminderTimes([
          { id: "1", time: fmt, amount: "1 tablet" },
        ]);
        expect(result.valid).toBe(false);
        expect(result.error).toContain("Invalid time format");
      }
    });

    it("rejects if an individual time has an invalid dose amount", () => {
      const times = [
        { id: "1", time: "08:00", amount: "1 tablet" },
        { id: "2", time: "20:00", amount: "0 tablets" },
      ];
      const result = validateReminderTimes(times);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("greater than zero");
    });
  });

  describe("isDuplicateReminderTime", () => {
    const times = [
      { id: "t_1", time: "08:00" },
      { id: "t_2", time: "14:00" },
    ];

    it("detects existing duplicate time", () => {
      expect(isDuplicateReminderTime(times, "08:00")).toBe(true);
      expect(isDuplicateReminderTime(times, "14:00")).toBe(true);
    });

    it("ignores the entry being edited when excludeId is passed", () => {
      // Editing t_1 keeping 08:00 is not a duplicate with other entries
      expect(isDuplicateReminderTime(times, "08:00", "t_1")).toBe(false);
      // Editing t_1 to match t_2 is a duplicate
      expect(isDuplicateReminderTime(times, "14:00", "t_1")).toBe(true);
    });

    it("returns false for new distinct time", () => {
      expect(isDuplicateReminderTime(times, "18:00")).toBe(false);
    });
  });

  describe("formatTime12Hour", () => {
    it("formats 24-hour time correctly to 12-hour AM/PM", () => {
      expect(formatTime12Hour("08:00")).toBe("8:00 AM");
      expect(formatTime12Hour("00:00")).toBe("12:00 AM");
      expect(formatTime12Hour("12:00")).toBe("12:00 PM");
      expect(formatTime12Hour("14:30")).toBe("2:30 PM");
      expect(formatTime12Hour("23:59")).toBe("11:59 PM");
    });
  });

  describe("getTimeLabel", () => {
    it("assigns correct label based on hour", () => {
      expect(getTimeLabel("08:00")).toBe("Morning");
      expect(getTimeLabel("13:00")).toBe("Afternoon");
      expect(getTimeLabel("19:00")).toBe("Evening");
      expect(getTimeLabel("22:00")).toBe("Night");
    });
  });
});
