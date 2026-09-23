import type { Env, AuthUser, CustomRequest } from '../types/env';
import { fail } from '../lib/response';
import { verifyToken } from '../lib/token';

export async function authenticate(request: CustomRequest, env: Env): Promise<Response | void> {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return fail('Yetkilendirme gerekli.', 401);
  if (!env.AUTH_SECRET) return fail('AUTH_SECRET yapılandırılmamış.', 500);

  const payload = await verifyToken(header.slice(7).trim(), env.AUTH_SECRET);
  if (!payload || typeof payload.sub !== 'number' || typeof payload.role !== 'string') {
    return fail('Geçersiz veya süresi dolmuş token.', 401);
  }

  request.user = {
    id: payload.sub,
    role: payload.role as AuthUser['role'],
    full_name: typeof payload.full_name === 'string' ? payload.full_name : undefined,
    email: typeof payload.email === 'string' ? payload.email : undefined,
  };
}
