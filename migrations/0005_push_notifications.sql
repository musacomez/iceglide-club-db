CREATE TABLE IF NOT EXISTS push_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auth_version INTEGER NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_push_devices_user ON push_devices(user_id);

CREATE TABLE IF NOT EXISTS push_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES push_devices(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  event_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('chat', 'manual', 'payment')),
  student_id INTEGER,
  due_date TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  UNIQUE(device_id, user_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_push_jobs_ready
ON push_jobs(available_at, id) WHERE finished_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_push_charge_due
ON student_charges(due_date, student_id) WHERE status = 'active';
