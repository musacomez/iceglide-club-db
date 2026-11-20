import { env, SELF } from 'cloudflare:test';
import { expect, it } from 'vitest';

async function session(email = 'admin@test.invalid', password = 'Test1234!') {
  const response = await call('/api/auth/login', { email, password });
  expect(response.status).toBe(200);
  const result = await response.json<{ data: { token: string } }>();
  return { Authorization: `Bearer ${result.data.token}` };
}

function call(path: string, body?: object, headers?: HeadersInit, method = body ? 'POST' : 'GET') {
  return SELF.fetch(`https://iceglide.test${path}`, {
    headers, method, body: body && JSON.stringify(body),
  });
}

const coach = {
  full_name: 'Additional coach',
  email: 'additional@test.invalid',
  phone: null,
  active: true,
  commission_bps: 1250,
  lesson_fee_cents: 75000,
  password: 'Initial1234!test',
};

it('manages both rates and deactivates an account without deleting it', async () => {
  const admin = await session();
  const created = await call('/api/manage/coaches', coach, admin);
  expect(created.status).toBe(201);
  const { data: { id } } = await created.json<{ data: { id: number } }>();
  const oldSession = await session(coach.email, coach.password);

  expect((await call('/api/manage/coaches', undefined, oldSession)).status).toBe(403);
  expect((await call('/api/manage/coaches', coach, admin)).status).toBe(409);
  expect((await call(`/api/manage/coaches/${id}`, { ...coach, active: false }, admin, 'PATCH')).status).toBe(200);
  expect(await (await call('/api/manage/coaches', undefined, admin)).json()).toMatchObject({
    data: expect.arrayContaining([expect.objectContaining({
      id, active: 0, commission_bps: 1250, lesson_fee_cents: 75000,
    })]),
  });
  expect((await call('/api/me', undefined, oldSession)).status).toBe(401);
});

it('assigns both coaches, checks secondary conflicts and lets the assigned instructor record attendance', async () => {
  const admin = await session();
  const instructor = await session('instructor@test.invalid');
  const lesson = {
    title: 'Multi-coach lesson',
    lesson_date: '2027-04-01',
    start_time: '10:00',
    end_time: '11:00',
    instructor_user_ids: [2, 3],
    student_ids: [101],
  };
  const created = await call('/api/lessons', { ...lesson, repeat_weeks: 1 }, admin);
  expect(created.status).toBe(201);
  const { data: { ids: [id, nextId] } } = await created.json<{ data: { ids: number[] } }>();
  expect(await (await call(`/api/lessons/${id}`, undefined, instructor)).json()).toMatchObject({
    data: { lesson: { instructor_user_ids: [2, 3], instructor_names: ['Head Coach', 'Instructor'] } },
  });
  expect(await (await call('/api/lessons?from=2027-04-01&to=2027-04-15', undefined, instructor)).json()).toMatchObject({
    data: [{ id }, { id: nextId }],
  });
  expect((await call('/api/lessons', { ...lesson, instructor_user_ids: [3], student_ids: [] }, admin)).status).toBe(409);
  const attendance = await call('/api/attendance', { lesson_instance_id: id, student_id: 101, status: 'present' }, instructor);
  expect(attendance.ok).toBe(true);
  expect((await call(`/api/lessons/${id}`, { instructor_user_ids: [2] }, admin, 'PATCH')).status).toBe(200);
  expect((await call(`/api/lessons/${id}`, undefined, instructor)).status).toBe(403);
  expect(await env.DB.prepare('SELECT instructor_user_id FROM lesson_instances WHERE id = ?').bind(id).first())
    .toEqual({ instructor_user_id: 2 });
});
