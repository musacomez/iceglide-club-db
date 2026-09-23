import type { CustomRequest, Env } from '../types/env';
import { fail, ok } from '../lib/response';

export async function listStudentPayments(request: CustomRequest, env: Env) {
  const studentId = Number(request.params.studentId);
  if (!Number.isInteger(studentId)) return fail('Geçersiz öğrenci ID.', 400);

  const result = await env.DB.prepare(`
    SELECT p.*, pkg.package_number
    FROM payments p
    LEFT JOIN packages pkg ON pkg.id = p.package_id
    WHERE p.student_id = ?
    ORDER BY p.payment_date DESC, p.id DESC
  `).bind(studentId).all();

  return ok(result.results);
}
