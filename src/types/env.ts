export interface Env {
  DB: D1Database;
  AUTH_SECRET?: string;
  CORS_ORIGIN?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

export type UserRole =
  | 'admin'
  | 'head_coach'
  | 'instructor'
  | 'parent'
  | 'student';

export interface AuthUser {
  id: number;
  role: UserRole;
  full_name?: string;
  email?: string;
}

export interface CustomRequest extends Request {
  params: Record<string, string>;
  query: Record<string, string>;
  user?: AuthUser;
  authVersion?: number;
}
