import { fail, ok } from '../lib/response';
import { isPositiveInt, isValidDate, readJson } from '../lib/validate';
import type { CustomRequest, Env } from '../types/env';

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const PAID = `COALESCE((
  SELECT SUM(a.amount_cents) FROM payment_allocations a
  JOIN payments p ON p.id = a.payment_id
  WHERE a.charge_id = c.id AND p.status = 'completed'
), 0)`;

interface Charge {
  id: number;
  student_id: number;
  charge_type: string;
  description: string;
  amount_cents: number;
  period_start: string | null;
  due_date: string | null;
}

function validCents(value: unknown): value is number {
  return isPositiveInt(value) && Number.isSafeInteger(value);
}

export async function listCharges(request: CustomRequest, env: Env) {
  const studentId = Number(request.params.studentId);
  if (!isPositiveInt(studentId)) return fail('Öğrenci ID geçersiz.', 422);
  const { results } = await env.DB.prepare(`
    SELECT c.id, c.charge_type, c.description, c.amount_cents, c.due_date, c.status,
           ${PAID} AS paid_cents, c.amount_cents - ${PAID} AS balance_cents
    FROM student_charges c WHERE c.student_id = ?
    ORDER BY c.status = 'active' DESC, c.due_date, c.id DESC
  `).bind(studentId).all();
  return ok(results);
}

export async function listOwnOpenCharges(request: CustomRequest, env: Env) {
  const { results } = await env.DB.prepare(`
    SELECT c.id, c.charge_type, c.description, c.amount_cents, c.due_date, c.status,
           ${PAID} AS paid_cents, c.amount_cents - ${PAID} AS balance_cents
    FROM student_charges c JOIN students s ON s.id = c.student_id
    WHERE s.user_id = ? AND c.status = 'active' AND c.amount_cents > ${PAID}
    ORDER BY c.due_date IS NULL, c.due_date, c.id
  `).bind(request.user!.id).all();
  return ok(results);
}

export async function createCharge(request: CustomRequest, env: Env) {
  const studentId = Number(request.params.studentId);
  const input = await readJson<{
    charge_type?: unknown; description?: unknown; amount_cents?: unknown;
    due_date?: unknown; period_start?: unknown; request_id?: unknown;
  }>(request);
  const type = input?.charge_type;
  const description = typeof input?.description === 'string' ? input.description.trim() : '';
  const amount = input?.amount_cents;
  const dueDate = input?.due_date;
  const period = input?.period_start ?? null;
  const key = input?.request_id;

  if (!isPositiveInt(studentId) || (type !== 'monthly_due' && type !== 'private_lesson') ||
    !description || description.length > 180 || !validCents(amount) || !isValidDate(dueDate) ||
    typeof key !== 'string' || !REQUEST_ID.test(key) ||
    (type === 'monthly_due' ? !isValidDate(period) || !period.endsWith('-01') : period !== null)) {
    return fail('Borç bilgileri geçersiz.', 422);
  }

  const selector = env.DB.prepare(`
    SELECT id, student_id, charge_type, description, amount_cents, period_start, due_date
    FROM student_charges WHERE request_id = ?
  `).bind(key);
  const inserted = await env.DB.prepare(`
    INSERT INTO student_charges (
      student_id, charge_type, description, amount_cents, due_date, period_start,
      created_by_user_id, request_id
    )
    SELECT id, ?, ?, ?, ?, ?, ?, ? FROM students WHERE id = ?
    ON CONFLICT DO NOTHING
    RETURNING id
  `).bind(type, description, amount, dueDate, period, request.user!.id, key, studentId).first();
  if (inserted) return ok(inserted, 201);
  const prior = await selector.first<Charge>();
  if (prior?.student_id === studentId && prior.charge_type === type && prior.description === description &&
    prior.amount_cents === amount && prior.due_date === dueDate && prior.period_start === period) {
    return ok({ id: prior.id });
  }
  return fail('Öğrenci bulunamadı, talep farklı bir kayıtla eşleşiyor veya bu dönemin aidatı zaten açılmış.', 409);
}

export async function cancelCharge(request: CustomRequest, env: Env) {
  const studentId = Number(request.params.studentId);
  const chargeId = Number(request.params.chargeId);
  if (!isPositiveInt(studentId) || !isPositiveInt(chargeId)) return fail('Borç ID geçersiz.', 422);
  const eligible = `c.id = ? AND c.student_id = ? AND c.status = 'active'
    AND c.charge_type != 'package' AND ${PAID} = 0`;
  const [, changed] = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO audit_logs(user_id, action, table_name, record_id)
      SELECT ?, 'charge.cancel', 'student_charges', c.id
      FROM student_charges c WHERE ${eligible}
    `).bind(request.user!.id, chargeId, studentId),
    env.DB.prepare(`
      UPDATE student_charges AS c SET status = 'cancelled'
      WHERE ${eligible}
    `).bind(chargeId, studentId),
  ]);
  return changed.meta.changes === 1 ? ok({ id: chargeId }) :
    fail('Sadece tahsilatsız manuel borçlar iptal edilebilir.', 409);
}

export async function receivePayment(request: CustomRequest, env: Env) {
  const studentId = Number(request.params.studentId);
  const chargeId = Number(request.params.chargeId);
  const input = await readJson<{ amount_cents?: unknown; payment_method?: unknown; payment_date?: unknown;
    request_id?: unknown; description?: unknown }>(request);
  const amount = input?.amount_cents;
  const method = input?.payment_method;
  const date = input?.payment_date;
  const id = input?.request_id;
  const description = typeof input?.description === 'string' ? input.description.trim() : '';
  if (!isPositiveInt(studentId) || !isPositiveInt(chargeId) || !validCents(amount) ||
    (method !== 'cash' && method !== 'bank_transfer') || !isValidDate(date) ||
    typeof id !== 'string' || !REQUEST_ID.test(id) || description.length > 180) {
    return fail('Tahsilat bilgileri geçersiz.', 422);
  }

  const number = `PAY-${id}`;
  const userId = request.user!.id;
  const read = env.DB.prepare(`
    SELECT p.id, p.student_id, p.amount_cents, p.payment_method, p.payment_date, p.description, a.charge_id
    FROM payments p JOIN payment_allocations a ON a.payment_id = p.id
    WHERE p.payment_number = ?
  `).bind(number);
  type Payment = { id: number; student_id: number; amount_cents: number; payment_method: string;
    payment_date: string; description: string | null; charge_id: number };
  const matches = (p: Payment) => p.student_id === studentId && p.charge_id === chargeId &&
    p.amount_cents === amount && p.payment_method === method && p.payment_date === date &&
    (p.description ?? '') === description;
  const prior = await read.first<Payment>();
  if (prior) return matches(prior) ? ok({ id: prior.id }) : fail('İstek numarası başka işlemde kullanıldı.', 409);

  try {
    const [inserted] = await env.DB.batch<{ id: number }>([
      env.DB.prepare(`
        INSERT INTO payments (payment_number, student_id, package_id, amount_cents, payment_method,
          payment_date, description, received_by_user_id, status)
        SELECT ?, c.student_id, c.package_id, ?, ?, ?, ?, ?, 'completed'
        FROM student_charges c WHERE c.id = ? AND c.student_id = ? AND c.status = 'active'
          AND c.amount_cents - ${PAID} >= ?
        RETURNING id
      `).bind(number, amount, method, date, description || null, userId, chargeId, studentId, amount),
      env.DB.prepare(`
        INSERT INTO payment_allocations (payment_id, charge_id, amount_cents)
        SELECT id, ?, amount_cents FROM payments WHERE payment_number = ?
      `).bind(chargeId, number),
      env.DB.prepare(`
        INSERT INTO ledger_transactions (transaction_number, student_id, payment_id, package_id,
          transaction_type, category, amount_cents, description, transaction_date, created_by_user_id)
        SELECT ?, p.student_id, p.id, p.package_id, 'income', c.charge_type, p.amount_cents,
          p.description, p.payment_date, ?
        FROM payments p JOIN payment_allocations a ON a.payment_id = p.id
        JOIN student_charges c ON c.id = a.charge_id WHERE p.payment_number = ?
      `).bind(`TX-${id}`, userId, number),
    ]);
    const record = inserted.results[0];
    return record ? ok(record, 201) : fail('Borç kapalı, bulunamadı veya tutar kalan borcu aşıyor.', 409);
  } catch (error) {
    const stored = await read.first<Payment>();
    if (stored) return matches(stored) ? ok({ id: stored.id }) : fail('İstek numarası başka işlemde kullanıldı.', 409);
    throw error;
  }
}
