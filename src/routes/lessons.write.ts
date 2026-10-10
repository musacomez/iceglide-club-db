import type { CustomRequest, Env } from '../types/env';
import { fail, ok } from '../lib/response';
import { auditStatement } from '../lib/audit';
import {
  addDaysISO,
  isPositiveInt,
  isValidDate,
  isValidTime,
  placeholders,
  readJson,
  timeToMinutes,
  uniqueInts,
} from '../lib/validate';

// Bu dosyadaki endpoint'ler index.ts'te withRoles(['admin', 'head_coach'])
// ile sarılıdır.

const LESSON_STATUSES = ['scheduled', 'completed', 'cancelled'];

interface LessonBody {
  title?: unknown;
  lesson_type?: unknown;
  group_id?: unknown;
  instructor_user_id?: unknown;
  location_id?: unknown;
  lesson_date?: unknown;
  start_time?: unknown;
  end_time?: unknown;
  notes?: unknown;
  status?: unknown;
  cancellation_reason?: unknown;
  student_ids?: unknown;
  repeat_weeks?: unknown;
  allow_conflict?: unknown;
}

interface Conflict {
  kind: 'instructor' | 'student';
  lesson_id: number;
  title: string;
  lesson_date: string;
  start_time: string;
  end_time: string;
  student_name?: string;
}

function nullableRef(v: unknown): number | null | undefined | 'invalid' {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  return isPositiveInt(v) ? v : 'invalid';
}

function nullableText(v: unknown, max: number): string | null | undefined | 'invalid' {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string' || v.length > max) return 'invalid';
  const t = v.trim();
  return t === '' ? null : t;
}

async function validateRefs(
  env: Env,
  refs: { group_id?: number | null; instructor_user_id?: number | null; location_id?: number | null },
  studentIds: number[] | undefined,
): Promise<string | null> {
  if (refs.group_id) {
    if (!(await env.DB.prepare('SELECT 1 AS x FROM groups WHERE id = ?').bind(refs.group_id).first())) {
      return 'Seçilen grup bulunamadı.';
    }
  }
  if (refs.location_id) {
    if (!(await env.DB.prepare('SELECT 1 AS x FROM locations WHERE id = ?').bind(refs.location_id).first())) {
      return 'Seçilen lokasyon bulunamadı.';
    }
  }
  if (refs.instructor_user_id) {
    const r = await env.DB.prepare(`
      SELECT 1 AS x FROM users
      WHERE id = ? AND role IN ('instructor','head_coach') AND active = 1
    `).bind(refs.instructor_user_id).first();
    if (!r) return 'Seçilen eğitmen bulunamadı veya aktif değil.';
  }
  if (studentIds && studentIds.length) {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM students WHERE id IN (${placeholders(studentIds.length)}) AND status = 'active'`,
    ).bind(...studentIds).first<{ n: number }>();
    if ((row?.n ?? 0) !== studentIds.length) return 'Seçilen öğrencilerden biri bulunamadı veya aktif değil.';
  }
  return null;
}

async function findConflicts(
  env: Env,
  input: {
    dates: string[];
    start_time: string;
    end_time: string;
    instructor_user_id: number | null;
    student_ids: number[];
    excludeLessonId?: number;
  },
): Promise<Conflict[]> {
  const conflicts: Conflict[] = [];
  const exclude = input.excludeLessonId ?? 0;

  for (const date of input.dates) {
    if (input.instructor_user_id) {
      const rows = await env.DB.prepare(`
        SELECT id, title, lesson_date, start_time, end_time
        FROM lesson_instances
        WHERE instructor_user_id = ?
          AND lesson_date = ?
          AND status != 'cancelled'
          AND id != ?
          AND start_time < ?
          AND end_time > ?
      `).bind(input.instructor_user_id, date, exclude, input.end_time, input.start_time)
        .all<{ id: number; title: string; lesson_date: string; start_time: string; end_time: string }>();
      for (const r of rows.results) {
        conflicts.push({ kind: 'instructor', lesson_id: r.id, title: r.title, lesson_date: r.lesson_date, start_time: r.start_time, end_time: r.end_time });
      }
    }

    if (input.student_ids.length) {
      const rows = await env.DB.prepare(`
        SELECT DISTINCT li.id, li.title, li.lesson_date, li.start_time, li.end_time, s.full_name
        FROM lesson_students ls
        JOIN lesson_instances li ON li.id = ls.lesson_instance_id
        JOIN students s ON s.id = ls.student_id
        WHERE ls.student_id IN (${placeholders(input.student_ids.length)})
          AND ls.enrollment_status = 'enrolled'
          AND li.lesson_date = ?
          AND li.status != 'cancelled'
          AND li.id != ?
          AND li.start_time < ?
          AND li.end_time > ?
      `).bind(...input.student_ids, date, exclude, input.end_time, input.start_time)
        .all<{ id: number; title: string; lesson_date: string; start_time: string; end_time: string; full_name: string }>();
      for (const r of rows.results) {
        conflicts.push({ kind: 'student', lesson_id: r.id, title: r.title, lesson_date: r.lesson_date, start_time: r.start_time, end_time: r.end_time, student_name: r.full_name });
      }
    }
  }
  return conflicts;
}

export async function createLesson(request: CustomRequest, env: Env) {
  const user = request.user;
  if (!user) return fail('Yetkilendirme gerekli.', 401);

  const body = await readJson<LessonBody>(request);
  if (!body || typeof body !== 'object') return fail('Geçersiz JSON.', 400);

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > 120) return fail('Ders başlığı zorunludur (en fazla 120 karakter).', 422);

  if (!isValidDate(body.lesson_date)) return fail('Ders tarihi geçersiz.', 422);
  if (!isValidTime(body.start_time) || !isValidTime(body.end_time)) {
    return fail('Başlangıç ve bitiş saati SS:DD biçiminde olmalıdır.', 422);
  }
  if (timeToMinutes(body.end_time) <= timeToMinutes(body.start_time)) {
    return fail('Bitiş saati başlangıç saatinden sonra olmalıdır.', 422);
  }

  const lessonType = nullableText(body.lesson_type, 30);
  const notes = nullableText(body.notes, 1000);
  const groupId = nullableRef(body.group_id);
  const instructorId = nullableRef(body.instructor_user_id);
  const locationId = nullableRef(body.location_id);
  if ([lessonType, notes, groupId, instructorId, locationId].includes('invalid')) {
    return fail('Gönderilen alanlardan biri geçersiz.', 422);
  }

  let studentIds: number[] = [];
  if (body.student_ids !== undefined) {
    const ids = uniqueInts(body.student_ids);
    if (!ids) return fail('student_ids geçerli ID listesi olmalıdır.', 422);
    studentIds = ids;
  }

  let repeatWeeks = 0;
  if (body.repeat_weeks !== undefined && body.repeat_weeks !== null) {
    if (typeof body.repeat_weeks !== 'number' || !Number.isInteger(body.repeat_weeks) || body.repeat_weeks < 0 || body.repeat_weeks > 52) {
      return fail('repeat_weeks 0 ile 52 arasında bir tam sayı olmalıdır.', 422);
    }
    repeatWeeks = body.repeat_weeks;
  }

  const lessonDate: string = body.lesson_date;
  const startTime: string = body.start_time;
  const endTime: string = body.end_time;

  const refs = {
    group_id: groupId as number | null | undefined,
    instructor_user_id: instructorId as number | null | undefined,
    location_id: locationId as number | null | undefined,
  };
  const refError = await validateRefs(env, refs, studentIds);
  if (refError) return fail(refError, 422);

  const dates = Array.from({ length: repeatWeeks + 1 }, (_, i) => addDaysISO(lessonDate, i * 7));

  if (body.allow_conflict !== true) {
    const conflicts = await findConflicts(env, {
      dates,
      start_time: startTime,
      end_time: endTime,
      instructor_user_id: refs.instructor_user_id ?? null,
      student_ids: studentIds,
    });
    if (conflicts.length) {
      return fail('Seçilen saatte çakışan dersler var.', 409, { conflicts });
    }
  }

  // 1. adım: tüm ders kayıtları tek batch'te (atomik)
  const insertResults = await env.DB.batch(
    dates.map((date) =>
      env.DB.prepare(`
        INSERT INTO lesson_instances
          (title, lesson_type, group_id, instructor_user_id, location_id,
           lesson_date, start_time, end_time, status, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)
      `).bind(
        title,
        (lessonType as string | null | undefined) ?? 'group',
        refs.group_id ?? null,
        refs.instructor_user_id ?? null,
        refs.location_id ?? null,
        date,
        startTime,
        endTime,
        (notes as string | null | undefined) ?? null,
      ),
    ),
  );
  const lessonIds = insertResults.map((r) => Number(r.meta.last_row_id));

  // 2. adım: kayıtlar + audit
  const followUps: D1PreparedStatement[] = [];
  for (const lessonId of lessonIds) {
    for (const studentId of studentIds) {
      followUps.push(
        env.DB.prepare(`
          INSERT INTO lesson_students (lesson_instance_id, student_id, enrollment_status)
          VALUES (?, ?, 'enrolled')
        `).bind(lessonId, studentId),
      );
    }
    followUps.push(
      auditStatement(env, user.id, 'lesson.create', 'lesson_instances', lessonId, {
        title,
        lesson_date: dates[lessonIds.indexOf(lessonId)],
        students: studentIds.length,
      }),
    );
  }

  try {
    await env.DB.batch(followUps);
  } catch (error) {
    console.error(error);
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM lesson_students WHERE lesson_instance_id IN (${placeholders(lessonIds.length)})`).bind(...lessonIds),
      env.DB.prepare(`DELETE FROM lesson_instances WHERE id IN (${placeholders(lessonIds.length)})`).bind(...lessonIds),
    ]);
    return fail('Ders kaydedilemedi.', 500);
  }

  return ok({ ids: lessonIds, count: lessonIds.length }, 201);
}

export async function updateLesson(request: CustomRequest, env: Env) {
  const user = request.user;
  if (!user) return fail('Yetkilendirme gerekli.', 401);

  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail('Geçersiz ders ID.', 400);

  const body = await readJson<LessonBody>(request);
  if (!body || typeof body !== 'object') return fail('Geçersiz JSON.', 400);

  const current = await env.DB.prepare(`
    SELECT id, title, lesson_date, start_time, end_time, instructor_user_id, status
    FROM lesson_instances WHERE id = ?
  `).bind(id).first<{
    id: number; title: string; lesson_date: string; start_time: string;
    end_time: string; instructor_user_id: number | null; status: string;
  }>();
  if (!current) return fail('Ders bulunamadı.', 404);

  const sets: string[] = [];
  const params: unknown[] = [];

  if (body.title !== undefined) {
    const t = typeof body.title === 'string' ? body.title.trim() : '';
    if (!t || t.length > 120) return fail('Ders başlığı boş olamaz (en fazla 120 karakter).', 422);
    sets.push('title = ?'); params.push(t);
  }

  const lessonType = nullableText(body.lesson_type, 30);
  const notes = nullableText(body.notes, 1000);
  const groupId = nullableRef(body.group_id);
  const instructorId = nullableRef(body.instructor_user_id);
  const locationId = nullableRef(body.location_id);
  if ([lessonType, notes, groupId, instructorId, locationId].includes('invalid')) {
    return fail('Gönderilen alanlardan biri geçersiz.', 422);
  }
  if (lessonType !== undefined) { sets.push('lesson_type = ?'); params.push(lessonType); }
  if (notes !== undefined) { sets.push('notes = ?'); params.push(notes); }
  if (groupId !== undefined) { sets.push('group_id = ?'); params.push(groupId); }
  if (instructorId !== undefined) { sets.push('instructor_user_id = ?'); params.push(instructorId); }
  if (locationId !== undefined) { sets.push('location_id = ?'); params.push(locationId); }

  let date = current.lesson_date;
  let start = current.start_time;
  let end = current.end_time;
  if (body.lesson_date !== undefined) {
    if (!isValidDate(body.lesson_date)) return fail('Ders tarihi geçersiz.', 422);
    date = body.lesson_date; sets.push('lesson_date = ?'); params.push(date);
  }
  if (body.start_time !== undefined) {
    if (!isValidTime(body.start_time)) return fail('Başlangıç saati geçersiz.', 422);
    start = body.start_time; sets.push('start_time = ?'); params.push(start);
  }
  if (body.end_time !== undefined) {
    if (!isValidTime(body.end_time)) return fail('Bitiş saati geçersiz.', 422);
    end = body.end_time; sets.push('end_time = ?'); params.push(end);
  }
  if (timeToMinutes(end) <= timeToMinutes(start)) {
    return fail('Bitiş saati başlangıç saatinden sonra olmalıdır.', 422);
  }

  let nextStatus = current.status;
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !LESSON_STATUSES.includes(body.status)) {
      return fail(`Durum şunlardan biri olmalıdır: ${LESSON_STATUSES.join(', ')}.`, 422);
    }
    nextStatus = body.status;
    sets.push('status = ?'); params.push(nextStatus);

    if (nextStatus === 'cancelled') {
      const reason = nullableText(body.cancellation_reason, 500);
      if (reason === 'invalid') return fail('İptal nedeni geçersiz.', 422);
      sets.push('cancellation_reason = ?'); params.push(reason ?? null);

      // Yoklaması alınıp paketten düşülmüş bir ders iptal edilirse hak iadesi
      // gerekir; bu akış yoklama servisi üzerinden yürüdüğü için önce yoklama
      // "katılmadı/izinli" yapılmalıdır.
      const consumed = await env.DB.prepare(`
        SELECT 1 AS x FROM attendances
        WHERE lesson_instance_id = ? AND status IN ('present','late') LIMIT 1
      `).bind(id).first();
      if (consumed) {
        return fail(
          'Katılımı işaretlenmiş (paketten hak düşülmüş) ders iptal edilemez. Önce yoklamaları düzeltin.',
          409,
        );
      }
    } else {
      sets.push('cancellation_reason = NULL');
    }
  } else if (body.cancellation_reason !== undefined && current.status === 'cancelled') {
    const reason = nullableText(body.cancellation_reason, 500);
    if (reason === 'invalid') return fail('İptal nedeni geçersiz.', 422);
    sets.push('cancellation_reason = ?'); params.push(reason);
  }

  let studentIds: number[] | undefined;
  if (body.student_ids !== undefined) {
    const ids = uniqueInts(body.student_ids);
    if (!ids) return fail('student_ids geçerli ID listesi olmalıdır.', 422);
    studentIds = ids;
  }

  const refError = await validateRefs(
    env,
    {
      group_id: groupId as number | null | undefined,
      instructor_user_id: instructorId as number | null | undefined,
      location_id: locationId as number | null | undefined,
    },
    undefined,
  );
  if (refError) return fail(refError, 422);

  const statements: D1PreparedStatement[] = [];

  // Kayıtlı öğrenci seti
  let finalStudentIds: number[] = [];
  const enrolledRows = await env.DB.prepare(
    `SELECT student_id FROM lesson_students WHERE lesson_instance_id = ?`,
  ).bind(id).all<{ student_id: number }>();
  const enrolled = enrolledRows.results.map((r) => r.student_id);
  finalStudentIds = enrolled;

  if (studentIds) {
    const toAdd = studentIds.filter((s) => !enrolled.includes(s));
    const toRemove = enrolled.filter((s) => !studentIds!.includes(s));

    if (toAdd.length) {
      const e = await validateRefs(env, {}, toAdd);
      if (e) return fail(e, 422);
    }
    if (toRemove.length) {
      const withAttendance = await env.DB.prepare(`
        SELECT s.full_name FROM attendances a JOIN students s ON s.id = a.student_id
        WHERE a.lesson_instance_id = ? AND a.student_id IN (${placeholders(toRemove.length)})
        LIMIT 1
      `).bind(id, ...toRemove).first<{ full_name: string }>();
      if (withAttendance) {
        return fail(`${withAttendance.full_name} için yoklama kaydı var; dersten çıkarılamaz.`, 409);
      }
      statements.push(
        env.DB.prepare(
          `DELETE FROM lesson_students WHERE lesson_instance_id = ? AND student_id IN (${placeholders(toRemove.length)})`,
        ).bind(id, ...toRemove),
      );
    }
    for (const s of toAdd) {
      statements.push(
        env.DB.prepare(`INSERT INTO lesson_students (lesson_instance_id, student_id, enrollment_status) VALUES (?, ?, 'enrolled')`).bind(id, s),
      );
    }
    finalStudentIds = studentIds;
  }

  // Çakışma kontrolü: zaman/eğitmen/öğrenci değiştiyse ve ders iptal değilse
  const affectsSchedule =
    body.lesson_date !== undefined || body.start_time !== undefined || body.end_time !== undefined ||
    instructorId !== undefined || studentIds !== undefined || (body.status !== undefined && current.status === 'cancelled');
  if (nextStatus !== 'cancelled' && affectsSchedule && body.allow_conflict !== true) {
    const conflicts = await findConflicts(env, {
      dates: [date],
      start_time: start,
      end_time: end,
      instructor_user_id: instructorId !== undefined ? (instructorId as number | null) : current.instructor_user_id,
      student_ids: finalStudentIds,
      excludeLessonId: id,
    });
    if (conflicts.length) return fail('Seçilen saatte çakışan dersler var.', 409, { conflicts });
  }

  if (sets.length) {
    statements.unshift(env.DB.prepare(`UPDATE lesson_instances SET ${sets.join(', ')} WHERE id = ?`).bind(...params, id));
  }
  if (statements.length === 0) return fail('Güncellenecek alan gönderilmedi.', 422);

  const action = nextStatus === 'cancelled' && current.status !== 'cancelled' ? 'lesson.cancel' : 'lesson.update';
  statements.push(
    auditStatement(env, user.id, action, 'lesson_instances', id, {
      fields: Object.keys(body).filter((k) => k !== 'allow_conflict'),
    }),
  );

  await env.DB.batch(statements);
  return ok({ id });
}
