import { describe, expect, it } from '@jest/globals';
import { CREATE_TABLES_SQL } from '../src/database/schema';
import { MIGRATION_REGISTRY } from '../src/database/migrationManager';

const EXPECTED_BASE_TABLES = [
  'profiles',
  'medicines',
  'schedules',
  'schedule_history',
  'adherence_logs',
  'scan_history',
  'ai_conversations',
  'ai_messages',
  'preferences',
];

describe('Schema single source of truth', () => {
  it('migration 001 applies the shared CREATE_TABLES_SQL from schema.ts', () => {
    const migration001 = MIGRATION_REGISTRY.find((m) => m.version === 1);
    expect(migration001).toBeDefined();
    // The dedup: migration001 must execute schema.ts's shared SQL constant
    // instead of holding its own duplicated copy.
    expect((migration001 as any).up.toString()).toContain('CREATE_TABLES_SQL');
  });

  it('CREATE_TABLES_SQL defines every base table once', () => {
    for (const table of EXPECTED_BASE_TABLES) {
      const occurrences = (
        CREATE_TABLES_SQL.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`, 'g')) ?? []
      ).length;
      expect(occurrences).toBe(1);
    }
  });
});
