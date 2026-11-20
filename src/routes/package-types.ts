import { fail, ok } from '../lib/response';
import { isPositiveInt, readJson } from '../lib/validate';
import type { CustomRequest, Env } from '../types/env';

export async function listManagedPackageTypes(_request: CustomRequest, env: Env) {
  const { results } = await env.DB.prepare(`
    SELECT id, name, lesson_count, lessons_per_week, validity_days, price_cents, active
    FROM package_types ORDER BY active DESC, name, id
  `).all();
  return ok(results);
}

export async function savePackageType(request: CustomRequest, env: Env) {
  const input = await readJson<{
    name?: unknown; lesson_count?: unknown; lessons_per_week?: unknown;
    price_cents?: unknown; active?: unknown;
  }>(request);
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  const lessons = input?.lesson_count;
  const weekly = input?.lessons_per_week;
  const price = input?.price_cents;
  const active = input?.active;
  if (!name || name.length > 120 || !isPositiveInt(lessons) || !Number.isSafeInteger(lessons) ||
    !isPositiveInt(weekly) || !Number.isSafeInteger(weekly) ||
    typeof price !== 'number' || !Number.isSafeInteger(price) || price < 0 ||
    (active !== 0 && active !== 1)) {
    return fail('Paket adı, fiyatı veya ders sayısı geçersiz.', 422);
  }
  const validity = Math.ceil(lessons / weekly) * 7;
  if (validity > 3_652_425) return fail('Hesaplanan paket süresi geçersiz.', 422);
  const id = request.params.typeId === undefined ? null : Number(request.params.typeId);
  if (id !== null && !isPositiveInt(id)) return fail('Paket türü ID geçersiz.', 422);
  const fields = [name, lessons, weekly, validity, price, active];
  const row = id === null
    ? await env.DB.prepare(`
        INSERT INTO package_types (name, lesson_count, lessons_per_week, validity_days, price_cents, active)
        VALUES (?, ?, ?, ?, ?, ?) RETURNING id, name, lesson_count, lessons_per_week, validity_days, price_cents, active
      `).bind(...fields).first()
    : await env.DB.prepare(`
        UPDATE package_types
        SET name = ?, lesson_count = ?, lessons_per_week = ?, validity_days = ?, price_cents = ?, active = ?
        WHERE id = ? RETURNING id, name, lesson_count, lessons_per_week, validity_days, price_cents, active
      `).bind(...fields, id).first();
  return row ? ok(row, id === null ? 201 : 200) : fail('Paket türü bulunamadı.', 404);
}
