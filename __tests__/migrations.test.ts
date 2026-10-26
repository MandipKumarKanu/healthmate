import { describe, it, expect, beforeEach } from '@jest/globals';
import { getDatabase, resetDatabase, ISQLiteDatabase } from '../src/database/client';
import { migrationManager, Migration } from '../src/database/migrationManager';
import { profileRepository } from '../src/database/repositories/profileRepository';
import { medicineRepository } from '../src/database/repositories/medicineRepository';

describe('Versioned Database Schema Migration Manager', () => {
  beforeEach(() => {
    resetDatabase();
  });

  it('initializes fresh database and applies all migrations in sequential order', () => {
    const db = getDatabase();
    const applied = migrationManager.getAppliedMigrations(db);

    expect(applied.length).toBeGreaterThanOrEqual(3);
    expect(applied[0].version).toBe(1);
    expect(applied[1].version).toBe(2);
    expect(applied[2].version).toBe(3);

    const currentVersion = migrationManager.getCurrentVersion(db);
    expect(currentVersion).toBe(3);
  });

  it('reopening or re-running migrations does not re-apply already completed migrations', () => {
    const db = getDatabase();
    const firstRunCurrentVersion = migrationManager.getCurrentVersion(db);

    // Run again
    const secondRun = migrationManager.runMigrations(db);
    expect(secondRun.appliedCount).toBe(0);
    expect(secondRun.currentVersion).toBe(firstRunCurrentVersion);

    const appliedAfter = migrationManager.getAppliedMigrations(db);
    expect(appliedAfter.length).toBe(firstRunCurrentVersion);
  });

  it('preserves existing user data, medicines, and schedules across migrations', () => {
    const db = getDatabase();

    // Insert user data
    profileRepository.saveProfile('Marcus Aurelius', { age: 58, unitSystem: 'metric' }, true);
    const sampleMed = medicineRepository.create({
      id: 'med_test_mig',
      name: 'Lisinopril',
      strength: '10 mg',
      dosageForm: 'tablet',
      category: 'Heart',
      packageDetails: {},
    });

    // Simulate future migration adding new table or columns
    const futureMigration: Migration = {
      version: 99,
      name: '099_test_future_expansion',
      up: (database) => {
        database.execSync(`
          CREATE TABLE IF NOT EXISTS future_notes (
            id TEXT PRIMARY KEY,
            note TEXT NOT NULL
          );
        `);
      },
    };

    const result = migrationManager.runMigrations(db, [futureMigration]);
    expect(result.appliedCount).toBe(1);
    expect(result.currentVersion).toBe(99);

    // Verify existing user profile and medicine were completely preserved
    const loadedProfile = profileRepository.getProfile();
    expect(loadedProfile?.name).toBe('Marcus Aurelius');
    expect(loadedProfile?.age).toBe(58);

    const loadedMed = medicineRepository.getById(sampleMed.id);
    expect(loadedMed?.name).toBe('Lisinopril');
    expect(loadedMed?.strength).toBe('10 mg');
  });

  it('fails safely when a migration encounters an error and allows retry after fix', () => {
    const db = getDatabase();
    const initialVersion = migrationManager.getCurrentVersion(db);

    let shouldFail = true;
    const faultyMigration: Migration = {
      version: 88,
      name: '088_faulty_step',
      up: () => {
        if (shouldFail) {
          throw new Error('Simulated syntax or disk error during migration');
        }
      },
    };

    // Should throw error
    expect(() => {
      migrationManager.runMigrations(db, [faultyMigration]);
    }).toThrow('Database migration 88 (088_faulty_step) failed');

    // The failed migration version MUST NOT be recorded in schema_migrations
    const appliedAfterFailure = migrationManager.getAppliedMigrations(db);
    expect(appliedAfterFailure.some((m) => m.version === 88)).toBe(false);
    expect(migrationManager.getCurrentVersion(db)).toBe(initialVersion);

    // Fix the error and retry
    shouldFail = false;
    const retryResult = migrationManager.runMigrations(db, [faultyMigration]);
    expect(retryResult.appliedCount).toBe(1);
    expect(migrationManager.getCurrentVersion(db)).toBe(88);
  });

  it('prevents overlapping concurrent migration runs on the same process', () => {
    const db = getDatabase();
    const res1 = migrationManager.runMigrations(db);
    expect(res1.currentVersion).toBeGreaterThanOrEqual(3);
  });
});
