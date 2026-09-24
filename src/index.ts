import { AutoRouter } from 'itty-router';
import type { CustomRequest, Env } from './types/env';
import { json, fail } from './lib/response';
import { corsHeaders } from './lib/cors';
import { authenticate } from './middleware/auth';
import { health } from './routes/health';
import { login } from './routes/auth';
import { listStudents, getStudent } from './routes/students';
import { listLessons, getLesson, attendanceList } from './routes/lessons';
import { createAttendance } from './routes/attendance';
import { listStudentPackages } from './routes/packages';
import { listStudentPayments } from './routes/payments';
import { dashboardSummary } from './routes/dashboard';
import { me } from './routes/me';

const router = AutoRouter();

function withAuth(handler: (request: CustomRequest, env: Env) => Promise<Response>) {
  return async (request: Request, env: Env) => {
    const req = request as CustomRequest;
    const authError = await authenticate(req, env);
    if (authError) return authError;
    return handler(req, env);
  };
}

function withRoles(
  roles: NonNullable<CustomRequest['user']>['role'][],
  handler: (request: CustomRequest, env: Env) => Promise<Response>,
) {
  return withAuth(async (request, env) => {
    if (!request.user || !roles.includes(request.user.role)) {
      return fail('Bu işlem için yetkiniz yok.', 403);
    }

    return handler(request, env);
  });
}

router.get('/', () =>
  json({
    success: true,
    service: 'iceglide-api',
    message: 'IceGlide API çalışıyor.'
  })
);

router.get('/api/health', (_request: Request, env: Env) => health(env));
router.post('/api/auth/login', (request: Request, env: Env) => login(request, env));

router.get('/api/me', withAuth(me));
router.get(
  '/api/dashboard/summary',
  withRoles(['admin', 'head_coach'], (_request, env) => dashboardSummary(env)),
);
router.get('/api/students', withAuth(listStudents));
router.get('/api/students/:id', withAuth(getStudent));
router.get('/api/lessons', withAuth(listLessons));
router.get('/api/lessons/:id', withAuth(getLesson));
router.get('/api/lessons/:id/attendance', withAuth(attendanceList));
router.post('/api/attendance', withAuth(createAttendance));
router.get('/api/packages/student/:studentId', withAuth(listStudentPackages));
router.get('/api/payments/student/:studentId', withAuth(listStudentPayments));

router.all('*', () => fail('API endpoint bulunamadı.', 404));

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    try {
      const response = await router.fetch(request, env, ctx);
      const headers = new Headers(response.headers);
      for (const [key, value] of corsHeaders(request, env)) headers.set(key, value);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch (error) {
      console.error(error);
      return fail('Beklenmeyen sunucu hatası.', 500);
    }
  }
};
