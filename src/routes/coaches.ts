import { hashPassword } from '../lib/password';
import { fail, ok } from '../lib/response';
import { isValidEmail, readJson } from '../lib/validate';
import type { CustomRequest, Env } from '../types/env';

const coachRoles = "('instructor', 'head_coach')";

export async function listCoaches(_request: CustomRequest, env: Env) {
  const { results } = await env.DB.prepare(`
    SELECT u.id, u.full_name, u.email, u.phone, u.role, u.active,
           c.commission_bps, c.lesson_fee_cents
    FROM users u LEFT JOIN coach_compensation c ON c.user_id = u.id
    WHERE u.role IN ${coachRoles}
    ORDER BY u.active DESC, u.full_name, u.id
  `).all();
  return ok(results);
}

export async function saveCoach(request: CustomRequest, env: Env) {
  const rawId = request.params?.coachId;
  const id = rawId === undefined ? null : Number(rawId);
  if (id !== null && (!Number.isSafeInteger(id) || id < 1)) return fail('Antrenör numarası geçersiz.', 422);

  const body = await readJson<Record<string, unknown>>(request);
  const name = typeof body?.full_name === 'string' ? body.full_name.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const active = body?.active;
  const commission = body?.commission_bps;
  const fee = body?.lesson_fee_cents;
  const password = body?.password;
  if (!name || name.length > 120 || !isValidEmail(email) || email.length > 254 || phone.length > 40 ||
      typeof active !== 'boolean' ||
      (commission !== null && (typeof commission !== 'number' || !Number.isSafeInteger(commission) || commission < 0 || commission > 10_000)) ||
      (fee !== null && (typeof fee !== 'number' || !Number.isSafeInteger(fee) || fee < 0)) ||
      (id === null && (typeof password !== 'string' || password.length < 12 || password.length > 128))) {
    return fail('Antrenör bilgileri, ücret veya başlangıç parolası geçersiz.', 422);
  }

  try {
    if (id === null && typeof password === 'string') {
      const hash = await hashPassword(password);
      const [inserted] = await env.DB.batch<{ id: number }>([
        env.DB.prepare(`
          INSERT INTO users (full_name, email, phone, role, active, password_hash)
          VALUES (?, ?, ?, 'instructor', ?, ?) RETURNING id
        `).bind(name, email, phone || null, Number(active), hash),
        env.DB.prepare(`
          INSERT INTO coach_compensation (user_id, commission_bps, lesson_fee_cents)
          SELECT id, ?, ? FROM users WHERE email = ? AND role = 'instructor'
        `).bind(commission, fee, email),
      ]);
      return ok(inserted.results[0], 201);
    }

    const [updated] = await env.DB.batch<{ id: number }>([
      env.DB.prepare(`
        UPDATE users SET full_name = ?, email = ?, phone = ?,
                         auth_version = auth_version + CASE WHEN active = 1 AND ? = 0 THEN 1 ELSE 0 END,
                         active = ?
        WHERE id = ? AND role IN ${coachRoles} RETURNING id
      `).bind(name, email, phone || null, Number(active), Number(active), id),
      env.DB.prepare(`
        INSERT INTO coach_compensation (user_id, commission_bps, lesson_fee_cents)
        SELECT id, ?, ? FROM users WHERE id = ? AND role IN ${coachRoles}
        ON CONFLICT(user_id) DO UPDATE SET
          commission_bps = excluded.commission_bps, lesson_fee_cents = excluded.lesson_fee_cents
      `).bind(commission, fee, id),
    ]);
    return updated.results.length ? ok(updated.results[0]) : fail('Antrenör bulunamadı.', 404);
  } catch (error) {
    if (String(error).includes('UNIQUE constraint failed: users.email')) return fail('Bu e-posta zaten kullanılıyor.', 409);
    throw error;
  }
}
