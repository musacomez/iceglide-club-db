import { describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const origin = 'https://iceglide.test';

async function session(email = 'admin@test.invalid') {
  const response = await SELF.fetch(origin + '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'Test1234!' }),
  });
  const result = await response.json<{ data: { token: string } }>();
  return { Authorization: `Bearer ${result.data.token}` };
}

const assignment = () => ({
  package_type_id: 201,
  starts_at: '2026-11-20',
  request_id: crypto.randomUUID(),
  expected_price_cents: 150000,
  expected_lesson_count: 10,
  expected_validity_days: 30,
});

function assign(headers: Record<string, string>, body: ReturnType<typeof assignment>) {
  return SELF.fetch(origin + '/api/packages/student/101', {
    method: 'POST', headers, body: JSON.stringify(body),
  });
}

async function configureType(price = 150000) {
  await env.DB.prepare('UPDATE package_types SET price_cents = ?, validity_days = 30 WHERE id = 201')
    .bind(price).run();
}

describe('package assignment', () => {
  it('creates one package, one debt and one audit event under concurrent retries', async () => {
    await configureType();
    const headers = await session();
    const body = assignment();
    const responses = await Promise.all([assign(headers, body), assign(headers, body)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    const results = await Promise.all(responses.map((response) => response.json<{ data: { id: number; charge_id: number } }>()));
    expect(results[0]?.data).toMatchObject({
      charge_id: expect.any(Number), total_lessons: 10, expires_at: '2026-12-19', price_cents: 150000,
    });
    expect(results[0]).toEqual(results[1]);
    const id = results[0]!.data.id;
    expect(await env.DB.prepare('SELECT remaining_lessons, total_lessons FROM packages WHERE id = ?').bind(id).first())
      .toEqual({ remaining_lessons: 10, total_lessons: 10 });
    expect(await env.DB.prepare('SELECT amount_cents, due_date FROM student_charges WHERE package_id = ?').bind(id).first())
      .toEqual({ amount_cents: 150000, due_date: '2026-11-20' });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action = 'package.assign' AND record_id = ?").bind(id).first())
      .toEqual({ count: 1 });
    expect(await env.DB.prepare('SELECT id FROM payments WHERE package_id = ?').bind(id).first()).toBeNull();
    const list = await SELF.fetch(origin + '/api/packages/student/101', { headers });
    expect(await list.json()).toMatchObject({ data: expect.arrayContaining([expect.objectContaining({ id })]) });
  });

  it('lets the head coach assign a free package without debt', async () => {
    await configureType(0);
    const response = await assign(await session('coach@test.invalid'), { ...assignment(), expected_price_cents: 0 });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ data: { charge_id: null } });
    expect(await env.DB.prepare('SELECT id FROM student_charges').first()).toBeNull();
  });

  it('rejects unauthorized writes and rejects a stale price', async () => {
    await configureType();
    const studentHeaders = await session('student-a@test.invalid');
    const body = assignment();
    expect((await assign(studentHeaders, body)).status).toBe(403);
    expect((await SELF.fetch(origin + '/api/packages/types', { headers: studentHeaders })).status).toBe(403);
    const headers = await session();
    expect((await assign(headers, { ...body, expected_price_cents: 1 })).status).toBe(409);
    expect(await env.DB.prepare('SELECT id FROM packages WHERE package_number = ?').bind(`PKG-${body.request_id}`).first())
      .toBeNull();
  });

  it('rolls back the package if writing the debt fails', async () => {
    await configureType();
    await env.DB.prepare(`
      CREATE TRIGGER test_reject_charge BEFORE INSERT ON student_charges
      BEGIN SELECT RAISE(ABORT, 'test charge failure'); END
    `).run();
    try {
      const body = assignment();
      expect((await assign(await session(), body)).status).toBe(500);
      expect(await env.DB.prepare('SELECT id FROM packages WHERE package_number = ?').bind(`PKG-${body.request_id}`).first())
        .toBeNull();
    } finally {
      await env.DB.prepare('DROP TRIGGER test_reject_charge').run();
    }
  });
});
