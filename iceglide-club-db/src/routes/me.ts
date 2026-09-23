import type { CustomRequest, Env } from '../types/env';
import { fail, ok } from '../lib/response';

export async function me(request: CustomRequest, env: Env) {
  if (!request.user) return fail('Yetkilendirme gerekli.', 401);

  const user = await env.DB.prepare(`
    SELECT id, email, full_name, phone, role, active, last_login_at, created_at
    FROM users
    WHERE id = ?
  `).bind(request.user.id).first();

  if (!user) return fail('Kullanıcı bulunamadı.', 404);
  return ok(user);
}
