ALTER TABLE lesson_instances ADD COLUMN additional_instructor_ids TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(additional_instructor_ids) AND json_type(additional_instructor_ids) = 'array');

CREATE TABLE IF NOT EXISTS coach_compensation (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  commission_bps INTEGER CHECK (commission_bps BETWEEN 0 AND 10000),
  lesson_fee_cents INTEGER CHECK (lesson_fee_cents >= 0)
);
