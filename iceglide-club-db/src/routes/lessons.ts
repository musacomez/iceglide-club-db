import type { CustomRequest, Env } from '../types/env';
import { fail, ok } from '../lib/response';

export async function listLessons(request: CustomRequest, env: Env) {
  const url = new URL(request.url);
  const from = url.searchParams.get('from') || new Date().toISOString().slice(0, 10);
  const to = url.searchParams.get('to') || from;

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
    ORDER BY li.lesson_date, li.start_time
  `).bind(from, to).all();

  return ok(result.results);
}

export async function getLesson(request: CustomRequest, env: Env) {
  const id = Number(request.params.id);
  if (!Number.isInteger(id)) return fail('Geçersiz ders ID.', 400);

  const lesson = await env.DB.prepare(`
    SELECT li.*, u.full_name AS instructor_name,
           g.name AS group_name, l.name AS location_name
    FROM lesson_instances li
    LEFT JOIN users u ON u.id = li.instructor_user_id
    LEFT JOIN groups g ON g.id = li.group_id
    LEFT JOIN locations l ON l.id = li.location_id
    WHERE li.id = ?
  `).bind(id).first();

  if (!lesson) return fail('Ders bulunamadı.', 404);

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

  return ok({ lesson, students: students.results });
}

export async function attendanceList(request: CustomRequest, env: Env) {
  const id = Number(request.params.id);
  if (!Number.isInteger(id)) return fail('Geçersiz ders ID.', 400);

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
