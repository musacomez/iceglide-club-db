export interface Env {
  DB: D1Database;
  AUTH_SECRET?: string;
  CORS_ORIGIN?: string;
}

export interface AuthUser {
  id: number;
  role: 'admin' | 'instructor' | 'student' | 'parent';
  full_name?: string;
  email?: string;
}

export interface CustomRequest extends Request {
  params: Record<string, string>;
  query: Record<string, string>;
  user?: AuthUser;
}
