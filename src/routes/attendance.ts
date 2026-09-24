import type { CustomRequest, Env } from '../types/env';
import { fail, ok } from '../lib/response';
import { recordAttendance } from '../services/attendance.service';

export async function createAttendance(request: CustomRequest, env: Env) {
  if (!request.user) return fail('Yetkilendirme gerekli.', 401);

  let body: {
    lesson_instance_id?: number;
    student_id?: number;
    status?: 'present' | 'absent' | 'late' | 'excused';
    note?: string | null;
  };

  try {
    body = await request.json();
  } catch {
    return fail('Geçersiz JSON.', 400);
  }

  if (!body.lesson_instance_id || !body.student_id || !body.status) {
    return fail('lesson_instance_id, student_id ve status zorunludur.', 422);
  }

  if (!['present', 'absent', 'late', 'excused'].includes(body.status)) {
    return fail('Geçersiz attendance status.', 422);
  }

  try {
    return ok(await recordAttendance(env, {
      lesson_instance_id: Number(body.lesson_instance_id),
      student_id: Number(body.student_id),
      status: body.status,
      note: body.note ?? null,
      recorded_by_user_id: request.user.id,
      recorded_by_role: request.user.role,
    }));
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'Yoklama kaydedilemedi.', 400);
  }
}
