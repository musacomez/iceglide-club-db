import { expect, it } from 'vitest';
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

function call(path: string, headers: Record<string, string>, body?: unknown, method = 'POST') {
  return SELF.fetch(origin + '/api' + path, { headers, method: body === undefined ? 'GET' : method,
    body: body === undefined ? undefined : JSON.stringify(body) });
}

it('creates and renames a group, then updates and removes a student membership', async () => {
  const admin = await session();
  const created = await call('/groups', admin, { name: 'Yeni grup' });
  expect(created.status).toBe(201);
  const { data: group } = await created.json<{ data: { id: number } }>();
  expect((await call(`/groups/${group.id}`, admin, { name: 'Yetişkinler' }, 'PATCH')).status).toBe(200);
  expect((await call('/students/101', admin, { group_id: group.id }, 'PATCH')).status).toBe(200);
  const list = await call('/students', admin);
  expect(await list.json()).toMatchObject({ data: expect.arrayContaining([
    expect.objectContaining({ id: 101, current_group: 'Yetişkinler', current_group_id: group.id }),
  ]) });
  expect((await call('/students/101', admin, { group_id: null }, 'PATCH')).status).toBe(200);
  expect(await env.DB.prepare('SELECT end_date FROM group_students WHERE student_id = 101 AND group_id = ?')
    .bind(group.id).first('end_date')).toEqual(expect.any(String));
});

it('rounds a package up to whole weeks and preserves an assigned package on later edits', async () => {
  const admin = await session();
  const payload = { name: '8 ders', lesson_count: 8, lessons_per_week: 3, price_cents: 150000, active: 1 };
  const create = await call('/manage/package-types', admin, payload);
  expect(create.status).toBe(201);
  const { data: template } = await create.json<{ data: { id: number; validity_days: number } }>();
  expect(template.validity_days).toBe(21);
  const assignment = await call('/packages/student/101', admin, {
    package_type_id: template.id, starts_at: '2026-11-20', request_id: crypto.randomUUID(),
    expected_price_cents: 150000, expected_lesson_count: 8, expected_validity_days: 21,
  });
  expect(assignment.status).toBe(201);
  const { data } = await assignment.json<{ data: { id: number; expires_at: string } }>();
  expect(data.expires_at).toBe('2026-12-10');
  expect((await call(`/manage/package-types/${template.id}`, admin, { ...payload, price_cents: 200000, lesson_count: 12 }, 'PATCH')).status).toBe(200);
  expect(await env.DB.prepare('SELECT price_cents, total_lessons, expires_at FROM packages WHERE id = ?')
    .bind(data.id).first()).toEqual({ price_cents: 150000, total_lessons: 8, expires_at: '2026-12-10' });
});

it('records partial payments atomically and prevents duplicate or excessive collection', async () => {
  const admin = await session();
  const root = '/finance/student/101/charges';
  const chargePayload = { charge_type: 'monthly_due', description: 'Kasım aidatı', amount_cents: 300000,
    due_date: '2026-11-30', period_start: '2026-11-01', request_id: crypto.randomUUID() };
  const created = await call(root, admin, chargePayload);
  expect(created.status).toBe(201);
  const { data: charge } = await created.json<{ data: { id: number } }>();
  expect((await call(root, admin, chargePayload)).status).toBe(200);
  expect((await call(root, admin, { ...chargePayload, request_id: crypto.randomUUID() })).status).toBe(409);

  const receipt = { amount_cents: 100000, payment_method: 'bank_transfer', payment_date: '2026-11-20',
    description: '', request_id: crypto.randomUUID() };
  const path = `${root}/${charge.id}/payments`;
  const responses = await Promise.all([call(path, admin, receipt), call(path, admin, receipt)]);
  expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
  const other = await session('coach@test.invalid');
  expect((await call(root, other)).status).toBe(403);
  const pending = await call(root, admin);
  expect(await pending.json()).toMatchObject({ data: [{ id: charge.id, paid_cents: 100000, balance_cents: 200000 }] });
  expect((await call(`${root}/${charge.id}/cancel`, admin, {})).status).toBe(409);
  expect((await call(path, admin, { ...receipt, request_id: crypto.randomUUID(), amount_cents: 200001 })).status).toBe(409);
  expect(await env.DB.prepare("SELECT COUNT(*) FROM ledger_transactions WHERE category = 'monthly_due'").first('COUNT(*)')).toBe(1);
});

it('lets an administrator cancel an unpaid manual charge while retaining its row', async () => {
  const admin = await session();
  const root = '/finance/student/101/charges';
  const charge = await call(root, admin, { charge_type: 'private_lesson', description: 'Özel ders',
    amount_cents: 120000, due_date: '2026-11-25', request_id: crypto.randomUUID() });
  const { data } = await charge.json<{ data: { id: number } }>();
  expect((await call(`${root}/${data.id}/cancel`, admin, {})).status).toBe(200);
  expect(await env.DB.prepare('SELECT status FROM student_charges WHERE id = ?').bind(data.id).first('status')).toBe('cancelled');
});

it('rolls back a receipt when its ledger entry fails', async () => {
  const admin = await session();
  const root = '/finance/student/101/charges';
  const charge = await call(root, admin, { charge_type: 'private_lesson', description: 'Özel ders',
    amount_cents: 120000, due_date: '2026-11-25', request_id: crypto.randomUUID() });
  const { data } = await charge.json<{ data: { id: number } }>();
  await env.DB.prepare(`
    CREATE TRIGGER test_reject_income BEFORE INSERT ON ledger_transactions
    BEGIN SELECT RAISE(ABORT, 'test ledger failure'); END
  `).run();
  try {
    const id = crypto.randomUUID();
    const failed = await call(`${root}/${data.id}/payments`, admin, { amount_cents: 120000, payment_method: 'cash',
      payment_date: '2026-11-20', request_id: id });
    expect(failed.status).toBe(500);
    expect(await env.DB.prepare('SELECT id FROM payments WHERE payment_number = ?').bind(`PAY-${id}`).first()).toBeNull();
    expect(await env.DB.prepare('SELECT payment_id FROM payment_allocations WHERE charge_id = ?').bind(data.id).first()).toBeNull();
  } finally {
    await env.DB.prepare('DROP TRIGGER test_reject_income').run();
  }
});
