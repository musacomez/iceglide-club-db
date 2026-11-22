import { deliverPushJobs, enqueueStudentPush, pushSettings } from '../lib/push';
import { fail, ok } from '../lib/response';
import { readJson } from '../lib/validate';
import type { CustomRequest, Env } from '../types/env';

export function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const host = url.hostname;
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && !url.hash &&
      (host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' ||
       host === 'web.push.apple.com' || host.endsWith('.push.apple.com') ||
       host.endsWith('.notify.windows.com'));
  } catch {
    return false;
  }
}

export async function getPushSettings(_request: CustomRequest, env: Env) {
  return ok({ public_key: pushSettings(env)?.publicKey ?? null });
}

export async function savePushDevice(request: CustomRequest, env: Env) {
  if (!pushSettings(env)) return fail('Telefon bildirimleri henüz yapılandırılmadı.', 503);
  const data = await readJson<{ endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } }>(request);
  const endpoint = data?.endpoint;
  const p256dh = data?.keys?.p256dh;
  const auth = data?.keys?.auth;
  if (!validPushEndpoint(endpoint) || typeof p256dh !== 'string' || typeof auth !== 'string' ||
      !/^B[A-Za-z0-9_-]{86}$/.test(p256dh) || !/^[A-Za-z0-9_-]{22}$/.test(auth)) {
    return fail('Cihaz bildirim bilgileri geçersiz.', 422);
  }

  const saved = await env.DB.prepare(`
    INSERT INTO push_devices(user_id, auth_version, endpoint, p256dh, auth)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id,
      auth_version = excluded.auth_version,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `).bind(request.user!.id, request.authVersion ?? 0, endpoint, p256dh, auth).first<{ id: number }>();
  return saved ? ok(saved) : fail('Cihaz kaydedilemedi.', 500);
}

export async function deletePushDevice(request: CustomRequest, env: Env) {
  const data = await readJson<{ endpoint?: unknown }>(request);
  if (typeof data?.endpoint !== 'string') return fail('Bildirim uç noktası geçersiz.', 422);
  await env.DB.prepare('DELETE FROM push_devices WHERE user_id = ? AND endpoint = ?')
    .bind(request.user!.id, data.endpoint).run();
  return ok({ deleted: true });
}

export async function notifyStudent(request: CustomRequest, env: Env, ctx: ExecutionContext) {
  const studentId = Number(request.params.id);
  if (!Number.isSafeInteger(studentId) || studentId < 1) return fail('Öğrenci numarası geçersiz.', 422);
  if (!pushSettings(env)) return fail('Telefon bildirimleri henüz yapılandırılmadı.', 503);
  const changed = await enqueueStudentPush(env, studentId);
  ctx.waitUntil(deliverPushJobs(env));
  return ok({ queued: changed });
}
