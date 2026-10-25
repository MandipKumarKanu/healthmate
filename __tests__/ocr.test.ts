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
});
