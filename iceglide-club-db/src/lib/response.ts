export function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(data, {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

export function ok<T>(data: T, status = 200): Response {
  return json({ success: true, data }, status);
}

export function fail(message: string, status = 400, details?: unknown): Response {
  return json(
    {
      success: false,
      message,
      ...(details === undefined ? {} : { details }),
    },
    status,
  );
}
