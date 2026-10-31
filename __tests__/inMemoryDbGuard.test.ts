import { describe, expect, it } from '@jest/globals';
import { InMemoryDemonstrationDatabase, resetDatabase } from '../src/database/client';
import { scanHistoryRepository } from '../src/database/repositories/scanHistoryRepository';

describe('In-memory database dev guard', () => {
  it('throws on a write statement that no handler understands (runSync)', () => {
    const db = new InMemoryDemonstrationDatabase();
    expect(() =>
      db.runSync('UPDATE mystery_planets SET explored = 1 WHERE id = ?;', ['earth']),
    ).toThrow('[InMemoryDemonstrationDatabase] Unsupported runSync statement');
  });

  it('throws on a read statement that no handler understands (getAllSync)', () => {
    const db = new InMemoryDemonstrationDatabase();
    expect(() => db.getAllSync('SELECT * FROM mystery_planets;')).toThrow(
      '[InMemoryDemonstrationDatabase] Unsupported getAllSync statement',
    );
  });

  it('throws on unrecognized execSync statements', () => {
    const db = new InMemoryDemonstrationDatabase();
    expect(() => db.execSync('REINDEX my_mystery_index;')).toThrow(
      '[InMemoryDemonstrationDatabase] Unsupported execSync statement',
    );
  });

  it('still absorbs schema DDL (PRAGMA / CREATE TABLE / CREATE INDEX / ALTER TABLE)', () => {
    const db = new InMemoryDemonstrationDatabase();
    expect(() => db.execSync('PRAGMA foreign_keys = ON;')).not.toThrow();
    expect(() =>
      db.execSync('CREATE TABLE IF NOT EXISTS demo_guard_probe (id TEXT);'),
    ).not.toThrow();
    expect(() =>
      db.execSync('CREATE INDEX IF NOT EXISTS idx_demo_guard_probe ON demo_guard_probe(id);'),
    ).not.toThrow();
    expect(() =>
      db.execSync('ALTER TABLE demo_guard_probe ADD COLUMN note TEXT DEFAULT NULL;'),
    ).not.toThrow();
  });

  it('handles a full scan_history clear and keeps the returned row count', () => {
    // Insert through the repository's real contract (root-cause fix:
    // the demo adapter previously ignored plain INSERT INTO entirely).
    const entry = scanHistoryRepository.add({ medicineName: 'Guard Probe Med' });
    expect(scanHistoryRepository.getAll().some((e) => e.id === entry.id)).toBe(true);

    const result = scanHistoryRepository.getAll();
    expect(result.length).toBe(1);

    scanHistoryRepository.clearAll();
    expect(scanHistoryRepository.getAll()).toEqual([]);
  });

  it('clears scan_history on DROP (reset previously leaked scan rows)', () => {
    const db = new InMemoryDemonstrationDatabase();
    db.runSync('INSERT INTO scan_history (id, medicine_name) VALUES (?, ?);', [
      'scan_guard_reset',
      'Guard Reset Med',
    ]);
    expect(db.getAllSync('SELECT * FROM scan_history;').length).toBe(1);

    db.execSync('DROP TABLE IF EXISTS scan_history;');
    expect(db.getAllSync('SELECT * FROM scan_history;')).toEqual([]);
    resetDatabase();
  });
});
