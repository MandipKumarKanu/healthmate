import { getDatabase, resetDatabase } from "../database/client";
import { migrationManager } from "../database/migrationManager";

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

export const BACKUP_FORMAT = "healthmate-backup";
export const BACKUP_FORMAT_VERSION = 1;

/** Tables in restore order: dependencies (medicines) precede children. */
const TABLES = [
  "profiles",
  "preferences",
  "medicines",
  "schedules",
  "schedule_history",
  "adherence_logs",
  "refill_reminders",
  "scan_history",
  "ai_conversations",
  "ai_messages",
] as const;

export type BackupTable = (typeof TABLES)[number];

export interface BackupPayload {
  format: string;
  formatVersion: number;
  schemaVersion: number;
  exportedAt: string;
  tables: Record<BackupTable, Record<string, unknown>[]>;
}

/** Column orders mirror the repository INSERT statements / demo adapter exactly. */
const TABLE_COLUMNS: Record<BackupTable, string[]> = {
  profiles: [
    "id",
    "name",
    "email",
    "age",
    "gender",
    "height",
    "weight",
    "unit_system",
    "created_at",
    "onboarding_completed",
  ],
  preferences: ["key", "value"],
  medicines: [
    "id",
    "name",
    "strength",
    "dosage_form",
    "category",
    "ingredient",
    "manufacturer",
    "expiry_date",
    "batch_number",
    "package_details_text",
    "information_source",
    "created_at",
    "updated_at",
    "is_sample",
    "current_inventory",
    "refill_threshold",
    "unit_dosage",
  ],
  schedules: [
    "id",
    "medicine_id",
    "recurrence",
    "start_date",
    "end_date",
    "times_json",
    "enabled",
    "notifications_enabled",
    "created_at",
    "updated_at",
  ],
  schedule_history: [
    "id",
    "schedule_id",
    "medicine_id",
    "recurrence",
    "start_date",
    "end_date",
    "times_json",
    "created_at",
    "updated_at",
  ],
  adherence_logs: [
    "id",
    "schedule_id",
    "medicine_id",
    "dose_date",
    "dose_time",
    "status",
    "logged_at",
  ],
  refill_reminders: [
    "id",
    "medicine_id",
    "threshold",
    "current_stock",
    "status",
    "reminded_at",
    "created_at",
  ],
  scan_history: [
    "id",
    "medicine_name",
    "detected_strength",
    "dosage_form",
    "manufacturer",
    "batch_number",
    "expiry_date",
    "raw_text",
    "image_uri",
    "scanned_at",
  ],
  ai_conversations: ["id", "title", "created_at"],
  ai_messages: ["id", "conversation_id", "role", "content", "timestamp"],
};

function readTable(table: BackupTable): Record<string, unknown>[] {
  return getDatabase().getAllSync(`SELECT * FROM ${table};`);
}

export const backupService = {
  /**
   * Builds the current device state as a validated JSON string.
   */
  createBackupJson(): string {
    const tables = {} as BackupPayload["tables"];
    let rowCount = 0;
    for (const table of TABLES) {
      const rows = readTable(table);
      tables[table] = rows;
      rowCount += rows.length;
    }

    const payload: BackupPayload = {
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      schemaVersion: migrationManager.getCurrentVersion(getDatabase()),
      exportedAt: new Date().toISOString(),
      tables,
    };
    void rowCount;
    return JSON.stringify(payload, null, 2);
  },

  /**
   * Validates and parses a JSON backup produced by `createBackupJson`.
   * Returns a discriminated result; never throws for malformed input.
   */
  parseBackup(json: string):
    | { ok: true; payload: BackupPayload }
    | { ok: false; error: string } {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return { ok: false, error: "The text is not valid JSON." };
    }

    if (typeof parsed !== "object" || parsed === null) {
      return { ok: false, error: "Backup is not a JSON object." };
    }
    const data = parsed as Record<string, unknown>;
    if (data.format !== BACKUP_FORMAT) {
      return {
        ok: false,
        error: "This file is not a HealthMate AI backup.",
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
        error: `Unsupported backup format version (${String(
          data.formatVersion,
        )}).`,
      };
    }

    const rawTables = data.tables;
    if (typeof rawTables !== "object" || rawTables === null) {
      return { ok: false, error: "Backup is missing its data tables." };
    }

    const tables = {} as BackupPayload["tables"];
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
        (row): row is Record<string, unknown> =>
          typeof row === "object" && row !== null,
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

    return {
      ok: true,
      payload: {
        format: BACKUP_FORMAT,
        formatVersion: BACKUP_FORMAT_VERSION,
        schemaVersion: Number(data.schemaVersion) || 3,
        exportedAt:
          typeof data.exportedAt === "string" ? data.exportedAt : "",
        tables,
      },
    };
  },

  /**
   * Restores a validated payload: wipe → rebuild schema → re-insert rows.
   * Returns the number of restored rows. Callers are responsible for
   * refreshing Zustand stores and re-reconciling notifications afterwards.
   */
  restoreFromBackup(payload: BackupPayload): { restored: number } {
    resetDatabase(); // Drops all data and re-runs migrations (schema v3).

    const db = getDatabase();
    let restored = 0;

    for (const table of TABLES) {
      const rows = payload.tables[table];
      if (!rows || rows.length === 0) continue;

      const columns = TABLE_COLUMNS[table];
      const placeholders = columns.map(() => "?").join(", ");
      // Plain INSERT: restore always runs on a freshly-wiped database, so
      // there is nothing to replace (matches the adapter contract too).
      const insertSql = `INSERT INTO ${table} (${columns.join(
        ", ",
      )}) VALUES (${placeholders});`;

      for (const row of rows) {
        db.runSync(insertSql, columns.map((col) => row[col] ?? null));
        restored++;
      }
    }

    return { restored };
  },
};
