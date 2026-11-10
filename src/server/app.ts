import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { authRoutes, ACCESS_COOKIE } from '@/server/auth/routes';
import { createTokenService } from '@/server/auth/tokens';
import { broadcastRoutes } from '@/server/broadcast/routes';
import { createBroadcastService } from '@/server/broadcast/service';
import { commentRoutes } from '@/server/comment/routes';
import { AppError, forbidden, toProblem } from '@/server/common/errors';
import { randomToken } from '@/server/common/ids';
import { donationRoutes } from '@/server/donation/routes';
import { createDonationService } from '@/server/donation/service';
import type { AppEnv } from '@/server/http';
import { mediaHookRoutes } from '@/server/media/routes';
import type { Deps } from '@/server/ports';
import { RealtimeHub } from '@/server/realtime/hub';
import { recordingRoutes } from '@/server/recording/routes';
import { createRecordingService } from '@/server/recording/service';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createApp(deps: Deps) {
  const tokens = createTokenService(deps);
  const broadcastsService = createBroadcastService(deps);
  const hub = new RealtimeHub(deps.createSubscriber);
  const donations = createDonationService(deps, broadcastsService);
  const app = new Hono<AppEnv>();

  app.use(async (c, next) => {
    const requestId = c.req.header('x-request-id') || randomToken(9);
    c.set('requestId', requestId);
    c.set('log', deps.log.child({ requestId }));
    c.set('user', null);
    c.header('x-request-id', requestId);
    await next();
  });

  // CSRF: 쓰기 요청은 Origin 이 앱 도메인과 같을 때만 받는다. 외부 서버가 부르는 웹훅은 제외한다.
  app.use('/api/*', async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method) && !c.req.path.startsWith('/api/webhooks/')) {
      if (c.req.header('origin') !== deps.config.appOrigin) {
        throw forbidden('ORIGIN_MISMATCH', '허용되지 않은 출처의 요청입니다.');
      }
    }
    c.set('user', await tokens.verifyAccess(getCookie(c, ACCESS_COOKIE)));
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof AppError) {
      if (err.status >= 500) c.get('log')?.error({ err }, err.message);
      return c.body(JSON.stringify(toProblem(err)), err.status as 400, {
        'content-type': 'application/problem+json',
      });
    }
    (c.get('log') ?? deps.log).error({ err }, 'unhandled error');
    return c.body(
      JSON.stringify({ type: 'about:blank', title: '서버 오류가 발생했습니다.', status: 500, code: 'INTERNAL' }),
      500,
      { 'content-type': 'application/problem+json' },
    );
  });

  app.notFound((c) =>
    c.body(JSON.stringify({ type: 'about:blank', title: '찾을 수 없습니다.', status: 404, code: 'NOT_FOUND' }), 404, {
      'content-type': 'application/problem+json',
    }),
  );

  app.route('/api', authRoutes(deps, tokens));
  app.route('/api', broadcastRoutes(deps, broadcastsService, hub));
  app.route('/api', commentRoutes(deps, broadcastsService));
  app.route('/api', donationRoutes(donations));
  app.route('/api', recordingRoutes(createRecordingService(deps)));
  app.route('/internal/media', mediaHookRoutes(deps, broadcastsService));

  app.get('/healthz', (c) => c.json({ ok: true }));
  app.get('/readyz', async (c) => {
    const checks = await Promise.allSettled([
      deps.db.execute(sql`select 1`),
      deps.redis.ping(),
      deps.media.ping().then((ok) => {
        if (!ok) throw new Error('mediamtx not ready');
      }),
    ]);
    const [dbOk, redisOk, mediaOk] = checks.map((r) => r.status === 'fulfilled');
    const ok = dbOk && redisOk && mediaOk;
    return c.json({ ok, db: dbOk, redis: redisOk, mediamtx: mediaOk }, ok ? 200 : 503);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
