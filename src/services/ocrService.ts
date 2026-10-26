import { DosageForm } from '../types';
import {
  extractAndMatchMedicineName,
  MedicineMatchCandidate,
} from './pharmaceuticalDictionary';

export interface ExtractedMedicineData {
  medicineName?: string;
  genericName?: string;
  isBrand?: boolean;
  confidenceScore?: number;
  isHighConfidence?: boolean;
  candidates?: MedicineMatchCandidate[];
  originalMatchText?: string;
  detectedStrength?: string;
  dosageForm?: DosageForm;
  manufacturer?: string;
  batchNumber?: string;
  expiryDate?: string;
  rawText: string;
}

export const ocrService = {
  extractMedicineData(rawText: string): ExtractedMedicineData {
    const text = rawText.trim();
    const result: ExtractedMedicineData = { rawText: text };

    // 1. Identify Medicine Name using Pharmaceutical Dictionary & Fuzzy Matching
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
      // Fallback for unlisted/experimental medicines: first capitalized keyword from top lines
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length > 0) {
        const firstLineWords = lines[0].split(/\s+/);
        result.medicineName = firstLineWords.slice(0, 2).join(' ');
        result.confidenceScore = 0.5;
        result.isHighConfidence = false;
        result.candidates = [];
      }
    }

    // 2. Identify Strength (e.g. 500 mg, 1,000 IU, 10 mg, 0.5%, 250 mg)
    const strengthMatch = text.match(
      /\b(\d+(?:,\d+)?(?:\.\d+)?\s*(?:mg|mcg|g|iu|%|ml|tablets?))(?=$|\s|[^\w%])/i
    );
    if (strengthMatch) {
      result.detectedStrength = strengthMatch[1].trim();
    }

    // 3. Identify Dosage Form
    const lower = text.toLowerCase();
    if (lower.includes('eye drop') || lower.includes('ophthalmic')) {
      result.dosageForm = 'eye_drop';
    } else if (lower.includes('softgel')) {
      result.dosageForm = 'softgel';
    } else if (lower.includes('capsule') || lower.includes('cap')) {
      result.dosageForm = 'capsule';
    } else if (lower.includes('tablet') || lower.includes('tab')) {
      result.dosageForm = 'tablet';
    } else if (lower.includes('syrup') || lower.includes('oral liquid')) {
      result.dosageForm = 'syrup';
    } else if (lower.includes('cream') || lower.includes('ointment')) {
      result.dosageForm = 'cream';
    } else if (lower.includes('injection')) {
      result.dosageForm = 'injection';
    }

    // 4. Identify Expiry Date (e.g. Exp 12/2027, Expiry: Dec 2027, Exp. Date: 05/28)
    const expiryMatch = text.match(
      /(?:exp(?:iry|\.|\s*date)?)\s*[:.-]?\s*([A-Za-z0-9/ -]{4,12})/i
    );
    if (expiryMatch) {
      result.expiryDate = expiryMatch[1].trim();
    }

    // 5. Identify Batch / Lot Number (e.g. Batch: DEMO-MF0426, Batch No: DEMO-MF0426, Lot: 48921)
    const batchMatch = text.match(
      /(?:batch(?:\s*no\.?)?|lot(?:\s*no\.?)?|b\.?no\.?)\s*[:.-]?\s*([A-Za-z0-9-]+)/i
    );
    if (batchMatch) {
      result.batchNumber = batchMatch[1].trim();
    }

    // 6. Identify Manufacturer
    const mfgMatch = text.match(
      /(?:mfg|manufactured by|mfd by|pharma(?:ceutical)?)\s*[:.-]?\s*([A-Za-z0-9 &.,-]+)/i
    );
    if (mfgMatch) {
      result.manufacturer = mfgMatch[1].trim();
    }

    return result;
  },
};
