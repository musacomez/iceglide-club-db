import type { CustomRequest, Env } from '../types/env';
import { fail, ok } from '../lib/response';

async function canAccessStudent(
  request: CustomRequest,
  env: Env,
  studentId: number,
): Promise<boolean> {
  const user = request.user;
  if (!user) return false;

  if (user.role === 'admin' || user.role === 'head_coach') {
    return true;
  }

  if (user.role === 'student') {
    const result = await env.DB.prepare(`
      SELECT 1
      FROM students
      WHERE id = ? AND user_id = ?
      LIMIT 1
    `).bind(studentId, user.id).first();

    return !!result;
  }

  if (user.role === 'parent') {
    const result = await env.DB.prepare(`
      SELECT 1
      FROM parent_students
      WHERE student_id = ?
        AND parent_user_id = ?
      LIMIT 1
    `).bind(studentId, user.id).first();

    return !!result;
  }

  if (user.role === 'instructor') {
    const result = await env.DB.prepare(`
      SELECT 1
      FROM student_instructors
      WHERE student_id = ?
        AND instructor_user_id = ?
        AND (end_date IS NULL OR end_date >= date('now'))
      LIMIT 1
    `).bind(studentId, user.id).first();

    return !!result;
  }

  return false;
}

export async function listStudentPackages(
  request: CustomRequest,
  env: Env,
) {
  if (!request.user) {
    return fail('Yetkilendirme gerekli.', 401);
  }

  const studentId = Number(request.params.studentId);

  if (!Number.isInteger(studentId)) {
    return fail('Geçersiz öğrenci ID.', 400);
  }

  const allowed = await canAccessStudent(request, env, studentId);

  if (!allowed) {
    return fail('Bu öğrencinin paketlerine erişim yetkiniz yok.', 403);
  }

  const result = await env.DB.prepare(`
    SELECT p.*, pt.name AS package_type_name,
           pt.lesson_count AS package_type_lesson_count
    FROM packages p
    JOIN package_types pt ON pt.id = p.package_type_id
    WHERE p.student_id = ?
    ORDER BY p.purchased_at DESC
  `).bind(studentId).all();

  return ok(result.results);
}
