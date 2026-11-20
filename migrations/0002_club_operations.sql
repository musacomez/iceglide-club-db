ALTER TABLE package_types ADD COLUMN lessons_per_week INTEGER
  CHECK (lessons_per_week IS NULL OR (typeof(lessons_per_week) = 'integer' AND lessons_per_week > 0));

ALTER TABLE student_charges ADD COLUMN request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_charges_request
ON student_charges(request_id) WHERE request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_allocations (
  payment_id INTEGER PRIMARY KEY REFERENCES payments(id) ON DELETE RESTRICT,
  charge_id INTEGER NOT NULL REFERENCES student_charges(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK (typeof(amount_cents) = 'integer' AND amount_cents > 0)
);

CREATE INDEX IF NOT EXISTS idx_payment_allocations_charge
ON payment_allocations(charge_id);
