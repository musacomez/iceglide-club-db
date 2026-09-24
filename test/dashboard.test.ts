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

async function getDashboard(token?: string) {
  return SELF.fetch('https://iceglide.test/api/dashboard/summary', {
    headers: token
      ? { Authorization: `Bearer ${token}` }
      : undefined,
  });
}

describe('Dashboard authorization', () => {
  it('admin dashboard erişebilir', async () => {
    const { token } = await login('admin@test.invalid');

    const response = await getDashboard(token);

    expect(response.status).toBe(200);
  });

  it('head coach dashboard erişebilir', async () => {
    const { token } = await login('coach@test.invalid');

    const response = await getDashboard(token);

    expect(response.status).toBe(200);
  });

  it('instructor dashboard erişemez', async () => {
    const { token } = await login('instructor@test.invalid');

    const response = await getDashboard(token);

    expect(response.status).toBe(403);
  });

  it('parent dashboard erişemez', async () => {
    const { token } = await login('parent-a@test.invalid');

    const response = await getDashboard(token);

    expect(response.status).toBe(403);
  });

  it('student dashboard erişemez', async () => {
    const { token } = await login('student-a@test.invalid');

    const response = await getDashboard(token);

    expect(response.status).toBe(403);
  });

  it('token olmadan dashboard erişimi reddedilir', async () => {
    const response = await getDashboard();

    expect(response.status).toBe(401);
  });
});
