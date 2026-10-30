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
      expect(extracted.detectedStrength).toBe('500 mg');
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

  describe('Line-aware parsing & OCR noise repair', () => {
    it('repairs digit confusions in dates and confusable keys on messy labels', () => {
      const rawText = `
Cetrizine 10 mg Tablets
Batch N0: 8L0KK A1 203
Use before: 08/2O27
Mfg. by: Sun Pharma Laboratories Ltd.
      `;

      const extracted = ocrService.extractMedicineData(rawText);

      expect(extracted.medicineName).toBe('Cetirizine');
      expect(extracted.detectedStrength).toBe('10 mg');
      // "N0" key fix + spaced code is compacted
      expect(extracted.batchNumber).toBe('8L0KKA1203');
      // "2O27" → 2027
      expect(extracted.expiryDate).toBe('08/2027');
      // manufacturer keeps only its own line
      expect(extracted.manufacturer).toBe('Sun Pharma Laboratories Ltd.');
    });

    it('does not let the manufacturer swallow the expiry printed on the same line', () => {
      const rawText = `
Paracetamol 500 mg Tablets
Mfg. by: Cipla Ltd. Exp: 03/2028
Batch: PC-4521
      `;

      const extracted = ocrService.extractMedicineData(rawText);

      expect(extracted.medicineName).toBe('Paracetamol');
      expect(extracted.manufacturer).toBe('Cipla Ltd.');
      expect(extracted.expiryDate).toBe('03/2028');
      expect(extracted.batchNumber).toBe('PC-4521');
    });

    it('normalizes date variants found on packs', () => {
      const extracted1 = ocrService.extractMedicineData('Salbutamol Inhaler\nExpiry: 2028-07');
      expect(extracted1.expiryDate).toBe('07/2028');

      const extracted2 = ocrService.extractMedicineData(
        'Montelukast 10 mg\nUse before June 2028\nBatch: MN-2290',
      );
      expect(extracted2.expiryDate).toBe('Jun 2028');

      const extracted3 = ocrService.extractMedicineData(
        'Aspirin 75 mg\nExp. Date: 06/28\nLot: L-771',
      );
      expect(extracted3.expiryDate).toBe('06/2028');
    });

    it('does not fabricate dates from non-date words', () => {
      const extracted = ocrService.extractMedicineData(
        'Xylophytol Complex 100 mg\nDoes not expire',
      );
      expect(extracted.expiryDate).toBeUndefined();
    });

    it('rebuilds a clean name when the product is not in the dictionary', () => {
      const extracted = ocrService.extractMedicineData('Rx ARESTON 80mg');
      // "Rx" prefix and strength are stripped from the fallback name
      expect(extracted.medicineName).toBe('ARESTON');
      expect(extracted.isHighConfidence).toBe(false);
    });

    it('exposes the cleaned line list for the full-text display', () => {
      const rawText = 'Metformin 500mg Tablets BP\n\nBatch:  DEMO-MF0426';
      const extracted = ocrService.extractMedicineData(rawText);
      expect(extracted.lines).toEqual(['Metformin 500mg Tablets BP', 'Batch: DEMO-MF0426']);
    });

    it('tracks field-level confidence scores for structured fields', () => {
      const rawText = `
Metformin Hydrochloride Tablets USP
500 mg
Batch No: DEMO-MF0426
Exp Date: 12/2027
Manufactured by: Example Pharma Ltd.
      `;
      const extracted = ocrService.extractMedicineData(rawText);
      expect(extracted.fieldConfidence).toBeDefined();
      expect(extracted.fieldConfidence?.medicineName).toBeGreaterThan(0.7);
      expect(extracted.fieldConfidence?.detectedStrength).toBeGreaterThan(0.8);
      expect(extracted.fieldConfidence?.expiryDate).toBeGreaterThan(0.8);
      expect(extracted.fieldConfidence?.batchNumber).toBeGreaterThan(0.8);
      expect(extracted.fieldConfidence?.manufacturer).toBeGreaterThan(0.8);
    });

    it('handles degraded / noisy input with low confidence and missing fields gracefully', () => {
      // Very blurry or degraded label with only partial text
      const blurryText = '?? random glare line\n80mg\n?? illegible';
      const extracted = ocrService.extractMedicineData(blurryText);

      expect(extracted.isHighConfidence).toBe(false);
      expect(extracted.expiryDate).toBeUndefined();
      expect(extracted.batchNumber).toBeUndefined();
      expect(extracted.fieldConfidence?.medicineName).toBeLessThanOrEqual(0.6);
    });
  });
});
