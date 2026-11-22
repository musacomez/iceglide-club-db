import { AutoRouter } from 'itty-router';
import type { CustomRequest, Env } from './types/env';
import { json, fail } from './lib/response';
import { corsHeaders } from './lib/cors';
import { authenticate } from './middleware/auth';
import { health } from './routes/health';
import { changePassword, login } from './routes/auth';
import { listStudents, getStudent } from './routes/students';
import { listLessons, getLesson, attendanceList } from './routes/lessons';
import { createAttendance } from './routes/attendance';
import { listStudentPackages } from './routes/packages';
import { assignStudentPackage, listPackageTypes } from './routes/packages.write';
import { saveGroup } from './routes/groups';
import { listManagedPackageTypes, savePackageType } from './routes/package-types';
import { listCharges, listOwnOpenCharges, createCharge, cancelCharge, receivePayment } from './routes/finance';
import { listStudentPayments } from './routes/payments';
import { dashboardSummary } from './routes/dashboard';
import { me } from './routes/me';
import { getStudentAccount, saveStudentAccount } from './routes/student-account';
import { createStudent, updateStudent } from './routes/students.write';
import { createLesson, updateLesson } from './routes/lessons.write';
import { listCoaches, saveCoach } from './routes/coaches';
import { listClubMessages, sendClubMessage, hideClubMessage } from './routes/club-chat';
import { getLookups } from './routes/lookups';
import { getPushSettings, savePushDevice, deletePushDevice, notifyStudent } from './routes/push';
import { runPushSchedule } from './lib/push';

const router = AutoRouter();

function withAuth(handler: (request: CustomRequest, env: Env, ctx: ExecutionContext) => Promise<Response>) {
  return async (request: Request, env: Env, ctx: ExecutionContext) => {
    const req = request as CustomRequest;
    const authError = await authenticate(req, env);
    if (authError) return authError;
    return handler(req, env, ctx);
  };
}

function withRoles(
  roles: NonNullable<CustomRequest['user']>['role'][],
  handler: (request: CustomRequest, env: Env, ctx: ExecutionContext) => Promise<Response>,
) {
  return withAuth(async (request, env, ctx) => {
    if (!request.user || !roles.includes(request.user.role)) {
      return fail('Bu işlem için yetkiniz yok.', 403);
    }

    return handler(request, env, ctx);
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
router.post('/api/auth/change-password', withAuth(changePassword));

router.get('/api/me', withAuth(me));
router.get(
  '/api/dashboard/summary',
  withRoles(['admin', 'head_coach'], (_request, env) => dashboardSummary(env)),
);
router.get('/api/students', withAuth(listStudents));
router.get('/api/students/:id', withAuth(getStudent));
router.post('/api/students', withRoles(['admin', 'head_coach'], createStudent));
router.patch('/api/students/:id', withRoles(['admin', 'head_coach'], updateStudent));
router.get('/api/students/:id/account', withRoles(['admin'], getStudentAccount));
router.post('/api/students/:id/account', withRoles(['admin'], saveStudentAccount));
router.patch('/api/students/:id/account', withRoles(['admin'], saveStudentAccount));
router.get('/api/lessons', withAuth(listLessons));
router.get('/api/lessons/:id', withAuth(getLesson));
router.get('/api/lessons/:id/attendance', withAuth(attendanceList));
router.post('/api/lessons', withRoles(['admin', 'head_coach'], createLesson));
router.patch('/api/lessons/:id', withRoles(['admin', 'head_coach'], updateLesson));
router.post('/api/groups', withRoles(['admin', 'head_coach'], saveGroup));
router.patch('/api/groups/:groupId', withRoles(['admin', 'head_coach'], saveGroup));
router.get('/api/manage/coaches', withRoles(['admin'], listCoaches));
router.post('/api/manage/coaches', withRoles(['admin'], saveCoach));
router.patch('/api/manage/coaches/:coachId', withRoles(['admin'], saveCoach));
router.get('/api/lookups', withRoles(['admin', 'head_coach'], getLookups));
router.post('/api/attendance', withAuth(createAttendance));
router.get('/api/packages/student/:studentId', withAuth(listStudentPackages));
router.get('/api/manage/package-types', withRoles(['admin'], listManagedPackageTypes));
router.post('/api/manage/package-types', withRoles(['admin'], savePackageType));
router.patch('/api/manage/package-types/:typeId', withRoles(['admin'], savePackageType));
router.get('/api/packages/types', withRoles(['admin', 'head_coach'], listPackageTypes));
router.post('/api/packages/student/:studentId', withRoles(['admin', 'head_coach'], assignStudentPackage));
router.get('/api/finance/me/open-charges', withRoles(['student'], listOwnOpenCharges));
router.get('/api/finance/student/:studentId/charges', withRoles(['admin'], listCharges));
router.post('/api/finance/student/:studentId/charges', withRoles(['admin'], createCharge));
router.post('/api/finance/student/:studentId/charges/:chargeId/cancel', withRoles(['admin'], cancelCharge));
router.post('/api/finance/student/:studentId/charges/:chargeId/payments', withRoles(['admin'], receivePayment));
router.get('/api/payments/student/:studentId', withAuth(listStudentPayments));

router.get('/api/club-chat/messages', withAuth(listClubMessages));
router.post('/api/club-chat/messages', withAuth(sendClubMessage));
router.delete('/api/club-chat/messages/:id', withRoles(['admin'], hideClubMessage));

router.get('/api/push/settings', withAuth(getPushSettings));
router.put('/api/push/device', withAuth(savePushDevice));
router.delete('/api/push/device', withAuth(deletePushDevice));
router.post('/api/students/:id/notify', withRoles(['admin'], notifyStudent));

router.all('*', () => fail('API endpoint bulunamadı.', 404));

export default {
  async scheduled(event: ScheduledController, env: Env) {
    await runPushSchedule(env, event.scheduledTime);
  },

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
