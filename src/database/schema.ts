export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  age INTEGER,
  gender TEXT,
  height REAL,
  weight REAL,
  unit_system TEXT DEFAULT 'metric',
  created_at TEXT NOT NULL,
  onboarding_completed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS medicines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  strength TEXT NOT NULL,
  dosage_form TEXT NOT NULL,
  category TEXT NOT NULL,
  ingredient TEXT,
  manufacturer TEXT,
  expiry_date TEXT,
  batch_number TEXT,
  package_details_text TEXT,
  information_source TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_sample INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  medicine_id TEXT NOT NULL,
  recurrence TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT,
  times_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  notifications_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS schedule_history (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  medicine_id TEXT NOT NULL,
  recurrence TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  times_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS adherence_logs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  medicine_id TEXT NOT NULL,
  dose_date TEXT NOT NULL,
  dose_time TEXT NOT NULL,
  status TEXT NOT NULL,
  logged_at TEXT NOT NULL,
  FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS scan_history (
  id TEXT PRIMARY KEY,
  medicine_name TEXT NOT NULL,
  detected_strength TEXT,
  dosage_form TEXT,
  manufacturer TEXT,
  batch_number TEXT,
  expiry_date TEXT,
  raw_text TEXT,
  image_uri TEXT,
  scanned_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS preferences (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
