import { timingSafeEqual } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { notFound } from '@/server/common/errors';
import { broadcasts } from '@/server/db/schema';
import type { AppEnv, Ctx } from '@/server/http';
import type { BroadcastService } from '@/server/broadcast/service';
import type { Deps } from '@/server/ports';
import { broadcastIdFromPath, readPublishToken } from './gateway';

const authSchema = z.object({
  action: z.string(),
  path: z.string().optional().default(''),
  query: z.string().optional().nullable(),
  token: z.string().optional().nullable(),
  user: z.string().optional().nullable(),
  password: z.string().optional().nullable(),
  protocol: z.string().optional().nullable(),
  ip: z.string().optional().nullable(),
});

const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};

/** 송출 토큰은 WHIP URL 쿼리(?token=)로 온다. Bearer 헤더나 비밀번호 칸으로 와도 받는다. */
function tokenFrom(body: z.infer<typeof authSchema>): string | null {
  if (body.query) {
    const t = new URLSearchParams(body.query).get('token');
    if (t) return t;
  }
  return body.token || body.password || null;
}

/**
 * MediaMTX 만 부르는 내부 경로. Caddy 는 외부 요청에 404 를 돌려주고, 앱은 공유 비밀키를 확인한다.
 * 인증 요청(authHTTPAddress)은 헤더를 붙일 수 없어서 ?secret= 쿼리도 받는다.
 */
export function mediaHookRoutes(deps: Deps, service: BroadcastService) {
  const { db, redis } = deps;
  const app = new Hono<AppEnv>();

  app.use(async (c, next) => {
    const provided = c.req.header('x-internal-secret') ?? c.req.query('secret') ?? '';
    if (!safeEqual(provided, deps.config.internalSecret)) throw notFound('NOT_FOUND', '찾을 수 없습니다.');
    await next();
  });

  const deny = (c: Ctx, reason: string, extra: Record<string, unknown>) => {
    c.get('log').info({ ...extra, reason }, 'media auth denied');
    return c.body(null, 401);
  };

  app.post('/auth', async (c) => {
    const parsed = authSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return deny(c, 'bad payload', {});
    const body = parsed.data;
    const id = broadcastIdFromPath(body.path);
    const ctx = { action: body.action, path: body.path, protocol: body.protocol, ip: body.ip };
    if (!id) return deny(c, 'unknown path', ctx);
    const b = await db.query.broadcasts.findFirst({
      where: and(eq(broadcasts.id, id), isNull(broadcasts.deletedAt)),
    });
    if (!b || b.status !== 'LIVE') return deny(c, 'broadcast not live', ctx);

    if (body.action === 'read') return c.body(null, 200);
    if (body.action === 'publish') {
      const token = tokenFrom(body);
      if (!token) return deny(c, 'missing publish token', ctx);
      const grant = await readPublishToken(redis, token);
      if (!grant) return deny(c, 'invalid publish token', ctx);
      if (grant.broadcastId !== b.id) return deny(c, 'token for another broadcast', ctx);
      if (grant.userId !== b.ownerId) return deny(c, 'token user is not owner', ctx);
      c.get('log').info({ ...ctx, broadcastId: b.id }, 'media publish allowed');
      return c.body(null, 200);
    }
    return deny(c, 'action not allowed', ctx);
  });

  const pathOf = async (c: Ctx) => {
    const q = c.req.query('path');
    if (q) return q;
    const body = (await c.req.json().catch(() => ({}))) as { path?: string };
    return body.path ?? '';
  };

  app.post('/ready', async (c) => {
    const id = broadcastIdFromPath(await pathOf(c));
    if (id) await service.onPublisherReady(id);
    return c.body(null, 204);
  });

  app.post('/not-ready', async (c) => {
    const id = broadcastIdFromPath(await pathOf(c));
    if (id) await service.onPublisherGone(id);
    return c.body(null, 204);
  });

  return app;
}
