import type { CustomRequest, Env } from '../types/env';
import { fail, ok } from '../lib/response';
import { auditStatement } from '../lib/audit';
import {
  isPositiveInt,
  isValidDate,
  isValidEmail,
  placeholders,
  readJson,
  todayISO,
  uniqueInts,
} from '../lib/validate';

// Bu dosyadaki endpoint'ler index.ts'te withRoles(['admin', 'head_coach'])
// ile sarılıdır; yetki kontrolü burada tekrarlanmaz.

const STUDENT_STATUSES = ['active', 'inactive', 'frozen'];

interface StudentBody {
  full_name?: unknown;
  birth_date?: unknown;
  phone?: unknown;
  email?: unknown;
  status?: unknown;
  registration_date?: unknown;
  level_id?: unknown;
  group_id?: unknown;
  instructor_user_ids?: unknown;
  parent_user_ids?: unknown;
  allow_duplicate?: unknown;
}

type Parsed<T> = { value: T } | { error: string };

// "undefined" = alan gönderilmedi, "null" = alan temizlensin.
function optText(v: unknown, label: string, max: number): Parsed<string | null | undefined> {
  if (v === undefined) return { value: undefined };
  if (v === null || v === '') return { value: null };
  if (typeof v !== 'string') return { error: `${label} metin olmalıdır.` };
  const trimmed = v.trim();
  if (trimmed.length > max) return { error: `${label} en fazla ${max} karakter olabilir.` };
  return { value: trimmed === '' ? null : trimmed };
}

function optDate(v: unknown, label: string): Parsed<string | null | undefined> {
  if (v === undefined) return { value: undefined };
  if (v === null || v === '') return { value: null };
  if (!isValidDate(v)) return { error: `${label} YYYY-AA-GG biçiminde geçerli bir tarih olmalıdır.` };
  return { value: v };
}

function optRef(v: unknown, label: string): Parsed<number | null | undefined> {
  if (v === undefined) return { value: undefined };
  if (v === null || v === '') return { value: null };
  if (!isPositiveInt(v)) return { error: `${label} geçersiz.` };
  return { value: v };
}

async function countExisting(
  env: Env,
  sql: string,
  ids: number[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const row = await env.DB.prepare(sql.replace('{IN}', placeholders(ids.length)))
    .bind(...ids)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function validateRelations(
  env: Env,
  body: { level_id?: number | null; group_id?: number | null },
  instructorIds: number[] | null | undefined,
  parentIds: number[] | null | undefined,
): Promise<string | null> {
  if (body.level_id) {
    const r = await env.DB.prepare('SELECT 1 AS x FROM levels WHERE id = ?').bind(body.level_id).first();
    if (!r) return 'Seçilen seviye bulunamadı.';
  }
  if (body.group_id) {
    const r = await env.DB.prepare('SELECT 1 AS x FROM groups WHERE id = ?').bind(body.group_id).first();
    if (!r) return 'Seçilen grup bulunamadı.';
  }
  if (instructorIds && instructorIds.length) {
    const n = await countExisting(
      env,
      `SELECT COUNT(*) AS n FROM users WHERE id IN ({IN}) AND role IN ('instructor','head_coach') AND active = 1`,
      instructorIds,
    );
    if (n !== instructorIds.length) return 'Seçilen eğitmenlerden biri bulunamadı veya aktif değil.';
  }
  if (parentIds && parentIds.length) {
    const n = await countExisting(
      env,
      `SELECT COUNT(*) AS n FROM users WHERE id IN ({IN}) AND role = 'parent' AND active = 1`,
      parentIds,
    );
    if (n !== parentIds.length) return 'Seçilen velilerden biri bulunamadı veya aktif değil.';
  }
  return null;
}

function parseCommon(body: StudentBody) {
  const full = optText(body.full_name, 'Ad soyad', 120);
  const phone = optText(body.phone, 'Telefon', 30);
  const email = optText(body.email, 'E-posta', 160);
  const birth = optDate(body.birth_date, 'Doğum tarihi');
  const reg = optDate(body.registration_date, 'Kayıt tarihi');
  const level = optRef(body.level_id, 'Seviye');
  const group = optRef(body.group_id, 'Grup');

  for (const p of [full, phone, email, birth, reg, level, group]) {
    if ('error' in p) return { error: p.error } as const;
  }
  const emailValue = (email as { value: string | null | undefined }).value;
  if (emailValue && !isValidEmail(emailValue)) return { error: 'E-posta adresi geçersiz.' } as const;

  let status: string | undefined;
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !STUDENT_STATUSES.includes(body.status)) {
      return { error: `Durum şunlardan biri olmalıdır: ${STUDENT_STATUSES.join(', ')}.` } as const;
    }
    status = body.status;
  }

  let instructorIds: number[] | undefined;
  if (body.instructor_user_ids !== undefined) {
    const ids = uniqueInts(body.instructor_user_ids);
    if (!ids) return { error: 'instructor_user_ids geçerli ID listesi olmalıdır.' } as const;
    instructorIds = ids;
  }
  let parentIds: number[] | undefined;
  if (body.parent_user_ids !== undefined) {
    const ids = uniqueInts(body.parent_user_ids);
    if (!ids) return { error: 'parent_user_ids geçerli ID listesi olmalıdır.' } as const;
    parentIds = ids;
  }

  return {
    ok: {
      full_name: (full as { value: string | null | undefined }).value,
      phone: (phone as { value: string | null | undefined }).value,
      email: emailValue,
      birth_date: (birth as { value: string | null | undefined }).value,
      registration_date: (reg as { value: string | null | undefined }).value,
      level_id: (level as { value: number | null | undefined }).value,
      group_id: (group as { value: number | null | undefined }).value,
      status,
      instructorIds,
      parentIds,
    },
  } as const;
}

export async function createStudent(request: CustomRequest, env: Env) {
  const user = request.user;
  if (!user) return fail('Yetkilendirme gerekli.', 401);

  const body = await readJson<StudentBody>(request);
  if (!body || typeof body !== 'object') return fail('Geçersiz JSON.', 400);

  const parsed = parseCommon(body);
  if (parsed.error !== undefined) return fail(parsed.error, 422);
  const v = parsed.ok;

  if (!v.full_name) return fail('Ad soyad zorunludur.', 422);

  const relationError = await validateRelations(env, v, v.instructorIds, v.parentIds);
  if (relationError) return fail(relationError, 422);

  if (v.birth_date && body.allow_duplicate !== true) {
    const dup = await env.DB.prepare(`
      SELECT id FROM students
      WHERE lower(full_name) = lower(?) AND birth_date = ?
      LIMIT 1
    `).bind(v.full_name, v.birth_date).first<{ id: number }>();
    if (dup) {
      return fail('Aynı ad ve doğum tarihine sahip bir öğrenci zaten kayıtlı.', 409, {
        duplicate_student_id: dup.id,
      });
    }
  }

  const inserted = await env.DB.prepare(`
    INSERT INTO students
      (full_name, status, birth_date, phone, email, registration_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    v.full_name,
    v.status ?? 'active',
    v.birth_date ?? null,
    v.phone ?? null,
    v.email ?? null,
    v.registration_date ?? todayISO(),
  ).run();

  const studentId = Number(inserted.meta.last_row_id);

  const statements: D1PreparedStatement[] = [];
  if (v.level_id) {
    statements.push(
      env.DB.prepare('INSERT INTO student_levels (student_id, level_id, end_date) VALUES (?, ?, NULL)')
        .bind(studentId, v.level_id),
    );
  }
  if (v.group_id) {
    statements.push(
      env.DB.prepare('INSERT INTO group_students (student_id, group_id, end_date, is_primary) VALUES (?, ?, NULL, 1)')
        .bind(studentId, v.group_id),
    );
  }
  (v.instructorIds ?? []).forEach((id, i) => {
    statements.push(
      env.DB.prepare('INSERT INTO student_instructors (student_id, instructor_user_id, is_primary, end_date) VALUES (?, ?, ?, NULL)')
        .bind(studentId, id, i === 0 ? 1 : 0),
    );
  });
  (v.parentIds ?? []).forEach((id, i) => {
    statements.push(
      env.DB.prepare('INSERT INTO parent_students (parent_user_id, student_id, is_primary) VALUES (?, ?, ?)')
        .bind(id, studentId, i === 0 ? 1 : 0),
    );
  });
  statements.push(
    auditStatement(env, user.id, 'student.create', 'students', studentId, {
      full_name: v.full_name,
    }),
  );

  try {
    await env.DB.batch(statements);
  } catch (error) {
    console.error(error);
    // Öğrenci kaydı yarım kalmasın.
    await env.DB.batch([
      env.DB.prepare('DELETE FROM student_levels WHERE student_id = ?').bind(studentId),
      env.DB.prepare('DELETE FROM group_students WHERE student_id = ?').bind(studentId),
      env.DB.prepare('DELETE FROM student_instructors WHERE student_id = ?').bind(studentId),
      env.DB.prepare('DELETE FROM parent_students WHERE student_id = ?').bind(studentId),
      env.DB.prepare('DELETE FROM students WHERE id = ?').bind(studentId),
    ]);
    return fail('Öğrenci kaydedilemedi.', 500);
  }

  return ok({ id: studentId }, 201);
}

export async function updateStudent(request: CustomRequest, env: Env) {
  const user = request.user;
  if (!user) return fail('Yetkilendirme gerekli.', 401);

  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail('Geçersiz öğrenci ID.', 400);

  const body = await readJson<StudentBody>(request);
  if (!body || typeof body !== 'object') return fail('Geçersiz JSON.', 400);

  const existing = await env.DB.prepare('SELECT id FROM students WHERE id = ?').bind(id).first();
  if (!existing) return fail('Öğrenci bulunamadı.', 404);

  const parsed = parseCommon(body);
  if (parsed.error !== undefined) return fail(parsed.error, 422);
  const v = parsed.ok;

  if (v.full_name === null) return fail('Ad soyad boş bırakılamaz.', 422);

  const relationError = await validateRelations(env, v, v.instructorIds, v.parentIds);
  if (relationError) return fail(relationError, 422);

  const statements: D1PreparedStatement[] = [];

  // 1) Düz alanlar
  const sets: string[] = [];
  const params: unknown[] = [];
  const scalar: [string, unknown][] = [
    ['full_name', v.full_name],
    ['status', v.status],
    ['birth_date', v.birth_date],
    ['phone', v.phone],
    ['email', v.email],
    ['registration_date', v.registration_date],
  ];
  for (const [column, value] of scalar) {
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      params.push(value);
    }
  }
  if (sets.length) {
    statements.push(
      env.DB.prepare(`UPDATE students SET ${sets.join(', ')} WHERE id = ?`).bind(...params, id),
    );
  }

  // 2) Seviye (geçmiş korunur: eski satır kapatılır, yenisi açılır)
  if (v.level_id !== undefined) {
    const current = await env.DB.prepare(
      'SELECT level_id FROM student_levels WHERE student_id = ? AND end_date IS NULL ORDER BY rowid DESC LIMIT 1',
    ).bind(id).first<{ level_id: number }>();
    if ((current?.level_id ?? null) !== v.level_id) {
      statements.push(
        env.DB.prepare("UPDATE student_levels SET end_date = date('now') WHERE student_id = ? AND end_date IS NULL").bind(id),
      );
      if (v.level_id) {
        statements.push(
          env.DB.prepare('INSERT INTO student_levels (student_id, level_id, end_date) VALUES (?, ?, NULL)').bind(id, v.level_id),
        );
      }
    }
  }

  // 3) Birincil grup
  if (v.group_id !== undefined) {
    const current = await env.DB.prepare(
      'SELECT group_id FROM group_students WHERE student_id = ? AND end_date IS NULL AND is_primary = 1 ORDER BY rowid DESC LIMIT 1',
    ).bind(id).first<{ group_id: number }>();
    if ((current?.group_id ?? null) !== v.group_id) {
      statements.push(
        env.DB.prepare("UPDATE group_students SET end_date = date('now') WHERE student_id = ? AND end_date IS NULL AND is_primary = 1").bind(id),
      );
      if (v.group_id) {
        statements.push(
          env.DB.prepare('INSERT INTO group_students (student_id, group_id, end_date, is_primary) VALUES (?, ?, NULL, 1)').bind(id, v.group_id),
        );
      }
    }
  }

  // 4) Eğitmenler: liste tam set olarak gelir; ilk eleman birincildir.
  if (v.instructorIds !== undefined) {
    const rows = await env.DB.prepare(`
      SELECT DISTINCT instructor_user_id AS uid FROM student_instructors
      WHERE student_id = ? AND (end_date IS NULL OR end_date >= date('now'))
    `).bind(id).all<{ uid: number }>();
    const current = new Set(rows.results.map((r) => r.uid));
    const next = new Set(v.instructorIds);

    for (const uid of current) {
      if (!next.has(uid)) {
        statements.push(
          env.DB.prepare(`
            UPDATE student_instructors SET end_date = date('now', '-1 day')
            WHERE student_id = ? AND instructor_user_id = ?
              AND (end_date IS NULL OR end_date >= date('now'))
          `).bind(id, uid),
        );
      }
    }
    for (const uid of v.instructorIds) {
      if (!current.has(uid)) {
        statements.push(
          env.DB.prepare('INSERT INTO student_instructors (student_id, instructor_user_id, is_primary, end_date) VALUES (?, ?, 0, NULL)').bind(id, uid),
        );
      }
    }
    if (v.instructorIds.length) {
      statements.push(
        env.DB.prepare(`
          UPDATE student_instructors
          SET is_primary = CASE WHEN instructor_user_id = ? THEN 1 ELSE 0 END
          WHERE student_id = ? AND (end_date IS NULL OR end_date >= date('now'))
        `).bind(v.instructorIds[0], id),
      );
    }
  }

  // 5) Veliler
  if (v.parentIds !== undefined) {
    if (v.parentIds.length === 0) {
      statements.push(env.DB.prepare('DELETE FROM parent_students WHERE student_id = ?').bind(id));
    } else {
      statements.push(
        env.DB.prepare(
          `DELETE FROM parent_students WHERE student_id = ? AND parent_user_id NOT IN (${placeholders(v.parentIds.length)})`,
        ).bind(id, ...v.parentIds),
      );
      for (const pid of v.parentIds) {
        statements.push(
          env.DB.prepare('INSERT OR IGNORE INTO parent_students (parent_user_id, student_id, is_primary) VALUES (?, ?, 0)').bind(pid, id),
        );
      }
      statements.push(
        env.DB.prepare(`
          UPDATE parent_students
          SET is_primary = CASE WHEN parent_user_id = ? THEN 1 ELSE 0 END
          WHERE student_id = ?
        `).bind(v.parentIds[0], id),
      );
    }
  }

  if (statements.length === 0) return fail('Güncellenecek alan gönderilmedi.', 422);

  const changed = Object.keys(body).filter((k) => k !== 'allow_duplicate');
  statements.push(auditStatement(env, user.id, 'student.update', 'students', id, { fields: changed }));

  await env.DB.batch(statements);
  return ok({ id });
}
