/**
 * HealthMate - Pharmaceutical Dictionary & Fuzzy Matching Engine
 *
 * Provides a curated pharmaceutical dictionary with generic/brand mappings,
 * normalized Levenshtein edit distance, OCR character confusion tolerance,
 * and length-aware confidence thresholds.
 */

export interface PharmaceuticalEntry {
  name: string;
  genericName?: string;
  isBrand?: boolean;
  aliases?: string[];
}

export interface MedicineMatchCandidate {
  name: string;
  genericName?: string;
  isBrand: boolean;
  score: number; // 0.0 - 1.0
  isExact: boolean;
  originalText: string;
}

export interface FuzzyMatchResult {
  bestMatch: MedicineMatchCandidate | null;
  candidates: MedicineMatchCandidate[];
  isHighConfidence: boolean;
  originalQuery: string;
}

/**
 * Curated Pharmaceutical Dictionary
 * Generic drugs, common brand names, and brand-to-generic mappings.
 */
export const PHARMACEUTICAL_DICTIONARY: PharmaceuticalEntry[] = [
  // Generics
  { name: 'Metformin', aliases: ['Metformin Hydrochloride', 'Metformin Hcl'] },
  { name: 'Amoxicillin', aliases: ['Amoxycillin', 'Amoxicillin Trihydrate'] },
  { name: 'Cetirizine', aliases: ['Cetirizine Hydrochloride', 'Cetirizine Hcl'] },
  { name: 'Vitamin D3', aliases: ['Cholecalciferol', 'Vit D3'] },
  { name: 'Ibuprofen' },
  { name: 'Paracetamol', genericName: 'Acetaminophen', aliases: ['APAP'] },
  { name: 'Acetaminophen', genericName: 'Acetaminophen' },
  { name: 'Atorvastatin', aliases: ['Atorvastatin Calcium'] },
  { name: 'Omeprazole' },
  { name: 'Lisinopril' },
  { name: 'Amlodipine', aliases: ['Amlodipine Besylate'] },
  { name: 'Salbutamol', aliases: ['Albuterol'] },
  { name: 'Albuterol', genericName: 'Salbutamol' },
  { name: 'Levothyroxine', aliases: ['Levothyroxine Sodium'] },
  { name: 'Losartan', aliases: ['Losartan Potassium'] },
  { name: 'Gabapentin' },
  { name: 'Hydrochlorothiazide', aliases: ['HCTZ'] },
  { name: 'Metoprolol', aliases: ['Metoprolol Tartrate', 'Metoprolol Succinate'] },
  { name: 'Pantoprazole', aliases: ['Pantoprazole Sodium'] },
  { name: 'Sertraline', aliases: ['Sertraline Hydrochloride'] },
  { name: 'Simvastatin' },
  { name: 'Montelukast', aliases: ['Montelukast Sodium'] },
  { name: 'Escitalopram', aliases: ['Escitalopram Oxalate'] },
  { name: 'Rosuvastatin', aliases: ['Rosuvastatin Calcium'] },
  { name: 'Ciprofloxacin', aliases: ['Ciprofloxacin Hcl'] },
  { name: 'Azithromycin' },
  { name: 'Doxycycline', aliases: ['Doxycycline Hyclate', 'Doxycycline Monohydrate'] },
  { name: 'Prednisone' },
  { name: 'Fluoxetine', aliases: ['Fluoxetine Hydrochloride'] },
  { name: 'Clopidogrel', aliases: ['Clopidogrel Bisulfate'] },
  { name: 'Aspirin', aliases: ['Acetylsalicylic Acid'] },
  { name: 'Furosemide' },
  { name: 'Meloxicam' },
  { name: 'Tramadol', aliases: ['Tramadol Hydrochloride'] },
  { name: 'Warfarin', aliases: ['Warfarin Sodium'] },
  { name: 'Insulin' },
  { name: 'Iron', aliases: ['Ferrous Sulfate', 'Ferrous Gluconate'] },
  { name: 'Zinc', aliases: ['Zinc Sulfate', 'Zinc Gluconate'] },
  { name: 'Calcium', aliases: ['Calcium Carbonate', 'Calcium Citrate'] },
  { name: 'Lubricating eye drops', aliases: ['Artificial Tears', 'Eye Drops'] },
  { name: 'Ampicillin' },
  { name: 'Amiloride' },

  // Common Brands mapped to Generics
  { name: 'Glucophage', genericName: 'Metformin', isBrand: true },
  { name: 'Amoxil', genericName: 'Amoxicillin', isBrand: true },
  {
    name: 'Augmentin',
    genericName: 'Amoxicillin',
    isBrand: true,
    aliases: ['Amoxicillin-Clavulanate'],
  },
  { name: 'Tylenol', genericName: 'Acetaminophen', isBrand: true },
  { name: 'Advil', genericName: 'Ibuprofen', isBrand: true },
  { name: 'Motrin', genericName: 'Ibuprofen', isBrand: true },
  { name: 'Lipitor', genericName: 'Atorvastatin', isBrand: true },
  { name: 'Prilosec', genericName: 'Omeprazole', isBrand: true },
  { name: 'Norvasc', genericName: 'Amlodipine', isBrand: true },
  { name: 'Zyrtec', genericName: 'Cetirizine', isBrand: true },
  { name: 'Ventolin', genericName: 'Salbutamol', isBrand: true },
  { name: 'ProAir', genericName: 'Salbutamol', isBrand: true },
  { name: 'Synthroid', genericName: 'Levothyroxine', isBrand: true },
  { name: 'Cozaar', genericName: 'Losartan', isBrand: true },
  { name: 'Neurontin', genericName: 'Gabapentin', isBrand: true },
  { name: 'Zoloft', genericName: 'Sertraline', isBrand: true },
  { name: 'Lexapro', genericName: 'Escitalopram', isBrand: true },
  { name: 'Crestor', genericName: 'Rosuvastatin', isBrand: true },
  { name: 'Plavix', genericName: 'Clopidogrel', isBrand: true },
];

/**
 * Common OCR character confusion pairs.
 * Optical character recognition commonly confounds characters like 1 with l/i, 0 with o, etc.
 */
function areOcrConfusable(charA: string, charB: string): boolean {
  if (charA === charB) return true;
  const a = charA.toLowerCase();
  const b = charB.toLowerCase();

  const confusionGroups = [
    ['1', 'l', 'i', '|', '!'],
    ['0', 'o'],
    ['5', 's'],
    ['8', 'b'],
    ['2', 'z'],
    ['u', 'v'],
  ];

  return confusionGroups.some((group) => group.includes(a) && group.includes(b));
}

/**
 * Normalized Levenshtein distance with OCR character confusion weighting.
 * Exact match = 0 distance.
 * OCR-confusable match (e.g. '1' for 'i' or 'l') = 0.35 distance penalty instead of 1.0.
 */
export function ocrAwareEditDistance(s1: string, s2: string): number {
  const a = s1.toLowerCase();
  const b = s2.toLowerCase();

  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const dp: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    dp[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    dp[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const charA = a[i - 1];
      const charB = b[j - 1];

      let cost = 1.0;
      if (charA === charB) {
        cost = 0;
      } else if (areOcrConfusable(charA, charB)) {
        cost = 0.35; // Lower penalty for OCR artifacts
      }

      dp[i][j] = Math.min(
        dp[i - 1][j] + 1.0, // deletion
        dp[i][j - 1] + 1.0, // insertion
        dp[i - 1][j - 1] + cost, // substitution
      );
    }
  }

  return dp[a.length][b.length];
}

/**
 * Calculate normalized similarity between two strings: 1.0 is identical, 0.0 is completely different.
 */
export function calculateSimilarity(s1: string, s2: string): number {
  const str1 = normalizeOcrToken(s1);
  const str2 = normalizeOcrToken(s2);

  if (!str1 || !str2) return 0;
  if (str1 === str2) return 1.0;

  const maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1.0;

  const dist = ocrAwareEditDistance(str1, str2);
  const rawScore = 1.0 - dist / maxLen;
  return Math.max(0, Math.min(1.0, rawScore));
}

/**
 * Cleans an OCR token by removing punctuation, normalizing spaces, and standardizing case.
 */
export function normalizeOcrToken(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Length-aware minimum similarity threshold:
 * Short names (e.g. Iron, Zinc, 3-4 chars) require high similarity (>= 0.88) to prevent false positives.
 * Medium names (5-7 chars) require >= 0.78.
 * Long names (>= 8 chars) require >= 0.72.
 */
export function getMinimumThresholdForLength(targetLength: number): number {
  if (targetLength <= 4) return 0.88;
  if (targetLength <= 7) return 0.78;
  return 0.72;
}

/**
 * Searches the pharmaceutical dictionary against a candidate query or OCR string.
 * Supports multi-word names and length-aware thresholds.
 */
export function findMedicineMatches(query: string, maxCandidates = 4): FuzzyMatchResult {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      bestMatch: null,
      candidates: [],
      isHighConfidence: false,
      originalQuery: query,
    };
  }

  const normalizedQuery = normalizeOcrToken(trimmed);
  const candidates: MedicineMatchCandidate[] = [];

  for (const entry of PHARMACEUTICAL_DICTIONARY) {
    // Check main name
    const allNamesToCheck = [entry.name, ...(entry.aliases ?? [])];

    let bestScoreForEntry = 0;
    let bestNameMatched = entry.name;
    let isExact = false;

    for (const nameCandidate of allNamesToCheck) {
      const normalizedCandidate = normalizeOcrToken(nameCandidate);
      if (normalizedCandidate === normalizedQuery) {
        bestScoreForEntry = 1.0;
        bestNameMatched = entry.name;
        isExact = true;
        break;
      }

      // Check substring match if query contains dosage/descriptors (e.g. "Metform1n Hydrochloride")
      let score = 0;
      if (
        normalizedQuery.length > normalizedCandidate.length &&
        normalizedQuery.startsWith(normalizedCandidate)
      ) {
        score = 0.95;
      } else {
        score = calculateSimilarity(normalizedQuery, normalizedCandidate);
      }

      if (score > bestScoreForEntry) {
        bestScoreForEntry = score;
        bestNameMatched = entry.name;
      }
    }

    const targetLength = Math.min(normalizedQuery.length, normalizeOcrToken(entry.name).length);
    const threshold = getMinimumThresholdForLength(targetLength);

    if (bestScoreForEntry >= threshold) {
      candidates.push({
        name: entry.name,
        genericName: entry.genericName,
        isBrand: entry.isBrand ?? false,
        score: Math.round(bestScoreForEntry * 100) / 100,
        isExact,
        originalText: trimmed,
      });
    }
  }

  // Sort candidates by descending score
  candidates.sort((a, b) => b.score - a.score);
  const topCandidates = candidates.slice(0, maxCandidates);

  if (topCandidates.length === 0) {
    return {
      bestMatch: null,
      candidates: [],
      isHighConfidence: false,
      originalQuery: query,
    };
  }

  const best = topCandidates[0];

  // High confidence conditions:
  // 1. Exact match (1.0), OR
  // 2. Score >= 0.85 AND either only 1 candidate OR score difference >= 0.10 from 2nd place
  let isHighConfidence = false;
  if (best.isExact || best.score >= 0.95) {
    isHighConfidence = true;
  } else if (best.score >= 0.84) {
    if (topCandidates.length === 1) {
      isHighConfidence = true;
    } else {
      const secondScore = topCandidates[1].score;
      isHighConfidence = best.score - secondScore >= 0.08;
    }
  }

  return {
    bestMatch: best,
    candidates: topCandidates,
    isHighConfidence,
    originalQuery: query,
  };
}

/**
 * Inspects a block of OCR raw text and extracts the medicine name using tokenization
 * and pharmaceutical fuzzy matching.
 */
export function extractAndMatchMedicineName(rawText: string): {
  matchedName?: string;
  genericName?: string;
  isBrand?: boolean;
  confidenceScore: number;
  isHighConfidence: boolean;
  candidates: MedicineMatchCandidate[];
  rawMatchText?: string;
} {
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return {
      confidenceScore: 0,
      isHighConfidence: false,
      candidates: [],
    };
  }

  // Collect potential candidate phrases: 1-word tokens and 2-word n-grams from first 4 lines
  const potentialTokens: string[] = [];
  const linesToScan = lines.slice(0, 4);

  for (const line of linesToScan) {
    // Remove typical strength & form noise for name matching (e.g. 500mg, tablets, usp, bp)
    const sanitized = line
      .replace(/\b\d+(\.\d+)?\s*(mg|mcg|g|iu|%|ml)\b/gi, '')
      .replace(/\b(tablets?|capsules?|cap|tab|usp|bp|oral|solution|suspension)\b/gi, '')
      .trim();

    if (!sanitized) continue;

    potentialTokens.push(sanitized);

    const words = sanitized.split(/\s+/).filter((w) => w.length >= 3);
    for (const word of words) {
      potentialTokens.push(word);
    }
    for (let i = 0; i < words.length - 1; i++) {
      potentialTokens.push(`${words[i]} ${words[i + 1]}`);
    }
  }

  let bestResult: FuzzyMatchResult = {
    bestMatch: null,
    candidates: [],
    isHighConfidence: false,
    originalQuery: '',
  };

  for (const token of potentialTokens) {
    const res = findMedicineMatches(token);
    if (!res.bestMatch) continue;

    if (!bestResult.bestMatch || res.bestMatch.score > bestResult.bestMatch.score) {
      bestResult = res;
      if (res.bestMatch.isExact) break; // Exact match found, stop looking
    }
  }

  if (bestResult.bestMatch) {
    return {
      matchedName: bestResult.bestMatch.name,
      genericName: bestResult.bestMatch.genericName,
      isBrand: bestResult.bestMatch.isBrand,
      confidenceScore: bestResult.bestMatch.score,
      isHighConfidence: bestResult.isHighConfidence,
      candidates: bestResult.candidates,
      rawMatchText: bestResult.bestMatch.originalText,
    };
  }

  return {
    confidenceScore: 0,
    isHighConfidence: false,
    candidates: [],
  };
}
