/**
 * HealthMate - OCR Text Parsing Service
 *
 * Structures ML Kit's raw output into editable medicine fields.
 *
 * Parsing is line-aware: every field is only ever read from the line that
 * carries its label key (`Exp:`, `Mfg. by:`, `Batch No:` ...), so labels can
 * no longer bleed into each other the way they did with the previous
 * whole-blob regexes. OCR digit-confusion repair (`O`→`0`, `2O27`→`2027`) is
 * applied narrowly to date segments only; medicine-name correction remains the
 * responsibility of the pharmaceutical dictionary fuzzer, which handles names
 * more carefully.
 */

import { DosageForm } from '../types';
import { extractAndMatchMedicineName, MedicineMatchCandidate } from './pharmaceuticalDictionary';

export interface FieldConfidence {
  medicineName: number;
  detectedStrength?: number;
  expiryDate?: number;
  batchNumber?: number;
  manufacturer?: number;
}

export interface ExtractedMedicineData {
  medicineName?: string;
  genericName?: string;
  isBrand?: boolean;
  confidenceScore?: number;
  isHighConfidence?: boolean;
  fieldConfidence?: FieldConfidence;
  candidates?: MedicineMatchCandidate[];
  originalMatchText?: string;
  detectedStrength?: string;
  dosageForm?: DosageForm;
  manufacturer?: string;
  batchNumber?: string;
  expiryDate?: string;
  /** Dosage or storage instructions extracted from packaging. */
  instructions?: string;
  /** Cautionary warnings extracted from packaging. */
  warnings?: string;
  /** Therapeutic use extracted from packaging. */
  commonUses?: string;
  /** Clean, single-spaced label lines rebuilt from the raw text. */
  lines?: string[];
  rawText: string;
}

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes ML Kit output into clean display/parsing lines:
 * collapses block gaps (areas with double spaces), trims, and drops empties.
 */
function buildLines(rawText: string): string[] {
  return rawText
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * Single-pass repair of characters OCR commonly confuses inside numeric
 * segments: O→0, I/l/|/!→1, S→5, B→8, Z→2.
 * Deliberately NOT applied to medicine names (the dictionary fuzzer is better
 * at those) or to batch codes (which legitimately contain letters).
 */
function repairOcrDigits(text: string): string {
  return text
    .replace(/[Oo]/g, '0')
    .replace(/[Iil|!]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/[Bb]/g, '8')
    .replace(/[Zz]/g, '2');
}

const MONTH_MAP: Record<string, string> = {
  jan: 'Jan',
  feb: 'Feb',
  mar: 'Mar',
  apr: 'Apr',
  may: 'May',
  jun: 'Jun',
  jul: 'Jul',
  aug: 'Aug',
  sep: 'Sep',
  oct: 'Oct',
  nov: 'Nov',
  dec: 'Dec',
};

function expandYear(year: string): string | null {
  if (year.length === 4) return year;
  if (year.length === 2) return `20${year}`;
  return null;
}

/**
 * Attempts to read a single token (or short token run) as an expiry date.
 * Accepted pack-printed forms:
 *   "Aug 2027" / "Aug-2027" / "Aug.2027" / "August 2027"
 *   "25 Jun 2028" / "25-Jun-2028"
 *   "12/2027" (MM/YYYY)   "06/28" (MM/YY)   "2028-07" (YYYY/MM)
 *   "25/06/2028" / "25-06-28" (DD/MM/YYYY)  "2028-07-25" (YYYY-MM-DD)
 * Returns a normalized display string, or null.
 */
function parseDateToken(token: string): string | null {
  if (!token) return null;
  const t = token.replace(/[,;.]+$/, '').trim();

  // Month-name + year: "Aug 2027", "Aug-2027", "August 2027"
  let m = t.match(/^([A-Za-z]{3,9})[\s.\-]*(\d{2,4})$/);
  if (m) {
    const month = MONTH_MAP[m[1].toLowerCase().slice(0, 3)];
    const year = expandYear(m[2]);
    if (month && year) return `${month} ${year}`;
  }

  // Day + month-name + year: "25 Jun 2028", "25-Jun-2028"
  m = t.match(/^(\d{1,2})[\s.\-]+([A-Za-z]{3,9})[\s.\-]+(\d{2,4})$/);
  if (m) {
    const month = MONTH_MAP[m[2].toLowerCase().slice(0, 3)];
    const year = expandYear(m[3]);
    if (month && year) return `${m[1].padStart(2, '0')}/${month}/${year}`;
  }

  // Numeric forms, single/continuous string
  const numeric = t.replace(/\s+/g, '');
  m = numeric.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) {
    const year = expandYear(m[3]);
    if (year) return `${m[1]}/${m[2]}/${year}`; // keep pack order (DD/MM/YYYY norm)
  }
  m = numeric.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`; // YYYY-MM-DD → DD/MM/YYYY
  m = numeric.match(/^(\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) {
    if (m[2].length === 4 && +m[1] >= 1 && +m[1] <= 12) return `${m[1]}/${m[2]}`;
    if (m[2].length === 2 && +m[1] >= 1 && +m[1] <= 12) return `${m[1]}/20${m[2]}`;
  }
  m = numeric.match(/^(\d{4})[\/.\-](\d{1,2})$/);
  if (m && +m[2] >= 1 && +m[2] <= 12) return `${m[2]}/${m[1]}`; // YYYY/MM
  return null;
}

/** Where the next label key starts inside a shared line (ML Kit joins blocks). */
function findNextLabelIndex(value: string): number {
  return value.search(
    /\b(?:exp(?:iry)?|expires?|use\s+(?:by|before)|best\s+before|batch|lot|b\.?\s*n[o0]\b|mfg|mfd|manufactured|mrp|price|m\.r\.p|net\s+(?:wt|qty|quantity)|storage|store|reg(?:d)?.?\s*no|licence|license|regd|country|imported|mktd)\b/i,
  );
}

// ---------------------------------------------------------------------------
// Label keys
// ---------------------------------------------------------------------------

const KEY_EXPIRY =
  /\b(?:exp(?:iry|\.|\s*date|\.\s*date)?|expires?|use\s+(?:by|before)|best\s+before)\s*[:.\-]?\s*/i;

const KEY_BATCH =
  /\b(?:batch(?:\s*(?:n[o0]|number|code|id)\b\.?|\.|\s*:)?|lot(?:\s*(?:n[o0]|number)\b\.?|\.|\s*:)?|b\.?\s*n[o0]\b\.?)\s*[:.\-]?\s*/i;

const KEY_MFG =
  /\b(?:mfg\.?(?:\s*by)?|mfd\.?(?:\s*by)?|manufactur(?:ed|er)?(?:\s*by)?|made\s+by|marketed\s+by|mktd\s*by)\s*[:.\-]?\s*/i;

// ---------------------------------------------------------------------------
// Per-field value parsers (each receives only the text after its own key)
// ---------------------------------------------------------------------------

function parseExpiryValue(value: string): string | null {
  if (!value) return null;
  const tokens = value.split(/\s+/).filter(Boolean);

  // Direct + joined candidates: "12/2027", "Aug 2027", "25 06 2028"...
  const candidates: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    candidates.push(tokens[i]);
    if (tokens[i + 1]) candidates.push(`${tokens[i]} ${tokens[i + 1]}`);
    if (tokens[i + 2]) {
      candidates.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
    }
  }

  for (const candidate of candidates) {
    const direct = parseDateToken(candidate);
    if (direct) return direct;
    // Retry once with digit-confusion repair ("08/2O27" → "08/2027").
    // Note: this cannot recover months whose letters themselves got OCR'd as
    // digits ("5ep 2027"); those stay unmatched rather than guessed.
    const repaired = repairOcrDigits(candidate);
    if (repaired !== candidate) {
      const fixed = parseDateToken(repaired);
      if (fixed) return fixed;
    }
  }
  return null;
}

function parseBatchValue(value: string): string | null {
  if (!value) return null;
  const nextKey = findNextLabelIndex(value);
  let v = nextKey >= 0 ? value.slice(0, nextKey) : value;
  v = v.replace(/[;:,.]+$/, '').trim();

  // Printed batch codes are often spaced ("DEMO MF0426"); compact them.
  const compact = v.replace(/\s+/g, '');
  if (/^[A-Za-z0-9][A-Za-z0-9\-\/]{2,23}$/.test(compact)) return compact;

  // Fallback: first standalone alphanumeric token of a plausible length.
  const token = v.match(/[A-Za-z0-9][A-Za-z0-9\-\/]{2,23}/);
  return token ? token[0] : null;
}

function parseManufacturerValue(value: string): string | null {
  if (!value) return null;
  const nextKey = findNextLabelIndex(value);
  let v = nextKey >= 0 ? value.slice(0, nextKey) : value;
  v = v
    .replace(/^[.,;:\-\s]+/, '')
    .replace(/\s+$/, '')
    .replace(/[;:,]+$/, '')
    .trim();
  if (v.replace(/[^A-Za-z]/g, '').length < 2) return null;
  return v;
}

/**
 * Runs `parseValue` over every line that carries the label key
 * `keyRegex`, returning the first successfully parsed value.
 */
function extractKeyedField(
  lines: string[],
  keyRegex: RegExp,
  parseValue: (value: string) => string | null,
): string | null {
  for (const line of lines) {
    const keyMatch = line.match(keyRegex);
    if (!keyMatch || keyMatch.index === undefined) continue;
    const value = line.slice(keyMatch.index + keyMatch[0].length).trim();
    const parsed = parseValue(value);
    if (parsed) return parsed;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Strength & dosage form
// ---------------------------------------------------------------------------

const STRENGTH_PATTERN = /\b(\d+(?:,\d{3})*(?:\.\d+)?)\s*(mg|mcg|iu|g|%|ml)(?![A-Za-z])/i;

function normalizeStrengthUnit(unit: string): string {
  return unit.toLowerCase() === 'iu' ? 'IU' : unit.toLowerCase();
}

/**
 * Reads the strength, preferring the line that produced the medicine-name
 * match (labels usually print strength right under the name), then other
 * lines top-down.
 */
function extractStrength(lines: string[], anchorLineIndex: number | null): string | null {
  const ordered =
    anchorLineIndex !== null && anchorLineIndex > 0
      ? [lines[anchorLineIndex], ...lines.filter((_, i) => i !== anchorLineIndex)]
      : lines;

  for (const line of ordered) {
    const m = line.match(STRENGTH_PATTERN);
    if (!m) continue;
    const unit = normalizeStrengthUnit(m[2]);
    return unit === '%' ? `${m[1]}%` : `${m[1]} ${unit}`;
  }
  return null;
}

const DOSAGE_FORM_PATTERNS: Array<[DosageForm, RegExp]> = [
  ['eye_drop', /\b(eye\s+drop|eye\s+ear\s+drop|ophthalmic|otic)\b/i],
  ['softgel', /\bsoftgels?\b/i],
  ['capsule', /\bcaps?\.?\b|\bcapsules?\b/i],
  ['tablet', /\btab(?:s|lets?)?\b|\btablets?\b/i],
  ['syrup', /\b(syrup|oral\s+liquid|elixir)\b/i],
  ['injection', /\b(injection|vial|ampoule|injectable)\b/i],
  ['cream', /\b(cream|ointment|gel|lotion)\b/i],
];

function detectDosageForm(lines: string[]): DosageForm | undefined {
  const text = lines.join('\n');
  for (const [form, pattern] of DOSAGE_FORM_PATTERNS) {
    if (pattern.test(text)) return form;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Medicine-name fallback (no dictionary hit)
// ---------------------------------------------------------------------------

/**
 * When the dictionary fuzzer cannot confidently match anything, keep the most
 * plausible name-like phrase from the top line: strip strengths, dosage noise,
 * and Rx-style prefixes instead of blindly slicing the first two words.
 */
function fallbackMedicineName(lines: string[]): string | null {
  const firstLine = lines[0];
  if (!firstLine) return null;

  const cleaned = firstLine
    .replace(/\b\d+(?:,\d{3})*(?:\.\d+)?\s*(?:mg|mcg|g|iu|%|ml)\b/gi, '')
    .replace(/\b(?:tablets?|capsules?|softgels?|injection|syrup|cream|drops?)\b/gi, '')
    .replace(/\b(?:rx|usp|ip|bp|usp\.?|gmp)\b/gi, '')
    .replace(/[^A-Za-z &.'\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = cleaned.split(/\s+/).filter((w) => w.replace(/[^A-Za-z]/g, '').length >= 2);
  if (words.length === 0) {
    // Degraded last resort: as much of the raw top line as is name-like.
    return firstLine.slice(0, 40).trim() || null;
  }
  return words.slice(0, 2).join(' ');
}

// ---------------------------------------------------------------------------
// Public service
// ---------------------------------------------------------------------------

export const ocrService = {
  extractMedicineData(rawText: string): ExtractedMedicineData {
    const lines = buildLines(rawText);
    const text = lines.join('\n');
    const result: ExtractedMedicineData = { rawText: text, lines };

    // 1. Identify Medicine Name using the Pharmaceutical Dictionary
    const match = extractAndMatchMedicineName(text);

    if (match.matchedName) {
      result.medicineName = match.matchedName;
      result.genericName = match.genericName;
      result.isBrand = match.isBrand;
      result.confidenceScore = match.confidenceScore;
      result.isHighConfidence = match.isHighConfidence;
      result.candidates = match.candidates;
      result.originalMatchText = match.rawMatchText;
    } else {
      const name = fallbackMedicineName(lines);
      if (name) {
        result.medicineName = name;
      } else {
        result.medicineName = 'Unknown medicine';
      }
      result.confidenceScore = 0.5;
      result.isHighConfidence = false;
      result.candidates = [];
    }

    // Anchor for strength: the line that produced the name match, since labels
    // usually print the strength directly under the medicine name.
    let anchorLineIndex: number | null = null;
    if (result.originalMatchText) {
      anchorLineIndex = lines.findIndex((line) =>
        line.toLowerCase().includes(result.originalMatchText!.toLowerCase()),
      );
    }

    // 2. Strength
    const strength = extractStrength(lines, anchorLineIndex);
    if (strength) result.detectedStrength = strength;

    // 3. Dosage form
    result.dosageForm = detectDosageForm(lines);

    // 4-6. Expiry / Batch / Manufacturer — strictly from their own labeled lines
    const expiryDate = extractKeyedField(lines, KEY_EXPIRY, parseExpiryValue);
    if (expiryDate) result.expiryDate = expiryDate;

    const batchNumber = extractKeyedField(lines, KEY_BATCH, parseBatchValue);
    if (batchNumber) result.batchNumber = batchNumber;

    const manufacturer = extractKeyedField(lines, KEY_MFG, parseManufacturerValue);
    if (manufacturer) result.manufacturer = manufacturer;

    // Field-level confidence scores
    const fieldConfidence: FieldConfidence = {
      medicineName: result.confidenceScore ?? 0.5,
      ...(strength ? { detectedStrength: anchorLineIndex !== null ? 0.95 : 0.85 } : {}),
      ...(expiryDate ? { expiryDate: 0.9 } : {}),
      ...(batchNumber ? { batchNumber: 0.9 } : {}),
      ...(manufacturer ? { manufacturer: 0.9 } : {}),
    };
    result.fieldConfidence = fieldConfidence;

    return result;
  },
};
