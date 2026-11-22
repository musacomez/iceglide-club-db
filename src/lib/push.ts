import webpush from 'web-push';
import type { Env } from '../types/env';
import { addDaysISO } from './validate';
import { PAID } from '../routes/finance';

interface PushJob {
  id: number;
  device_id: number;
  user_id: number;
  kind: 'chat' | 'manual' | 'payment';
  event_key: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  attempts: number;
}

const validRecipient = 'u.active = 1 AND u.auth_version = d.auth_version';

export function pushSettings(env: Env) {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = env;
  return publicKey && privateKey && subject ? { subject, publicKey, privateKey } : null;
}

export async function enqueueChatPush(env: Env, messageId: number, author: number) {
  if (!pushSettings(env)) return;
  await env.DB.prepare(`
    INSERT OR IGNORE INTO push_jobs (device_id, user_id, event_key, kind)
    SELECT d.id, d.user_id, ?, 'chat'
      FROM push_devices d JOIN users u ON u.id = d.user_id
      WHERE d.user_id <> ? AND ${validRecipient}
  `).bind(`chat:${messageId}`, author).run();
}

export async function enqueuePaymentReminders(env: Env, due: string) {
  await env.DB.prepare(`
    INSERT OR IGNORE INTO push_jobs (device_id, user_id, event_key, kind, student_id, due_date)
    SELECT d.id, d.user_id, 'payment:' || s.id || ':' || ?, 'payment', s.id, ?
      FROM students s
      JOIN push_devices d ON d.user_id = s.user_id
      JOIN users u ON u.id = d.user_id
      WHERE ${validRecipient} AND u.role = 'student' AND EXISTS (
        SELECT 1 FROM student_charges c WHERE c.student_id = s.id AND c.due_date = ?
          AND c.status = 'active' AND c.amount_cents > ${PAID}
      )
  `).bind(due, due, due).run();
}

export async function enqueueStudentPush(env: Env, studentId: number) {
  const result = await env.DB.prepare(`
    INSERT OR IGNORE INTO push_jobs (device_id, user_id, event_key, kind, student_id)
    SELECT d.id, d.user_id, 'manual:' || s.id || ':' || strftime('%Y-%m-%d %H:%M','now'), 'manual', s.id
      FROM students s
      JOIN push_devices d ON d.user_id = s.user_id
      JOIN users u ON u.id = d.user_id
      WHERE s.id = ? AND ${validRecipient} AND u.role = 'student'
  `).bind(studentId).run();
  return result.meta.changes;
}

const labels = {
  chat: 'Kulüp sohbetinde yeni bir mesaj var.',
  manual: 'Kulübünden bir bildirim var.',
  payment: 'Ödeme vaden yaklaşıyor.',
};

export async function deliverPushJobs(env: Env) {
  const vapidDetails = pushSettings(env);
  if (!vapidDetails) return;

  const { results: leased } = await env.DB.prepare(`
    UPDATE push_jobs
    SET available_at = datetime('now', '+5 minutes'), attempts = attempts + 1
    WHERE id IN (
      SELECT j.id FROM push_jobs j JOIN push_devices d ON d.id = j.device_id
      JOIN users u ON u.id = d.user_id
      WHERE j.finished_at IS NULL AND j.available_at <= CURRENT_TIMESTAMP AND j.attempts < 4
        AND j.user_id = d.user_id AND ${validRecipient}
      ORDER BY j.available_at, j.id LIMIT 30
    ) RETURNING id
  `).all<{ id: number }>();
  if (!leased.length) return;

  const slots = leased.map(() => '?').join(',');
  const { results } = await env.DB.prepare(`
    SELECT j.id, j.device_id, j.user_id, j.kind, j.event_key, j.attempts,
           d.endpoint, d.p256dh, d.auth
    FROM push_jobs j JOIN push_devices d ON d.id = j.device_id
    JOIN users u ON u.id = d.user_id
    WHERE j.id IN (${slots}) AND j.user_id = d.user_id AND ${validRecipient}
      AND (j.kind = 'chat' OR EXISTS (
        SELECT 1 FROM students s WHERE s.id = j.student_id AND s.user_id = j.user_id
      ))
      AND (j.kind <> 'payment' OR (
        j.due_date >= date('now', '+3 hours') AND EXISTS (
          SELECT 1 FROM student_charges c
          WHERE c.student_id = j.student_id AND c.due_date = j.due_date
            AND c.status = 'active' AND c.amount_cents > ${PAID}
        )
      ))
  `).bind(...leased.map(row => row.id)).all<PushJob>();

  const sendable = new Set(results.map(row => row.id));
  const finish = (id: number) => env.DB.prepare(
    'UPDATE push_jobs SET finished_at = CURRENT_TIMESTAMP WHERE id = ?',
  ).bind(id);

  const updates = leased.filter(row => !sendable.has(row.id)).map(row => finish(row.id));
  for (let offset = 0; offset < results.length; offset += 5) {
    const changes = await Promise.all(results.slice(offset, offset + 5).map(async (job) => {
      const url = job.kind === 'chat' ? '/chat' : job.kind === 'payment' ? '/student/payments' : '/student';
      try {
        const request = webpush.generateRequestDetails(
          { endpoint: job.endpoint, keys: { p256dh: job.p256dh, auth: job.auth } },
          JSON.stringify({ body: labels[job.kind], url, tag: job.event_key }),
          { vapidDetails, TTL: 300 },
        );
        const response = await fetch(request.endpoint, {
          method: request.method, headers: request.headers,
          body: request.body ? Uint8Array.from(request.body) : undefined,
          redirect: 'manual', signal: AbortSignal.timeout(8_000),
        });
        await response.body?.cancel();
        if (!response.ok) throw Object.assign(new Error('Push service refused the request'), { statusCode: response.status });
        return finish(job.id);
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          return env.DB.prepare('DELETE FROM push_devices WHERE id = ? AND user_id = ? AND endpoint = ?')
            .bind(job.device_id, job.user_id, job.endpoint);
        }
        if (job.attempts >= 4 || (status && status < 500 && status !== 429)) {
          console.warn('Push delivery rejected', { status, kind: job.kind });
          return finish(job.id);
        }
        return null;
      }
    }));
    for (const change of changes) if (change) updates.push(change);
  }
  if (updates.length) await env.DB.batch(updates);
}

export async function runPushSchedule(env: Env, time: number) {
  if (!pushSettings(env)) return;
  const local = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(time));
  const part = (type: Intl.DateTimeFormatPartTypes) => local.find(p => p.type === type)?.value;
  if (part('hour') === '09') {
    const date = `${part('year')}-${part('month')}-${part('day')}`;
    await enqueuePaymentReminders(env, addDaysISO(date, 1));
  }
  await deliverPushJobs(env);
  if (part('hour') === '03') {
    await env.DB.prepare("DELETE FROM push_jobs WHERE available_at < datetime('now', '-14 days')").run();
  }
}
