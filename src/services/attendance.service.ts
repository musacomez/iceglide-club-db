import type { Env, UserRole } from '../types/env';

type AttendanceInput = {
  lesson_instance_id: number;
  student_id: number;
  status: 'present' | 'absent' | 'late' | 'excused';
  note?: string | null;
  recorded_by_user_id: number;
  recorded_by_role: UserRole;
};

export async function recordAttendance(env: Env, input: AttendanceInput) {
  const lesson = await env.DB.prepare(`
    SELECT id, lesson_date, status, instructor_user_id
    FROM lesson_instances
    WHERE id = ?
  `).bind(input.lesson_instance_id).first<{
    id: number;
    lesson_date: string;
    status: string;
    instructor_user_id: number | null;
  }>();

  if (!lesson) throw new Error('Ders bulunamadı.');

  const canRecord =
    input.recorded_by_role === 'admin' ||
    input.recorded_by_role === 'head_coach' ||
    (
      input.recorded_by_role === 'instructor' &&
      lesson.instructor_user_id === input.recorded_by_user_id
    );

  if (!canRecord) {
    throw new Error('Bu ders için yoklama kaydetme yetkiniz yok.');
  }

  const enrolled = await env.DB.prepare(`
    SELECT 1 AS ok
    FROM lesson_students
    WHERE lesson_instance_id = ?
      AND student_id = ?
      AND enrollment_status = 'enrolled'
    LIMIT 1
  `).bind(input.lesson_instance_id, input.student_id).first<{ ok: number }>();

  if (!enrolled) throw new Error('Öğrenci bu derse kayıtlı değil.');

  const existing = await env.DB.prepare(`
    SELECT id, status
    FROM attendances
    WHERE lesson_instance_id = ? AND student_id = ?
    LIMIT 1
  `).bind(input.lesson_instance_id, input.student_id).first<{ id: number; status: string }>();

  const previousQualifies = existing?.status === 'present' || existing?.status === 'late';
  const nextQualifies = input.status === 'present' || input.status === 'late';

  let attendanceStatement: D1PreparedStatement;
  if (existing) {
    attendanceStatement = env.DB.prepare(`
      UPDATE attendances
      SET status = ?, note = ?, recorded_by_user_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(input.status, input.note ?? null, input.recorded_by_user_id, existing.id);
  } else {
    attendanceStatement = env.DB.prepare(`
      INSERT INTO attendances
        (lesson_instance_id, student_id, status, note, recorded_by_user_id)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      input.lesson_instance_id,
      input.student_id,
      input.status,
      input.note ?? null,
      input.recorded_by_user_id,
    );
  }

  const statements: D1PreparedStatement[] = [attendanceStatement];

  if (!previousQualifies && nextQualifies) {
    const pkg = await env.DB.prepare(`
      SELECT id, remaining_lessons
      FROM packages
      WHERE student_id = ?
        AND status = 'active'
        AND remaining_lessons > 0
        AND (starts_at IS NULL OR starts_at <= ?)
        AND (expires_at IS NULL OR expires_at >= ?)
      ORDER BY expires_at IS NULL, expires_at, purchased_at
      LIMIT 1
    `).bind(input.student_id, lesson.lesson_date, lesson.lesson_date)
      .first<{ id: number; remaining_lessons: number }>();

    if (pkg) {
      const already = await env.DB.prepare(`
        SELECT 1 AS ok
        FROM package_transactions
        WHERE package_id = ?
          AND lesson_instance_id = ?
          AND student_id = ?
          AND transaction_type = 'consumption'
        LIMIT 1
      `).bind(pkg.id, input.lesson_instance_id, input.student_id)
        .first<{ ok: number }>();

      if (!already) {
        statements.push(
          env.DB.prepare(`
            INSERT INTO package_transactions
              (package_id, student_id, lesson_instance_id, attendance_id,
               transaction_type, quantity_delta, description, created_by_user_id)
            VALUES (?, ?, ?, NULL, 'consumption', -1, ?, ?)
          `).bind(
            pkg.id,
            input.student_id,
            input.lesson_instance_id,
            `${lesson.lesson_date} dersi kullanımı`,
            input.recorded_by_user_id,
          ),
          env.DB.prepare(`
            UPDATE packages
            SET remaining_lessons = remaining_lessons - 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND remaining_lessons > 0
          `).bind(pkg.id),
        );
      }
    }
  }

  if (previousQualifies && !nextQualifies) {
    const consumed = await env.DB.prepare(`
      SELECT id, package_id
      FROM package_transactions
      WHERE lesson_instance_id = ?
        AND student_id = ?
        AND transaction_type = 'consumption'
      ORDER BY id DESC
      LIMIT 1
    `).bind(input.lesson_instance_id, input.student_id)
      .first<{ id: number; package_id: number }>();

    if (consumed) {
      statements.push(
        env.DB.prepare(`
          INSERT INTO package_transactions
            (package_id, student_id, lesson_instance_id, attendance_id,
             transaction_type, quantity_delta, description, created_by_user_id)
          SELECT package_id, student_id, lesson_instance_id, attendance_id,
                 'correction', 1, 'Attendance değişikliği nedeniyle iade', ?
          FROM package_transactions
          WHERE id = ?
        `).bind(input.recorded_by_user_id, consumed.id),
        env.DB.prepare(`
          UPDATE packages
          SET remaining_lessons = remaining_lessons + 1,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(consumed.package_id),
      );
    }
  }

  statements.push(
    env.DB.prepare(`
      INSERT INTO audit_logs
        (user_id, action, table_name, record_id, details)
      VALUES (
        ?, 'attendance.record', 'attendances',
        (SELECT id FROM attendances WHERE lesson_instance_id = ? AND student_id = ?),
        ?
      )
    `).bind(
      input.recorded_by_user_id,
      input.lesson_instance_id,
      input.student_id,
      JSON.stringify({ status: input.status }),
    ),
  );

  await env.DB.batch(statements);

  return env.DB.prepare(`
    SELECT
      a.*,
      p.id AS package_id,
      p.package_number,
      p.remaining_lessons
    FROM attendances a
    LEFT JOIN packages p
      ON p.id = (
        SELECT package_id
        FROM package_transactions
        WHERE attendance_id = a.id
        ORDER BY id DESC
        LIMIT 1
      )
    WHERE a.lesson_instance_id = ? AND a.student_id = ?
  `).bind(input.lesson_instance_id, input.student_id).first();
}
