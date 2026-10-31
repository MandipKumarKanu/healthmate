import { getDatabase } from '../client';
import { ScanHistoryEntry, DosageForm } from '../../types';
import { deleteScanImage, deleteAllScanImages } from '../../services/scanImageStorage';

interface ScanRow {
  id: string;
  medicine_name: string;
  detected_strength: string | null;
  dosage_form: string | null;
  manufacturer: string | null;
  batch_number: string | null;
  expiry_date: string | null;
  raw_text: string | null;
  image_uri: string | null;
  scanned_at: string;
}

function mapRowToScan(row: ScanRow): ScanHistoryEntry {
  return {
    id: row.id,
    medicineName: row.medicine_name,
    detectedStrength: row.detected_strength ?? undefined,
    dosageForm: (row.dosage_form as DosageForm) ?? undefined,
    manufacturer: row.manufacturer ?? undefined,
    batchNumber: row.batch_number ?? undefined,
    expiryDate: row.expiry_date ?? undefined,
    rawText: row.raw_text ?? undefined,
    imageUri: row.image_uri ?? undefined,
    scannedAt: row.scanned_at,
  };
}

export const scanHistoryRepository = {
  getAll(): ScanHistoryEntry[] {
    const db = getDatabase();
    const rows = db.getAllSync<ScanRow>('SELECT * FROM scan_history ORDER BY scanned_at DESC;');
    return rows.map(mapRowToScan);
  },

  add(scan: Omit<ScanHistoryEntry, 'id' | 'scannedAt'>): ScanHistoryEntry {
    const db = getDatabase();
    const id = `scan_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    const scannedAt = new Date().toISOString();

    const entry: ScanHistoryEntry = {
      ...scan,
      id,
      scannedAt,
    };

    db.runSync(
      `INSERT INTO scan_history (
        id, medicine_name, detected_strength, dosage_form, manufacturer,
        batch_number, expiry_date, raw_text, image_uri, scanned_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        entry.id,
        entry.medicineName,
        entry.detectedStrength ?? null,
        entry.dosageForm ?? null,
        entry.manufacturer ?? null,
        entry.batchNumber ?? null,
        entry.expiryDate ?? null,
        entry.rawText ?? null,
        entry.imageUri ?? null,
        entry.scannedAt,
      ],
    );

    return entry;
  },

  delete(id: string): boolean {
    const db = getDatabase();
    const existing = db.getFirstSync<ScanRow>('SELECT * FROM scan_history WHERE id = ?;', [id]);
    if (!existing) return false;
    const result = db.runSync('DELETE FROM scan_history WHERE id = ?;', [id]);
    if (result.changes > 0 && existing.image_uri) {
      const allRows = db.getAllSync<ScanRow>('SELECT * FROM scan_history;');
      const isStillReferenced = allRows.some(
        (r) => r.id !== id && r.image_uri === existing.image_uri,
      );
      if (!isStillReferenced) {
        deleteScanImage(existing.image_uri);
      }
    }
    return result.changes > 0;
  },

  clearAll(): void {
    const db = getDatabase();
    db.runSync('DELETE FROM scan_history;');
    deleteAllScanImages();
  },
};
