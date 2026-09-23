import type { Env } from '../types/env';
import { fail, ok } from '../lib/response';
import { verifyPassword } from '../lib/password';
import { signToken } from '../lib/token';

export async function login(request: Request, env: Env) {
  if (!env.AUTH_SECRET) return fail('AUTH_SECRET yapılandırılmamış.', 500);

  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return fail('Geçersiz JSON.', 400);
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  if (!email || !password) return fail('email ve password zorunludur.', 422);

  const user = await env.DB.prepare(`
    SELECT id, email, full_name, role, active
    FROM users
    WHERE lower(email) = ? AND active = 1
    LIMIT 1
  `).bind(email).first<{
    id: number;
    email: string;
    full_name: string;
    role: 'admin' | 'instructor' | 'student' | 'parent';
    active: number;
  }>();

  if (!user) return fail('Email veya parola hatalı.', 401);

  const stored = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(user.id)
    .first<{ password_hash: string }>();

  if (!stored || !(await verifyPassword(password, stored.password_hash))) {
    return fail('Email veya parola hatalı.', 401);
  }

  const token = await signToken({
    sub: user.id,
    role: user.role,
    email: user.email,
    full_name: user.full_name,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12,
  }, env.AUTH_SECRET);

  await env.DB.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(user.id)
    .run();

  return ok({ token, user });
}
