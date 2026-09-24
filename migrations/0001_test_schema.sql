PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin','head_coach','instructor','parent','student')),
  active INTEGER NOT NULL DEFAULT 1,
  password_hash TEXT NOT NULL,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE students (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  full_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  birth_date TEXT,
  phone TEXT,
  email TEXT,
  photo_url TEXT,
  registration_date TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE parent_students (
  parent_user_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (parent_user_id, student_id),
  FOREIGN KEY (parent_user_id) REFERENCES users(id),
  FOREIGN KEY (student_id) REFERENCES students(id)
);

CREATE TABLE levels (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE student_levels (
  student_id INTEGER NOT NULL,
  level_id INTEGER NOT NULL,
  end_date TEXT,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (level_id) REFERENCES levels(id)
);

CREATE TABLE groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE group_students (
  student_id INTEGER NOT NULL,
  group_id INTEGER NOT NULL,
  end_date TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (group_id) REFERENCES groups(id)
);

CREATE TABLE locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE lesson_instances (
  id INTEGER PRIMARY KEY,
  template_id INTEGER,
  private_request_id INTEGER,
  title TEXT NOT NULL,
  lesson_type TEXT,
  group_id INTEGER,
  instructor_user_id INTEGER,
  location_id INTEGER,
  lesson_date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  cancellation_reason TEXT,
  notes TEXT,
  FOREIGN KEY (group_id) REFERENCES groups(id),
  FOREIGN KEY (instructor_user_id) REFERENCES users(id),
  FOREIGN KEY (location_id) REFERENCES locations(id)
);

CREATE TABLE lesson_students (
  lesson_instance_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  enrollment_status TEXT NOT NULL DEFAULT 'enrolled',
  PRIMARY KEY (lesson_instance_id, student_id),
  FOREIGN KEY (lesson_instance_id) REFERENCES lesson_instances(id),
  FOREIGN KEY (student_id) REFERENCES students(id)
);

CREATE TABLE attendances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_instance_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  recorded_by_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (lesson_instance_id, student_id),
  FOREIGN KEY (lesson_instance_id) REFERENCES lesson_instances(id),
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (recorded_by_user_id) REFERENCES users(id)
);

CREATE TABLE package_types (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  lesson_count INTEGER NOT NULL
);

CREATE TABLE packages (
  id INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL,
  package_type_id INTEGER NOT NULL,
  package_number TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  remaining_lessons INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  expires_at TEXT,
  purchased_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (package_type_id) REFERENCES package_types(id)
);

CREATE TABLE package_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  package_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  lesson_instance_id INTEGER,
  attendance_id INTEGER,
  transaction_type TEXT NOT NULL,
  quantity_delta INTEGER NOT NULL,
  description TEXT,
  created_by_user_id INTEGER,
  FOREIGN KEY (package_id) REFERENCES packages(id),
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (lesson_instance_id) REFERENCES lesson_instances(id),
  FOREIGN KEY (attendance_id) REFERENCES attendances(id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  package_id INTEGER,
  amount REAL NOT NULL,
  payment_date TEXT NOT NULL,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (package_id) REFERENCES packages(id)
);

CREATE TABLE student_instructors (
  student_id INTEGER NOT NULL,
  instructor_user_id INTEGER NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  end_date TEXT,
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (instructor_user_id) REFERENCES users(id)
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  table_name TEXT,
  record_id INTEGER,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE private_lesson_requests (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL
);
