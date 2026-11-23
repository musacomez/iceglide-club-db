import { env, SELF } from 'cloudflare:test';
import { expect, it } from 'vitest';

const origin = 'https://iceglide.test';

async function session(email = 'admin@test.invalid') {
  const response = await SELF.fetch(origin + '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'Test1234!' }),
  });
  const result = await response.json<{ data: { token: string } }>();
  return { Authorization: `Bearer ${result.data.token}` };
}

const adjustment = (delta: number, previous = 8) => ({
  quantity_delta: delta,
  expected_remaining_lessons: previous,
  reason: 'Ders hakkı düzeltmesi',
  request_id: crypto.randomUUID(),
});

function adjust(headers: Record<string, string>, body: ReturnType<typeof adjustment>, studentId = 101) {
  return SELF.fetch(origin + `/api/packages/student/${studentId}/301/lesson-adjustments`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
}

it('adds and removes rights and records the correction without creating attendance', async () => {
  const headers = await session('coach@test.invalid');
  await env.DB.prepare('UPDATE packages SET total_lessons = 10, expires_at = NULL WHERE id = 301').run();
  expect(await (await adjust(headers, adjustment(3))).json()).toMatchObject({ data: { remaining_lessons: 11 } });
  expect(await (await adjust(headers, adjustment(-2, 11))).json()).toMatchObject({ data: { remaining_lessons: 9 } });
  expect(await env.DB.prepare('SELECT total_lessons, remaining_lessons FROM packages WHERE id = 301').first())
    .toEqual({ total_lessons: 10, remaining_lessons: 9 });
  expect(await env.DB.prepare(`
    SELECT transaction_type, quantity_delta, lesson_instance_id, attendance_id, description, created_by_user_id
    FROM package_transactions WHERE package_id = 301 ORDER BY id
  `).all()).toMatchObject({
    results: [3, -2].map((quantity_delta) => ({
      quantity_delta, transaction_type: 'correction', lesson_instance_id: null, attendance_id: null,
      description: 'Ders hakkı düzeltmesi', created_by_user_id: 2,
    })),
  });
  expect(await env.DB.prepare('SELECT id FROM attendances').first()).toBeNull();
});

it('applies concurrent retries once and prevents stale or conflicting updates', async () => {
  const headers = await session();
  await env.DB.prepare('UPDATE packages SET expires_at = NULL WHERE id = 301').run();
  const body = adjustment(-1);
  const responses = await Promise.all([adjust(headers, body), adjust(headers, body)]);
  expect(await Promise.all(responses.map((response) => response.json()))).toMatchObject([
    { data: { remaining_lessons: 7 } }, { data: { remaining_lessons: 7 } },
  ]);
  expect((await adjust(headers, { ...body, reason: 'Farklı açıklama' })).status).toBe(409);
  expect((await adjust(headers, adjustment(1))).status).toBe(409);
  expect(await env.DB.prepare('SELECT count(*) AS count FROM package_transactions WHERE package_id = 301').first())
    .toEqual({ count: 1 });
  expect(await env.DB.prepare("SELECT count(*) AS count FROM audit_logs WHERE action = 'package.adjust_lessons'").first())
    .toEqual({ count: 1 });
});

it('rejects unauthorized, mismatched, expired and negative changes', async () => {
  const headers = await session();
  await env.DB.prepare("UPDATE packages SET expires_at = '2000-01-01' WHERE id = 301").run();
  expect((await adjust(await session('student-a@test.invalid'), adjustment(1))).status).toBe(403);
  expect((await adjust(headers, adjustment(1))).status).toBe(409);
  await env.DB.prepare('UPDATE packages SET expires_at = NULL WHERE id = 301').run();
  expect((await adjust(headers, adjustment(1), 102)).status).toBe(409);
  expect((await adjust(headers, adjustment(-9))).status).toBe(422);
  expect(await env.DB.prepare('SELECT remaining_lessons FROM packages WHERE id = 301').first())
    .toEqual({ remaining_lessons: 8 });
});

it('rolls back the balance and audit row if the correction cannot be recorded', async () => {
  const headers = await session();
  await env.DB.batch([
    env.DB.prepare('UPDATE packages SET expires_at = NULL WHERE id = 301'),
    env.DB.prepare(`CREATE TRIGGER test_reject_correction BEFORE INSERT ON package_transactions
                    BEGIN SELECT RAISE(ABORT, 'test correction failure'); END`),
  ]);
  try {
    expect((await adjust(headers, adjustment(1))).status).toBe(500);
    expect(await env.DB.prepare('SELECT remaining_lessons FROM packages WHERE id = 301').first())
      .toEqual({ remaining_lessons: 8 });
    expect(await env.DB.prepare("SELECT id FROM audit_logs WHERE action = 'package.adjust_lessons'").first()).toBeNull();
  } finally {
    await env.DB.prepare('DROP TRIGGER test_reject_correction').run();
  }
});
