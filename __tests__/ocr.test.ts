import { describe, it, expect } from '@jest/globals';
import { ocrService } from '../src/services/ocrService';

describe('OCR Package Data Extraction Service', () => {
  it('correctly extracts Metformin with strength, batch, and expiry', () => {
    const rawText = `
Metformin Hydrochloride Tablets USP
500 mg
Batch No: DEMO-MF0426
Exp Date: 12/2027
Manufactured by: Example Pharma Ltd.
    `;

    const extracted = ocrService.extractMedicineData(rawText);

    expect(extracted.medicineName).toBe('Metformin');
    expect(extracted.detectedStrength).toBe('500 mg');
    expect(extracted.batchNumber).toBe('DEMO-MF0426');
    expect(extracted.expiryDate).toBe('12/2027');
    expect(extracted.dosageForm).toBe('tablet');
  });

  it('correctly detects softgel and IU units for Vitamin D3', () => {
    const rawText = `
Vitamin D3 Dietary Supplement
1,000 IU Softgels
Exp: Aug 2027
    `;

    const extracted = ocrService.extractMedicineData(rawText);

    expect(extracted.medicineName).toBe('Vitamin D3');
    expect(extracted.detectedStrength).toBe('1,000 IU');
    expect(extracted.dosageForm).toBe('softgel');
    expect(extracted.expiryDate).toBe('Aug 2027');
  });

  it('correctly detects eye drops form and percentage concentration', () => {
    const rawText = `
Lubricating eye drops
0.5% Ophthalmic Solution
Batch: DEMO-ED0627
Exp: Jun 2027
    `;

    const extracted = ocrService.extractMedicineData(rawText);

    expect(extracted.medicineName).toBe('Lubricating eye drops');
    expect(extracted.detectedStrength).toBe('0.5%');
    expect(extracted.dosageForm).toBe('eye_drop');
  });

  it('correctly detects capsules for Amoxicillin', () => {
    const rawText = `
Amoxicillin Capsules USP
250 mg
Exp: Jan 2026
    `;

    const extracted = ocrService.extractMedicineData(rawText);

    expect(extracted.medicineName).toBe('Amoxicillin');
    expect(extracted.detectedStrength).toBe('250 mg');
    expect(extracted.dosageForm).toBe('capsule');
  });

  describe('Pharmaceutical Fuzzy Matching & OCR Error Correction', () => {
    it('corrects OCR artifact Metform1n to Metformin with high confidence', () => {
      const rawText = `
Metform1n Hydrochloride 500mg
Batch: B-9981
Exp: 10/2028
      `;

      const extracted = ocrService.extractMedicineData(rawText);

      expect(extracted.medicineName).toBe('Metformin');
      expect(extracted.detectedStrength).toBe('500mg');
      expect(extracted.isHighConfidence).toBe(true);
      expect(extracted.confidenceScore).toBeGreaterThanOrEqual(0.85);
    });

    it('corrects OCR artifact Amoxici11in to Amoxicillin with high confidence', () => {
      const rawText = `
Amoxici11in 500 mg
Capsules BP
Exp Date: 03/2027
      `;

      const extracted = ocrService.extractMedicineData(rawText);

      expect(extracted.medicineName).toBe('Amoxicillin');
      expect(extracted.detectedStrength).toBe('500 mg');
      expect(extracted.dosageForm).toBe('capsule');
      expect(extracted.isHighConfidence).toBe(true);
      expect(extracted.confidenceScore).toBeGreaterThanOrEqual(0.85);
    });

    it('handles mixed case and minor typos like cEtIrIzInE and Ibuprofn', () => {
      const extracted1 = ocrService.extractMedicineData('cEtIrIzInE 10 mg tab');
      expect(extracted1.medicineName).toBe('Cetirizine');

      const extracted2 = ocrService.extractMedicineData('Ibuprofn 400 mg Tablets');
      expect(extracted2.medicineName).toBe('Ibuprofen');
    });

    it('maps brand names to their generic counterpart in the pharmaceutical dictionary', () => {
      const extractedTylenol = ocrService.extractMedicineData('Tylenol 500 mg Extra Strength');
      expect(extractedTylenol.medicineName).toBe('Tylenol');
      expect(extractedTylenol.genericName).toBe('Acetaminophen');
      expect(extractedTylenol.isBrand).toBe(true);

      const extractedGlucophage = ocrService.extractMedicineData('Glucophage 850 mg');
      expect(extractedGlucophage.medicineName).toBe('Glucophage');
      expect(extractedGlucophage.genericName).toBe('Metformin');
      expect(extractedGlucophage.isBrand).toBe(true);
    });

    it('prevents short-name false positives (e.g. random 2-letter tokens do not match Iron or Zinc)', () => {
      const extractedIn = ocrService.extractMedicineData('IN 500 mg');
      // Should not falsely match Iron
      expect(extractedIn.medicineName).not.toBe('Iron');

      const extractedIron = ocrService.extractMedicineData('Iron Supplement 65 mg');
      expect(extractedIron.medicineName).toBe('Iron');
    });

    it('preserves candidates when OCR text is ambiguous or unknown', () => {
      const extractedAmbiguous = ocrService.extractMedicineData('Amiloid 5 mg');
      // Should have candidates list and allow user verification
      expect(extractedAmbiguous.candidates).toBeDefined();

      const extractedUnknown = ocrService.extractMedicineData('Xylophytol Complex 100 mg');
      expect(extractedUnknown.rawText).toContain('Xylophytol Complex');
      expect(extractedUnknown.isHighConfidence).toBe(false);
    });

    it('never infers dosage or formulation solely from medicine name', () => {
      const extracted = ocrService.extractMedicineData('Metformin Hydrochloride');
      // No strength in raw text, should NOT fabricate a strength
      expect(extracted.medicineName).toBe('Metformin');
      expect(extracted.detectedStrength).toBeUndefined();
    });
  });
});
