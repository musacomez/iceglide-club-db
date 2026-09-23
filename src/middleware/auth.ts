import type {
  Env,
  AuthUser,
  CustomRequest,
  UserRole
} from '../types/env';
import { fail } from '../lib/response';
import { verifyToken } from '../lib/token';

const VALID_ROLES: UserRole[] = [
  'admin',
  'head_coach',
  'instructor',
  'parent',
  'student'
];

function isUserRole(value: unknown): value is UserRole {
  return (
    typeof value === 'string' &&
    VALID_ROLES.includes(value as UserRole)
  );
}

export async function authenticate(
  request: CustomRequest,
  env: Env
): Promise<Response | void> {
  const header = request.headers.get('Authorization');

  if (!header?.startsWith('Bearer ')) {
    return fail('Yetkilendirme gerekli.', 401);
  }

  if (!env.AUTH_SECRET) {
    return fail('AUTH_SECRET yapılandırılmamış.', 500);
  }

  const token = header.slice(7).trim();

  if (!token) {
    return fail('Geçersiz veya süresi dolmuş token.', 401);
  }

  const payload = await verifyToken(token, env.AUTH_SECRET);

  if (
    !payload ||
    typeof payload.sub !== 'number' ||
    !isUserRole(payload.role)
  ) {
    return fail('Geçersiz veya süresi dolmuş token.', 401);
  }

  request.user = {
    id: payload.sub,
    role: payload.role,
    full_name:
      typeof payload.full_name === 'string'
        ? payload.full_name
        : undefined,
    email:
      typeof payload.email === 'string'
        ? payload.email
        : undefined,
  };
}
