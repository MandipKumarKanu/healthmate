import { getDatabase } from './client';
import { Medicine, ReminderSchedule, DoseStatus } from '../types';

export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function seedInitialDataIfNeeded(force: boolean = false): void {
  // Production-grade: never seed dummy or sample data by default.
  // The app starts completely empty unless explicitly forced (e.g. from developer reset).
  if (!force) {
    return;
  }

  const db = getDatabase();

  const today = getTodayDateString();

  const existingProfile = db.getFirstSync<{ onboarding_completed: number }>(
    'SELECT onboarding_completed FROM profiles LIMIT 1;',
  );
  const isCompleted = force ? 1 : existingProfile ? existingProfile.onboarding_completed : 0;
  const defaultName = force ? 'Alex' : existingProfile ? '' : '';

  // 1. Initial Profile
  db.runSync(
    `INSERT OR REPLACE INTO profiles (id, name, email, created_at, onboarding_completed)
     VALUES (?, ?, ?, ?, ?);`,
    [
      'default-user',
      defaultName,
      force ? 'alex.m@example.com' : null,
      new Date().toISOString(),
      isCompleted,
    ],
  );

  // 2. Preferences
  const prefs = [
    ['in_app_reminders', 'true'],
    ['ai_assistant_enabled', 'true'],
    ['camera_permissions_granted', 'true'],
    ['notifications_enabled', 'true'],
    ['streak_count', '3'],
    ['last_active_date', today],
  ];
  for (const [k, v] of prefs) {
    db.runSync('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?);', [k, v]);
  }

  // 3. Fictional sample medicines from screenshots
  const sampleMedicines: Medicine[] = [
    {
      id: 'med-metformin',
      name: 'Metformin',
      strength: '500 mg',
      dosageForm: 'tablet',
      category: 'Generic',
      ingredient: 'Metformin hydrochloride',
      packageDetails: {
        manufacturer: 'Example Pharma · Fictional data',
        expiryDate: 'Dec 2027',
        batchNumber: 'DEMO-MF0426',
        packageDetailsText: 'Example values, not a verified scan',
        originalPackageChecked: true,
      },
      informationSource:
        'Example package record entered for this design. No verified clinical reference is attached. Educational sections are not a substitute for the package leaflet or professional advice.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isSample: true,
    },
    {
      id: 'med-vitamind3',
      name: 'Vitamin D3',
      strength: '1,000 IU',
      dosageForm: 'softgel',
      category: 'Generic',
      ingredient: 'Cholecalciferol',
      packageDetails: {
        manufacturer: 'NutraHealth Labs · Fictional data',
        expiryDate: 'Aug 2027',
        batchNumber: 'DEMO-VD0827',
        packageDetailsText: 'Example values, not a verified scan',
        originalPackageChecked: true,
      },
      informationSource: 'Fictional demonstration record for Vitamin D3.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isSample: true,
    },
    {
      id: 'med-cetirizine',
      name: 'Cetirizine',
      strength: '10 mg',
      dosageForm: 'tablet',
      category: 'Generic',
      ingredient: 'Cetirizine dihydrochloride',
      packageDetails: {
        manufacturer: 'AllerCare Labs · Fictional data',
        expiryDate: 'Mar 2027',
        batchNumber: 'DEMO-CT0327',
        packageDetailsText: 'Example values, not a verified scan',
        originalPackageChecked: true,
      },
      informationSource: 'Fictional demonstration record for Cetirizine.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isSample: true,
    },
    {
      id: 'med-eyedrops',
      name: 'Lubricating eye drops',
      strength: '0.5%',
      dosageForm: 'eye_drop',
      category: 'Generic',
      ingredient: 'Carboxymethylcellulose sodium',
      packageDetails: {
        manufacturer: 'OptiClear Care · Fictional data',
        expiryDate: 'Jun 2027',
        batchNumber: 'DEMO-ED0627',
        packageDetailsText: 'Saved label directions',
        originalPackageChecked: true,
      },
      informationSource: 'Fictional demonstration record for Lubricating eye drops.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isSample: true,
    },
    {
      id: 'med-amoxicillin',
      name: 'Amoxicillin',
      strength: '250 mg',
      dosageForm: 'capsule',
      category: 'Generic',
      ingredient: 'Amoxicillin trihydrate',
      packageDetails: {
        manufacturer: 'BioCure Pharma · Fictional data',
        expiryDate: 'Jan 2026', // Expired
        batchNumber: 'DEMO-AM0126',
        packageDetailsText: 'Expired medicine record for safety demonstration',
        originalPackageChecked: true,
      },
      informationSource: 'Expired sample record demonstrating medication warning state.',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isSample: true,
    },
  ];

  for (const m of sampleMedicines) {
    db.runSync(
      `INSERT OR REPLACE INTO medicines (
        id, name, strength, dosage_form, category, ingredient,
        manufacturer, expiry_date, batch_number, package_details_text,
        information_source, created_at, updated_at, is_sample
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        m.id,
        m.name,
        m.strength,
        m.dosageForm,
        m.category,
        m.ingredient ?? null,
        m.packageDetails.manufacturer ?? null,
        m.packageDetails.expiryDate ?? null,
        m.packageDetails.batchNumber ?? null,
        m.packageDetails.packageDetailsText ?? null,
        m.informationSource ?? null,
        m.createdAt,
        m.updatedAt,
        m.isSample ? 1 : 0,
      ],
    );
  }

  // 4. Sample Schedules matching screenshots
  const sampleSchedules: ReminderSchedule[] = [
    {
      id: 'sched-metformin',
      medicineId: 'med-metformin',
      recurrence: 'daily',
      startDate: today,
      times: [
        { id: 't1', time: '08:00', amount: '1 tablet' },
        { id: 't2', time: '18:00', amount: '1 tablet' },
      ],
      enabled: true,
      notificationsEnabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'sched-vitamind3',
      medicineId: 'med-vitamind3',
      recurrence: 'daily',
      startDate: today,
      times: [{ id: 't3', time: '08:00', amount: '1 softgel' }],
      enabled: true,
      notificationsEnabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'sched-cetirizine',
      medicineId: 'med-cetirizine',
      recurrence: 'daily',
      startDate: today,
      times: [{ id: 't4', time: '09:00', amount: '1 tablet' }],
      enabled: true,
      notificationsEnabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'sched-eyedrops',
      medicineId: 'med-eyedrops',
      recurrence: 'daily',
      startDate: today,
      times: [
        { id: 't5', time: '12:00', amount: 'Saved label directions' },
        { id: 't6', time: '13:00', amount: 'Saved label directions' },
      ],
      enabled: true,
      notificationsEnabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  for (const s of sampleSchedules) {
    db.runSync(
      `INSERT OR REPLACE INTO schedules (
        id, medicine_id, recurrence, start_date, end_date,
        times_json, enabled, notifications_enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        s.id,
        s.medicineId,
        s.recurrence,
        s.startDate,
        s.endDate ?? null,
        JSON.stringify(s.times),
        s.enabled ? 1 : 0,
        s.notificationsEnabled ? 1 : 0,
        s.createdAt,
        s.updatedAt,
      ],
    );
  }

  // 5. Today's Adherence Records (3 taken, 1 missed, 1 skipped, 1 upcoming)
  const adherenceLogs: Array<{
    id: string;
    scheduleId: string;
    medicineId: string;
    time: string;
    status: DoseStatus;
  }> = [
    {
      id: 'log-1',
      scheduleId: 'sched-metformin',
      medicineId: 'med-metformin',
      time: '08:00',
      status: 'taken',
    },
    {
      id: 'log-2',
      scheduleId: 'sched-vitamind3',
      medicineId: 'med-vitamind3',
      time: '08:00',
      status: 'taken',
    },
    {
      id: 'log-3',
      scheduleId: 'sched-cetirizine',
      medicineId: 'med-cetirizine',
      time: '09:00',
      status: 'taken',
    },
    {
      id: 'log-4',
      scheduleId: 'sched-eyedrops',
      medicineId: 'med-eyedrops',
      time: '12:00',
      status: 'missed',
    },
    {
      id: 'log-5',
      scheduleId: 'sched-eyedrops',
      medicineId: 'med-eyedrops',
      time: '13:00',
      status: 'skipped',
    },
  ];

  for (const log of adherenceLogs) {
    db.runSync(
      `INSERT OR REPLACE INTO adherence_logs (
        id, schedule_id, medicine_id, dose_date, dose_time, status, logged_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [
        log.id,
        log.scheduleId,
        log.medicineId,
        today,
        log.time,
        log.status,
        new Date().toISOString(),
      ],
    );
  }

  // 6. Sample Scan History
  db.runSync(
    `INSERT OR REPLACE INTO scan_history (
      id, medicine_name, detected_strength, dosage_form, manufacturer,
      batch_number, expiry_date, raw_text, image_uri, scanned_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      'scan-1',
      'Metformin',
      '500 mg',
      'tablet',
      'Example Pharma',
      'DEMO-MF0426',
      'Dec 2027',
      'Metformin Tablets 500mg - Take one tablet twice daily with meals. Batch DEMO-MF0426. Exp 12/2027.',
      null,
      new Date().toISOString(),
    ],
  );
}
