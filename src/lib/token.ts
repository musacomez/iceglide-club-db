const encoder = new TextEncoder();

function base64url(input: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof input === 'string'
    ? encoder.encode(input)
    : input instanceof Uint8Array
      ? input
      : new Uint8Array(input);

  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64url(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export async function signToken(payload: Record<string, unknown>, secret: string): Promise<string> {
  const body = base64url(JSON.stringify(payload));
  const signature = base64url(await hmac(secret, body));
  return `${body}.${signature}`;
}

export async function verifyToken(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const expected = await hmac(secret, body);
  const actual = fromBase64url(signature);
  if (expected.length !== actual.length) return null;

  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i];
  if (diff !== 0) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(body))) as Record<string, unknown>;
    if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
