import { hashPassword } from '../lib/password';
import { fail, ok } from '../lib/response';
import { isValidEmail, readJson } from '../lib/validate';
import type { CustomRequest, Env } from '../types/env';

type StudentAccount = {
  user_id: number | null;
  email: string | null;
  active: number | null;
  role: string | null;
  auth_version: number | null;
  linked_students: number;
};

function readStudentAccount(env: Env, studentId: number) {
  return env.DB.prepare(`
    SELECT s.user_id, u.email, u.active, u.role, u.auth_version,
      (SELECT COUNT(*) FROM students linked WHERE linked.user_id = s.user_id) AS linked_students
    FROM students s LEFT JOIN users u ON u.id = s.user_id
    WHERE s.id = ?
  `).bind(studentId).first<StudentAccount>();
}

function hasInvalidLink(account: StudentAccount) {
  return account.user_id !== null && (account.role !== 'student' || account.linked_students !== 1);
}

export async function getStudentAccount(request: CustomRequest, env: Env) {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return fail('Geçersiz öğrenci numarası.', 400);
  const account = await readStudentAccount(env, id);
  if (!account) return fail('Öğrenci bulunamadı.', 404);
  if (hasInvalidLink(account)) return fail('Öğrencinin hesap bağlantısı kontrol edilmeli.', 409);
  return ok({ email: account.email, active: account.active === null ? null : account.active === 1 });
}

export async function saveStudentAccount(request: CustomRequest, env: Env) {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return fail('Geçersiz öğrenci numarası.', 400);

  const create = request.method === 'POST';
  const body = await readJson<{ email?: unknown; password?: unknown }>(request);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = body?.password;
  if (!isValidEmail(email) || email.length > 254) return fail('Geçerli bir giriş e-postası girin.', 422);
  if (create || password !== undefined) {
    const length = typeof password === 'string' ? [...password].length : 0;
    if (length < 15 || length > 128) return fail('Parola 15 ile 128 karakter arasında olmalıdır.', 422);
  }

  const account = await readStudentAccount(env, id);
  if (!account) return fail('Öğrenci bulunamadı.', 404);
  if (hasInvalidLink(account)) return fail('Öğrencinin hesap bağlantısı kontrol edilmeli.', 409);
  if (create !== (account.user_id === null)) return fail('Hesap durumu değişti. Sayfayı yenileyin.', 409);

  const hash = typeof password === 'string' ? await hashPassword(password) : null;
  const duplicateEmail = 'SELECT 1 FROM users other WHERE lower(other.email) = ?';
  if (create) {
    const [inserted] = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO users (email, full_name, phone, role, active, password_hash)
        SELECT ?, full_name, phone, 'student', 1, ?
        FROM students WHERE id = ? AND user_id IS NULL
          AND NOT EXISTS (${duplicateEmail})
      `).bind(email, hash, id, email),
      env.DB.prepare(`
        UPDATE students SET user_id = last_insert_rowid()
        WHERE id = ? AND user_id IS NULL AND changes() = 1
      `).bind(id),
    ]);
    if (inserted.meta.changes !== 1) return fail('Bu e-posta kullanılıyor veya öğrenci hesabı zaten açıldı.', 409);
    return ok({ email, active: true }, 201);
  }

  const updated = await env.DB.prepare(`
    UPDATE users SET email = ?, password_hash = COALESCE(?, password_hash),
      password_changed_at = CASE WHEN ? IS NULL THEN password_changed_at ELSE CURRENT_TIMESTAMP END,
      auth_version = auth_version + CASE WHEN ? IS NOT NULL OR email <> ? THEN 1 ELSE 0 END
    WHERE id = ? AND role = 'student' AND auth_version = ?
      AND EXISTS (SELECT 1 FROM students WHERE id = ? AND user_id = users.id)
      AND NOT EXISTS (SELECT 1 FROM students WHERE id <> ? AND user_id = users.id)
      AND NOT EXISTS (${duplicateEmail} AND other.id <> users.id)
    RETURNING active
  `).bind(email, hash, hash, hash, email, account.user_id, account.auth_version, id, id, email)
    .first<{ active: number }>();
  if (!updated) return fail('Bu e-posta kullanılıyor veya hesap değişti. Sayfayı yenileyin.', 409);
  return ok({ email, active: updated.active === 1 });
}
