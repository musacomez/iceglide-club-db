import { describe, expect, it } from 'vitest';
import { SELF, env } from 'cloudflare:test';

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

async function recordAttendance(
  token: string,
  lessonInstanceId: number,
  studentId: number,
  status: 'present' | 'absent' | 'late' | 'excused' = 'present',
  note?: string | null,
) {
  return SELF.fetch('https://iceglide.test/api/attendance', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      lesson_instance_id: lessonInstanceId,
      student_id: studentId,
      status,
      ...(note !== undefined ? { note } : {}),
    }),
  });
}

async function getPackageRemaining(packageId: number) {
  const row = await env.DB.prepare(`
    SELECT remaining_lessons
    FROM packages
    WHERE id = ?
  `).bind(packageId).first<{ remaining_lessons: number }>();

  return row?.remaining_lessons;
}

async function getConsumptionCount(
  lessonInstanceId: number,
  studentId: number,
) {
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM package_transactions
    WHERE lesson_instance_id = ?
      AND student_id = ?
      AND transaction_type = 'consumption'
  `).bind(lessonInstanceId, studentId).first<{ count: number }>();

  return row?.count ?? 0;
}

async function getCorrectionCount(
  lessonInstanceId: number,
  studentId: number,
) {
  const row = await env.DB.prepare(`
    SELECT COUNT(*) AS count
    FROM package_transactions
    WHERE lesson_instance_id = ?
      AND student_id = ?
      AND transaction_type = 'correction'
  `).bind(lessonInstanceId, studentId).first<{ count: number }>();

  return row?.count ?? 0;
}

describe('Attendance validation', () => {
  it('token olmadan yoklama kaydedilemez', async () => {
    const response = await SELF.fetch(
      'https://iceglide.test/api/attendance',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lesson_instance_id: 501,
          student_id: 101,
          status: 'present',
        }),
      },
    );

    expect(response.status).toBe(401);
  });

  it('geçersiz JSON 400 döner', async () => {
    const token = await login('admin@test.invalid');

    const response = await SELF.fetch(
      'https://iceglide.test/api/attendance',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: '{invalid-json',
      },
    );

    expect(response.status).toBe(400);
  });

  it('zorunlu alan eksikse 422 döner', async () => {
    const token = await login('admin@test.invalid');

    const response = await SELF.fetch(
      'https://iceglide.test/api/attendance',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          lesson_instance_id: 501,
          student_id: 101,
        }),
      },
    );

    expect(response.status).toBe(422);
  });

  it('geçersiz attendance status 422 döner', async () => {
    const token = await login('admin@test.invalid');

    const response = await SELF.fetch(
      'https://iceglide.test/api/attendance',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          lesson_instance_id: 501,
          student_id: 101,
          status: 'unknown',
        }),
      },
    );

    expect(response.status).toBe(422);
  });
});

describe('Attendance authorization', () => {
  it('admin yoklama kaydedebilir', async () => {
    const token = await login('admin@test.invalid');
    const response = await recordAttendance(token!, 501, 101);

    expect(response.status).toBe(200);
  });

  it('head coach yoklama kaydedebilir', async () => {
    const token = await login('coach@test.invalid');
    const response = await recordAttendance(token!, 501, 101);

    expect(response.status).toBe(200);
  });

  it('instructor kendi dersine yoklama kaydedebilir', async () => {
    const token = await login('instructor@test.invalid');
    const response = await recordAttendance(token!, 501, 101);

    expect(response.status).toBe(200);
  });

  it('instructor başka instructorun dersine yoklama kaydedemez', async () => {
    const token = await login('instructor@test.invalid');
    const response = await recordAttendance(token!, 502, 102);

    expect(response.status).toBe(400);
  });

  it('parent yoklama kaydedemez', async () => {
    const token = await login('parent-a@test.invalid');
    const response = await recordAttendance(token!, 501, 101);

    expect(response.status).toBe(400);
  });

  it('student yoklama kaydedemez', async () => {
    const token = await login('student-a@test.invalid');
    const response = await recordAttendance(token!, 501, 101);

    expect(response.status).toBe(400);
  });

  it('instructor derse kayıtlı olmayan öğrenciye yoklama kaydedemez', async () => {
    const token = await login('instructor@test.invalid');
    const response = await recordAttendance(token!, 501, 999);

    expect(response.status).toBe(400);
  });
});

describe('Attendance package consumption', () => {
  it('present kaydı aktif paketten bir ders tüketir', async () => {
    const token = await login('instructor@test.invalid');

    expect(await getPackageRemaining(301)).toBe(8);

    const response = await recordAttendance(
      token!,
      501,
      101,
      'present',
    );

    expect(response.status).toBe(200);
    expect(await getPackageRemaining(301)).toBe(7);
    expect(await getConsumptionCount(501, 101)).toBe(1);
  });

  it('late kaydı da aktif paketten bir ders tüketir', async () => {
    const token = await login('instructor@test.invalid');

    const response = await recordAttendance(
      token!,
      501,
      101,
      'late',
    );

    expect(response.status).toBe(200);
    expect(await getPackageRemaining(301)).toBe(7);
    expect(await getConsumptionCount(501, 101)).toBe(1);
  });

  it('qualifying attendance tekrar güncellendiğinde ikinci tüketim yapılmaz', async () => {
    const token = await login('instructor@test.invalid');

    const first = await recordAttendance(
      token!,
      501,
      101,
      'present',
    );

    expect(first.status).toBe(200);
    expect(await getPackageRemaining(301)).toBe(7);

    const second = await recordAttendance(
      token!,
      501,
      101,
      'late',
    );

    expect(second.status).toBe(200);
    expect(await getPackageRemaining(301)).toBe(7);
    expect(await getConsumptionCount(501, 101)).toBe(1);
  });

  it('aynı ders için mevcut consumption varsa ikinci consumption oluşturmaz', async () => {
    const token = await login('instructor@test.invalid');

    await env.DB.prepare(`
      INSERT INTO package_transactions
        (package_id, student_id, lesson_instance_id, attendance_id,
         transaction_type, quantity_delta, description, created_by_user_id)
      VALUES
        (301, 101, 501, NULL, 'consumption', -1,
         'Önceden tüketilmiş kayıt', 3)
    `).run();

    await env.DB.prepare(`
      UPDATE packages
      SET remaining_lessons = 7
      WHERE id = 301
    `).run();

    const response = await recordAttendance(
      token!,
      501,
      101,
      'present',
    );

    expect(response.status).toBe(200);
    expect(await getPackageRemaining(301)).toBe(7);
    expect(await getConsumptionCount(501, 101)).toBe(1);
  });

  it('aktif paket yoksa attendance yine kaydedilir', async () => {
    const token = await login('instructor@test.invalid');

    await env.DB.prepare(`
      UPDATE packages
      SET status = 'inactive'
      WHERE id = 301
    `).run();

    const response = await recordAttendance(
      token!,
      501,
      101,
      'present',
    );

    expect(response.status).toBe(200);
    expect(await getConsumptionCount(501, 101)).toBe(0);
    expect(await getPackageRemaining(301)).toBe(8);
  });

  it('absent kaydı paket tüketmez', async () => {
    const token = await login('instructor@test.invalid');

    const response = await recordAttendance(
      token!,
      501,
      101,
      'absent',
    );

    expect(response.status).toBe(200);
    expect(await getPackageRemaining(301)).toBe(8);
    expect(await getConsumptionCount(501, 101)).toBe(0);
  });

  it('excused kaydı paket tüketmez', async () => {
    const token = await login('instructor@test.invalid');

    const response = await recordAttendance(
      token!,
      501,
      101,
      'excused',
    );

    expect(response.status).toBe(200);
    expect(await getPackageRemaining(301)).toBe(8);
    expect(await getConsumptionCount(501, 101)).toBe(0);
  });
});

describe('Attendance correction', () => {
  it('present → absent değişikliğinde paket dersi iade edilir', async () => {
    const token = await login('instructor@test.invalid');

    const first = await recordAttendance(
      token!,
      501,
      101,
      'present',
    );

    expect(first.status).toBe(200);
    expect(await getPackageRemaining(301)).toBe(7);

    const second = await recordAttendance(
      token!,
      501,
      101,
      'absent',
    );

    expect(second.status).toBe(200);
    expect(await getPackageRemaining(301)).toBe(8);
    expect(await getConsumptionCount(501, 101)).toBe(1);
    expect(await getCorrectionCount(501, 101)).toBe(1);
  });

  it('late → excused değişikliğinde paket dersi iade edilir', async () => {
    const token = await login('instructor@test.invalid');

    const first = await recordAttendance(
      token!,
      501,
      101,
      'late',
    );

    expect(first.status).toBe(200);
    expect(await getPackageRemaining(301)).toBe(7);

    const second = await recordAttendance(
      token!,
      501,
      101,
      'excused',
    );

    expect(second.status).toBe(200);
    expect(await getPackageRemaining(301)).toBe(8);
    expect(await getCorrectionCount(501, 101)).toBe(1);
  });

  it('present → late değişikliğinde paket iadesi yapılmaz', async () => {
    const token = await login('instructor@test.invalid');

    await recordAttendance(
      token!,
      501,
      101,
      'present',
    );

    const response = await recordAttendance(
      token!,
      501,
      101,
      'late',
    );

    expect(response.status).toBe(200);
    expect(await getPackageRemaining(301)).toBe(7);
    expect(await getCorrectionCount(501, 101)).toBe(0);
  });

  it('late → present değişikliğinde paket iadesi yapılmaz', async () => {
    const token = await login('instructor@test.invalid');

    await recordAttendance(
      token!,
      501,
      101,
      'late',
    );

    const response = await recordAttendance(
      token!,
      501,
      101,
      'present',
    );

    expect(response.status).toBe(200);
    expect(await getPackageRemaining(301)).toBe(7);
    expect(await getCorrectionCount(501, 101)).toBe(0);
  });

  it('qualifying olmayan attendance absent → present olduğunda paket tüketilir', async () => {
    const token = await login('instructor@test.invalid');

    await recordAttendance(
      token!,
      501,
      101,
      'absent',
    );

    expect(await getPackageRemaining(301)).toBe(8);

    const response = await recordAttendance(
      token!,
      501,
      101,
      'present',
    );

    expect(response.status).toBe(200);
    expect(await getPackageRemaining(301)).toBe(7);
    expect(await getConsumptionCount(501, 101)).toBe(1);
  });
});

describe('Attendance edge cases', () => {
  it('geçersiz lesson instance için 400 döner', async () => {
    const token = await login('admin@test.invalid');

    const response = await recordAttendance(
      token!,
      9999,
      101,
      'present',
    );

    expect(response.status).toBe(400);
  });

  it('derse kayıtlı olmayan öğrenci için 400 döner', async () => {
    const token = await login('admin@test.invalid');

    const response = await recordAttendance(
      token!,
      502,
      101,
      'present',
    );

    expect(response.status).toBe(400);
  });

  it('note gönderildiğinde attendance başarıyla kaydedilir', async () => {
    const token = await login('instructor@test.invalid');

    const response = await recordAttendance(
      token!,
      501,
      101,
      'present',
      'Geç başladı.',
    );

    expect(response.status).toBe(200);

    const attendance = await env.DB.prepare(`
      SELECT status, note
      FROM attendances
      WHERE lesson_instance_id = ?
        AND student_id = ?
    `).bind(501, 101).first<{
      status: string;
      note: string | null;
    }>();

    expect(attendance?.status).toBe('present');
    expect(attendance?.note).toBe('Geç başladı.');
  });
});
