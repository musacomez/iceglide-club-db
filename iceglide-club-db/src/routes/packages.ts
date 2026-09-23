import type { CustomRequest, Env } from '../types/env';
import { fail, ok } from '../lib/response';

export async function listStudentPackages(request: CustomRequest, env: Env) {
  const studentId = Number(request.params.studentId);
  if (!Number.isInteger(studentId)) return fail('Geçersiz öğrenci ID.', 400);

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
