import { describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';

type JsonBody = {
  success?: boolean;
  message?: string;
  data?: unknown;
  students?: Array<Record<string, unknown>>;
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
  const token =
    typeof body.token === 'string'
      ? body.token
      : typeof (body.data as { token?: unknown } | undefined)?.token === 'string'
        ? (body.data as { token: string }).token
        : undefined;

  return { response, body, token };
}

async function get(path: string, token?: string) {
  return SELF.fetch(`https://iceglide.test${path}`, {
    headers: token
      ? { Authorization: `Bearer ${token}` }
      : undefined,
  });
}

async function bodyOf(response: Response) {
  return (await response.json()) as JsonBody;
}

describe('Students - listStudents', () => {
  it('token olmadan öğrenci listesi erişimi reddedilir', async () => {
    const response = await get('/api/students');

    expect(response.status).toBe(401);
  });

  it('admin tüm aktif öğrencileri görebilir', async () => {
    const { token } = await login('admin@test.invalid');

    const response = await get('/api/students', token);
    const body = await bodyOf(response);

    expect(response.status).toBe(200);

    const students =
      (body.students as Array<Record<string, unknown>> | undefined) ??
      (body.data as Array<Record<string, unknown>> | undefined) ??
      [];

    expect(students).toHaveLength(2);
  });

  it('head coach tüm aktif öğrencileri görebilir', async () => {
    const { token } = await login('coach@test.invalid');

    const response = await get('/api/students', token);
    const body = await bodyOf(response);

    expect(response.status).toBe(200);

    const students =
      (body.students as Array<Record<string, unknown>> | undefined) ??
      (body.data as Array<Record<string, unknown>> | undefined) ??
      [];

    expect(students).toHaveLength(2);
  });

  it('student yalnızca kendi öğrenci kaydını listede görebilir', async () => {
    const { token } = await login('student-a@test.invalid');

    const response = await get('/api/students', token);
    const body = await bodyOf(response);

    expect(response.status).toBe(200);

    const students =
      (body.students as Array<Record<string, unknown>> | undefined) ??
      (body.data as Array<Record<string, unknown>> | undefined) ??
      [];

    expect(students).toHaveLength(1);
    expect(students[0]?.id).toBe(101);
  });

  it('parent yalnızca bağlı olduğu öğrencileri listede görebilir', async () => {
    const { token } = await login('parent-a@test.invalid');

    const response = await get('/api/students', token);
    const body = await bodyOf(response);

    expect(response.status).toBe(200);

    const students =
      (body.students as Array<Record<string, unknown>> | undefined) ??
      (body.data as Array<Record<string, unknown>> | undefined) ??
      [];

    expect(students).toHaveLength(1);
    expect(students[0]?.id).toBe(101);
  });

  it('instructor yalnızca aktif olarak atanmış öğrencileri listede görebilir', async () => {
    const { token } = await login('instructor@test.invalid');

    const response = await get('/api/students', token);
    const body = await bodyOf(response);

    expect(response.status).toBe(200);

    const students =
      (body.students as Array<Record<string, unknown>> | undefined) ??
      (body.data as Array<Record<string, unknown>> | undefined) ??
      [];

    expect(students).toHaveLength(1);
    expect(students[0]?.id).toBe(101);
  });

  it('student başka öğrenciyi listede göremez', async () => {
    const { token } = await login('student-a@test.invalid');

    const response = await get('/api/students?search=Student%20B', token);
    const body = await bodyOf(response);

    expect(response.status).toBe(200);

    const students =
      (body.students as Array<Record<string, unknown>> | undefined) ??
      (body.data as Array<Record<string, unknown>> | undefined) ??
      [];

    expect(students).toHaveLength(0);
  });

  it('search parametresi öğrenci adına göre filtreler', async () => {
    const { token } = await login('admin@test.invalid');

    const response = await get('/api/students?search=Student%20A', token);
    const body = await bodyOf(response);

    expect(response.status).toBe(200);

    const students =
      (body.students as Array<Record<string, unknown>> | undefined) ??
      (body.data as Array<Record<string, unknown>> | undefined) ??
      [];

    expect(students).toHaveLength(1);
    expect(students[0]?.id).toBe(101);
  });

  it('search parametresi telefon üzerinden de filtreler', async () => {
    const { token } = await login('admin@test.invalid');

    const response = await get('/api/students?search=5551000002', token);
    const body = await bodyOf(response);

    expect(response.status).toBe(200);

    const students =
      (body.students as Array<Record<string, unknown>> | undefined) ??
      (body.data as Array<Record<string, unknown>> | undefined) ??
      [];

    expect(students).toHaveLength(1);
    expect(students[0]?.id).toBe(102);
  });

  it('status parametresi aktif öğrenci filtresini uygular', async () => {
    const { token } = await login('admin@test.invalid');

    const response = await get('/api/students?status=active', token);
    const body = await bodyOf(response);

    expect(response.status).toBe(200);

    const students =
      (body.students as Array<Record<string, unknown>> | undefined) ??
      (body.data as Array<Record<string, unknown>> | undefined) ??
      [];

    expect(students).toHaveLength(2);
  });

  it('aktif olmayan öğrenci istenince sonuç boş döner', async () => {
    const { token } = await login('admin@test.invalid');

    const response = await get('/api/students?status=inactive', token);
    const body = await bodyOf(response);

    expect(response.status).toBe(200);

    const students =
      (body.students as Array<Record<string, unknown>> | undefined) ??
      (body.data as Array<Record<string, unknown>> | undefined) ??
      [];

    expect(students).toHaveLength(0);
  });
});

describe('Students - getStudent', () => {
  it('geçersiz öğrenci ID reddedilir', async () => {
    const { token } = await login('admin@test.invalid');

    const response = await get('/api/students/not-a-number', token);
    const body = await bodyOf(response);

    expect(response.status).toBe(400);
    expect(body.message).toBe('Geçersiz öğrenci ID.');
  });

  it('ondalıklı öğrenci ID reddedilir', async () => {
    const { token } = await login('admin@test.invalid');

    const response = await get('/api/students/101.5', token);
    const body = await bodyOf(response);

    expect(response.status).toBe(400);
    expect(body.message).toBe('Geçersiz öğrenci ID.');
  });

  it('olmayan öğrenci için 404 döner', async () => {
    const { token } = await login('admin@test.invalid');

    const response = await get('/api/students/99999', token);
    const body = await bodyOf(response);

    expect(response.status).toBe(404);
    expect(body.message).toBe('Öğrenci bulunamadı.');
  });

  it('admin öğrenci detayını ve ilişkili kayıtları görebilir', async () => {
    const { token } = await login('admin@test.invalid');

    const response = await get('/api/students/101', token);
    const body = await bodyOf(response);

    expect(response.status).toBe(200);

    const data = body.data as {
      student?: Record<string, unknown>;
      parents?: Array<Record<string, unknown>>;
      instructors?: Array<Record<string, unknown>>;
      packages?: Array<Record<string, unknown>>;
    };

    expect(data.student?.id).toBe(101);
    expect(data.student?.full_name).toBe('Student A');

    expect(data.parents).toHaveLength(1);
    expect(data.parents?.[0]?.parent_user_id).toBe(4);

    expect(data.instructors).toHaveLength(1);
    expect(data.instructors?.[0]?.instructor_user_id).toBe(3);

    expect(data.packages).toHaveLength(1);
    expect(data.packages?.[0]?.id).toBe(301);
  });

  it('head coach öğrenci detayına erişebilir', async () => {
    const { token } = await login('coach@test.invalid');

    const response = await get('/api/students/102', token);

    expect(response.status).toBe(200);
  });

  it('token olmadan öğrenci detayına erişim reddedilir', async () => {
    const response = await get('/api/students/101');

    expect(response.status).toBe(401);
  });
});
