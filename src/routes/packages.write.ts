import { fail, ok } from '../lib/response';
import { addDaysISO, isPositiveInt, isValidDate, readJson } from '../lib/validate';
import type { CustomRequest, Env } from '../types/env';

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const ASSIGNABLE_TYPE = `
  active = 1 AND typeof(lesson_count) = 'integer' AND lesson_count > 0
  AND typeof(price_cents) = 'integer' AND price_cents >= 0
  AND (validity_days IS NULL OR (typeof(validity_days) = 'integer' AND validity_days >= 0))
`;

type AssignmentInput = {
  package_type_id?: unknown;
  starts_at?: unknown;
  request_id?: unknown;
  expected_price_cents?: unknown;
  expected_lesson_count?: unknown;
  expected_validity_days?: unknown;
};

type AssignedPackage = {
  id: number;
  student_id: number;
  package_type_id: number;
  package_number: string;
  starts_at: string;
  expires_at: string | null;
  total_lessons: number;
  price_cents: number;
  charge_id: number | null;
};

export async function listPackageTypes(_request: CustomRequest, env: Env) {
  const result = await env.DB.prepare(`
    SELECT id, name, lesson_count, validity_days, price_cents
    FROM package_types WHERE ${ASSIGNABLE_TYPE}
    ORDER BY name, id
  `).all();
  return ok(result.results);
}

export async function assignStudentPackage(request: CustomRequest, env: Env) {
  if (!request.user) return fail('Yetkilendirme gerekli.', 401);
  const studentId = Number(request.params.studentId);
  if (!Number.isSafeInteger(studentId) || studentId < 1) {
    return fail('Geçersiz öğrenci ID.', 400);
  }

  const input = await readJson<AssignmentInput>(request);
  const typeId = input?.package_type_id;
  const startsAt = input?.starts_at;
  const requestId = input?.request_id;
  const price = input?.expected_price_cents;
  const lessons = input?.expected_lesson_count;
  const validity = input?.expected_validity_days;
  if (
    !isPositiveInt(typeId) || !Number.isSafeInteger(typeId) ||
    !isValidDate(startsAt) ||
    typeof requestId !== 'string' || !REQUEST_ID.test(requestId) ||
    typeof price !== 'number' || !Number.isSafeInteger(price) || price < 0 ||
    !isPositiveInt(lessons) || !Number.isSafeInteger(lessons) ||
    (validity !== null && (typeof validity !== 'number' ||
      !Number.isSafeInteger(validity) || validity < 0 || validity > 3_652_425))
  ) {
    return fail('Paket, başlangıç tarihi veya paket bilgileri geçersiz.', 422);
  }

  const expiresAt = validity ? addDaysISO(startsAt, validity - 1) : null;
  if (expiresAt && !isValidDate(expiresAt)) {
    return fail('Paket bitiş tarihi geçersiz.', 422);
  }

  const packageNumber = `PKG-${requestId}`;
  const userId = request.user.id;
  const readPackage = env.DB.prepare(`
    SELECT p.id, p.student_id, p.package_type_id, p.package_number, p.starts_at,
           p.expires_at, p.total_lessons, p.price_cents, c.id AS charge_id
    FROM packages p LEFT JOIN student_charges c ON c.package_id = p.id
    WHERE p.package_number = ?
  `).bind(packageNumber);

  function existingResponse(existing: AssignedPackage, status = 200) {
    if (existing.student_id !== studentId || existing.package_type_id !== typeId ||
      existing.starts_at !== startsAt || existing.expires_at !== expiresAt ||
      existing.total_lessons !== lessons || existing.price_cents !== price) {
      return fail('Bu istek numarası farklı bir paket atamasında kullanıldı.', 409);
    }
    return ok(existing, status);
  }

  const existing = await readPackage.first<AssignedPackage>();
  if (existing) return existingResponse(existing);

  let created: AssignedPackage | undefined;
  try {
    const [, , , result] = await env.DB.batch<AssignedPackage>([
      env.DB.prepare(`
        INSERT INTO packages (
          student_id, package_type_id, package_number, total_lessons, remaining_lessons,
          purchased_at, starts_at, expires_at, status, price_cents
        )
        SELECT s.id, pt.id, ?, pt.lesson_count, pt.lesson_count,
               date('now', '+3 hours'), ?, ?, 'active', pt.price_cents
        FROM students s CROSS JOIN (
          SELECT id, price_cents, lesson_count FROM package_types
          WHERE id = ? AND ${ASSIGNABLE_TYPE}
            AND price_cents = ? AND lesson_count = ? AND validity_days IS ?
        ) pt
        WHERE s.id = ? AND s.status = 'active'
      `).bind(packageNumber, startsAt, expiresAt, typeId, price, lessons, validity, studentId),
      env.DB.prepare(`
        INSERT INTO student_charges (
          student_id, charge_type, description, amount_cents, due_date, package_id,
          created_by_user_id
        )
        SELECT p.student_id, 'package', pt.name, p.price_cents, p.starts_at, p.id, ?
        FROM packages p JOIN package_types pt ON pt.id = p.package_type_id
        WHERE p.package_number = ? AND p.price_cents > 0
      `).bind(userId, packageNumber),
      env.DB.prepare(`
        INSERT INTO audit_logs (user_id, action, table_name, record_id, details)
        SELECT ?, 'package.assign', 'packages', p.id, json_object('student_id', p.student_id)
        FROM packages p WHERE p.package_number = ?
      `).bind(userId, packageNumber),
      readPackage,
    ]);
    created = result.results[0];
  } catch (error) {
    const assigned = await readPackage.first<AssignedPackage>();
    if (assigned) return existingResponse(assigned);
    throw error;
  }

  if (!created) {
    return fail('Öğrenci veya paket türü artık aktif değil ya da paket bilgileri değişti. Listeyi yenileyin.', 409);
  }
  return existingResponse(created, 201);
}
