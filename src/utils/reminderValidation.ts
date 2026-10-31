export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates a medication dose amount string (e.g. "1 tablet", "5 ml", "2 capsules").
 *
 * Rules:
 * - Must not be empty or whitespace.
 * - If numeric, amount must be greater than 0 (rejects 0, -1, 0.00, etc.).
 * - Must not consist solely of punctuation or symbols.
 */
export function validateDoseAmount(amount?: string | null): ValidationResult {
  if (amount === undefined || amount === null) {
    return {
      valid: false,
      error: 'Please enter a dose amount (e.g., "1 tablet" or "5 ml").',
    };
  }

  const trimmed = typeof amount === 'string' ? amount.trim() : String(amount).trim();
  if (trimmed.length === 0) {
    return {
      valid: false,
      error: 'Dose amount cannot be empty. Please enter an amount (e.g., "1 tablet" or "5 ml").',
    };
  }

  // Reject pure punctuation/symbols
  if (/^[^a-zA-Z0-9]+$/.test(trimmed)) {
    return {
      valid: false,
      error: 'Please enter a valid dose amount with numbers or words (e.g., "1 tablet").',
    };
  }

  // Extract leading numeric value if present
  const leadingNumMatch = trimmed.match(/^([-+]?[0-9]+(?:\.[0-9]+)?)/);
  if (leadingNumMatch) {
    const val = parseFloat(leadingNumMatch[1]);
    if (isNaN(val) || val <= 0) {
      return {
        valid: false,
        error: 'Dose amount must be greater than zero.',
      };
    }
  } else if (/^0+(\.0+)?$/.test(trimmed)) {
    return {
      valid: false,
      error: 'Dose amount must be greater than zero.',
    };
  }

  return { valid: true };
}

/**
 * Validates a list of reminder times for a schedule.
 *
 * Rules:
 * - Must contain at least one reminder time.
 * - Each time must strictly adhere to 24-hour HH:mm format (00:00 to 23:59).
 * - No duplicate times are allowed across entries.
 * - Each entry's dose amount must be valid if specified.
 */
export function validateReminderTimes(
  times: Array<{ id?: string; time: string; amount?: string; label?: string }>,
): ValidationResult {
  if (!times || times.length === 0) {
    return {
      valid: false,
      error: 'At least one reminder time is required.',
    };
  }

  const seenTimes = new Set<string>();
  const duplicates = new Set<string>();

  for (const item of times) {
    const rawTime = (item.time || '').trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(rawTime)) {
      return {
        valid: false,
        error: `Invalid time format "${item.time}". Enter time in 24-hour HH:mm format (e.g. 08:00 or 20:30).`,
      };
    }

    if (seenTimes.has(rawTime)) {
      duplicates.add(rawTime);
    }
    seenTimes.add(rawTime);
  }

  if (duplicates.size > 0) {
    const formattedDups = Array.from(duplicates)
      .sort()
      .map((t) => formatTime12Hour(t))
      .join(', ');
    return {
      valid: false,
      error: `Duplicate reminder time detected (${formattedDups}). Each dose reminder must have a distinct time.`,
    };
  }

  for (const item of times) {
    if (item.amount !== undefined) {
      const amountCheck = validateDoseAmount(item.amount);
      if (!amountCheck.valid) {
        return {
          valid: false,
          error: `Invalid dose amount for ${formatTime12Hour(item.time)}: ${amountCheck.error}`,
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Checks whether a given time is already present in a reminder times list,
 * optionally excluding an entry with a specific ID (useful when editing an existing time).
 */
export function isDuplicateReminderTime(
  times: Array<{ id?: string; time: string }>,
  newTime: string,
  excludeId?: string,
): boolean {
  const normalized = (newTime || '').trim();
  return times.some((t) => t.id !== excludeId && t.time.trim() === normalized);
}

/**
 * Formats a 24-hour HH:mm time string into friendly 12-hour format with AM/PM.
 */
export function formatTime12Hour(time: string): string {
  const parts = time.split(':').map(Number);
  if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) {
    return time;
  }
  const hours = parts[0];
  const minutes = parts[1];
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(minutes).padStart(2, '0')} ${period}`;
}

/**
 * Returns a default descriptive label based on the time of day.
 */
export function getTimeLabel(time: string): string {
  if (time < '11:00') return 'Morning';
  if (time < '17:00') return 'Afternoon';
  if (time < '21:00') return 'Evening';
  return 'Night';
}
