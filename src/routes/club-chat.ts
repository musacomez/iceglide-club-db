import { fail, json, ok } from '../lib/response';
import { readJson } from '../lib/validate';
import type { CustomRequest, Env, UserRole } from '../types/env';
import { deliverPushJobs, enqueueChatPush, pushSettings } from '../lib/push';

type Message = {
  id: number;
  author_id: number;
  author_name: string;
  author_role: UserRole;
  message: string;
  created_at: string;
};

const pageSize = 50;

export async function listClubMessages(request: CustomRequest, env: Env) {
  const cursor = new URL(request.url).searchParams.get('before');
  const before = cursor === null ? null : Number(cursor);
  if (before !== null && (!Number.isSafeInteger(before) || before < 1)) {
    return fail('Geçersiz mesaj numarası.', 400);
  }

  const condition = before === null ? '' : 'AND m.id < ?';
  const query = env.DB.prepare(`
    SELECT m.id, m.author_id, u.full_name AS author_name, u.role AS author_role,
      m.message, m.created_at
    FROM club_chat_messages m JOIN users u ON u.id = m.author_id
    WHERE m.hidden_at IS NULL ${condition}
    ORDER BY m.id DESC LIMIT ${pageSize + 1}
  `);
  const { results } = await (before === null ? query : query.bind(before)).all<Message>();
  const messages = results.slice(0, pageSize).reverse();

  return json({ success: true, data: {
    messages,
    next_before: results.length > pageSize ? messages[0]!.id : null,
  } }, 200, { 'Cache-Control': 'private, no-store' });
}

export async function sendClubMessage(request: CustomRequest, env: Env, ctx: ExecutionContext) {
  const body = await readJson<{ message?: unknown }>(request);
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message || [...message].length > 1000 || message.includes('\0')) {
    return fail('Mesaj 1 ile 1.000 karakter arasında olmalıdır.', 422);
  }

  const author = request.user!.id;
  const inserted = await env.DB.prepare(`
    INSERT INTO club_chat_messages (author_id, message)
    SELECT ?, ? WHERE NOT EXISTS (
      SELECT 1 FROM club_chat_messages
      WHERE author_id = ? AND created_at > datetime('now', '-2 seconds')
    )
    RETURNING id
  `).bind(author, message, author).first<{ id: number }>();

  if (!inserted) return fail('Yeni mesaj için birkaç saniye bekleyin.', 429);
  if (pushSettings(env)) {
    ctx.waitUntil(enqueueChatPush(env, inserted.id, author)
      .then(() => deliverPushJobs(env))
      .catch(() => console.error('Push processing failed for chat message', inserted.id)));
  }
  return ok(inserted, 201);
}

export async function hideClubMessage(request: CustomRequest, env: Env) {
  const id = Number(request.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return fail('Geçersiz mesaj numarası.', 400);

  const updated = await env.DB.prepare(`
    UPDATE club_chat_messages SET hidden_at = CURRENT_TIMESTAMP, hidden_by = ?
    WHERE id = ? AND hidden_at IS NULL
  `).bind(request.user!.id, id).run();

  return updated.meta.changes === 1 ? ok({ id }) : fail('Mesaj bulunamadı.', 404);
}
