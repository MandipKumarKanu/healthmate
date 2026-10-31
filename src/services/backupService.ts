import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getDatabase, withTransaction } from '../database/client';
import { migrationManager } from '../database/migrationManager';
import { RECURRENCE_TYPES } from '../types';
import {
  getScanImageBackupAsset,
  isManagedScanImageUri,
  restoreScanImageBackupAsset,
  ScanImageBackupAsset,
} from './scanImageStorage';

/**
 * HealthMate — JSON backup / restore service
 *
 * Export produces a single, complete JSON snapshot of every user-data table.
 * Import validates the payload, wipes the local database (schema is rebuilt
 * via migrations) and re-inserts all rows, restoring the exact device state.
 * Local-first by design: nothing leaves the device; the UI decides whether to
 * copy / share / paste the JSON.
 *
 * Exit criterion: a wiped device can restore full history from the file.
 */

export const BACKUP_FORMAT = 'healthmate-backup';
export const BACKUP_FORMAT_VERSION = 2;

/** Tables in restore order: dependencies (medicines) precede children. */
const TABLES = [
  'profiles',
  'preferences',
  'medicines',
  'schedules',
  'schedule_history',
  'adherence_logs',
  'refill_reminders',
  'scan_history',
  'ai_conversations',
  'ai_messages',
] as const;

export type BackupTable = (typeof TABLES)[number];

export interface BackupPayload {
  format: string;
  formatVersion: number;
  schemaVersion: number;
  exportedAt: string;
  tables: Record<BackupTable, Record<string, unknown>[]>;
  assets?: {
    scanImages: ScanImageBackupAsset[];
  };
}

export interface BackupSummary {
  medicineCount: number;
  scheduleCount: number;
  doseLogCount: number;
  scanCount: number;
  chatCount: number;
  exportedAt: string;
  schemaVersion: number;
}

/** Column orders mirror the repository INSERT statements / demo adapter exactly. */
const TABLE_COLUMNS: Record<BackupTable, string[]> = {
  profiles: [
    'id',
    'name',
    'email',
    'age',
    'gender',
    'height',
    'weight',
    'unit_system',
    'created_at',
    'onboarding_completed',
  ],
  preferences: ['key', 'value'],
  medicines: [
    'id',
    'name',
    'strength',
    'dosage_form',
    'category',
    'ingredient',
    'manufacturer',
    'expiry_date',
    'batch_number',
    'package_details_text',
    'information_source',
    'created_at',
    'updated_at',
    'is_sample',
    'current_inventory',
    'refill_threshold',
    'unit_dosage',
  ],
  schedules: [
    'id',
    'medicine_id',
    'recurrence',
    'start_date',
    'end_date',
    'times_json',
    'enabled',
    'notifications_enabled',
    'created_at',
    'updated_at',
  ],
  schedule_history: [
    'id',
    'schedule_id',
    'medicine_id',
    'recurrence',
    'start_date',
    'end_date',
    'times_json',
    'created_at',
    'updated_at',
  ],
  adherence_logs: [
    'id',
    'schedule_id',
    'medicine_id',
    'dose_date',
    'dose_time',
    'status',
    'logged_at',
  ],
  refill_reminders: [
    'id',
    'medicine_id',
    'threshold',
    'current_stock',
    'status',
    'reminded_at',
    'created_at',
  ],
  scan_history: [
    'id',
    'medicine_name',
    'detected_strength',
    'dosage_form',
    'manufacturer',
    'batch_number',
    'expiry_date',
    'raw_text',
    'image_uri',
    'scanned_at',
  ],
  ai_conversations: ['id', 'title', 'created_at'],
  ai_messages: ['id', 'conversation_id', 'role', 'content', 'timestamp'],
};

function readTable(table: BackupTable): Record<string, unknown>[] {
  return getDatabase().getAllSync(`SELECT * FROM ${table};`);
}

export const backupService = {
  /**
   * Builds the current device state as a validated JSON string.
   */
  createBackupJson(): string {
    const tables = {} as BackupPayload['tables'];
    const scanImageAssets = new Map<string, ScanImageBackupAsset>();
    let rowCount = 0;
    for (const table of TABLES) {
      const rows = readTable(table);
      tables[table] = rows;
      if (table === 'scan_history') {
        for (const row of rows) {
          const asset = getScanImageBackupAsset(String(row.image_uri ?? ''));
          if (asset) scanImageAssets.set(asset.key, asset);
        }
      }
      rowCount += rows.length;
    }

    const payload: BackupPayload = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      schemaVersion: migrationManager.getCurrentVersion(getDatabase()),
      exportedAt: new Date().toISOString(),
      tables,
      assets: { scanImages: [...scanImageAssets.values()] },
    };
    void rowCount;
    return JSON.stringify(payload, null, 2);
  },

  /**
   * Validates and parses a JSON backup produced by `createBackupJson`.
   * Returns a discriminated result; never throws for malformed input.
   */
  parseBackup(json: string): { ok: true; payload: BackupPayload } | { ok: false; error: string } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { ok: false, error: 'The text is not valid JSON.' };
    }

    if (typeof parsed !== 'object' || parsed === null) {
      return { ok: false, error: 'Backup is not a JSON object.' };
    }
    const data = parsed as Record<string, unknown>;
    if (data.format !== BACKUP_FORMAT) {
      return {
        ok: false,
        error: 'This file is not a HealthMate AI backup.',
      };
    }
    const formatVersion = Number(data.formatVersion);
    if (
      !Number.isFinite(formatVersion) ||
      formatVersion < 1 ||
      formatVersion > BACKUP_FORMAT_VERSION
    ) {
      return {
        ok: false,
        error: `Unsupported backup format version (${String(data.formatVersion)}).`,
      };
    }

    const rawTables = data.tables;
    if (typeof rawTables !== 'object' || rawTables === null) {
      return { ok: false, error: 'Backup is missing its data tables.' };
    }

    const tables = {} as BackupPayload['tables'];
    for (const table of TABLES) {
      const rows = (rawTables as Record<string, unknown>)[table];
      if (rows === undefined) continue; // Older backups may omit a table.
      if (!Array.isArray(rows)) {
        return {
          ok: false,
          error: `Backup table "${table}" is not a list.`,
        };
      }
      tables[table] = rows.filter(
        (row): row is Record<string, unknown> => typeof row === 'object' && row !== null,
      );
    }

    for (const key of Object.keys(rawTables as Record<string, unknown>)) {
      if (!TABLES.includes(key as BackupTable)) {
        return {
          ok: false,
          error: `Backup contains an unknown table "${key}".`,
        };
      }
    }

    const rawAssets = data.assets;
    const scanImages =
      typeof rawAssets === 'object' && rawAssets !== null && Array.isArray((rawAssets as any).scanImages)
        ? (rawAssets as any).scanImages.filter(
            (asset: unknown): asset is ScanImageBackupAsset =>
              typeof asset === 'object' &&
              asset !== null &&
              typeof (asset as any).key === 'string' &&
              typeof (asset as any).extension === 'string' &&
              typeof (asset as any).base64 === 'string',
          )
        : [];

    return {
      ok: true,
      payload: {
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        schemaVersion: Number(data.schemaVersion) || 3,
        exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
        tables,
        assets: { scanImages },
      },
    };
  },

  /**
   * Validates row data across all tables before any database changes are made.
   */
  validateBackupRows(payload: BackupPayload): { valid: boolean; error?: string } {
    const medIds = new Set<string>();
    const scheduleIds = new Set<string>();
    const validRecurrences = new Set<string>(RECURRENCE_TYPES);

    if (payload.tables.medicines) {
      for (const row of payload.tables.medicines) {
        if (!row.id || typeof row.id !== 'string') {
          return { valid: false, error: 'Medicine record has invalid or missing id.' };
        }
        if (!row.name || typeof row.name !== 'string') {
          return { valid: false, error: `Medicine "${row.id}" has missing name.` };
        }
        if (medIds.has(row.id)) {
          return { valid: false, error: `Duplicate medicine id "${row.id}".` };
        }
        medIds.add(row.id);
      }
    }

    if (payload.tables.schedules) {
      for (const row of payload.tables.schedules) {
        if (!row.id || typeof row.id !== 'string') {
          return { valid: false, error: 'Schedule record has invalid or missing id.' };
        }
        if (!row.medicine_id || typeof row.medicine_id !== 'string') {
          return { valid: false, error: `Schedule "${row.id}" has missing medicine_id.` };
        }
        if (!medIds.has(row.medicine_id)) {
          return {
            valid: false,
            error: `Schedule "${row.id}" references non-existent medicine "${row.medicine_id}".`,
          };
        }
        if (row.recurrence && !validRecurrences.has(String(row.recurrence))) {
          return {
            valid: false,
            error: `Schedule "${row.id}" has unsupported recurrence "${String(row.recurrence)}".`,
          };
        }
        if (scheduleIds.has(row.id)) {
          return { valid: false, error: `Duplicate schedule id "${row.id}".` };
        }
        scheduleIds.add(row.id);
      }
    }

    if (payload.tables.schedule_history) {
      for (const row of payload.tables.schedule_history) {
        if (!row.id || typeof row.id !== 'string') {
          return { valid: false, error: 'Schedule history record has invalid or missing id.' };
        }
        if (!row.schedule_id || typeof row.schedule_id !== 'string') {
          return { valid: false, error: `Schedule history "${row.id}" has missing schedule_id.` };
        }
        if (!row.medicine_id || typeof row.medicine_id !== 'string' || !medIds.has(row.medicine_id)) {
          return { valid: false, error: `Schedule history "${row.id}" references an unknown medicine.` };
        }
        if (row.recurrence && !validRecurrences.has(String(row.recurrence))) {
          return {
            valid: false,
            error: `Schedule history "${row.id}" has unsupported recurrence "${String(row.recurrence)}".`,
          };
        }
        scheduleIds.add(row.schedule_id);
      }
    }

    if (payload.tables.adherence_logs) {
      const validStatuses = ['taken', 'missed', 'skipped', 'upcoming'];
      for (const row of payload.tables.adherence_logs) {
        if (!row.id || typeof row.id !== 'string') {
          return { valid: false, error: 'Adherence log has invalid or missing id.' };
        }
        if (row.status && !validStatuses.includes(String(row.status))) {
          return {
            valid: false,
            error: `Adherence log "${row.id}" has invalid status "${String(row.status)}".`,
          };
        }
        if (row.medicine_id && !medIds.has(String(row.medicine_id))) {
          return {
            valid: false,
            error: `Adherence log "${row.id}" references unknown medicine "${row.medicine_id}".`,
          };
        }
        if (row.schedule_id && !scheduleIds.has(String(row.schedule_id))) {
          return {
            valid: false,
            error: `Adherence log "${row.id}" references unknown schedule "${String(row.schedule_id)}".`,
          };
        }
      }
    }

    if (payload.tables.refill_reminders) {
      for (const row of payload.tables.refill_reminders) {
        if (row.medicine_id && !medIds.has(String(row.medicine_id))) {
          return {
            valid: false,
            error: `Refill reminder "${String(row.id ?? '')}" references unknown medicine.`,
          };
        }
      }
    }

    if (payload.tables.ai_messages) {
      const conversationIds = new Set(
        (payload.tables.ai_conversations ?? [])
          .map((row) => (typeof row.id === 'string' ? row.id : null))
          .filter((id): id is string => Boolean(id)),
      );
      for (const row of payload.tables.ai_messages) {
        if (row.conversation_id && !conversationIds.has(String(row.conversation_id))) {
          return {
            valid: false,
            error: `AI message "${String(row.id ?? '')}" references an unknown conversation.`,
          };
        }
      }
    }

    return { valid: true };
  },

  /**
   * Restores a validated payload atomically while keeping the current schema.
   * Embedded scan assets are written first and their URIs are remapped into
   * the restored scan-history rows.
   */
  restoreFromBackup(payload: BackupPayload): { restored: number } {
    const validation = this.validateBackupRows(payload);
    if (!validation.valid) {
      throw new Error(`Backup validation failed: ${validation.error}`);
    }

    const restoredAssetUris = new Map<string, string>();
    const createdAssetUris: string[] = [];

    try {
      for (const [index, asset] of (payload.assets?.scanImages ?? []).entries()) {
        const restoredUri = restoreScanImageBackupAsset(asset, index);
        if (!restoredUri) throw new Error(`Could not restore scan image asset "${asset.key}".`);
        restoredAssetUris.set(asset.key, restoredUri);
        createdAssetUris.push(restoredUri);
      }

      const restored = withTransaction(() => {
        const db = getDatabase();
        let rowCount = 0;

        // Delete children before parents while preserving the migrated schema.
        for (const table of [
          'ai_messages',
          'ai_conversations',
          'scan_history',
          'refill_reminders',
          'adherence_logs',
          'schedule_history',
          'schedules',
          'medicines',
          'preferences',
          'profiles',
        ]) {
          db.runSync(`DELETE FROM ${table};`);
        }

        for (const table of TABLES) {
          const rows = payload.tables[table];
          if (!rows || rows.length === 0) continue;

          const columns = TABLE_COLUMNS[table];
          const placeholders = columns.map(() => '?').join(', ');
          const insertSql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders});`;

          for (const row of rows) {
            const values = columns.map((col) => {
              if (table === 'scan_history' && col === 'image_uri') {
                const originalUri = typeof row[col] === 'string' ? row[col] : '';
                if (isManagedScanImageUri(originalUri)) {
                  const key = originalUri.split(/[?#]/)[0].split('/').pop() || '';
                  return restoredAssetUris.get(key) ?? null;
                }
              }
              return row[col] ?? null;
            });
            db.runSync(insertSql, values);
            rowCount++;
          }
        }

        return rowCount;
      });

      return { restored };
    } catch (restoreError) {
      for (const uri of createdAssetUris) {
        try {
          const file = new File(uri);
          if (file.exists) file.delete();
        } catch {
          // Startup orphan cleanup will remove an asset if immediate deletion fails.
        }
      }
      console.warn('Restoration failed; database transaction rolled back:', restoreError);
      throw restoreError;
    }
  },

  /**
   * Generates a high-level summary of the backup payload contents.
   */
  getSummary(payload: BackupPayload): BackupSummary {
    return {
      medicineCount: payload.tables.medicines?.length ?? 0,
      scheduleCount: payload.tables.schedules?.length ?? 0,
      doseLogCount: payload.tables.adherence_logs?.length ?? 0,
      scanCount: payload.tables.scan_history?.length ?? 0,
      chatCount: payload.tables.ai_conversations?.length ?? 0,
      exportedAt: payload.exportedAt,
      schemaVersion: payload.schemaVersion,
    };
  },

  /**
   * Standard timestamped backup filename: healthmate-backup-YYYY-MM-DD-HHmmss.json
   */
  generateBackupFileName(date: Date = new Date()): string {
    const timestamp = date.toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return `healthmate-backup-${timestamp}.json`;
  },

  /**
   * Writes the full JSON snapshot to a file in the app cache / document directory.
   */
  async writeBackupFile(
    customFileName?: string,
  ): Promise<{ uri: string; fileName: string; json: string }> {
    const json = this.createBackupJson();
    const fileName = customFileName ?? this.generateBackupFileName();
    const file = new File(Paths.cache, fileName);
    if (!file.exists) {
      file.create({ overwrite: true });
    }
    await file.write(json);
    return { uri: file.uri, fileName, json };
  },

  /**
   * Exports backup to a file and opens the system share/save dialog.
   */
  async exportAndShareBackupFile(): Promise<{ uri: string; fileName: string }> {
    const { uri, fileName } = await this.writeBackupFile();
    const isAvailable = await Sharing.isAvailableAsync();
    if (isAvailable) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/json',
        dialogTitle: `Save ${fileName}`,
        UTI: 'public.json',
      });
    }
    return { uri, fileName };
  },

  /**
   * Directly saves backup JSON into a user-selected Android folder via StorageAccessFramework.
   */
  async saveToAndroidFolder(fileName: string, json: string): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    const saf = FileSystem.StorageAccessFramework;
    if (!saf) return false;

    const permissions = await saf.requestDirectoryPermissionsAsync();
    if (!permissions.granted) {
      return false;
    }

    const cleanBaseName = fileName.replace(/\.json$/i, '');
    const safUri = await saf.createFileAsync(
      permissions.directoryUri,
      cleanBaseName,
      'application/json',
    );
    await FileSystem.writeAsStringAsync(safUri, json, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    return true;
  },

  /**
   * Opens the system file picker to select a backup JSON file,
   * reads and validates it, and returns the payload with a summary.
   */
  async pickAndParseBackupFile(): Promise<
    | { ok: true; payload: BackupPayload; fileName: string; summary: BackupSummary }
    | { ok: false; error: string; canceled?: boolean }
  > {
    try {
      const pickResult = await File.pickFileAsync({
        mimeTypes: ['application/json', 'text/*', '*/*'],
      });

      if (pickResult.canceled || !pickResult.result) {
        return { ok: false, error: 'File selection canceled', canceled: true };
      }

      const file = pickResult.result;
      let content = '';
      try {
        content = await file.text();
      } catch {
        content = await FileSystem.readAsStringAsync(file.uri, {
          encoding: FileSystem.EncodingType.UTF8,
        });
      }

      const parsed = this.parseBackup(content);
      if (!parsed.ok) {
        return { ok: false, error: parsed.error };
      }

      return {
        ok: true,
        payload: parsed.payload,
        fileName: file.name || 'backup.json',
        summary: this.getSummary(parsed.payload),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to pick backup file';
      return { ok: false, error: message };
    }
  },
};
