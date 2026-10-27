import * as SQLite from 'expo-sqlite';
import { migrationManager } from './migrationManager';

export interface ISQLiteDatabase {
  execSync(sql: string): void;
  runSync(query: string, params?: unknown[]): { changes: number; lastInsertRowId: number };
  getFirstSync<T>(query: string, params?: unknown[]): T | null;
  getAllSync<T>(query: string, params?: unknown[]): T[];
}

declare const __DEV__: boolean | undefined;

/**
 * When true (dev builds, Expo Go, and Jest runs) the in-memory demonstration
 * database refuses to swallow unknown SQL: any statement that reaches the
 * end of a handler chain without matching a known write/read pattern throws
 * `Unsupported statement` instead of silently returning `changes: 0` / `[]`.
 * While the real SQLite path exists on
 * every device, Expo Go / CI run this in-memory DB, so a new repository
 * query that forgets a handler shows up as a loud test failure.
 */
function guardIsEnabled(): boolean {
  try {
    if (typeof __DEV__ !== 'undefined' && __DEV__) return true;
  } catch {
    // Ignore runtime lookups; fall through to the NODE_ENV check.
  }
  return process.env.NODE_ENV !== 'production';
}

class InMemoryDemonstrationDatabase implements ISQLiteDatabase {
  private schemaMigrations = new Map<
    number,
    { version: number; name: string; applied_at: string }
  >();
  private profiles = new Map<string, Record<string, unknown>>();
  private preferences = new Map<string, { key: string; value: string }>();
  private medicines = new Map<string, Record<string, unknown>>();
  private schedules = new Map<string, Record<string, unknown>>();
  private scheduleHistory = new Map<string, Record<string, unknown>>();
  private adherenceLogs = new Map<string, Record<string, unknown>>();
  private refillReminders = new Map<string, Record<string, unknown>>();
  private scanHistory = new Map<string, Record<string, unknown>>();
  private aiConversations = new Map<string, Record<string, unknown>>();
  private aiMessages = new Map<string, Record<string, unknown>>();

  execSync(sql: string): void {
    const clean = sql.trim().toUpperCase();
    if (clean.includes('DROP TABLE')) {
      if (clean.includes('SCHEMA_MIGRATIONS')) {
        this.schemaMigrations.clear();
      }
      this.profiles.clear();
      this.preferences.clear();
      this.medicines.clear();
      this.schedules.clear();
      this.scheduleHistory.clear();
      this.adherenceLogs.clear();
      this.refillReminders.clear();
      this.scanHistory.clear();
      this.aiConversations.clear();
      this.aiMessages.clear();
      return;
    }
    // Schema DDL (migrations, PRAGMAs) is absorbed: the in-memory layout is
    // hand-managed by the handlers below.
    const sqlUpper = sql.trim().toUpperCase();
    const isKnownDdl =
      sqlUpper.startsWith('PRAGMA') ||
      sqlUpper.startsWith('CREATE TABLE') ||
      sqlUpper.startsWith('CREATE INDEX') ||
      sqlUpper.startsWith('ALTER TABLE');
    if (isKnownDdl) return;
    if (guardIsEnabled()) {
      throw new Error(
        `[InMemoryDemonstrationDatabase] Unsupported execSync statement: ${sql.trim().slice(0, 160)}`,
      );
    }
  }

  runSync(query: string, params: unknown[] = []): { changes: number; lastInsertRowId: number } {
    const clean = query.trim().toUpperCase();

    if (
      clean.startsWith('INSERT OR REPLACE INTO PROFILES') ||
      clean.startsWith('INSERT INTO PROFILES')
    ) {
      if (params.length >= 10) {
        const [
          id,
          name,
          email,
          age,
          gender,
          height,
          weight,
          unitSystem,
          createdAt,
          onboardingCompleted,
        ] = params;
        this.profiles.set(String(id), {
          id: String(id),
          name: String(name),
          email: email ?? null,
          age: age !== undefined && age !== null ? Number(age) : null,
          gender: gender ?? null,
          height: height !== undefined && height !== null ? Number(height) : null,
          weight: weight !== undefined && weight !== null ? Number(weight) : null,
          unit_system: (unitSystem as string) || 'metric',
          created_at: String(createdAt),
          onboarding_completed: Number(onboardingCompleted),
        });
      } else {
        const [id, name, email, createdAt, onboardingCompleted] = params;
        this.profiles.set(String(id), {
          id: String(id),
          name: String(name),
          email: email ?? null,
          age: null,
          gender: null,
          height: null,
          weight: null,
          unit_system: 'metric',
          created_at: String(createdAt),
          onboarding_completed: Number(onboardingCompleted),
        });
      }
      return { changes: 1, lastInsertRowId: 1 };
    }

    if (clean.startsWith('UPDATE PROFILES SET ONBOARDING_COMPLETED')) {
      const [completed] = params;
      for (const [id, prof] of this.profiles.entries()) {
        this.profiles.set(id, {
          ...prof,
          onboarding_completed: Number(completed),
        });
      }
      return { changes: 1, lastInsertRowId: 1 };
    }

    if (
      clean.startsWith('INSERT OR REPLACE INTO PREFERENCES') ||
      clean.startsWith('INSERT INTO PREFERENCES')
    ) {
      const [key, value] = params;
      this.preferences.set(String(key), {
        key: String(key),
        value: String(value),
      });
      return { changes: 1, lastInsertRowId: 1 };
    }

    if (clean.startsWith('INSERT INTO SCHEMA_MIGRATIONS')) {
      const [version, name, applied_at] = params;
      this.schemaMigrations.set(Number(version), {
        version: Number(version),
        name: String(name),
        applied_at: String(applied_at),
      });
      return { changes: 1, lastInsertRowId: Number(version) };
    }

    if (
      clean.startsWith('INSERT OR REPLACE INTO MEDICINES') ||
      clean.startsWith('INSERT INTO MEDICINES')
    ) {
      const [
        id,
        name,
        strength,
        dosageForm,
        category,
        ingredient,
        manufacturer,
        expiryDate,
        batchNumber,
        packageDetailsText,
        informationSource,
        createdAt,
        updatedAt,
        isSample,
        currentInventory,
        refillThreshold,
        unitDosage,
      ] = params;
      this.medicines.set(String(id), {
        id: String(id),
        name: String(name),
        strength: String(strength),
        dosage_form: String(dosageForm),
        category: String(category),
        ingredient: ingredient ?? null,
        manufacturer: manufacturer ?? null,
        expiry_date: expiryDate ?? null,
        batch_number: batchNumber ?? null,
        package_details_text: packageDetailsText ?? null,
        information_source: informationSource ?? null,
        created_at: String(createdAt),
        updated_at: String(updatedAt),
        is_sample: Number(isSample),
        current_inventory:
          currentInventory === null || currentInventory === undefined
            ? null
            : Number(currentInventory),
        refill_threshold:
          refillThreshold === null || refillThreshold === undefined
            ? null
            : Number(refillThreshold),
        unit_dosage: unitDosage ?? null,
      });
      return { changes: 1, lastInsertRowId: 1 };
    }

    // Column order mirrors medicineRepository.update() SET clause exactly:
    // name, strength, dosage_form, category, ingredient, manufacturer,
    // expiry_date, batch_number, package_details_text, information_source,
    // updated_at, current_inventory, refill_threshold, unit_dosage, id.
    if (clean.startsWith('UPDATE MEDICINES SET') && params.length === 15) {
      const id = String(params[14]);
      const existing = this.medicines.get(id);
      if (!existing) return { changes: 0, lastInsertRowId: 0 };
      this.medicines.set(id, {
        ...existing,
        name: String(params[0]),
        strength: String(params[1]),
        dosage_form: String(params[2]),
        category: String(params[3]),
        ingredient: params[4] ?? null,
        manufacturer: params[5] ?? null,
        expiry_date: params[6] ?? null,
        batch_number: params[7] ?? null,
        package_details_text: params[8] ?? null,
        information_source: params[9] ?? null,
        updated_at: String(params[10]),
        current_inventory:
          params[11] === null || params[11] === undefined ? null : Number(params[11]),
        refill_threshold:
          params[12] === null || params[12] === undefined ? null : Number(params[12]),
        unit_dosage: params[13] ?? null,
      });
      return { changes: 1, lastInsertRowId: 1 };
    }

    if (clean.startsWith('DELETE FROM MEDICINES WHERE ID')) {
      const [id] = params;
      const existed = this.medicines.delete(String(id));
      return { changes: existed ? 1 : 0, lastInsertRowId: 0 };
    }

    if (clean.startsWith('DELETE FROM SCHEDULES WHERE MEDICINE_ID')) {
      const [medicineId] = params;
      let changes = 0;
      for (const [id, schedule] of this.schedules.entries()) {
        if (schedule.medicine_id === String(medicineId)) {
          this.schedules.delete(id);
          changes++;
        }
      }
      return { changes, lastInsertRowId: 0 };
    }

    if (
      clean.startsWith('INSERT OR REPLACE INTO SCHEDULE_HISTORY') ||
      clean.startsWith('INSERT INTO SCHEDULE_HISTORY')
    ) {
      const [
        id,
        scheduleId,
        medicineId,
        recurrence,
        startDate,
        endDate,
        timesJson,
        createdAt,
        updatedAt,
      ] = params;
      this.scheduleHistory.set(String(id), {
        id: String(id),
        schedule_id: String(scheduleId),
        medicine_id: String(medicineId),
        recurrence: String(recurrence),
        start_date: String(startDate),
        end_date: String(endDate),
        times_json: String(timesJson),
        enabled: 1,
        notifications_enabled: 0,
        created_at: String(createdAt),
        updated_at: String(updatedAt),
      });
      return { changes: 1, lastInsertRowId: 1 };
    }

    // Order mirrors scheduleRepository.compactScheduleHistory: end_date, id.
    if (clean.startsWith('UPDATE SCHEDULE_HISTORY SET END_DATE')) {
      const [endDate, idParam] = params;
      const id = String(idParam);
      const existing = this.scheduleHistory.get(id);
      if (!existing) return { changes: 0, lastInsertRowId: 0 };
      this.scheduleHistory.set(id, {
        ...existing,
        end_date: String(endDate),
      });
      return { changes: 1, lastInsertRowId: 1 };
    }

    if (clean.startsWith('DELETE FROM SCHEDULE_HISTORY WHERE ID')) {
      const [id] = params;
      const existed = this.scheduleHistory.delete(String(id));
      return { changes: existed ? 1 : 0, lastInsertRowId: 0 };
    }

    if (clean.startsWith('DELETE FROM ADHERENCE_LOGS WHERE MEDICINE_ID')) {
      const [medicineId] = params;
      let changes = 0;
      for (const [id, log] of this.adherenceLogs.entries()) {
        if (log.medicine_id === String(medicineId)) {
          this.adherenceLogs.delete(id);
          changes++;
        }
      }
      return { changes, lastInsertRowId: 0 };
    }

    if (
      clean.startsWith('INSERT OR REPLACE INTO SCHEDULES') ||
      clean.startsWith('INSERT INTO SCHEDULES')
    ) {
      const [
        id,
        medicineId,
        recurrence,
        startDate,
        endDate,
        timesJson,
        enabled,
        notificationsEnabled,
        createdAt,
        updatedAt,
      ] = params;
      this.schedules.set(String(id), {
        id: String(id),
        medicine_id: String(medicineId),
        recurrence: String(recurrence),
        start_date: String(startDate),
        end_date: endDate ?? null,
        times_json: String(timesJson),
        enabled: Number(enabled),
        notifications_enabled: Number(notificationsEnabled),
        created_at: String(createdAt),
        updated_at: String(updatedAt),
      });
      return { changes: 1, lastInsertRowId: 1 };
    }

    if (clean.startsWith('UPDATE SCHEDULES SET ENABLED')) {
      // Order mirrors scheduleRepository.toggleEnabled: enabled, updated_at, id.
      const [enabledFlag, updatedAt, idParam] = params;
      const id = String(idParam);
      const existing = this.schedules.get(id);
      if (!existing) return { changes: 0, lastInsertRowId: 0 };
      this.schedules.set(id, {
        ...existing,
        enabled: Number(enabledFlag),
        updated_at: String(updatedAt),
      });
      return { changes: 1, lastInsertRowId: 1 };
    }

    if (clean.startsWith('DELETE FROM SCHEDULES WHERE ID')) {
      const [id] = params;
      const existed = this.schedules.delete(String(id));
      return { changes: existed ? 1 : 0, lastInsertRowId: 0 };
    }

    if (
      clean.startsWith('INSERT OR REPLACE INTO ADHERENCE_LOGS') ||
      clean.startsWith('INSERT INTO ADHERENCE_LOGS')
    ) {
      const [id, scheduleId, medicineId, doseDate, doseTime, status, loggedAt] = params;
      this.adherenceLogs.set(String(id), {
        id: String(id),
        schedule_id: String(scheduleId),
        medicine_id: String(medicineId),
        dose_date: String(doseDate),
        dose_time: String(doseTime),
        status: String(status),
        logged_at: String(loggedAt),
      });
      return { changes: 1, lastInsertRowId: 1 };
    }

    if (clean.startsWith('DELETE FROM ADHERENCE_LOGS WHERE SCHEDULE_ID')) {
      const [scheduleId] = params;
      let changes = 0;
      for (const [id, log] of this.adherenceLogs.entries()) {
        if (log.schedule_id === String(scheduleId)) {
          this.adherenceLogs.delete(id);
          changes++;
        }
      }
      return { changes, lastInsertRowId: 0 };
    }

    if (
      clean.startsWith('INSERT OR REPLACE INTO REFILL_REMINDERS') ||
      clean.startsWith('INSERT INTO REFILL_REMINDERS')
    ) {
      const [id, medicineId, threshold, currentStock, status, remindedAt, createdAt] = params;
      this.refillReminders.set(String(id), {
        id: String(id),
        medicine_id: String(medicineId),
        threshold: Number(threshold),
        current_stock: Number(currentStock),
        status: String(status),
        reminded_at: remindedAt ?? null,
        created_at: String(createdAt),
      });
      return { changes: 1, lastInsertRowId: 1 };
    }

    if (clean.startsWith('UPDATE REFILL_REMINDERS SET STATUS')) {
      // Order mirrors refillService.markReminded: reminded_at, id
      const [remindedAt, id] = params;
      const row = this.refillReminders.get(String(id));
      if (!row) return { changes: 0, lastInsertRowId: 0 };
      this.refillReminders.set(String(id), {
        ...row,
        status: 'reminded',
        reminded_at: remindedAt == null ? null : String(remindedAt),
      });
      return { changes: 1, lastInsertRowId: 1 };
    }

    if (clean.startsWith('UPDATE REFILL_REMINDERS')) {
      // Order mirrors refillService: current_stock = ?, threshold = ? ... id = ?
      const [currentStock, threshold, id] = params;
      const row = this.refillReminders.get(String(id));
      if (!row) return { changes: 0, lastInsertRowId: 0 };
      this.refillReminders.set(String(id), {
        ...row,
        current_stock: Number(currentStock),
        threshold: Number(threshold),
      });
      return { changes: 1, lastInsertRowId: 1 };
    }

    if (clean.startsWith('DELETE FROM REFILL_REMINDERS WHERE ID')) {
      const [id] = params;
      const existed = this.refillReminders.delete(String(id));
      return { changes: existed ? 1 : 0, lastInsertRowId: 0 };
    }

    if (clean.startsWith('DELETE FROM REFILL_REMINDERS WHERE MEDICINE_ID')) {
      const [medicineId] = params;
      let changes = 0;
      for (const [id, row] of this.refillReminders.entries()) {
        if (row.medicine_id === String(medicineId)) {
          this.refillReminders.delete(id);
          changes++;
        }
      }
      return { changes, lastInsertRowId: 0 };
    }

    // Column order mirrors scanHistoryRepository.add() exactly: id,
    // medicine_name, detected_strength, dosage_form, manufacturer,
    // batch_number, expiry_date, raw_text, image_uri, scanned_at.
    if (
      clean.startsWith('INSERT INTO SCAN_HISTORY') ||
      clean.startsWith('INSERT OR REPLACE INTO SCAN_HISTORY')
    ) {
      const [
        id,
        medicineName,
        detectedStrength,
        dosageForm,
        manufacturer,
        batchNumber,
        expiryDate,
        rawText,
        imageUri,
        scannedAt,
      ] = params;
      this.scanHistory.set(String(id), {
        id: String(id),
        medicine_name: String(medicineName),
        detected_strength: detectedStrength ?? null,
        dosage_form: dosageForm ?? null,
        manufacturer: manufacturer ?? null,
        batch_number: batchNumber ?? null,
        expiry_date: expiryDate ?? null,
        raw_text: rawText ?? null,
        image_uri: imageUri ?? null,
        scanned_at: String(scannedAt),
      });
      return { changes: 1, lastInsertRowId: 1 };
    }

    if (clean.startsWith('DELETE FROM SCAN_HISTORY WHERE ID')) {
      const [id] = params;
      const existed = this.scanHistory.delete(String(id));
      return { changes: existed ? 1 : 0, lastInsertRowId: 0 };
    }

    if (clean === 'DELETE FROM SCAN_HISTORY;' || clean === 'DELETE FROM SCAN_HISTORY') {
      const changes = this.scanHistory.size;
      this.scanHistory.clear();
      return { changes, lastInsertRowId: 0 };
    }

    if (clean.startsWith('INSERT INTO AI_CONVERSATIONS')) {
      const [id, title, createdAt] = params;
      this.aiConversations.set(String(id), {
        id: String(id),
        title: String(title),
        created_at: String(createdAt),
      });
      return { changes: 1, lastInsertRowId: 1 };
    }

    if (clean.startsWith('INSERT INTO AI_MESSAGES')) {
      const [id, conversationId, role, content, timestamp] = params;
      this.aiMessages.set(String(id), {
        id: String(id),
        conversation_id: String(conversationId),
        role: String(role),
        content: String(content),
        timestamp: String(timestamp),
      });
      return { changes: 1, lastInsertRowId: 1 };
    }

    if (clean.startsWith('DELETE FROM AI_MESSAGES WHERE CONVERSATION_ID')) {
      const [conversationId] = params;
      let changes = 0;
      for (const [id, msg] of this.aiMessages.entries()) {
        if (msg.conversation_id === String(conversationId)) {
          this.aiMessages.delete(id);
          changes++;
        }
      }
      return { changes, lastInsertRowId: 0 };
    }

    if (clean.startsWith('DELETE FROM AI_CONVERSATIONS WHERE ID')) {
      const [id] = params;
      const existed = this.aiConversations.delete(String(id));
      return { changes: existed ? 1 : 0, lastInsertRowId: 0 };
    }

    if (clean === 'DELETE FROM AI_MESSAGES;' || clean === 'DELETE FROM AI_MESSAGES') {
      const changes = this.aiMessages.size;
      this.aiMessages.clear();
      return { changes, lastInsertRowId: 0 };
    }

    if (clean === 'DELETE FROM AI_CONVERSATIONS;' || clean === 'DELETE FROM AI_CONVERSATIONS') {
      const changes = this.aiConversations.size;
      this.aiConversations.clear();
      return { changes, lastInsertRowId: 0 };
    }

    if (clean.startsWith('DELETE FROM PREFERENCES WHERE KEY')) {
      const match = clean.match(/KEY\s*=\s*'([^']+)'/i);
      const key = params.length > 0 ? String(params[0]) : match ? match[1] : null;
      if (key) {
        const existed = this.preferences.delete(key);
        return { changes: existed ? 1 : 0, lastInsertRowId: 0 };
      }
      return { changes: 0, lastInsertRowId: 0 };
    }

    if (clean === 'DELETE FROM PREFERENCES;' || clean === 'DELETE FROM PREFERENCES') {
      const changes = this.preferences.size;
      this.preferences.clear();
      return { changes, lastInsertRowId: 0 };
    }

    if (guardIsEnabled()) {
      throw new Error(
        `[InMemoryDemonstrationDatabase] Unsupported runSync statement: ${query.trim().slice(0, 160)}`,
      );
    }
    return { changes: 0, lastInsertRowId: 0 };
  }

  getFirstSync<T>(query: string, params: unknown[] = []): T | null {
    const all = this.getAllSync<T>(query, params);
    return all.length > 0 ? all[0] : null;
  }

  getAllSync<T>(query: string, params: unknown[] = []): T[] {
    const clean = query.trim().toUpperCase();

    if (clean.includes('FROM SCHEMA_MIGRATIONS')) {
      return Array.from(this.schemaMigrations.values()).sort(
        (a, b) => a.version - b.version,
      ) as unknown as T[];
    }

    if (clean.includes('FROM PROFILES')) {
      return Array.from(this.profiles.values()) as unknown as T[];
    }

    if (clean.includes('FROM PREFERENCES')) {
      if (clean.includes('WHERE KEY =')) {
        const [key] = params;
        const item = this.preferences.get(String(key));
        return item ? ([item] as unknown as T[]) : [];
      }
      return Array.from(this.preferences.values()) as unknown as T[];
    }

    if (clean.includes('FROM MEDICINES')) {
      if (clean.includes('WHERE ID =')) {
        const [id] = params;
        const item = this.medicines.get(String(id));
        return item ? ([item] as unknown as T[]) : [];
      }
      return Array.from(this.medicines.values()).sort((a, b) =>
        String(a.name).localeCompare(String(b.name)),
      ) as unknown as T[];
    }

    if (clean.includes('FROM SCHEDULES')) {
      if (clean.includes('WHERE ID =')) {
        const [id] = params;
        const item = this.schedules.get(String(id));
        return item ? ([item] as unknown as T[]) : [];
      }
      if (clean.includes('WHERE MEDICINE_ID =')) {
        const [medId] = params;
        return Array.from(this.schedules.values()).filter(
          (s) => s.medicine_id === String(medId),
        ) as unknown as T[];
      }
      if (clean.includes('WHERE ENABLED = 1')) {
        return Array.from(this.schedules.values()).filter(
          (s) => Number(s.enabled) === 1,
        ) as unknown as T[];
      }
      return Array.from(this.schedules.values()) as unknown as T[];
    }

    if (clean.includes('FROM SCHEDULE_HISTORY')) {
      if (clean.includes('WHERE SCHEDULE_ID =')) {
        const [schedId] = params;
        return Array.from(this.scheduleHistory.values()).filter(
          (s) => s.schedule_id === String(schedId),
        ) as unknown as T[];
      }
      return Array.from(this.scheduleHistory.values()) as unknown as T[];
    }

    if (clean.includes('FROM ADHERENCE_LOGS')) {
      if (clean.includes('WHERE DOSE_DATE =')) {
        const [doseDate] = params;
        let rows = Array.from(this.adherenceLogs.values()).filter(
          (l) => l.dose_date === String(doseDate),
        ) as unknown as Record<string, unknown>[];
        if (clean.includes('AND DOSE_TIME =')) {
          const doseTime = String(params[1]);
          rows = rows.filter((l) => l.dose_time === doseTime);
        }
        if (clean.includes('AND SCHEDULE_ID =')) {
          const scheduleId = String(params[2]);
          rows = rows.filter((l) => l.schedule_id === scheduleId);
        }
        return rows as unknown as T[];
      }
      return Array.from(this.adherenceLogs.values()) as unknown as T[];
    }

    if (clean.includes('FROM REFILL_REMINDERS')) {
      if (clean.includes('WHERE ID =')) {
        const [id] = params;
        const item = this.refillReminders.get(String(id));
        return item ? ([item] as unknown as T[]) : [];
      }
      if (clean.includes('WHERE MEDICINE_ID =')) {
        const [medicineId] = params;
        return Array.from(this.refillReminders.values()).filter(
          (r) => r.medicine_id === String(medicineId),
        ) as unknown as T[];
      }
      return Array.from(this.refillReminders.values()) as unknown as T[];
    }

    if (clean.includes('FROM SCAN_HISTORY')) {
      if (clean.includes('WHERE ID =')) {
        const [id] = params;
        const item = this.scanHistory.get(String(id));
        return item ? ([item] as unknown as T[]) : [];
      }
      return Array.from(this.scanHistory.values()).sort((a, b) =>
        String(b.scanned_at).localeCompare(String(a.scanned_at)),
      ) as unknown as T[];
    }

    if (clean.includes('FROM AI_CONVERSATIONS')) {
      if (clean.includes('WHERE ID =')) {
        const [id] = params;
        const item = this.aiConversations.get(String(id));
        return item ? ([item] as unknown as T[]) : [];
      }
      return Array.from(this.aiConversations.values()).sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at)),
      ) as unknown as T[];
    }

    if (clean.includes('FROM AI_MESSAGES')) {
      if (clean.includes('WHERE CONVERSATION_ID =')) {
        const [convId] = params;
        return Array.from(this.aiMessages.values())
          .filter((m) => m.conversation_id === String(convId))
          .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))) as unknown as T[];
      }
      return Array.from(this.aiMessages.values()).sort((a, b) =>
        String(a.timestamp).localeCompare(String(b.timestamp)),
      ) as unknown as T[];
    }

    if (guardIsEnabled()) {
      throw new Error(
        `[InMemoryDemonstrationDatabase] Unsupported getAllSync statement: ${query.trim().slice(0, 160)}`,
      );
    }
    return [];
  }
}

export { InMemoryDemonstrationDatabase };

let dbInstance: ISQLiteDatabase | null = null;

export function getDatabase(): ISQLiteDatabase {
  if (!dbInstance) {
    try {
      const realDb = SQLite.openDatabaseSync('healthmate.db');
      realDb.execSync('PRAGMA foreign_keys = ON;');
      dbInstance = realDb as unknown as ISQLiteDatabase;
    } catch {
      // In Expo Go or client runtimes without native ExpoSQLite, fall back smoothly
      dbInstance = new InMemoryDemonstrationDatabase();
    }
    migrationManager.runMigrations(dbInstance);
  }
  return dbInstance!;
}

export function resetDatabase(): void {
  const db = getDatabase();
  db.execSync(`
    DROP TABLE IF EXISTS schema_migrations;
    DROP TABLE IF EXISTS refill_reminders;
    DROP TABLE IF EXISTS ai_messages;
    DROP TABLE IF EXISTS ai_conversations;
    DROP TABLE IF EXISTS scan_history;
    DROP TABLE IF EXISTS adherence_logs;
    DROP TABLE IF EXISTS schedule_history;
    DROP TABLE IF EXISTS schedules;
    DROP TABLE IF EXISTS medicines;
    DROP TABLE IF EXISTS profiles;
    DROP TABLE IF EXISTS preferences;
  `);
  migrationManager.runMigrations(db);
}
