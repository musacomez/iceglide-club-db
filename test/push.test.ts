import { env, SELF } from 'cloudflare:test';
import { afterEach, expect, it, vi } from 'vitest';
import webpush from 'web-push';
import { deliverPushJobs, enqueueChatPush, enqueuePaymentReminders, enqueueStudentPush } from '../src/lib/push';
import { savePushDevice, validPushEndpoint } from '../src/routes/push';
import type { CustomRequest } from '../src/types/env';

const origin = 'https://iceglide.test';

function keys() {
  const vapid = webpush.generateVAPIDKeys();
  return {
    DB: env.DB,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_SUBJECT: 'mailto:club@example.org',
  };
}

const expiry = '2090-02-02';

async function device(id: number, userId: number, publicKey: string) {
  await env.DB.prepare(
    'INSERT INTO push_devices(id,user_id,auth_version,endpoint,p256dh,auth) VALUES (?, ?, 0, ?, ?, ?)',
  ).bind(id, userId, `https://fcm.googleapis.com/fcm/send/test-${id}`, publicKey, 'AAAAAAAAAAAAAAAAAAAAAA').run();
}

afterEach(() => vi.unstubAllGlobals());

it('accepts supported HTTPS push services and validates a browser subscription', async () => {
  expect(validPushEndpoint('https://web.push.apple.com/device')).toBe(true);
  expect(validPushEndpoint('https://fcm.googleapis.com.example.org/device')).toBe(false);
  expect(validPushEndpoint('https://fcm.googleapis.com:444/device')).toBe(false);
  expect(validPushEndpoint('https://web.push.apple.com@127.0.0.1/device')).toBe(false);
  const configured = keys();
  const request = new Request(origin + '/api/push/device', {
    method: 'PUT',
    body: JSON.stringify({
      endpoint: 'https://web.push.apple.com/device',
      keys: { p256dh: configured.VAPID_PUBLIC_KEY, auth: 'AAAAAAAAAAAAAAAAAAAAAA' },
    }),
  }) as CustomRequest;
  request.user = { id: 6, role: 'student' };
  request.authVersion = 0;
  expect((await savePushDevice(request, configured)).status).toBe(200);
  expect((await SELF.fetch(origin + '/api/push/settings')).status).toBe(401);
});

it('queues once per opted-in device and delivers encrypted requests', async () => {
  const configured = keys();
  await device(901, 6, configured.VAPID_PUBLIC_KEY);
  await device(902, 7, configured.VAPID_PUBLIC_KEY);
  await device(903, 1, configured.VAPID_PUBLIC_KEY);
  await env.DB.prepare(`
    INSERT INTO student_charges(id, student_id, charge_type, description, amount_cents, due_date)
    VALUES (901,101,'private_lesson','Partial',15000,?),
           (902,101,'private_lesson','Other',4000,?),
           (903,102,'private_lesson','Paid',10000,?)
  `).bind(expiry, expiry, expiry).run();
  await env.DB.prepare(`
    INSERT INTO payment_allocations(payment_id,charge_id,amount_cents)
    VALUES (401,901,5000),(402,903,10000)
  `).run();
  await enqueuePaymentReminders(configured, expiry);
  await enqueuePaymentReminders(configured, expiry);
  expect(await enqueueStudentPush(configured, 101)).toBe(1);
  expect(await enqueueStudentPush(configured, 101)).toBe(0);
  await enqueueChatPush(configured, 1, 6);

  const sender = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 201 }));
  vi.stubGlobal('fetch', sender);
  await Promise.all([deliverPushJobs(configured), deliverPushJobs(configured)]);
  expect(sender).toHaveBeenCalledTimes(4);
  for (const [, init] of sender.mock.calls) {
    const headers = new Headers(init.headers);
    expect(headers.get('Content-Encoding')).toBe('aes128gcm');
    expect(headers.get('Authorization')).toMatch(/^vapid /);
    expect(init.body).toBeInstanceOf(Uint8Array);
    expect(init.redirect).toBe('manual');
  }
});
