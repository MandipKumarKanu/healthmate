import { describe, expect, it, beforeEach } from '@jest/globals';
import { medicineRepository } from '../src/database/repositories/medicineRepository';

describe('Medicine Editing', () => {
  const sampleMed = {
    id: 'med_test_edit',
    name: 'Initial Medicine',
    strength: '250 mg',
    dosageForm: 'capsule' as const,
    category: 'Prescription',
    packageDetails: {
      manufacturer: 'Alpha Pharma',
      expiryDate: '12/2026',
      batchNumber: 'LOT-100',
      packageDetailsText: 'Take one daily',
    },
    isSample: false,
  };

  beforeEach(() => {
    // Ensure clean state for test record
    try {
      medicineRepository.delete('med_test_edit');
    } catch {
      // ignore
    }
    medicineRepository.create(sampleMed);
  });

  it('updates medicine name and strength correctly', () => {
    const updated = medicineRepository.update('med_test_edit', {
      name: 'Updated Medicine Name',
      strength: '500 mg',
    });

    expect(updated).not.toBeNull();
    expect(updated?.name).toBe('Updated Medicine Name');
    expect(updated?.strength).toBe('500 mg');
    // Dosage form and other fields should be preserved
    expect(updated?.dosageForm).toBe('capsule');
    expect(updated?.packageDetails.manufacturer).toBe('Alpha Pharma');
  });

  it('updates package details without clearing other package fields', () => {
    const updated = medicineRepository.update('med_test_edit', {
      packageDetails: {
        expiryDate: '01/2028',
        batchNumber: 'LOT-200',
      },
    });

    expect(updated).not.toBeNull();
    expect(updated?.packageDetails.expiryDate).toBe('01/2028');
    expect(updated?.packageDetails.batchNumber).toBe('LOT-200');
    // Preserved existing manufacturer
    expect(updated?.packageDetails.manufacturer).toBe('Alpha Pharma');
  });

  it('updates dosage form and instructions', () => {
    const updated = medicineRepository.update('med_test_edit', {
      dosageForm: 'tablet',
      packageDetails: {
        packageDetailsText: 'Take twice daily with food',
      },
    });

    expect(updated).not.toBeNull();
    expect(updated?.dosageForm).toBe('tablet');
    expect(updated?.packageDetails.packageDetailsText).toBe('Take twice daily with food');
  });

  it('returns null when updating non-existent medicine', () => {
    const updated = medicineRepository.update('non_existent_id', {
      name: 'Does not exist',
    });
    expect(updated).toBeNull();
  });
});
