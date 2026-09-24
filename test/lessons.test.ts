import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

type JsonBody = {
  token?: string;
  data?: {
    token?: string;
  };
};

async function login(email: string) {
  const response = await SELF.fetch(
    'https://iceglide.test/api/auth/login',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password: 'Test1234!',
      }),
    },
  );

  const body = (await response.json()) as JsonBody;
  return body.token ?? body.data?.token;
}

async function get(path: string, token: string) {
  return SELF.fetch(`https://iceglide.test${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

describe('Lesson authorization isolation', () => {
  it('admin tüm derslere erişebilir', async () => {
    const token = await login('admin@test.invalid');

    const response = await get('/api/lessons/501', token!);

    expect(response.status).toBe(200);
  });

  it('head coach tüm derslere erişebilir', async () => {
    const token = await login('coach@test.invalid');

    const response = await get('/api/lessons/502', token!);

    expect(response.status).toBe(200);
  });

  it('instructor kendi dersine erişebilir', async () => {
    const token = await login('instructor@test.invalid');

    const response = await get('/api/lessons/501', token!);

    expect(response.status).toBe(200);
  });

  it('instructor başka instructorun dersine erişemez', async () => {
    const token = await login('instructor@test.invalid');

    const response = await get('/api/lessons/502', token!);

    expect(response.status).toBe(403);
  });

  it('parent kendi öğrencisinin bulunduğu derse erişebilir', async () => {
    const token = await login('parent-a@test.invalid');

    const response = await get('/api/lessons/501', token!);

    expect(response.status).toBe(200);
  });

  it('parent başka öğrencinin bulunduğu derse erişemez', async () => {
    const token = await login('parent-a@test.invalid');

    const response = await get('/api/lessons/502', token!);

    expect(response.status).toBe(403);
  });

  it('student kendi dersine erişebilir', async () => {
    const token = await login('student-a@test.invalid');

    const response = await get('/api/lessons/501', token!);

    expect(response.status).toBe(200);
  });

  it('student başka öğrencinin dersine erişemez', async () => {
    const token = await login('student-a@test.invalid');

    const response = await get('/api/lessons/502', token!);

    expect(response.status).toBe(403);
  });

  it('parent kendi öğrencisinin ders attendance bilgisine erişebilir', async () => {
    const token = await login('parent-a@test.invalid');

    const response = await get(
      '/api/lessons/501/attendance',
      token!,
    );

    expect(response.status).toBe(200);
  });

  it('parent başka öğrencinin ders attendance bilgisine erişemez', async () => {
    const token = await login('parent-a@test.invalid');

    const response = await get(
      '/api/lessons/502/attendance',
      token!,
    );

    expect(response.status).toBe(403);
  });

  it('instructor kendi dersinin attendance bilgisine erişebilir', async () => {
    const token = await login('instructor@test.invalid');

    const response = await get(
      '/api/lessons/501/attendance',
      token!,
    );

    expect(response.status).toBe(200);
  });

  it('instructor başka instructorun attendance bilgisine erişemez', async () => {
    const token = await login('instructor@test.invalid');

    const response = await get(
      '/api/lessons/502/attendance',
      token!,
    );

    expect(response.status).toBe(403);
  });
});

describe('Lesson list authorization isolation', () => {
  it('instructor ders listesinde yalnızca kendi derslerini görür', async () => {
    const token = await login('instructor@test.invalid');

    const response = await get(
      '/api/lessons?from=2026-09-01&to=2026-12-31',
      token!,
    );

    expect(response.status).toBe(200);

    const body = await response.json() as {
      success?: boolean;
      data?: Array<{ id: number }>;
    };

    const ids = (body.data ?? []).map((lesson) => lesson.id);

    expect(ids).toContain(501);
    expect(ids).not.toContain(502);
  });

  it('parent ders listesinde yalnızca bağlı öğrencisinin derslerini görür', async () => {
    const token = await login('parent-a@test.invalid');

    const response = await get(
      '/api/lessons?from=2026-09-01&to=2026-12-31',
      token!,
    );

    expect(response.status).toBe(200);

    const body = await response.json() as {
      success?: boolean;
      data?: Array<{ id: number }>;
    };

    const ids = (body.data ?? []).map((lesson) => lesson.id);

    expect(ids).toContain(501);
    expect(ids).not.toContain(502);
  });

  it('student ders listesinde yalnızca kendi derslerini görür', async () => {
    const token = await login('student-a@test.invalid');

    const response = await get(
      '/api/lessons?from=2026-09-01&to=2026-12-31',
      token!,
    );

    expect(response.status).toBe(200);

    const body = await response.json() as {
      success?: boolean;
      data?: Array<{ id: number }>;
    };

    const ids = (body.data ?? []).map((lesson) => lesson.id);

    expect(ids).toContain(501);
    expect(ids).not.toContain(502);
  });
});

describe('Lesson validation and edge cases', () => {
  it('token olmadan ders listesi 401 döner', async () => {
    const response = await SELF.fetch(
      'https://iceglide.test/api/lessons?from=2026-09-01&to=2026-12-31',
    );

    expect(response.status).toBe(401);
  });

  it('token olmadan ders detayı 401 döner', async () => {
    const response = await SELF.fetch(
      'https://iceglide.test/api/lessons/501',
    );

    expect(response.status).toBe(401);
  });

  it('geçersiz ders ID 400 döner', async () => {
    const token = await login('admin@test.invalid');

    const response = await get('/api/lessons/abc', token!);

    expect(response.status).toBe(400);
  });

  it('olmayan ders 404 döner', async () => {
    const token = await login('admin@test.invalid');

    const response = await get('/api/lessons/999999', token!);

    expect(response.status).toBe(404);
  });

  it('geçersiz attendance ders ID 400 döner', async () => {
    const token = await login('admin@test.invalid');

    const response = await get(
      '/api/lessons/abc/attendance',
      token!,
    );

    expect(response.status).toBe(400);
  });

  it('olmayan attendance dersi 404 döner', async () => {
    const token = await login('admin@test.invalid');

    const response = await get(
      '/api/lessons/999999/attendance',
      token!,
    );

    expect(response.status).toBe(404);
  });

  it('token olmadan attendance listesi 401 döner', async () => {
    const response = await SELF.fetch(
      'https://iceglide.test/api/lessons/501/attendance',
    );

    expect(response.status).toBe(401);
  });

  it('admin tüm dersleri listeler', async () => {
    const token = await login('admin@test.invalid');

    const response = await get(
      '/api/lessons?from=2026-09-01&to=2026-12-31',
      token!,
    );

    expect(response.status).toBe(200);

    const body = await response.json() as {
      data?: Array<{ id: number }>;
    };

    const ids = (body.data ?? []).map((lesson) => lesson.id);

    expect(ids).toContain(501);
    expect(ids).toContain(502);
  });

  it('head coach tüm dersleri listeler', async () => {
    const token = await login('coach@test.invalid');

    const response = await get(
      '/api/lessons?from=2026-09-01&to=2026-12-31',
      token!,
    );

    expect(response.status).toBe(200);

    const body = await response.json() as {
      data?: Array<{ id: number }>;
    };

    const ids = (body.data ?? []).map((lesson) => lesson.id);

    expect(ids).toContain(501);
    expect(ids).toContain(502);
  });

  it('ders listesinde tarih filtresi çalışır', async () => {
    const token = await login('admin@test.invalid');

    const response = await get(
      '/api/lessons?from=2026-09-23&to=2026-09-23',
      token!,
    );

    expect(response.status).toBe(200);

    const body = await response.json() as {
      data?: Array<{ id: number }>;
    };

    const ids = (body.data ?? []).map((lesson) => lesson.id);

    expect(ids).toContain(501);
    expect(ids).not.toContain(502);
  });

  it('ders listesinde from verilip to verilmezse aynı gün kullanılır', async () => {
    const token = await login('admin@test.invalid');

    const response = await get(
      '/api/lessons?from=2026-09-23',
      token!,
    );

    expect(response.status).toBe(200);

    const body = await response.json() as {
      data?: Array<{ id: number }>;
    };

    const ids = (body.data ?? []).map((lesson) => lesson.id);

    expect(ids).toContain(501);
    expect(ids).not.toContain(502);
  });

  it('ders detayı öğrencileri döndürür', async () => {
    const token = await login('admin@test.invalid');

    const response = await get('/api/lessons/501', token!);

    expect(response.status).toBe(200);

    const body = await response.json() as {
      data?: {
        lesson?: { id: number };
        students?: Array<{ id: number }>;
      };
    };

    expect(body.data?.lesson?.id).toBe(501);
    expect(body.data?.students?.some((student) => student.id === 101)).toBe(true);
    expect(body.data?.students?.some((student) => student.id === 102)).toBe(true);
  });

  it('attendance listesi yalnızca enrolled öğrencileri döndürür', async () => {
    const token = await login('admin@test.invalid');

    const response = await get(
      '/api/lessons/501/attendance',
      token!,
    );

    expect(response.status).toBe(200);

    const body = await response.json() as {
      data?: Array<{ student_id: number }>;
    };

    const ids = (body.data ?? []).map((student) => student.student_id);

    expect(ids).toContain(101);
    expect(ids).toContain(102);
  });
});
