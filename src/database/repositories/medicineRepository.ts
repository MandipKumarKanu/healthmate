import { getDatabase } from '../client';
import { Medicine, DosageForm } from '../../types';

interface MedicineRow {
  id: string;
  name: string;
  strength: string;
  dosage_form: string;
  category: string;
  ingredient: string | null;
  manufacturer: string | null;
  expiry_date: string | null;
  batch_number: string | null;
  package_details_text: string | null;
  information_source: string | null;
  created_at: string;
  updated_at: string;
  is_sample: number;
}

function mapRowToMedicine(row: MedicineRow): Medicine {
  return {
    id: row.id,
    name: row.name,
    strength: row.strength,
    dosageForm: row.dosage_form as DosageForm,
    category: row.category,
    ingredient: row.ingredient ?? undefined,
    packageDetails: {
      manufacturer: row.manufacturer ?? undefined,
      expiryDate: row.expiry_date ?? undefined,
      batchNumber: row.batch_number ?? undefined,
      packageDetailsText: row.package_details_text ?? undefined,
    },
    informationSource: row.information_source ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isSample: row.is_sample === 1,
  };
}

/**
 * Parse common expiry formats and return the final millisecond of the expiry
 * period. Unknown formats return null rather than guessing.
 */
function getExpiryTimestamp(value?: string): number | null {
  if (!value?.trim()) return null;
  const input = value.trim();
  let match = input.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = match[3] ? Number(match[3]) : new Date(year, month, 0).getDate();
    if (month < 1 || month > 12 || day < 1 || day > new Date(year, month, 0).getDate()) return null;
    return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
  }
  match = input.match(/^(\d{1,2})[/-](\d{2}|\d{4})$/);
  if (match) {
    const month = Number(match[1]);
    let year = Number(match[2]);
    if (match[2].length === 2) year += year >= 70 ? 1900 : 2000;
    if (month < 1 || month > 12) return null;
    return new Date(year, month, 0, 23, 59, 59, 999).getTime();
  }
  match = input.match(/^(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{4})$/i);
  if (match) {
    const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const month = monthNames.indexOf(match[1].slice(0, 3).toLowerCase());
    return new Date(Number(match[2]), month + 1, 0, 23, 59, 59, 999).getTime();
  }
  return null;
}

export const medicineRepository = {
  getAll(): Medicine[] {
    const db = getDatabase();
    const rows = db.getAllSync<MedicineRow>(
      'SELECT * FROM medicines ORDER BY name ASC;'
    );
    return rows.map(mapRowToMedicine);
  },

  getById(id: string): Medicine | null {
    const db = getDatabase();
    const row = db.getFirstSync<MedicineRow>(
      'SELECT * FROM medicines WHERE id = ?;',
      [id]
    );
    return row ? mapRowToMedicine(row) : null;
  },

  create(data: Omit<Medicine, 'createdAt' | 'updatedAt'>): Medicine {
    const db = getDatabase();
    const now = new Date().toISOString();
    const newMedicine: Medicine = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };

    db.runSync(
      `INSERT INTO medicines (
        id, name, strength, dosage_form, category, ingredient,
        manufacturer, expiry_date, batch_number, package_details_text,
        information_source, created_at, updated_at, is_sample
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        newMedicine.id,
        newMedicine.name,
        newMedicine.strength,
        newMedicine.dosageForm,
        newMedicine.category,
        newMedicine.ingredient ?? null,
        newMedicine.packageDetails.manufacturer ?? null,
        newMedicine.packageDetails.expiryDate ?? null,
        newMedicine.packageDetails.batchNumber ?? null,
        newMedicine.packageDetails.packageDetailsText ?? null,
        newMedicine.informationSource ?? null,
        newMedicine.createdAt,
        newMedicine.updatedAt,
        newMedicine.isSample ? 1 : 0,
      ]
    );

    return newMedicine;
  },

  update(id: string, updates: Partial<Medicine>): Medicine | null {
    const existing = this.getById(id);
    if (!existing) return null;

    const updated: Medicine = {
      ...existing,
      ...updates,
      packageDetails: {
        ...existing.packageDetails,
        ...(updates.packageDetails || {}),
      },
      updatedAt: new Date().toISOString(),
    };

    const db = getDatabase();
    db.runSync(
      `UPDATE medicines SET
        name = ?, strength = ?, dosage_form = ?, category = ?, ingredient = ?,
        manufacturer = ?, expiry_date = ?, batch_number = ?, package_details_text = ?,
        information_source = ?, updated_at = ?
      WHERE id = ?;`,
      [
        updated.name,
        updated.strength,
        updated.dosageForm,
        updated.category,
        updated.ingredient ?? null,
        updated.packageDetails.manufacturer ?? null,
        updated.packageDetails.expiryDate ?? null,
        updated.packageDetails.batchNumber ?? null,
        updated.packageDetails.packageDetailsText ?? null,
        updated.informationSource ?? null,
        updated.updatedAt,
        id,
      ]
    );

    return updated;
  },

  delete(id: string): boolean {
    const db = getDatabase();
    if (!this.getById(id)) return false;

    // Remove dependent rows explicitly as well as relying on SQLite foreign keys.
    // This keeps cleanup consistent with the demonstration database adapter.
    db.runSync('DELETE FROM schedules WHERE medicine_id = ?;', [id]);
    db.runSync('DELETE FROM adherence_logs WHERE medicine_id = ?;', [id]);
    const result = db.runSync('DELETE FROM medicines WHERE id = ?;', [id]);
    return result.changes > 0;
  },

  search(
    query: string = '',
    expiryFilter: 'all' | 'active' | 'expired' = 'all',
    reminderFilter: 'all' | 'with' | 'without' = 'all'
  ): Medicine[] {
    const medicines = this.getAll();
    const db = getDatabase();
    const activeScheduleMedicineIds = new Set(
      db
        .getAllSync<{ medicine_id: string }>(
          'SELECT medicine_id FROM schedules WHERE enabled = 1;'
        )
        .map((r) => r.medicine_id)
    );

    return medicines.filter((m) => {
      // Query match (name or ingredient)
      if (query.trim()) {
        const q = query.toLowerCase();
        const matchesName = m.name.toLowerCase().includes(q);
        const matchesIngredient =
          m.ingredient?.toLowerCase().includes(q) ?? false;
        if (!matchesName && !matchesIngredient) return false;
      }

      // Evaluate expiry against today's date, not a hardcoded year.
      // Unknown/unparseable dates are not falsely classified as expired.
      const expiryTimestamp = getExpiryTimestamp(m.packageDetails.expiryDate);
      const isExpired = expiryTimestamp !== null && expiryTimestamp < Date.now();

      if (expiryFilter === 'active' && isExpired) return false;
      if (expiryFilter === 'expired' && !isExpired) return false;

      // Reminder filter
      const hasReminder = activeScheduleMedicineIds.has(m.id);
      if (reminderFilter === 'with' && !hasReminder) return false;
      if (reminderFilter === 'without' && hasReminder) return false;

      return true;
    });
  },
};
