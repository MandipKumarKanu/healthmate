/**
 * HealthMate - Versioned Database Schema Migration Manager
 *
 * Tracks, applies, and verifies database migrations in sequential order.
 * Ensures data preservation, idempotent upgrades, error recovery, and
 * concurrent execution prevention.
 */

import { CREATE_TABLES_SQL } from './schema';
import { ISQLiteDatabase } from './client';

export interface MigrationRecord {
  version: number;
  name: string;
  applied_at: string;
}

export interface Migration {
  version: number;
  name: string;
  up: (db: ISQLiteDatabase) => void;
}

/**
 * Migration 1: Base Application Tables
 *
 * Single source of truth for the base schema lives in `schema.ts` — this
 * migration imports and applies it (removed the ~200 duplicated
 * SQL lines that previously drifted from `schema.ts`).
 */
const migration001_initial_schema: Migration = {
  version: 1,
  name: '001_initial_schema',
  up: (db) => {
    db.execSync(CREATE_TABLES_SQL);
  },
};

/**
 * Migration 2: Performance Indexes for Foreign Keys & Range Queries
 */
const migration002_performance_indexes: Migration = {
  version: 2,
  name: '002_performance_indexes',
  up: (db) => {
    db.execSync(`
      CREATE INDEX IF NOT EXISTS idx_schedules_medicine_id ON schedules(medicine_id);
      CREATE INDEX IF NOT EXISTS idx_schedule_history_medicine_id ON schedule_history(medicine_id);
      CREATE INDEX IF NOT EXISTS idx_adherence_logs_schedule ON adherence_logs(schedule_id);
      CREATE INDEX IF NOT EXISTS idx_adherence_logs_dose ON adherence_logs(medicine_id, dose_date);
      CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_scan_history_med ON scan_history(medicine_name);
    `);
  },
};

/**
 * Safely adds a column to a table if it doesn't already exist.
 */
function safeAddColumn(db: ISQLiteDatabase, table: string, columnDef: string, columnName: string) {
  try {
    db.execSync(`ALTER TABLE ${table} ADD COLUMN ${columnDef};`);
  } catch (e: any) {
    const msg = String(e?.message || '');
    if (msg.includes('duplicate column') || msg.includes('already exists')) {
      // Column already exists, safe to ignore
      return;
    }
    throw e;
  }
}

/**
 * Migration 3: Medication Inventory, Stock Tracking & Refill Reminders
 * Extensibility demonstration adding refill tracking fields.
 */
const migration003_medicine_inventory_and_refills: Migration = {
  version: 3,
  name: '003_medicine_inventory_and_refills',
  up: (db) => {
    safeAddColumn(db, 'medicines', 'current_inventory INTEGER DEFAULT NULL', 'current_inventory');
    safeAddColumn(db, 'medicines', 'refill_threshold INTEGER DEFAULT NULL', 'refill_threshold');
    safeAddColumn(db, 'medicines', 'unit_dosage TEXT DEFAULT NULL', 'unit_dosage');

    db.execSync(`
      CREATE TABLE IF NOT EXISTS refill_reminders (
        id TEXT PRIMARY KEY,
        medicine_id TEXT NOT NULL,
        threshold INTEGER NOT NULL,
        current_stock INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        reminded_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_refill_reminders_med ON refill_reminders(medicine_id);
    `);
  },
};

/**
 * Ordered Migration Registry
 */
export const MIGRATION_REGISTRY: Migration[] = [
  migration001_initial_schema,
  migration002_performance_indexes,
  migration003_medicine_inventory_and_refills,
];

// In-memory concurrency guard to prevent overlapping migration executions
let isMigrationRunning = false;

export const migrationManager = {
  /**
   * Initializes the schema_migrations tracking table if it does not exist.
   */
  ensureMigrationTable(db: ISQLiteDatabase): void {
    db.execSync(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
  },

  /**
   * Retrieves all applied migrations in ascending order.
   */
  getAppliedMigrations(db: ISQLiteDatabase): MigrationRecord[] {
    this.ensureMigrationTable(db);
    try {
      const rows = db.getAllSync<MigrationRecord>(
        'SELECT version, name, applied_at FROM schema_migrations ORDER BY version ASC;',
      );
      return rows;
    } catch {
      return [];
    }
  },

  /**
   * Returns the current schema version (highest applied migration version), or 0 if none applied.
   */
  getCurrentVersion(db: ISQLiteDatabase): number {
    const applied = this.getAppliedMigrations(db);
    if (applied.length === 0) return 0;
    return applied[applied.length - 1].version;
  },

  /**
   * Executes all pending migrations in order, recording success and handling failures safely.
   */
  runMigrations(
    db: ISQLiteDatabase,
    customRegistry: Migration[] = MIGRATION_REGISTRY,
  ): { appliedCount: number; currentVersion: number } {
    if (isMigrationRunning) {
      // Prevent concurrent initialization loops
      return {
        appliedCount: 0,
        currentVersion: this.getCurrentVersion(db),
      };
    }

    isMigrationRunning = true;
    try {
      this.ensureMigrationTable(db);

      const applied = this.getAppliedMigrations(db);
      const appliedSet = new Set(applied.map((m) => m.version));

      // Sort registry ascending by version
      const sortedMigrations = [...customRegistry].sort((a, b) => a.version - b.version);

      let appliedCount = 0;

      for (const migration of sortedMigrations) {
        if (appliedSet.has(migration.version)) {
          continue; // Already applied
        }

        const now = new Date().toISOString();

        try {
          // Execute migration
          migration.up(db);

          // Record successful migration in schema_migrations table
          db.runSync(
            'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?);',
            [migration.version, migration.name, now],
          );

          appliedSet.add(migration.version);
          appliedCount++;
        } catch (err) {
          console.error(
            `[MigrationManager] Migration ${migration.version} (${migration.name}) FAILED:`,
            err,
          );
          throw new Error(
            `Database migration ${migration.version} (${migration.name}) failed: ${String(
              err instanceof Error ? err.message : err,
            )}`,
          );
        }
      }

      return {
        appliedCount,
        currentVersion: this.getCurrentVersion(db),
      };
    } finally {
      isMigrationRunning = false;
    }
  },
};
