import type { CustomRequest, Env } from '../types/env';
import { ok } from '../lib/response';

// Yönetim formlarında (ders / öğrenci ekleme) kullanılan seçim listeleri.
// Yalnızca admin ve head_coach için açılır (bkz. index.ts).
export async function getLookups(_request: CustomRequest, env: Env) {
  const [instructors, parents, locations, groups, levels] = await Promise.all([
    env.DB.prepare(`
      SELECT id, full_name, role
      FROM users
      WHERE role IN ('instructor', 'head_coach') AND active = 1
      ORDER BY full_name
    `).all(),
    env.DB.prepare(`
      SELECT id, full_name, email
      FROM users
      WHERE role = 'parent' AND active = 1
      ORDER BY full_name
    `).all(),
    env.DB.prepare(`SELECT id, name FROM locations ORDER BY name`).all(),
    env.DB.prepare(`SELECT id, name FROM groups ORDER BY name`).all(),
    env.DB.prepare(`SELECT id, name FROM levels ORDER BY id`).all(),
  ]);

  return ok({
    instructors: instructors.results,
    parents: parents.results,
    locations: locations.results,
    groups: groups.results,
    levels: levels.results,
  });
}
