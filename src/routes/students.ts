import type { CustomRequest, Env } from '../types/env';
import { fail, ok } from '../lib/response';

export async function listStudents(request: CustomRequest, env: Env) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'active';
  const search = url.searchParams.get('search')?.trim() || '';

  const result = await env.DB.prepare(`
    SELECT
      s.id, s.full_name, s.status, s.birth_date, s.phone, s.email,
      s.photo_url, s.registration_date,
      l.name AS current_level,
      g.name AS current_group,
      u.email AS account_email
    FROM students s
    LEFT JOIN student_levels sl
      ON sl.student_id = s.id AND sl.end_date IS NULL
    LEFT JOIN levels l ON l.id = sl.level_id
    LEFT JOIN group_students gs
      ON gs.student_id = s.id AND gs.end_date IS NULL AND gs.is_primary = 1
    LEFT JOIN groups g ON g.id = gs.group_id
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.status = ?
      AND (
        ? = '' OR
        s.full_name LIKE '%' || ? || '%' OR
        s.phone LIKE '%' || ? || '%' OR
        s.email LIKE '%' || ? || '%'
      )
    ORDER BY s.full_name
  `).bind(status, search, search, search, search).all();

  return ok(result.results);
}

export async function getStudent(request: CustomRequest, env: Env) {
  const id = Number(request.params.id);
  if (!Number.isInteger(id)) return fail('Geçersiz öğrenci ID.', 400);

  const student = await env.DB.prepare(`
    SELECT s.*, l.name AS current_level, g.name AS current_group
    FROM students s
    LEFT JOIN student_levels sl
      ON sl.student_id = s.id AND sl.end_date IS NULL
    LEFT JOIN levels l ON l.id = sl.level_id
    LEFT JOIN group_students gs
      ON gs.student_id = s.id AND gs.end_date IS NULL AND gs.is_primary = 1
    LEFT JOIN groups g ON g.id = gs.group_id
    WHERE s.id = ?
  `).bind(id).first();

  if (!student) return fail('Öğrenci bulunamadı.', 404);

  const [parents, instructors, packages] = await Promise.all([
    env.DB.prepare(`
      SELECT ps.*, u.full_name, u.email, u.phone
      FROM parent_students ps
      JOIN users u ON u.id = ps.parent_user_id
      WHERE ps.student_id = ?
      ORDER BY ps.is_primary DESC, u.full_name
    `).bind(id).all(),
    env.DB.prepare(`
      SELECT si.*, u.full_name, u.email
      FROM student_instructors si
      JOIN users u ON u.id = si.instructor_user_id
      WHERE si.student_id = ?
        AND (si.end_date IS NULL OR si.end_date >= date('now'))
      ORDER BY si.is_primary DESC, u.full_name
    `).bind(id).all(),
    env.DB.prepare(`
      SELECT p.*, pt.name AS package_type_name
      FROM packages p
      JOIN package_types pt ON pt.id = p.package_type_id
      WHERE p.student_id = ?
      ORDER BY p.purchased_at DESC
    `).bind(id).all()
  ]);

  return ok({
    student,
    parents: parents.results,
    instructors: instructors.results,
    packages: packages.results
  });
}
