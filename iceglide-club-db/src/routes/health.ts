import { ok } from '../lib/response';
import type { Env } from '../types/env';

export async function health(env: Env) {
  const row = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
  return ok({
    service: 'iceglide-api',
    database: row?.ok === 1,
    timestamp: new Date().toISOString(),
  });
}
