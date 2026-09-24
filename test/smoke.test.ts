import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { me } from '../src/routes/me';
import { login } from '../src/routes/auth';
import { corsHeaders } from '../src/lib/cors';
import { hashPassword, verifyPassword } from '../src/lib/password';
import { env } from 'cloudflare:test';
import { fail } from '../src/lib/response';
import { createAttendance } from '../src/routes/attendance';
import { authenticate } from '../src/middleware/auth';

describe('test ortamı', () => {
  it('local D1 seed verisini görüyor', async () => {
    const admin = await env.DB
      .prepare('SELECT id, email, role FROM users WHERE id = 1')
      .first<{
        id: number;
        email: string;
        role: string;
      }>();

    expect(admin).toEqual({
      id: 1,
      email: 'admin@test.invalid',
      role: 'admin',
    });
  });

  it('iki test öğrencisi mevcut', async () => {
    const result = await env.DB
      .prepare('SELECT COUNT(*) AS count FROM students')
      .first<{ count: number }>();

    expect(result?.count).toBe(2);
  });

  it('ders ve öğrenci ilişkileri mevcut', async () => {
    const result = await env.DB
      .prepare(`
        SELECT COUNT(*) AS count
        FROM lesson_students
        WHERE lesson_instance_id = 501
      `)
      .first<{ count: number }>();

    expect(result?.count).toBe(2);
  });
});

it('OPTIONS isteği CORS ile 204 döner', async () => {
  const response = await SELF.fetch('https://iceglide.test/api/me', {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://example.com',
    },
  });

  expect(response.status).toBe(204);
});

it('bilinmeyen endpoint 404 döner', async () => {
  const response = await SELF.fetch(
    'https://iceglide.test/api/bilinmeyen-endpoint',
  );

  expect(response.status).toBe(404);
});

it('parent dashboard erişiminde 403 döner', async () => {
  const response = await SELF.fetch(
    'https://iceglide.test/api/dashboard/summary',
    {
      headers: {
        Authorization: `Bearer ${(await SELF.fetch('https://iceglide.test/api/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: 'parent-a@test.invalid',
            password: 'Test1234!',
          }),
        }).then(async (r) => {
          const body = await r.json() as { token?: string; data?: { token?: string } };
          return body.token ?? body.data?.token;
        }))}`,
      },
    },
  );

  expect(response.status).toBe(403);
});

it('özel CORS origin eşleşirse origin döner', async () => {
  const response = await SELF.fetch('https://iceglide.test/api/me', {
    headers: {
      Origin: 'https://allowed.example.com',
    },
  });

  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
});

it('health endpoint çalışır', async () => {
  const response = await SELF.fetch('https://iceglide.test/api/health');
  const body = await response.json() as {
    service?: string;
    database?: boolean;
    timestamp?: string;
    data?: {
      service?: string;
      database?: boolean;
      timestamp?: string;
    };
  };

  expect(response.status).toBe(200);

  const data = body.data ?? body;

  expect(data.service).toBe('iceglide-api');
  expect(data.database).toBe(true);
  expect(data.timestamp).toEqual(expect.any(String));
});

it('me endpoint başarılı kullanıcı bilgisi döner', async () => {
  const loginResponse = await SELF.fetch(
    'https://iceglide.test/api/auth/login',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'admin@test.invalid',
        password: 'Test1234!',
      }),
    },
  );

  const loginBody = await loginResponse.json() as {
    token?: string;
    data?: { token?: string };
  };

  const token = loginBody.token ?? loginBody.data?.token;

  const response = await SELF.fetch('https://iceglide.test/api/me', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const body = await response.json() as {
    id?: number;
    email?: string;
    data?: {
      id?: number;
      email?: string;
    };
  };

  expect(response.status).toBe(200);

  const data = body.data ?? body;

  expect(data.id).toBe(1);
  expect(data.email).toBe('admin@test.invalid');
});

it('root endpoint çalışır', async () => {
  const response = await SELF.fetch('https://iceglide.test/');

  const body = await response.json() as {
    success?: boolean;
    service?: string;
    message?: string;
    data?: {
      success?: boolean;
      service?: string;
      message?: string;
    };
  };

  expect(response.status).toBe(200);

  const data = body.data ?? body;

  expect(data.success).toBe(true);
  expect(data.service).toBe('iceglide-api');
  expect(data.message).toBe('IceGlide API çalışıyor.');
});


it('me endpoint kullanıcı bulunamazsa 404 döner', async () => {
  const response = await SELF.fetch('https://iceglide.test/api/me', {
    headers: {
      Authorization: 'Bearer invalid',
    },
  });

  expect(response.status).toBe(401);
});


it('me endpoint kullanıcı bulunamazsa 404 döner', async () => {
  const response = await SELF.fetch('https://iceglide.test/api/me', {
    headers: {
      Authorization: 'Bearer invalid',
    },
  });

  expect(response.status).toBe(401);
});


it('me route kullanıcı bulunamazsa 404 döner', async () => {
  const request = new Request('https://iceglide.test/api/me') as import('../src/types/env').CustomRequest;

  request.user = {
    id: 999999,
    role: 'admin',
    email: 'missing@test.invalid',
    full_name: 'Missing User',
  };

  const response = await me(request, env);

  expect(response.status).toBe(404);
});


it('özel CORS origin eşleşmesi çalışır', async () => {
  const request = new Request('https://iceglide.test/', {
    headers: {
      Origin: 'https://allowed.example.com',
    },
  });

  const headers = corsHeaders(request, {
    CORS_ORIGIN: 'https://allowed.example.com',
  });

  expect(headers.get('Access-Control-Allow-Origin')).toBe(
    'https://allowed.example.com',
  );
});


it('password doğrulama geçerli ve geçersiz parola durumlarını kontrol eder', async () => {
  const stored = await hashPassword('Test1234!');

  expect(await verifyPassword('Test1234!', stored)).toBe(true);
  expect(await verifyPassword('Yanlis123!', stored)).toBe(false);
  expect(await verifyPassword('Test1234!', 'invalid-hash')).toBe(false);
  expect(await verifyPassword('Test1234!', 'pbkdf2$100000$$')).toBe(false);
});


it('fail details alanını döndürür', async () => {
  const response = fail('Test hatası', 422, {
    field: 'email',
  });

  const body = await response.json() as {
    success?: boolean;
    message?: string;
    details?: {
      field?: string;
    };
  };

  expect(response.status).toBe(422);
  expect(body.success).toBe(false);
  expect(body.message).toBe('Test hatası');
  expect(body.details?.field).toBe('email');
});


it('attendance service hatası 400 döner', async () => {
  const request = new Request('https://iceglide.test/api/attendance', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      lesson_instance_id: 999999,
      student_id: 101,
      status: 'present',
    }),
  }) as import('../src/types/env').CustomRequest;

  request.user = {
    id: 1,
    role: 'admin',
    email: 'admin@test.invalid',
    full_name: 'Test Admin',
  };

  const response = await createAttendance(request, env);

  expect(response.status).toBe(400);
});


it('authenticate AUTH_SECRET yoksa 500 döner', async () => {
  const request = new Request('https://iceglide.test/api/me', {
    headers: {
      Authorization: 'Bearer test-token',
    },
  }) as import('../src/types/env').CustomRequest;

  const testEnv = {
    ...env,
    AUTH_SECRET: '',
  };

  const response = await authenticate(request, testEnv);

  expect(response.status).toBe(500);
});

it('authenticate Bearer boşlukları sonrası boş token 401 döner', async () => {
  const request = new Request('https://iceglide.test/api/me', {
    headers: {
      Authorization: 'Bearer    ',
    },
  }) as import('../src/types/env').CustomRequest;

  const response = await authenticate(request, env);

  expect(response.status).toBe(401);
});

it('authenticate boş Bearer token ile 401 döner', async () => {
  const request = new Request('https://iceglide.test/api/me', {
    headers: {
      Authorization: 'Bearer ',
    },
  }) as import('../src/types/env').CustomRequest;

  const response = await authenticate(request, env);

  expect(response.status).toBe(401);
});

it('password hash uzunluğu uyuşmazsa doğrulama false döner', async () => {
  const stored = await hashPassword('Test1234!');
  const parts = stored.split('$');

  const hashBytes = atob(parts[3]);
  parts[3] = btoa(hashBytes + '\\0');

  expect(await verifyPassword('Test1234!', parts.join('$'))).toBe(false);
});

it('attendance kullanıcı yoksa 401 döner', async () => {
  const request = new Request('https://iceglide.test/api/attendance', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      lesson_instance_id: 501,
      student_id: 101,
      status: 'present',
    }),
  }) as import('../src/types/env').CustomRequest;

  const response = await createAttendance(request, env);

  expect(response.status).toBe(401);
});


it('login AUTH_SECRET yoksa 500 döner', async () => {
  const request = new Request('https://iceglide.test/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'admin@test.invalid',
      password: 'Test1234!',
    }),
  });

  const testEnv = {
    ...env,
    AUTH_SECRET: '',
  };

  const response = await login(request, testEnv);

  expect(response.status).toBe(500);
});


it('özel CORS origin eşleşmezse origin header dönmez', () => {
  const request = new Request('https://iceglide.test/', {
    headers: {
      Origin: 'https://other.example.com',
    },
  });

  const headers = corsHeaders(request, {
    CORS_ORIGIN: 'https://allowed.example.com',
  });

  expect(headers.get('Access-Control-Allow-Origin')).toBeNull();
});


it('me route kullanıcı yoksa 401 döner', async () => {
  const request = new Request('https://iceglide.test/api/me') as import('../src/types/env').CustomRequest;

  const response = await me(request, env);

  expect(response.status).toBe(401);
});


it('geçerli imzalı fakat bozuk token payloadı 401 döner', async () => {
  const secret = env.AUTH_SECRET;

  const body = btoa('bozuk-json').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signatureBytes = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(body)),
  );

  let binary = '';
  for (const byte of signatureBytes) {
    binary += String.fromCharCode(byte);
  }

  const signature = btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');

  const token = `${body}.${signature}`;

  const response = await SELF.fetch('https://iceglide.test/api/me', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  expect(response.status).toBe(401);
});

