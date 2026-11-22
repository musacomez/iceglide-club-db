interface Env {
  DB: D1Database;
  AUTH_SECRET?: string;
  CORS_ORIGIN?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}
