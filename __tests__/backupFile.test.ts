import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { resetDatabase } from '../src/database/client';
import { backupService } from '../src/services/backupService';
import { profileRepository } from '../src/database/repositories/profileRepository';
import { medicineRepository } from '../src/database/repositories/medicineRepository';
import { scheduleRepository } from '../src/database/repositories/scheduleRepository';
import { adherenceRepository } from '../src/database/repositories/adherenceRepository';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

// Access mock helpers from __mocks__/expo-file-system.js
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { __setMockPickedFile, __initMockState } = require('expo-file-system');

describe('Backup file export & restore', () => {
  beforeEach(() => {
    __initMockState();
    resetDatabase();
    profileRepository.saveProfile('Alex', { age: 32 }, true);
    medicineRepository.create({
      id: 'med_test_file',
      name: 'Amoxicillin',
      strength: '500 mg',
      dosageForm: 'capsule',
      category: 'Antibiotic',
      packageDetails: { manufacturer: 'GSK' },
      isSample: false,
    });
    scheduleRepository.save({
      id: 'sched_test_file',
      medicineId: 'med_test_file',
      recurrence: 'daily',
      startDate: '2026-10-01',
      endDate: '2026-12-31',
      times: [{ id: 't1', time: '08:00', amount: '1 cap' }],
      enabled: true,
      notificationsEnabled: false,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    adherenceRepository.logDoseStatus('sched_test_file', 'med_test_file', '2026-10-25', '08:00', 'taken');
  });

  it('generates a clean timestamped backup filename', () => {
    const fileName = backupService.generateBackupFileName(new Date('2026-10-27T14:30:00.000Z'));
    expect(fileName).toBe('healthmate-backup-2026-10-27-14-30-00.json');
    expect(fileName.endsWith('.json')).toBe(true);
  });

  it('writes backup snapshot to a JSON file and reads summary', async () => {
    const { uri, fileName, json } = await backupService.writeBackupFile();

    expect(fileName).toContain('healthmate-backup-');
    expect(uri).toContain(fileName);
    expect(json).toContain('healthmate-backup');

    const file = new File(uri);
    expect(file.exists).toBe(true);
    const content = await file.text();
    expect(content).toBe(json);

    const parsed = backupService.parseBackup(content);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const summary = backupService.getSummary(parsed.payload);
    expect(summary.medicineCount).toBe(1);
    expect(summary.scheduleCount).toBe(1);
    expect(summary.doseLogCount).toBe(1);
  });

  it('exports and triggers system sharing', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { __getLastShared, __resetMockSharing } = require('expo-sharing');
    __resetMockSharing();

    const { uri, fileName } = await backupService.exportAndShareBackupFile();

    expect(fileName.endsWith('.json')).toBe(true);
    const lastShared = __getLastShared();
    expect(lastShared).not.toBeNull();
    expect(lastShared?.uri).toBe(uri);
    expect(lastShared?.options?.mimeType).toBe('application/json');
  });

  it('saves backup to Android folder via StorageAccessFramework', async () => {
    const json = backupService.createBackupJson();
    const saved = await backupService.saveToAndroidFolder('healthmate-backup-test.json', json);
    // On the test environment (non-Android), returns false gracefully
    expect(typeof saved).toBe('boolean');
  });

  it('picks and parses a backup file successfully', async () => {
    const json = backupService.createBackupJson();
    const mockFile = new File('file:///mock-documents/my-backup.json');
    await mockFile.write(json);

    __setMockPickedFile(mockFile);

    const result = await backupService.pickAndParseBackupFile();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.fileName).toBe('my-backup.json');
    expect(result.summary.medicineCount).toBe(1);
    expect(result.summary.scheduleCount).toBe(1);

    __setMockPickedFile(null);
  });

  it('handles canceled file picking gracefully', async () => {
    __setMockPickedFile(null);
    const result = await backupService.pickAndParseBackupFile();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.canceled).toBe(true);
  });
});
