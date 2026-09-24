import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

type JsonBody = {
  token?: string;
  data?: {
    token?: string;
  };
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

  return { response, token };
}

async function get(path: string, token?: string) {
  return SELF.fetch(`https://iceglide.test${path}`, {
    headers: token
      ? { Authorization: `Bearer ${token}` }
      : undefined,
  });
}

describe('Packages authorization isolation', () => {
  it('token olmadan paketlere erişim reddedilir', async () => {
    const response = await get('/api/packages/student/101');

    expect(response.status).toBe(401);
  });

  it('geçersiz paket öğrenci ID reddedilir', async () => {
    const { token } = await login('admin@test.invalid');

    const response = await get('/api/packages/student/not-a-number', token);
    const body = await response.json() as { message?: string };

    expect(response.status).toBe(400);
    expect(body.message).toBe('Geçersiz öğrenci ID.');
  });


  it('admin tüm öğrencinin paketlerini görebilir', async () => {
    const { token } = await login('admin@test.invalid');

    const response = await get('/api/packages/student/102', token);

    expect(response.status).toBe(200);
  });

  it('head coach tüm öğrencinin paketlerini görebilir', async () => {
    const { token } = await login('coach@test.invalid');

    const response = await get('/api/packages/student/102', token);

    expect(response.status).toBe(200);
  });

  it('parent kendi çocuğunun paketlerini görebilir', async () => {
    const { token } = await login('parent-a@test.invalid');

    const response = await get('/api/packages/student/101', token);

    expect(response.status).toBe(200);
  });

  it('parent başka öğrencinin paketlerini göremez', async () => {
    const { token } = await login('parent-a@test.invalid');

    const response = await get('/api/packages/student/102', token);

    expect(response.status).toBe(403);
  });

  it('student kendi paketlerini görebilir', async () => {
    const { token } = await login('student-a@test.invalid');

    const response = await get('/api/packages/student/101', token);

    expect(response.status).toBe(200);
  });

  it('student başka öğrencinin paketlerini göremez', async () => {
    const { token } = await login('student-a@test.invalid');

    const response = await get('/api/packages/student/102', token);

    expect(response.status).toBe(403);
  });

  it('instructor atanmış öğrencinin paketlerini görebilir', async () => {
    const { token } = await login('instructor@test.invalid');

    const response = await get('/api/packages/student/101', token);

    expect(response.status).toBe(200);
  });

  it('instructor atanmadığı öğrencinin paketlerini göremez', async () => {
    const { token } = await login('instructor@test.invalid');

    const response = await get('/api/packages/student/102', token);

    expect(response.status).toBe(403);
  });
});

describe('Payments authorization isolation', () => {
  it('token olmadan ödemelere erişim reddedilir', async () => {
    const response = await get('/api/payments/student/101');

    expect(response.status).toBe(401);
  });

  it('geçersiz ödeme öğrenci ID reddedilir', async () => {
    const { token } = await login('admin@test.invalid');

    const response = await get('/api/payments/student/not-a-number', token);
    const body = await response.json() as { message?: string };

    expect(response.status).toBe(400);
    expect(body.message).toBe('Geçersiz öğrenci ID.');
  });


  it('admin tüm öğrencinin ödemelerini görebilir', async () => {
    const { token } = await login('admin@test.invalid');

    const response = await get('/api/payments/student/102', token);

    expect(response.status).toBe(200);
  });

  it('head coach tüm öğrencinin ödemelerini görebilir', async () => {
    const { token } = await login('coach@test.invalid');

    const response = await get('/api/payments/student/102', token);

    expect(response.status).toBe(200);
  });

  it('parent kendi çocuğunun ödemelerini görebilir', async () => {
    const { token } = await login('parent-a@test.invalid');

    const response = await get('/api/payments/student/101', token);

    expect(response.status).toBe(200);
  });

  it('parent başka öğrencinin ödemelerini göremez', async () => {
    const { token } = await login('parent-a@test.invalid');

    const response = await get('/api/payments/student/102', token);

    expect(response.status).toBe(403);
  });

  it('student kendi ödemelerini görebilir', async () => {
    const { token } = await login('student-a@test.invalid');

    const response = await get('/api/payments/student/101', token);

    expect(response.status).toBe(200);
  });

  it('student başka öğrencinin ödemelerini göremez', async () => {
    const { token } = await login('student-a@test.invalid');

    const response = await get('/api/payments/student/102', token);

    expect(response.status).toBe(403);
  });

  it('instructor atanmış öğrencinin ödemelerini görebilir', async () => {
    const { token } = await login('instructor@test.invalid');

    const response = await get('/api/payments/student/101', token);

    expect(response.status).toBe(200);
  });

  it('instructor atanmadığı öğrencinin ödemelerini göremez', async () => {
    const { token } = await login('instructor@test.invalid');

    const response = await get('/api/payments/student/102', token);

    expect(response.status).toBe(403);
  });
});
