import { env, SELF } from 'cloudflare:test';
import { expect, it } from 'vitest';

const path = '/api/club-chat/messages';

function call(path: string, method = 'GET', token?: string, body?: object) {
  return SELF.fetch('https://iceglide.test' + path, {
    method, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: body && JSON.stringify(body),
  });
}

async function session(email: string) {
  const response = await call('/api/auth/login', 'POST', undefined, { email, password: 'Test1234!' });
  expect(response.status).toBe(200);
  const result = await response.json<{ data: { token: string } }>();
  return result.data.token;
}

it('shares messages only with signed-in users and lets only an administrator hide them', async () => {
  const [student, parent, coach, admin] = await Promise.all([
    session('student-a@test.invalid'),
    session('parent-a@test.invalid'),
    session('instructor@test.invalid'),
    session('admin@test.invalid'),
  ]);
  expect((await call(path)).status).toBe(401);
  expect((await call(path, 'POST', undefined, { message: 'Hello' })).status).toBe(401);
  expect((await call(path, 'POST', student, { message: ' ' })).status).toBe(422);
  expect((await call(path, 'POST', student, { message: 'a'.repeat(1001) })).status).toBe(422);
  const response = await call(path, 'POST', student, { message: '  Selam kulüp!  ', author_id: 1 });
  expect(response.status).toBe(201);
  const { data: { id } } = await response.json<{ data: { id: number } }>();
  const result = await call(path, 'GET', parent);
  expect(result.headers.get('Cache-Control')).toContain('no-store');
  expect(await result.json()).toMatchObject({
    data: { messages: [{ id, author_role: 'student', message: 'Selam kulüp!' }] },
  });
  expect((await call(path + '/' + id, 'DELETE', coach)).status).toBe(403);
  expect((await call(path + '/' + id, 'DELETE', admin)).status).toBe(200);
  expect(await (await call(path, 'GET', parent)).json()).toMatchObject({ data: { messages: [] } });
});

it('lists chronological pages without repeating the previous page boundary', async () => {
  const admin = await session('admin@test.invalid');
  await env.DB.prepare(`
    WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value+1 FROM n WHERE value < 55)
    INSERT INTO club_chat_messages (author_id, message)
    SELECT 1, 'Mesaj ' || value FROM n
  `).run();
  type Page = { data: { messages: { id: number; message: string }[]; next_before: number | null } };
  const latest = await (await call(path, 'GET', admin)).json<Page>();
  expect(latest.data.messages).toHaveLength(50);
  expect(latest.data.messages.at(-1)?.message).toBe('Mesaj 55');
  const older = await (await call(path + '?before=' + latest.data.next_before, 'GET', admin)).json<Page>();
  expect(older.data.messages.map((row) => row.message)).toEqual(['Mesaj 1', 'Mesaj 2', 'Mesaj 3', 'Mesaj 4', 'Mesaj 5']);
  expect(older.data.next_before).toBeNull();
});
