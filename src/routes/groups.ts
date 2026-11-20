import { fail, ok } from '../lib/response';
import { isPositiveInt, readJson } from '../lib/validate';
import type { CustomRequest, Env } from '../types/env';

export async function saveGroup(request: CustomRequest, env: Env) {
  const body = await readJson<{ name?: unknown }>(request);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 100) return fail('Grup adı 1–100 karakter olmalıdır.', 422);
  const id = request.params.groupId === undefined ? null : Number(request.params.groupId);
  if (id !== null && !isPositiveInt(id)) return fail('Grup ID geçersiz.', 422);

  const row = id === null
    ? await env.DB.prepare(`
        INSERT INTO groups (name) SELECT ?
        WHERE NOT EXISTS (SELECT 1 FROM groups WHERE name = ? COLLATE NOCASE)
        RETURNING id, name
      `).bind(name, name).first()
    : await env.DB.prepare(`
        UPDATE groups SET name = ? WHERE id = ?
        AND NOT EXISTS (SELECT 1 FROM groups WHERE name = ? COLLATE NOCASE AND id != ?)
        RETURNING id, name
      `).bind(name, id, name, id).first();

  if (!row) return fail('Grup bulunamadı veya aynı adla bir grup var.', 409);
  return ok(row, id === null ? 201 : 200);
}
