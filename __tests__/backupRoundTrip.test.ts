import { beforeEach, describe, expect, it } from '@jest/globals';
import { resetDatabase } from '../src/database/client';
import { backupService } from '../src/services/backupService';
import { profileRepository } from '../src/database/repositories/profileRepository';
import { medicineRepository } from '../src/database/repositories/medicineRepository';
import { scheduleRepository } from '../src/database/repositories/scheduleRepository';
import { adherenceRepository } from '../src/database/repositories/adherenceRepository';
import { scanHistoryRepository } from '../src/database/repositories/scanHistoryRepository';
import { aiRepository } from '../src/database/repositories/aiRepository';

const MEDICINE_ID = 'med_backup_roundtrip';
const SCHEDULE_ID = 'sched_backup_roundtrip';
const LOG_DATE = '2026-10-25'; // yesterday relative to the fixed fixture

function seedFixtureData(): void {
  profileRepository.saveProfile('Priya', { age: 30 }, true);
  profileRepository.updatePreference('snooze_interval_minutes', '15');

  medicineRepository.create({
    id: MEDICINE_ID,
    name: 'Napa Extra',
    strength: '500 mg',
    dosageForm: 'tablet',
    category: 'Analgesic',
    packageDetails: { manufacturer: 'Beximco' },
    isSample: false,
    currentInventory: 12,
    refillThreshold: 5,
    unitDosage: 'tablets',
  });

  scheduleRepository.save({
    id: SCHEDULE_ID,
    medicineId: MEDICINE_ID,
    recurrence: 'daily',
    startDate: '2026-10-20',
    endDate: '2026-12-31',
    times: [{ id: 't_morning', time: '09:00', amount: '1 tablet' }],
    enabled: true,
    notificationsEnabled: false,
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
  });

  // A real adherence log (taken dose) plus a scan and an AI conversation.
  adherenceRepository.logDoseStatus(SCHEDULE_ID, MEDICINE_ID, LOG_DATE, '09:00', 'taken');
  scanHistoryRepository.add({ medicineName: 'Napa Extra' });
  const conv = aiRepository.createConversation('Backup Q');
  aiRepository.addMessage(conv.id, {
    role: 'user',
    content: 'Can I take Napa with food?',
  });
}

describe('JSON backup round-trip', () => {
  beforeEach(() => {
    resetDatabase();
    seedFixtureData();
  });

  it('restores full history into a wiped database (exit criterion)', () => {
    const json = backupService.createBackupJson();
    expect(JSON.parse(json).format).toBe('healthmate-backup');

    // Simulate a wiped device.
    resetDatabase();
    expect(profileRepository.getProfile()).toBeNull();

    const parsed = backupService.parseBackup(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const { restored } = backupService.restoreFromBackup(parsed.payload);
    expect(restored).toBeGreaterThan(6);

    // Profile + preferences
    const profile = profileRepository.getProfile();
    expect(profile?.name).toBe('Priya');
    expect(profile?.age).toBe(30);
    expect(profile?.onboardingCompleted).toBe(true);
    expect(profileRepository.getPreferences().snoozeIntervalMinutes).toBe(15);

    // Medicine incl. inventory columns
    const med = medicineRepository.getById(MEDICINE_ID);
    expect(med?.name).toBe('Napa Extra');
    expect(med?.packageDetails.manufacturer).toBe('Beximco');
    // NOTE: currentInventory is 11, not 12 — logging the taken dose consumed
    // one unit before export. The backup must preserve that exact state.
    expect(med?.currentInventory).toBe(11);
    expect(med?.refillThreshold).toBe(5);

    // Schedule
    const schedule = scheduleRepository.getById(SCHEDULE_ID);
    expect(schedule?.recurrence).toBe('daily');
    expect(schedule?.times[0]?.time).toBe('09:00');
    expect(schedule?.enabled).toBe(true);

    // Adherence history survives (taken dose still reads back as taken)
    const doses = adherenceRepository.getDosesForDate(LOG_DATE);
    const dose = doses.find((d) => d.scheduleId === SCHEDULE_ID);
    expect(dose?.status).toBe('taken');

    // Scan history + AI chat
    const scans = scanHistoryRepository.getAll();
    expect(scans).toHaveLength(1);
    expect(scans[0]?.medicineName).toBe('Napa Extra');
    const conversations = aiRepository.getConversations();
    expect(conversations).toHaveLength(1);
    expect(conversations[0]?.messages).toHaveLength(1);
    expect(conversations[0]?.messages[0]?.content).toContain('Napa');
  });

  it('rejects malformed, foreign, and unknown-table backups without throwing', () => {
    expect(backupService.parseBackup('not json at all').ok).toBe(false);
    expect(backupService.parseBackup('{"nope": 1}').ok).toBe(false);
    expect(backupService.parseBackup('{"format": "other-app", "tables": {}}').ok).toBe(false);
    expect(
      backupService.parseBackup(
        '{"format": "healthmate-backup", "formatVersion": 99, "tables": {}}',
      ).ok,
    ).toBe(false);
    expect(
      backupService.parseBackup(
        '{"format": "healthmate-backup", "formatVersion": 1, "tables": {"evil": []}}',
      ).ok,
    ).toBe(false);
  });

  it('rejects invalid rows during restore and does not touch existing data', () => {
    // Existing data was seeded in beforeEach
    expect(profileRepository.getProfile()?.name).toBe('Priya');
    expect(medicineRepository.getById(MEDICINE_ID)?.name).toBe('Napa Extra');

    // Payload with corrupted schedule referencing a non-existent medicine
    const invalidPayload: any = {
      format: 'healthmate-backup',
      formatVersion: 1,
      schemaVersion: 3,
      exportedAt: new Date().toISOString(),
      tables: {
        medicines: [{ id: 'med_valid_1', name: 'Aspirin' }],
        schedules: [
          {
            id: 'sched_bad_1',
            medicine_id: 'med_non_existent',
            recurrence: 'daily',
            times_json: '[]',
          },
        ],
      },
    };

    expect(() => backupService.restoreFromBackup(invalidPayload)).toThrow(
      /references non-existent medicine/,
    );

    // Verify existing database data is untouched!
    expect(profileRepository.getProfile()?.name).toBe('Priya');
    expect(medicineRepository.getById(MEDICINE_ID)?.name).toBe('Napa Extra');
  });

  it('safely restores older backups with missing optional tables', () => {
    const olderBackupJson = JSON.stringify({
      format: 'healthmate-backup',
      formatVersion: 1,
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      tables: {
        medicines: [
          {
            id: 'med_old_1',
            name: 'Old Medicine',
            strength: '250 mg',
            dosage_form: 'tablet',
            category: 'General',
          },
        ],
        schedules: [
          {
            id: 'sched_old_1',
            medicine_id: 'med_old_1',
            recurrence: 'daily',
            times_json: '[{"id":"t1","time":"08:00","amount":"1"}]',
            enabled: 1,
          },
        ],
        // schedule_history, ai_conversations, refill_reminders omitted
      },
    });

    const parsed = backupService.parseBackup(olderBackupJson);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const { restored } = backupService.restoreFromBackup(parsed.payload);
    expect(restored).toBe(2);

    expect(medicineRepository.getById('med_old_1')?.name).toBe('Old Medicine');
    expect(scheduleRepository.getById('sched_old_1')?.recurrence).toBe('daily');
    // AI conversations table exists and is empty
    expect(aiRepository.getConversations()).toEqual([]);
  });

  it('accepts all supported recurrence values during validation', () => {
    const payload: any = {
      format: 'healthmate-backup',
      formatVersion: 2,
      schemaVersion: 3,
      exportedAt: new Date().toISOString(),
      tables: {
        medicines: [{ id: 'med_recurrence', name: 'Recurrence Medicine' }],
        schedules: [
          {
            id: 'sched_once',
            medicine_id: 'med_recurrence',
            recurrence: 'once',
          },
          {
            id: 'sched_custom',
            medicine_id: 'med_recurrence',
            recurrence: 'custom',
          },
        ],
      },
    };

    expect(backupService.validateBackupRows(payload)).toEqual({ valid: true });
  });
});
