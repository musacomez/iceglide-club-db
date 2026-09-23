import type { Env } from '../types/env';
import { ok } from '../lib/response';

export async function dashboardSummary(env: Env) {
  const [activeStudents, exhausted, low, todayLessons, pending] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS count FROM students WHERE status = 'active'`).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM packages WHERE status = 'active' AND remaining_lessons <= 0`).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM packages WHERE status = 'active' AND remaining_lessons BETWEEN 1 AND 2`).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM lesson_instances WHERE lesson_date = date('now') AND status = 'scheduled'`).first<{ count: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM private_lesson_requests WHERE status = 'pending'`).first<{ count: number }>()
  ]);

  return ok({
    active_students: activeStudents?.count ?? 0,
    exhausted_packages: exhausted?.count ?? 0,
    low_packages: low?.count ?? 0,
    today_lessons: todayLessons?.count ?? 0,
    pending_private_lesson_requests: pending?.count ?? 0
  });
}
