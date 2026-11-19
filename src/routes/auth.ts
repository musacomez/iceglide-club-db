import type { CustomRequest, Env, UserRole } from '../types/env';
import { fail, ok } from '../lib/response';
import { hashPassword, verifyPassword } from '../lib/password';
import { signToken } from '../lib/token';

export async function login(request: Request, env: Env) {
  if (!env.AUTH_SECRET) return fail('AUTH_SECRET yapılandırılmamış.', 500);

  let body: { email?: string; password?: string } | null;
  try {
    body = await request.json();
  } catch {
    return fail('Geçersiz JSON.', 400);
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = body?.password;
  if (!email || typeof password !== 'string' || !password) {
    return fail('email ve password zorunludur.', 422);
  }

  const account = await env.DB.prepare(`
    SELECT id, email, full_name, role, active, password_hash, auth_version
    FROM users
    WHERE lower(email) = ? AND active = 1
    LIMIT 1
  `).bind(email).first<{
    id: number;
    email: string;
    full_name: string;
    role: UserRole;
    active: number;
    password_hash: string;
    auth_version: number;
  }>();

  if (!account || !(await verifyPassword(password, account.password_hash))) {
    return fail('Email veya parola hatalı.', 401);
  }

  const { password_hash: _hash, auth_version: authVersion, ...user } = account;
  const token = await signToken({
    sub: user.id,
    role: user.role,
    email: user.email,
    full_name: user.full_name,
    ver: authVersion,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12,
  }, env.AUTH_SECRET);

  await env.DB.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(user.id)
    .run();

  return ok({ token, user });
}

export async function changePassword(request: CustomRequest, env: Env) {
  if (!request.user || request.authVersion === undefined) {
    return fail('Yetkilendirme gerekli.', 401);
  }

  let body: { current_password?: unknown; new_password?: unknown } | null;
  try {
    body = await request.json();
  } catch {
    return fail('Geçersiz JSON.', 400);
  }

  const currentPassword = body?.current_password;
  const newPassword = body?.new_password;

  if (typeof currentPassword !== 'string' || !currentPassword || typeof newPassword !== 'string') {
    return fail('Mevcut ve yeni parola zorunludur.', 422);
  }
  const length = [...newPassword].length;
  if (length < 15 || length > 128) {
    return fail('Yeni parola 15 ile 128 karakter arasında olmalıdır.', 422);
  }
  if (currentPassword === newPassword) {
    return fail('Yeni parola mevcut paroladan farklı olmalıdır.', 422);
  }

  const userId = request.user.id;
  const authVersion = request.authVersion;

  // Reserve an attempt before verifying the password, including across parallel requests.
  const attempt = await env.DB.prepare(`
    INSERT INTO audit_logs (user_id, action, table_name, record_id)
    SELECT ?, 'password_change_attempt', 'users', ?
    WHERE (
      SELECT COUNT(*) FROM audit_logs
      WHERE user_id = ? AND action = 'password_change_attempt'
        AND created_at > datetime('now', '-15 minutes')
    ) < 5
  `).bind(userId, userId, userId).run();

  if (attempt.meta.changes !== 1) {
    return fail('Çok fazla deneme yapıldı. Lütfen 15 dakika sonra tekrar deneyin.', 429);
  }

  const account = await env.DB.prepare(`
    SELECT password_hash FROM users
    WHERE id = ? AND active = 1 AND auth_version = ?
  `).bind(userId, authVersion).first<{ password_hash: string }>();

  if (!account) return fail('Oturumunuz sona erdi. Yeniden giriş yapın.', 401);
  if (!(await verifyPassword(currentPassword, account.password_hash))) {
    return fail('Mevcut parola hatalı.', 422);
  }

  const passwordHash = await hashPassword(newPassword);
  const changed = await env.DB.prepare(`
    UPDATE users
    SET password_hash = ?, auth_version = auth_version + 1,
        password_changed_at = CURRENT_TIMESTAMP
    WHERE id = ? AND active = 1 AND auth_version = ? AND password_hash = ?
  `).bind(passwordHash, userId, authVersion, account.password_hash).run();

  if (changed.meta.changes !== 1) {
    return fail('Oturumunuz sona erdi. Yeniden giriş yapın.', 401);
  }

  return ok({ changed: true });
}
