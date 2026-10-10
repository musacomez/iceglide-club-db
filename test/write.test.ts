import { describe, expect, it } from 'vitest';
import { SELF, env } from 'cloudflare:test';

type Json = {
  success?: boolean;
  message?: string;
  token?: string;
  data?: Record<string, unknown> & { token?: string };
  details?: { conflicts?: unknown[] };
};

async function login(email: string) {
  const response = await SELF.fetch('https://iceglide.test/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Test1234!' }),
  });
  const body = (await response.json()) as Json;
  return (body.token ?? body.data?.token) as string;
}

async function send(method: string, path: string, token: string, body?: unknown) {
  const response = await SELF.fetch(`https://iceglide.test${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, body: (await response.json()) as Json };
}

const newLesson = {
  title: 'Yeni Ders',
  lesson_date: '2026-10-05',
  start_time: '14:00',
  end_time: '15:00',
  instructor_user_id: 3,
  location_id: 1,
  group_id: 1,
  student_ids: [101],
};

describe('POST /api/lessons', () => {
  it('admin ders oluşturabilir ve öğrenci kaydı yapılır', async () => {
    const token = await login('admin@test.invalid');
    const { response, body } = await send('POST', '/api/lessons', token, newLesson);
    expect(response.status).toBe(201);
    const ids = body.data?.ids as number[];
    expect(ids).toHaveLength(1);

    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM lesson_students WHERE lesson_instance_id = ?',
    ).bind(ids[0]).first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it('instructor ders oluşturamaz', async () => {
    const token = await login('instructor@test.invalid');
    const { response } = await send('POST', '/api/lessons', token, newLesson);
    expect(response.status).toBe(403);
  });

  it('parent ve student ders oluşturamaz', async () => {
    for (const email of ['parent-a@test.invalid', 'student-a@test.invalid']) {
      const token = await login(email);
      const { response } = await send('POST', '/api/lessons', token, newLesson);
      expect(response.status).toBe(403);
    }
  });

  it('bitiş saati başlangıçtan önceyse 422 döner', async () => {
    const token = await login('admin@test.invalid');
    const { response } = await send('POST', '/api/lessons', token, {
      ...newLesson,
      start_time: '15:00',
      end_time: '14:00',
    });
    expect(response.status).toBe(422);
  });

  it('eğitmen çakışmasında 409 döner, allow_conflict ile kaydedilir', async () => {
    const token = await login('admin@test.invalid');
    // Seed: 501 numaralı ders 2026-09-23 10:00-11:00, eğitmen 3
    const clash = { ...newLesson, lesson_date: '2026-09-23', start_time: '10:30', end_time: '11:30', student_ids: [] };
    const first = await send('POST', '/api/lessons', token, clash);
    expect(first.response.status).toBe(409);
    expect(first.body.details?.conflicts?.length).toBeGreaterThan(0);

    const forced = await send('POST', '/api/lessons', token, { ...clash, allow_conflict: true });
    expect(forced.response.status).toBe(201);
  });

  it('repeat_weeks haftalık tekrar eden dersleri oluşturur', async () => {
    const token = await login('admin@test.invalid');
    const { response, body } = await send('POST', '/api/lessons', token, {
      ...newLesson,
      repeat_weeks: 3,
    });
    expect(response.status).toBe(201);
    expect(body.data?.count).toBe(4);
  });

  it('olmayan eğitmen/grup 422 döner', async () => {
    const token = await login('admin@test.invalid');
    const { response } = await send('POST', '/api/lessons', token, { ...newLesson, instructor_user_id: 9999 });
    expect(response.status).toBe(422);
  });
});

describe('PATCH /api/lessons/:id', () => {
  it('admin dersi düzenleyebilir', async () => {
    const token = await login('admin@test.invalid');
    const { response } = await send('PATCH', '/api/lessons/501', token, { title: 'Güncel', notes: 'Not' });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare('SELECT title, notes FROM lesson_instances WHERE id = 501').first<{ title: string; notes: string }>();
    expect(row?.title).toBe('Güncel');
  });

  it('dersi iptal edebilir ve neden kaydedilir', async () => {
    const token = await login('admin@test.invalid');
    const { response } = await send('PATCH', '/api/lessons/502', token, {
      status: 'cancelled',
      cancellation_reason: 'Buz bakımı',
    });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare('SELECT status, cancellation_reason FROM lesson_instances WHERE id = 502')
      .first<{ status: string; cancellation_reason: string }>();
    expect(row?.status).toBe('cancelled');
    expect(row?.cancellation_reason).toBe('Buz bakımı');
  });

  it('katılımı işaretlenmiş (present) ders iptal edilemez', async () => {
    const token = await login('admin@test.invalid');
    await send('POST', '/api/attendance', token, { lesson_instance_id: 501, student_id: 101, status: 'present' });
    const { response } = await send('PATCH', '/api/lessons/501', token, { status: 'cancelled' });
    expect(response.status).toBe(409);
  });

  it('yoklaması olan öğrenci dersten çıkarılamaz', async () => {
    const token = await login('admin@test.invalid');
    await send('POST', '/api/attendance', token, { lesson_instance_id: 501, student_id: 101, status: 'absent' });
    const { response } = await send('PATCH', '/api/lessons/501', token, { student_ids: [102] });
    expect(response.status).toBe(409);
  });

  it('instructor dersi düzenleyemez', async () => {
    const token = await login('instructor@test.invalid');
    const { response } = await send('PATCH', '/api/lessons/501', token, { title: 'x' });
    expect(response.status).toBe(403);
  });

  it('olmayan ders 404 döner', async () => {
    const token = await login('admin@test.invalid');
    const { response } = await send('PATCH', '/api/lessons/99999', token, { title: 'x' });
    expect(response.status).toBe(404);
  });
});

describe('POST /api/students', () => {
  it('admin öğrenci oluşturur; seviye, grup, eğitmen ve veli bağlanır', async () => {
    const token = await login('admin@test.invalid');
    const { response, body } = await send('POST', '/api/students', token, {
      full_name: 'Yeni Öğrenci',
      birth_date: '2017-03-04',
      phone: '5559990000',
      level_id: 1,
      group_id: 1,
      instructor_user_ids: [3],
      parent_user_ids: [4],
    });
    expect(response.status).toBe(201);
    const id = body.data?.id as number;

    const counts = await env.DB.batch([
      env.DB.prepare('SELECT COUNT(*) AS n FROM student_levels WHERE student_id = ?').bind(id),
      env.DB.prepare('SELECT COUNT(*) AS n FROM group_students WHERE student_id = ?').bind(id),
      env.DB.prepare('SELECT COUNT(*) AS n FROM student_instructors WHERE student_id = ?').bind(id),
      env.DB.prepare('SELECT COUNT(*) AS n FROM parent_students WHERE student_id = ?').bind(id),
    ]);
    for (const c of counts) expect((c.results[0] as { n: number }).n).toBe(1);
  });

  it('ad soyad zorunludur', async () => {
    const token = await login('admin@test.invalid');
    const { response } = await send('POST', '/api/students', token, { phone: '1' });
    expect(response.status).toBe(422);
  });

  it('aynı ad + doğum tarihi 409 döner', async () => {
    const token = await login('admin@test.invalid');
    const { response } = await send('POST', '/api/students', token, {
      full_name: 'student a',
      birth_date: '2015-01-10',
    });
    expect(response.status).toBe(409);
  });

  it('instructor / parent / student öğrenci oluşturamaz', async () => {
    for (const email of ['instructor@test.invalid', 'parent-a@test.invalid', 'student-a@test.invalid']) {
      const token = await login(email);
      const { response } = await send('POST', '/api/students', token, { full_name: 'X' });
      expect(response.status).toBe(403);
    }
  });
});

describe('PATCH /api/students/:id', () => {
  it('head coach bilgileri güncelleyebilir', async () => {
    const token = await login('coach@test.invalid');
    const { response } = await send('PATCH', '/api/students/101', token, { phone: '5558887766', status: 'inactive' });
    expect(response.status).toBe(200);
    const row = await env.DB.prepare('SELECT phone, status FROM students WHERE id = 101').first<{ phone: string; status: string }>();
    expect(row?.phone).toBe('5558887766');
    expect(row?.status).toBe('inactive');
  });

  it('seviye değişince eski satır kapatılır, geçmiş korunur', async () => {
    const token = await login('admin@test.invalid');
    await env.DB.prepare("INSERT INTO levels (id, name) VALUES (2, 'Advanced')").run();
    const { response } = await send('PATCH', '/api/students/101', token, { level_id: 2 });
    expect(response.status).toBe(200);
    const rows = await env.DB.prepare('SELECT level_id, end_date FROM student_levels WHERE student_id = 101').all<{ level_id: number; end_date: string | null }>();
    expect(rows.results).toHaveLength(2);
    expect(rows.results.filter((r) => r.end_date === null)).toHaveLength(1);
  });

  it('veli ve eğitmen listesi tam set olarak değiştirilir', async () => {
    const token = await login('admin@test.invalid');
    const { response } = await send('PATCH', '/api/students/101', token, {
      parent_user_ids: [5],
      instructor_user_ids: [2],
    });
    expect(response.status).toBe(200);
    const parents = await env.DB.prepare('SELECT parent_user_id FROM parent_students WHERE student_id = 101').all<{ parent_user_id: number }>();
    expect(parents.results.map((r) => r.parent_user_id)).toEqual([5]);
  });

  it('instructor öğrenci düzenleyemez', async () => {
    const token = await login('instructor@test.invalid');
    const { response } = await send('PATCH', '/api/students/101', token, { phone: '1' });
    expect(response.status).toBe(403);
  });

  it('olmayan öğrenci 404, boş gövde 422 döner', async () => {
    const token = await login('admin@test.invalid');
    expect((await send('PATCH', '/api/students/9999', token, { phone: '1' })).response.status).toBe(404);
    expect((await send('PATCH', '/api/students/101', token, {})).response.status).toBe(422);
  });
});

describe('GET /api/lookups', () => {
  it('yönetim erişir, instructor erişemez', async () => {
    const admin = await login('admin@test.invalid');
    const ok = await send('GET', '/api/lookups', admin);
    expect(ok.response.status).toBe(200);
    expect(Array.isArray(ok.body.data?.instructors)).toBe(true);

    const instructor = await login('instructor@test.invalid');
    expect((await send('GET', '/api/lookups', instructor)).response.status).toBe(403);
  });
});
