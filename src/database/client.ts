import * as SQLite from 'expo-sqlite';
import { CREATE_TABLES_SQL } from './schema';

export interface ISQLiteDatabase {
  execSync(sql: string): void;
  runSync(query: string, params?: unknown[]): { changes: number; lastInsertRowId: number };
  getFirstSync<T>(query: string, params?: unknown[]): T | null;
  getAllSync<T>(query: string, params?: unknown[]): T[];
}

class InMemoryDemonstrationDatabase implements ISQLiteDatabase {
  private profiles = new Map<string, Record<string, unknown>>();
  private preferences = new Map<string, { key: string; value: string }>();
  private medicines = new Map<string, Record<string, unknown>>();
  private schedules = new Map<string, Record<string, unknown>>();
  private adherenceLogs = new Map<string, Record<string, unknown>>();
  private scanHistory = new Map<string, Record<string, unknown>>();

  execSync(sql: string): void {
    if (sql.includes('DROP TABLE')) {
      this.profiles.clear();
      this.preferences.clear();
      this.medicines.clear();
      this.schedules.clear();
      this.adherenceLogs.clear();
      this.scanHistory.clear();
    }
  }

  runSync(query: string, params: unknown[] = []): { changes: number; lastInsertRowId: number } {
    const clean = query.trim().toUpperCase();

    if (clean.startsWith('INSERT OR REPLACE INTO PROFILES') || clean.startsWith('INSERT INTO PROFILES')) {
      if (params.length >= 10) {
        const [id, name, email, age, gender, height, weight, unitSystem, createdAt, onboardingCompleted] = params;
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
        this.profiles.set(id, { ...prof, onboarding_completed: Number(completed) });
      }
      return { changes: 1, lastInsertRowId: 1 };
    }

    if (clean.startsWith('INSERT OR REPLACE INTO PREFERENCES')) {
      const [key, value] = params;
      this.preferences.set(String(key), { key: String(key), value: String(value) });
      return { changes: 1, lastInsertRowId: 1 };
    }

    if (clean.startsWith('INSERT OR REPLACE INTO MEDICINES')) {
      const [
        id, name, strength, dosageForm, category, ingredient,
        manufacturer, expiryDate, batchNumber, packageDetailsText,
        informationSource, createdAt, updatedAt, isSample
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
      });
      return { changes: 1, lastInsertRowId: 1 };
    }

    if (clean.startsWith('DELETE FROM MEDICINES WHERE ID')) {
      const [id] = params;
      this.medicines.delete(String(id));
      return { changes: 1, lastInsertRowId: 1 };
    }

    if (clean.startsWith('INSERT OR REPLACE INTO SCHEDULES')) {
      const [
        id, medicineId, recurrence, startDate, endDate,
        timesJson, enabled, notificationsEnabled, createdAt, updatedAt
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

    if (clean.startsWith('DELETE FROM SCHEDULES WHERE ID')) {
      const [id] = params;
      this.schedules.delete(String(id));
      return { changes: 1, lastInsertRowId: 1 };
    }

    if (clean.startsWith('INSERT OR REPLACE INTO ADHERENCE_LOGS')) {
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

    if (clean.startsWith('INSERT OR REPLACE INTO SCAN_HISTORY')) {
      const [
        id, imageUri, rawOcrText, extractedMedicineName,
        extractedStrength, extractedDosageForm, extractedBatch,
        extractedExpiry, scannedAt
      ] = params;
      this.scanHistory.set(String(id), {
        id: String(id),
        image_uri: String(imageUri),
        raw_ocr_text: String(rawOcrText),
        extracted_medicine_name: extractedMedicineName ?? null,
        extracted_strength: extractedStrength ?? null,
        extracted_dosage_form: extractedDosageForm ?? null,
        extracted_batch: extractedBatch ?? null,
        extracted_expiry: extractedExpiry ?? null,
        scanned_at: String(scannedAt),
      });
      return { changes: 1, lastInsertRowId: 1 };
    }

    if (clean.startsWith('DELETE FROM SCAN_HISTORY WHERE ID')) {
      const [id] = params;
      this.scanHistory.delete(String(id));
      return { changes: 1, lastInsertRowId: 1 };
    }

    return { changes: 0, lastInsertRowId: 0 };
  }

  getFirstSync<T>(query: string, params: unknown[] = []): T | null {
    const all = this.getAllSync<T>(query, params);
    return all.length > 0 ? all[0] : null;
  }

  getAllSync<T>(query: string, params: unknown[] = []): T[] {
    const clean = query.trim().toUpperCase();

    if (clean.includes('FROM PROFILES')) {
      return Array.from(this.profiles.values()) as unknown as T[];
    }

    if (clean.includes('FROM PREFERENCES')) {
      return Array.from(this.preferences.values()) as unknown as T[];
    }

    if (clean.includes('FROM MEDICINES')) {
      if (clean.includes('WHERE ID =')) {
        const [id] = params;
        const item = this.medicines.get(String(id));
        return item ? ([item] as unknown as T[]) : [];
      }
      return Array.from(this.medicines.values()).sort((a, b) =>
        String(a.name).localeCompare(String(b.name))
      ) as unknown as T[];
    }

    if (clean.includes('FROM SCHEDULES')) {
      if (clean.includes('WHERE MEDICINE_ID =')) {
        const [medId] = params;
        return Array.from(this.schedules.values()).filter(
          (s) => s.medicine_id === String(medId)
        ) as unknown as T[];
      }
      if (clean.includes('WHERE ENABLED = 1')) {
        return Array.from(this.schedules.values()).filter(
          (s) => Number(s.enabled) === 1
        ) as unknown as T[];
      }
      return Array.from(this.schedules.values()) as unknown as T[];
    }

    if (clean.includes('FROM ADHERENCE_LOGS')) {
      if (clean.includes('WHERE DOSE_DATE =')) {
        const [doseDate] = params;
        return Array.from(this.adherenceLogs.values()).filter(
          (l) => l.dose_date === String(doseDate)
        ) as unknown as T[];
      }
      return Array.from(this.adherenceLogs.values()) as unknown as T[];
    }

    if (clean.includes('FROM SCAN_HISTORY')) {
      return Array.from(this.scanHistory.values()).sort((a, b) =>
        String(b.scanned_at).localeCompare(String(a.scanned_at))
      ) as unknown as T[];
    }

    return [];
  }
}

let dbInstance: ISQLiteDatabase | null = null;

export function getDatabase(): ISQLiteDatabase {
  if (!dbInstance) {
    try {
      const realDb = SQLite.openDatabaseSync('healthmate.db');
      realDb.execSync('PRAGMA foreign_keys = ON;');
      realDb.execSync(CREATE_TABLES_SQL);
      dbInstance = realDb as unknown as ISQLiteDatabase;
    } catch {
      // In Expo Go or client runtimes without native ExpoSQLite, fall back smoothly
      dbInstance = new InMemoryDemonstrationDatabase();
      dbInstance.execSync(CREATE_TABLES_SQL);
    }
  }
  return dbInstance!;
}

export function resetDatabase(): void {
  const db = getDatabase();
  db.execSync(`
    DROP TABLE IF EXISTS ai_messages;
    DROP TABLE IF EXISTS ai_conversations;
    DROP TABLE IF EXISTS scan_history;
    DROP TABLE IF EXISTS adherence_logs;
    DROP TABLE IF EXISTS schedules;
    DROP TABLE IF EXISTS medicines;
    DROP TABLE IF EXISTS profiles;
    DROP TABLE IF EXISTS preferences;
  `);
  db.execSync(CREATE_TABLES_SQL);
}
