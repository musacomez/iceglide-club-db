export function corsHeaders(request: Request, env: { CORS_ORIGIN?: string }): Headers {
  const origin = request.headers.get('Origin');
  const allowed = env.CORS_ORIGIN || '*';
  const headers = new Headers();

  if (allowed === '*') {
    headers.set('Access-Control-Allow-Origin', '*');
  } else if (origin === allowed) {
    headers.set('Access-Control-Allow-Origin', origin);
  }

  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  headers.set('Access-Control-Max-Age', '86400');
  return headers;
}
