export type DosageForm =
  | 'tablet'
  | 'capsule'
  | 'softgel'
  | 'eye_drop'
  | 'syrup'
  | 'injection'
  | 'cream'
  | 'other';

export type RecurrenceType =
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'custom'
  | 'once';

export type DoseStatus =
  | 'taken'
  | 'missed'
  | 'skipped'
  | 'upcoming';

export type GenderOption = 'Male' | 'Female' | 'Other' | 'Prefer not to say';
export type UnitSystem = 'metric' | 'imperial';

export interface UserProfile {
  id: string;
  name: string;
  email?: string;
  age?: number;
  gender?: GenderOption | string;
  height?: number;
  weight?: number;
  unitSystem?: UnitSystem;
  createdAt: string;
  onboardingCompleted: boolean;
}

export interface MedicinePackageDetails {
  manufacturer?: string;
  expiryDate?: string;
  batchNumber?: string;
  packageDetailsText?: string;
  originalPackageChecked?: boolean;
}

export interface Medicine {
  id: string;
  name: string;
  strength: string;
  dosageForm: DosageForm;
  category: string;
  ingredient?: string;
  packageDetails: MedicinePackageDetails;
  informationSource?: string;
  createdAt: string;
  updatedAt: string;
  isSample?: boolean;
}

export interface ReminderTime {
  id: string;
  time: string; // 'HH:mm' e.g. '08:00'
  amount: string; // e.g. '1 tablet'
  label?: string; // e.g. Morning, Afternoon, Evening, Night, or a custom dose name
}

export interface ReminderSchedule {
  id: string;
  medicineId: string;
  recurrence: RecurrenceType;
  startDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  times: ReminderTime[];
  enabled: boolean;
  notificationsEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledDose {
  id: string;
  scheduleId: string;
  medicineId: string;
  medicineName: string;
  strength: string;
  dosageForm: DosageForm;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  amount: string;
  status: DoseStatus;
  loggedAt?: string;
}

export interface AdherenceRecord {
  id: string;
  scheduleId: string;
  medicineId: string;
  doseDate: string; // YYYY-MM-DD
  doseTime: string; // HH:mm
  status: DoseStatus;
  loggedAt: string;
}

export interface DayAdherenceSummary {
  date: string;
  total: number;
  taken: number;
  remaining: number;
  missed: number;
  skipped: number;
  percentage: number;
}

export interface ScanHistoryEntry {
  id: string;
  medicineName: string;
  detectedStrength?: string;
  dosageForm?: DosageForm;
  manufacturer?: string;
  batchNumber?: string;
  expiryDate?: string;
  rawText?: string;
  imageUri?: string;
  scannedAt: string;
}

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface AIConversation {
  id: string;
  title: string;
  createdAt: string;
  messages: AIMessage[];
}

export interface UserPreferences {
  inAppReminders: boolean;
  aiAssistantEnabled: boolean;
  cameraPermissionsGranted: boolean;
  notificationsEnabled: boolean;
  streakCount: number;
  lastActiveDate: string;
}
