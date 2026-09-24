import type { CustomRequest, Env } from '../types/env';
import { fail, ok } from '../lib/response';

async function canAccessLesson(
  request: CustomRequest,
  env: Env,
  lessonId: number,
): Promise<boolean> {
  const user = request.user;

  if (!user) return false;

  // Yönetim rolleri tüm derslere erişebilir.
  if (user.role === 'admin' || user.role === 'head_coach') {
    return true;
  }

  // Instructor yalnızca kendisine atanmış derslere erişebilir.
  if (user.role === 'instructor') {
    const result = await env.DB.prepare(`
      SELECT 1
      FROM lesson_instances
      WHERE id = ?
        AND instructor_user_id = ?
      LIMIT 1
    `).bind(lessonId, user.id).first();

    return !!result;
  }

  // Parent yalnızca bağlı olduğu öğrencinin bulunduğu derslere erişebilir.
  if (user.role === 'parent') {
    const result = await env.DB.prepare(`
      SELECT 1
      FROM lesson_students ls
      JOIN parent_students ps
        ON ps.student_id = ls.student_id
      WHERE ls.lesson_instance_id = ?
        AND ps.parent_user_id = ?
        AND ls.enrollment_status = 'enrolled'
      LIMIT 1
    `).bind(lessonId, user.id).first();

    return !!result;
  }

  // Student yalnızca kendi katıldığı derslere erişebilir.
  if (user.role === 'student') {
    const result = await env.DB.prepare(`
      SELECT 1
      FROM lesson_students ls
      JOIN students s
        ON s.id = ls.student_id
      WHERE ls.lesson_instance_id = ?
        AND s.user_id = ?
        AND ls.enrollment_status = 'enrolled'
      LIMIT 1
    `).bind(lessonId, user.id).first();

    return !!result;
  }

  return false;
}

function lessonAccessSql(role: string): {
  condition: string;
  params: number[];
} | null {
  switch (role) {
    case 'admin':
    case 'head_coach':
      return {
        condition: '1 = 1',
        params: [],
      };

    default:
      return null;
  }
}

export async function listLessons(request: CustomRequest, env: Env) {
  const url = new URL(request.url);
  const from =
    url.searchParams.get('from') ||
    new Date().toISOString().slice(0, 10);
  const to = url.searchParams.get('to') || from;
  const user = request.user;

  if (!user) return fail('Yetkilendirme gerekli.', 401);

  let accessCondition = '';
  let accessParams: number[] = [];

  const managementAccess = lessonAccessSql(user.role);

  if (managementAccess) {
    accessCondition = managementAccess.condition;
    accessParams = managementAccess.params;
  } else if (user.role === 'instructor') {
    accessCondition = 'li.instructor_user_id = ?';
    accessParams = [user.id];
  } else if (user.role === 'parent') {
    accessCondition = `
      EXISTS (
        SELECT 1
        FROM lesson_students ls_access
        JOIN parent_students ps_access
          ON ps_access.student_id = ls_access.student_id
        WHERE ls_access.lesson_instance_id = li.id
          AND ps_access.parent_user_id = ?
          AND ls_access.enrollment_status = 'enrolled'
      )
    `;
    accessParams = [user.id];
  } else if (user.role === 'student') {
    accessCondition = `
      EXISTS (
        SELECT 1
        FROM lesson_students ls_access
        JOIN students s_access
          ON s_access.id = ls_access.student_id
        WHERE ls_access.lesson_instance_id = li.id
          AND s_access.user_id = ?
          AND ls_access.enrollment_status = 'enrolled'
      )
    `;
    accessParams = [user.id];
  } else {
    return fail('Bu işlem için yetkiniz yok.', 403);
  }

  const result = await env.DB.prepare(`
    SELECT
      li.id, li.template_id, li.private_request_id, li.title, li.lesson_type,
      li.group_id, li.instructor_user_id, li.location_id, li.lesson_date,
      li.start_time, li.end_time, li.status, li.cancellation_reason, li.notes,
      u.full_name AS instructor_name,
      g.name AS group_name,
      l.name AS location_name
    FROM lesson_instances li
    LEFT JOIN users u ON u.id = li.instructor_user_id
    LEFT JOIN groups g ON g.id = li.group_id
    LEFT JOIN locations l ON l.id = li.location_id
    WHERE li.lesson_date BETWEEN ? AND ?
      AND ${accessCondition}
    ORDER BY li.lesson_date, li.start_time
  `).bind(
    from,
    to,
    ...accessParams,
  ).all();

  return ok(result.results);
}

export async function getLesson(request: CustomRequest, env: Env) {
  const id = Number(request.params.id);

  if (!Number.isInteger(id)) {
    return fail('Geçersiz ders ID.', 400);
  }

  const lesson = await env.DB.prepare(`
    SELECT li.*, u.full_name AS instructor_name,
           g.name AS group_name, l.name AS location_name
    FROM lesson_instances li
    LEFT JOIN users u ON u.id = li.instructor_user_id
    LEFT JOIN groups g ON g.id = li.group_id
    LEFT JOIN locations l ON l.id = li.location_id
    WHERE li.id = ?
  `).bind(id).first();

  if (!lesson) {
    return fail('Ders bulunamadı.', 404);
  }

  const allowed = await canAccessLesson(request, env, id);

  if (!allowed) {
    return fail('Bu derse erişim yetkiniz yok.', 403);
  }

  const students = await env.DB.prepare(`
    SELECT
      s.id, s.full_name, s.status, ls.enrollment_status,
      a.id AS attendance_id, a.status AS attendance_status,
      a.note AS attendance_note
    FROM lesson_students ls
    JOIN students s ON s.id = ls.student_id
    LEFT JOIN attendances a
      ON a.lesson_instance_id = ls.lesson_instance_id
      AND a.student_id = ls.student_id
    WHERE ls.lesson_instance_id = ?
    ORDER BY s.full_name
  `).bind(id).all();

  return ok({
    lesson,
    students: students.results,
  });
}

export async function attendanceList(
  request: CustomRequest,
  env: Env,
) {
  const id = Number(request.params.id);

  if (!Number.isInteger(id)) {
    return fail('Geçersiz ders ID.', 400);
  }

  const lesson = await env.DB.prepare(`
    SELECT 1
    FROM lesson_instances
    WHERE id = ?
    LIMIT 1
  `).bind(id).first();

  if (!lesson) {
    return fail('Ders bulunamadı.', 404);
  }

  const allowed = await canAccessLesson(request, env, id);

  if (!allowed) {
    return fail('Bu dersin yoklama bilgilerine erişim yetkiniz yok.', 403);
  }

  const result = await env.DB.prepare(`
    SELECT
      s.id AS student_id, s.full_name, s.status AS student_status,
      a.id AS attendance_id, a.status AS attendance_status,
      a.note AS attendance_note, a.recorded_by_user_id,
      a.created_at, a.updated_at
    FROM lesson_students ls
    JOIN students s ON s.id = ls.student_id
    LEFT JOIN attendances a
      ON a.lesson_instance_id = ls.lesson_instance_id
      AND a.student_id = ls.student_id
    WHERE ls.lesson_instance_id = ?
      AND ls.enrollment_status = 'enrolled'
    ORDER BY s.full_name
  `).bind(id).all();

  return ok(result.results);
}
