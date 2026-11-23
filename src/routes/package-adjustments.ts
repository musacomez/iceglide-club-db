import { fail, ok } from '../lib/response';
import { readJson } from '../lib/validate';
import type { CustomRequest, Env } from '../types/env';

type AdjustmentInput = {
  quantity_delta?: unknown;
  expected_remaining_lessons?: unknown;
  reason?: unknown;
  request_id?: unknown;
};

type Adjustment = {
  user_id: number;
  quantity_delta: number;
  reason: string;
  previous_lessons: number;
  remaining_lessons: number;
};

export async function adjustPackageLessons(request: CustomRequest, env: Env) {
  if (!request.user) return fail('Yetkilendirme gerekli.', 401);
  const userId = request.user.id;
  const studentId = Number(request.params.studentId);
  const packageId = Number(request.params.packageId);
  if (!Number.isSafeInteger(studentId) || studentId < 1 || !Number.isSafeInteger(packageId) || packageId < 1) {
    return fail('Öğrenci veya paket numarası geçersiz.', 400);
  }

  const input = await readJson<AdjustmentInput>(request);
  const delta = input?.quantity_delta;
  const previous = input?.expected_remaining_lessons;
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  const requestId = input?.request_id;
  if (typeof delta !== 'number' || !Number.isSafeInteger(delta) || delta === 0 ||
      typeof previous !== 'number' || !Number.isSafeInteger(previous) || previous < 0 ||
      !reason || reason.length > 180 || typeof requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) {
    return fail('Ders adedi veya işlem açıklaması geçersiz.', 422);
  }

  const remaining = previous + delta;
  if (!Number.isSafeInteger(remaining) || remaining < 0) {
    return fail('Kalan ders hakkı sıfırın altına inemez veya sayı sınırını aşamaz.', 422);
  }

  // A unique attempt identifies the audit row created by this batch alone.
  const attemptId = crypto.randomUUID();
  const auditScope = "action = 'package.adjust_lessons' AND table_name = 'packages' AND record_id = ?";
  const auditForAttempt = `SELECT 1 FROM audit_logs
    WHERE ${auditScope} AND json_extract(details, '$.attempt_id') = ?`;
  const [, , , result] = await env.DB.batch<Adjustment>([
    env.DB.prepare(`
      INSERT INTO audit_logs (user_id, action, table_name, record_id, details)
      SELECT ?, 'package.adjust_lessons', 'packages', p.id, ?
      FROM packages p
      WHERE p.id = ? AND p.student_id = ? AND p.remaining_lessons = ?
        AND p.status = 'active' AND (p.expires_at IS NULL OR date(p.expires_at) >= date('now', '+3 hours'))
        AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE ${auditScope}
                        AND json_extract(details, '$.request_id') = ?)
    `).bind(userId, JSON.stringify({
      request_id: requestId, attempt_id: attemptId, student_id: studentId,
      quantity_delta: delta, reason, previous_lessons: previous, remaining_lessons: remaining,
    }), packageId, studentId, previous, packageId, requestId),
    env.DB.prepare(`
      UPDATE packages SET remaining_lessons = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND EXISTS (${auditForAttempt})
    `).bind(remaining, packageId, packageId, attemptId),
    env.DB.prepare(`
      INSERT INTO package_transactions
        (package_id, student_id, transaction_type, quantity_delta, description, created_by_user_id)
      SELECT ?, ?, 'correction', ?, ?, ? WHERE EXISTS (${auditForAttempt})
    `).bind(packageId, studentId, delta, reason, userId, packageId, attemptId),
    env.DB.prepare(`
      SELECT user_id,
             json_extract(details, '$.quantity_delta') AS quantity_delta,
             json_extract(details, '$.reason') AS reason,
             json_extract(details, '$.previous_lessons') AS previous_lessons,
             json_extract(details, '$.remaining_lessons') AS remaining_lessons
      FROM audit_logs WHERE ${auditScope}
        AND json_extract(details, '$.request_id') = ?
        AND json_extract(details, '$.student_id') = ?
    `).bind(packageId, requestId, studentId),
  ]);

  const adjustment = result.results[0];
  if (!adjustment) {
    return fail('Paket kullanıma açık değil veya ders hakkı değişti. Listeyi yenileyip tekrar deneyin.', 409);
  }
  if (adjustment.user_id !== userId || adjustment.quantity_delta !== delta ||
      adjustment.previous_lessons !== previous || adjustment.reason !== reason) {
    return fail('Bu istek numarası farklı bir işlemde kullanıldı.', 409);
  }
  return ok({ remaining_lessons: adjustment.remaining_lessons });
}
