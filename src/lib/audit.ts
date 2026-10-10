import type { Env } from '../types/env';

export function auditStatement(
  env: Env,
  userId: number,
  action: string,
  tableName: string,
  recordId: number | null,
  details?: unknown,
): D1PreparedStatement {
  return env.DB.prepare(`
    INSERT INTO audit_logs (user_id, action, table_name, record_id, details)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    userId,
    action,
    tableName,
    recordId,
    details === undefined ? null : JSON.stringify(details),
  );
}
