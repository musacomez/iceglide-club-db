import { beforeEach } from 'vitest';
import { env, applyD1Migrations } from 'cloudflare:test';
import { hashPassword } from '../src/lib/password';

async function seed() {
  const db = env.DB;
  await applyD1Migrations(db, env.TEST_MIGRATIONS);
  const passwordHash = await hashPassword('Test1234!');

  await db.batch([
    db.prepare('DELETE FROM audit_logs'),
    db.prepare('DELETE FROM package_transactions'),
    db.prepare('DELETE FROM payments'),
    db.prepare('DELETE FROM attendances'),
    db.prepare('DELETE FROM lesson_students'),
    db.prepare('DELETE FROM lesson_instances'),
    db.prepare('DELETE FROM group_students'),
    db.prepare('DELETE FROM student_levels'),
    db.prepare('DELETE FROM student_instructors'),
    db.prepare('DELETE FROM parent_students'),
    db.prepare('DELETE FROM packages'),
    db.prepare('DELETE FROM package_types'),
    db.prepare('DELETE FROM students'),
    db.prepare('DELETE FROM private_lesson_requests'),
    db.prepare('DELETE FROM users'),
    db.prepare('DELETE FROM locations'),
    db.prepare('DELETE FROM groups'),
    db.prepare('DELETE FROM levels'),

    db.prepare(`
      INSERT INTO users
        (id, email, full_name, phone, role, active, password_hash)
      VALUES
        (1, 'admin@test.invalid', 'Test Admin', '5550000001', 'admin', 1, ?),
        (2, 'coach@test.invalid', 'Head Coach', '5550000002', 'head_coach', 1, ?),
        (3, 'instructor@test.invalid', 'Instructor', '5550000003', 'instructor', 1, ?),
        (4, 'parent-a@test.invalid', 'Parent A', '5550000004', 'parent', 1, ?),
        (5, 'parent-b@test.invalid', 'Parent B', '5550000005', 'parent', 1, ?),
        (6, 'student-a@test.invalid', 'Student A', '5550000006', 'student', 1, ?),
        (7, 'student-b@test.invalid', 'Student B', '5550000007', 'student', 1, ?)
    `).bind(
      passwordHash,
      passwordHash,
      passwordHash,
      passwordHash,
      passwordHash,
      passwordHash,
      passwordHash,
    ),

    db.prepare(`
      INSERT INTO students
        (id, user_id, full_name, status, birth_date, phone, email, registration_date)
      VALUES
        (101, 6, 'Student A', 'active', '2015-01-10', '5551000001', 'student-a@test.invalid', '2026-01-01'),
        (102, 7, 'Student B', 'active', '2016-02-20', '5551000002', 'student-b@test.invalid', '2026-01-01')
    `),

    db.prepare(`
      INSERT INTO parent_students
        (parent_user_id, student_id, is_primary)
      VALUES
        (4, 101, 1),
        (5, 102, 1)
    `),

    db.prepare(`
      INSERT INTO student_instructors
        (student_id, instructor_user_id, is_primary, end_date)
      VALUES
        (101, 3, 1, NULL)
    `),

    db.prepare(`
      INSERT INTO levels (id, name)
      VALUES (1, 'Beginner')
    `),

    db.prepare(`
      INSERT INTO student_levels
        (student_id, level_id, end_date)
      VALUES
        (101, 1, NULL),
        (102, 1, NULL)
    `),

    db.prepare(`
      INSERT INTO groups (id, name)
      VALUES (1, 'Test Group')
    `),

    db.prepare(`
      INSERT INTO group_students
        (student_id, group_id, end_date, is_primary)
      VALUES
        (101, 1, NULL, 1),
        (102, 1, NULL, 1)
    `),

    db.prepare(`
      INSERT INTO locations (id, name)
      VALUES (1, 'Test Ice Rink')
    `),

    db.prepare(`
      INSERT INTO package_types
        (id, name, lesson_count)
      VALUES (201, '10 Lessons', 10)
    `),

    db.prepare(`
      INSERT INTO packages
        (id, student_id, package_type_id, package_number, status,
         remaining_lessons, starts_at, expires_at, purchased_at)
      VALUES
        (301, 101, 201, 'PKG-A', 'active', 8, '2026-01-01', '2026-12-31', '2026-01-01'),
        (302, 102, 201, 'PKG-B', 'active', 8, '2026-01-01', '2026-12-31', '2026-12-31')
    `),

    db.prepare(`
      INSERT INTO payments
        (id, student_id, package_id, amount, payment_date)
      VALUES
        (401, 101, 301, 1000, '2026-01-01'),
        (402, 102, 302, 1000, '2026-01-01')
    `),

    db.prepare(`
      INSERT INTO lesson_instances
        (id, title, lesson_type, group_id, instructor_user_id,
         location_id, lesson_date, start_time, end_time, status)
      VALUES
        (501, 'Instructor Lesson', 'group', 1, 3, 1,
         '2026-09-23', '10:00', '11:00', 'scheduled'),
        (502, 'Head Coach Lesson', 'group', 1, 2, 1,
         '2026-09-24', '10:00', '11:00', 'scheduled')
    `),

    db.prepare(`
      INSERT INTO lesson_students
        (lesson_instance_id, student_id, enrollment_status)
      VALUES
        (501, 101, 'enrolled'),
        (501, 102, 'enrolled'),
        (502, 102, 'enrolled')
    `),
  ]);
}

beforeEach(async () => {
  await seed();
});
