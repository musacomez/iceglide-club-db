import { describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';

type JsonBody = {
  token?: string;
  data?: {
    token?: string;
  };
  [key: string]: unknown;
};

async function login(email: string, password = 'Test1234!') {
  const response = await SELF.fetch('https://iceglide.test/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  const body = (await response.json()) as JsonBody;
  const token = body.token ?? body.data?.token;

  return { response, body, token };
}

async function get(path: string, token?: string) {
  return SELF.fetch(`https://iceglide.test${path}`, {
    headers: token
      ? { Authorization: `Bearer ${token}` }
      : undefined,
  });
}

describe('Authentication', () => {
  it('geçersiz JSON isteği reddedilir', async () => {
    const response = await SELF.fetch('https://iceglide.test/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: '{invalid-json',
    });

    const body = await response.json() as { message?: string };

    expect(response.status).toBe(400);
    expect(body.message).toBe('Geçersiz JSON.');
  });

  it('admin başarılı şekilde giriş yapabilir', async () => {
    const { response, token } = await login('admin@test.invalid');

    expect(response.status).toBe(200);
    expect(token).toEqual(expect.any(String));
  });

  it('parent başarılı şekilde giriş yapabilir', async () => {
    const { response, token } = await login('parent-a@test.invalid');

    expect(response.status).toBe(200);
    expect(token).toEqual(expect.any(String));
  });

  it('student başarılı şekilde giriş yapabilir', async () => {
    const { response, token } = await login('student-a@test.invalid');

    expect(response.status).toBe(200);
    expect(token).toEqual(expect.any(String));
  });

  it('hatalı şifre ile giriş reddedilir', async () => {
    const { response } = await login(
      'admin@test.invalid',
      'YanlisSifre!',
    );

    expect(response.status).toBe(401);
  });

  it('token olmadan korumalı endpoint erişimi reddedilir', async () => {
    const response = await get('/api/me');

    expect(response.status).toBe(401);
  });
});

describe('Stale token authorization', () => {
  it('pasifleştirilen kullanıcı eski token ile erişemez', async () => {
    const { token } = await login('parent-a@test.invalid');

    expect(token).toEqual(expect.any(String));

    await env.DB.prepare(`
      UPDATE users
      SET active = 0
      WHERE id = 4
    `).run();

    const response = await get('/api/me', token);

    expect(response.status).toBe(401);
  });

  it('rolü değiştirilen kullanıcı eski rol tokenı ile erişemez', async () => {
    const { token } = await login('parent-a@test.invalid');

    expect(token).toEqual(expect.any(String));

    await env.DB.prepare(`
      UPDATE users
      SET role = 'student'
      WHERE id = 4
    `).run();

    const response = await get('/api/dashboard/summary', token);

    expect(response.status).toBe(401);
  });
});

describe('Student authorization isolation', () => {
  it('parent kendi öğrencisine erişebilir', async () => {
    const { token } = await login('parent-a@test.invalid');

    const response = await get('/api/students/101', token);

    expect(response.status).toBe(200);
  });

  it('parent başka öğrencinin kaydına erişemez', async () => {
    const { token } = await login('parent-a@test.invalid');

    const response = await get('/api/students/102', token);

    expect(response.status).toBe(403);
  });

  it('student kendi kaydına erişebilir', async () => {
    const { token } = await login('student-a@test.invalid');

    const response = await get('/api/students/101', token);

    expect(response.status).toBe(200);
  });

  it('student başka öğrencinin kaydına erişemez', async () => {
    const { token } = await login('student-a@test.invalid');

    const response = await get('/api/students/102', token);

    expect(response.status).toBe(403);
  });

  it('instructor atanmış öğrencisine erişebilir', async () => {
    const { token } = await login('instructor@test.invalid');

    const response = await get('/api/students/101', token);

    expect(response.status).toBe(200);
  });

  it('instructor atanmadığı öğrencinin kaydına erişemez', async () => {
    const { token } = await login('instructor@test.invalid');

    const response = await get('/api/students/102', token);

    expect(response.status).toBe(403);
  });
});

describe('Authentication middleware edge cases', () => {
  it('Bearer prefix var ama token boşsa 401 döner', async () => {
    const response = await SELF.fetch('https://iceglide.test/api/me', {
      headers: {
        Authorization: 'Bearer ',
      },
    });

    expect(response.status).toBe(401);
  });

  it('geçersiz token 401 döner', async () => {
    const response = await SELF.fetch('https://iceglide.test/api/me', {
      headers: {
        Authorization: 'Bearer definitely-invalid-token',
      },
    });

    expect(response.status).toBe(401);
  });
});

describe('Login validation', () => {
  it('email veya password eksikse 422 döner', async () => {
    const response = await SELF.fetch('https://iceglide.test/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'admin@test.invalid',
      }),
    });

    expect(response.status).toBe(422);
  });

  it('olmayan kullanıcı ile giriş reddedilir', async () => {
    const { response } = await login('not-found@test.invalid');

    expect(response.status).toBe(401);
  });
});

it('bozuk token payload 401 döner', async () => {
  const response = await SELF.fetch('https://iceglide.test/api/me', {
    headers: {
      Authorization: 'Bearer eyJmb28iOiJiYXIifQ.invalid',
    },
  });

  expect(response.status).toBe(401);
});
