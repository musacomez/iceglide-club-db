import { env, SELF } from 'cloudflare:test';
import { expect, it } from 'vitest';

const origin = 'https://iceglide.test';
const path = '/api/students/101/account';
const initial = 'Test-only-student-123!';
const reset = 'Test-only-student-456!';
const selfChanged = 'Test-only-student-789!';

function call(path: string, method: string, token?: string, body?: object) {
  return SELF.fetch(origin + path, {
    method,
    headers: token
      ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      : { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function signIn(email: string, password = 'Test1234!') {
  const response = await call('/api/auth/login', 'POST', undefined, { email, password });
  expect(response.status).toBe(200);
  const result = await response.json<{ data: { token: string } }>();
  return result.data.token;
}

it('links a new student login to the existing profile and supports admin reset and student password change', async () => {
  await env.DB.prepare('UPDATE students SET user_id = NULL WHERE id = 101').run();
  const admin = await signIn('admin@test.invalid');
  const email = 'new-student@test.invalid';
  expect((await call(path, 'POST', admin, { email, password: initial })).status).toBe(201);
  expect(await (await call(path, 'GET', admin)).json()).toMatchObject({ data: { email, active: true } });
  const student = await signIn(email, initial);
  expect((await call('/api/students/101', 'GET', student)).status).toBe(200);
  expect((await call(path, 'POST', admin, { email: 'another@test.invalid', password: initial })).status).toBe(409);
  expect((await call(path, 'PATCH', admin, { email, password: reset })).status).toBe(200);
  expect((await call('/api/me', 'GET', student)).status).toBe(401);
  expect((await call('/api/auth/login', 'POST', undefined, { email, password: initial })).status).toBe(401);
  const newSession = await signIn(email, reset);
  expect((await call('/api/auth/change-password', 'POST', newSession, {
    current_password: reset,
    new_password: selfChanged,
  })).status).toBe(200);
  await signIn(email, selfChanged);
});

it('enforces admin access, rejects reused email and supports an email-only change', async () => {
  const coach = await signIn('coach@test.invalid');
  const admin = await signIn('admin@test.invalid');
  expect((await call(path, 'GET', coach)).status).toBe(403);
  expect((await call(path, 'PATCH', coach, { email: 'other@test.invalid' })).status).toBe(403);
  expect((await call(path, 'PATCH', admin, { email: 'ADMIN@test.invalid' })).status).toBe(409);
  expect((await call(path, 'PATCH', admin, { email: 'student-a@test.invalid', password: 'short' })).status).toBe(422);
  expect((await call(path, 'PATCH', admin, { email: 'other@test.invalid' })).status).toBe(200);
  await signIn('other@test.invalid');
});
