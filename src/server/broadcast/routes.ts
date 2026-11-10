import { and, desc, eq, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { notFound } from '@/server/common/errors';
import { broadcasts, users } from '@/server/db/schema';
import {
  decodeCursor,
  encodeCursor,
  pageQuery,
  parseJson,
  parseWith,
  requireUser,
  uuidParam,
  type AppEnv,
} from '@/server/http';
import { viewerCount } from '@/server/media/gateway';
import type { Deps } from '@/server/ports';
import type { RealtimeHub } from '@/server/realtime/hub';
import { listItem, type BroadcastService } from './service';

const title = z.string().trim().min(1, '제목을 입력해 주세요.').max(100, '제목은 100자까지 쓸 수 있습니다.');
const description = z.string().trim().max(2000).nullable().optional();

const createSchema = z.object({ title, description });
const patchSchema = z
  .object({ title: title.optional(), description })
  .refine((v) => v.title !== undefined || v.description !== undefined, '바꿀 값이 없습니다.');
const startSchema = z.object({ source: z.enum(['SCREEN', 'CAMERA']) });

const owner = { id: users.id, nickname: users.nickname };
const idCursor = z.object({ id: z.string().uuid() });

export function broadcastRoutes(deps: Deps, service: BroadcastService, hub: RealtimeHub) {
  const { db } = deps;
  const app = new Hono<AppEnv>();

  /** 공개 목록: 삭제되지 않은 LIVE·ENDED 만. LIVE 가 먼저, 그다음 최신순. */
  app.get('/broadcasts', async (c) => {
    const q = parseWith(pageQuery.extend({ status: z.enum(['LIVE', 'ENDED']).optional() }), c.req.query());
    const rank = sql<number>`(CASE WHEN ${broadcasts.status} = 'LIVE' THEN 1 ELSE 0 END)`;
    const cursor = decodeCursor(q.cursor, z.object({ r: z.number().int(), id: z.string().uuid() }));
    const conds: SQL[] = [isNull(broadcasts.deletedAt), ne(broadcasts.status, 'READY')];
    if (q.status) conds.push(eq(broadcasts.status, q.status));
    if (cursor) conds.push(or(lt(rank, cursor.r), and(eq(rank, cursor.r), lt(broadcasts.id, cursor.id)))!);
    const rows = await db
      .select({ b: broadcasts, owner, rank })
      .from(broadcasts)
      .innerJoin(users, eq(users.id, broadcasts.ownerId))
      .where(and(...conds))
      .orderBy(desc(rank), desc(broadcasts.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return c.json({
      items: page.map((r) => listItem(r.b, r.owner)),
      nextCursor: rows.length > q.limit && last ? encodeCursor({ r: Number(last.rank), id: last.b.id }) : null,
    });
  });

  /** 내 방송: READY 포함. 스튜디오로 들어가는 진입점이다. */
  app.get('/me/broadcasts', async (c) => {
    const user = requireUser(c);
    const q = parseWith(pageQuery, c.req.query());
    const cursor = decodeCursor(q.cursor, idCursor);
    const rows = await db
      .select({ b: broadcasts, owner })
      .from(broadcasts)
      .innerJoin(users, eq(users.id, broadcasts.ownerId))
      .where(
        and(
          eq(broadcasts.ownerId, user.id),
          isNull(broadcasts.deletedAt),
          cursor ? lt(broadcasts.id, cursor.id) : undefined,
        ),
      )
      .orderBy(desc(broadcasts.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    return c.json({
      items: page.map((r) => listItem(r.b, r.owner)),
      nextCursor: rows.length > q.limit ? encodeCursor({ id: page[page.length - 1]!.b.id }) : null,
    });
  });

  app.post('/broadcasts', async (c) => {
    const user = requireUser(c);
    const input = await parseJson(c, createSchema);
    const b = await service.create(user.id, input);
    return c.json({ broadcast: await service.detail(b.id, user.id) }, 201);
  });

  app.get('/broadcasts/:id', async (c) => {
    const id = parseWith(uuidParam, c.req.param('id'));
    return c.json({ broadcast: await service.detail(id, c.get('user')?.id ?? null) });
  });

  app.patch('/broadcasts/:id', async (c) => {
    const user = requireUser(c);
    const id = parseWith(uuidParam, c.req.param('id'));
    const input = await parseJson(c, patchSchema);
    return c.json({ broadcast: await service.update(id, user.id, input) });
  });

  app.delete('/broadcasts/:id', async (c) => {
    const user = requireUser(c);
    const id = parseWith(uuidParam, c.req.param('id'));
    await service.remove(id, user.id);
    return c.body(null, 204);
  });

  app.post('/broadcasts/:id/start', async (c) => {
    const user = requireUser(c);
    const id = parseWith(uuidParam, c.req.param('id'));
    const { source } = await parseJson(c, startSchema);
    return c.json(await service.start(id, user.id, source));
  });

  app.post('/broadcasts/:id/end', async (c) => {
    const user = requireUser(c);
    const id = parseWith(uuidParam, c.req.param('id'));
    return c.json({ broadcast: await service.endByOwner(id, user.id) });
  });

  app.post('/broadcasts/:id/publish-token', async (c) => {
    const user = requireUser(c);
    const id = parseWith(uuidParam, c.req.param('id'));
    return c.json(await service.reissuePublishToken(id, user.id));
  });

  /** SSE. 댓글·후원·수정·종료·시청자 수를 흘려보낸다. */
  app.get('/broadcasts/:id/events', async (c) => {
    const id = parseWith(uuidParam, c.req.param('id'));
    await service.mustFind(id);

    // 응답을 돌려주기 전에 구독을 끝내서, 연결 직후 발행된 이벤트도 놓치지 않는다.
    const pending: Array<{ type: string; data: unknown }> = [];
    let write: ((e: { type: string; data: unknown }) => void) | null = null;
    const unsubscribe = await hub.subscribe(id, (e) => (write ? write(e) : pending.push(e)));

    c.header('Cache-Control', 'no-cache, no-transform');
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      let closed = false;
      const timers: NodeJS.Timeout[] = [];
      const cleanup = () => {
        if (closed) return;
        closed = true;
        timers.forEach(clearInterval);
        unsubscribe();
      };
      stream.onAbort(cleanup);
      const send = (e: { type: string; data: unknown }) => {
        if (closed) return;
        stream.writeSSE({ event: e.type, data: JSON.stringify(e.data) }).catch(cleanup);
      };

      await stream.write(': connected\n\n');
      pending.splice(0).forEach(send);
      write = send;

      // 연결을 연 뒤에 방송이 시작될 수 있으므로(대기 화면, 스튜디오) 매번 현재 상태를 확인한다.
      const sendViewers = async () => {
        try {
          const current = await db.query.broadcasts.findFirst({
            columns: { status: true },
            where: eq(broadcasts.id, id),
          });
          if (current?.status !== 'LIVE') return;
          send({ type: 'viewers', data: { count: await viewerCount(deps, id) } });
        } catch {
          /* 다음 주기에 다시 보낸다. */
        }
      };
      timers.push(setInterval(() => stream.write(': ping\n\n').catch(cleanup), 15_000));
      timers.push(setInterval(() => void sendViewers(), 10_000));
      void sendViewers();

      await new Promise<void>((resolve) => {
        if (closed) return resolve();
        stream.onAbort(() => resolve());
      });
      cleanup();
    });
  });

  /** 채널 = 사용자. 지금 LIVE 인 방송과 지난 방송(ENDED). */
  app.get('/channels/:userId', async (c) => {
    const userId = parseWith(uuidParam, c.req.param('userId'));
    const q = parseWith(pageQuery, c.req.query());
    const channel = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!channel) throw notFound('CHANNEL_NOT_FOUND', '채널을 찾을 수 없습니다.');
    const ownerRef = { id: channel.id, nickname: channel.nickname };
    const live = await db.query.broadcasts.findFirst({
      where: and(eq(broadcasts.ownerId, userId), eq(broadcasts.status, 'LIVE'), isNull(broadcasts.deletedAt)),
    });
    const cursor = decodeCursor(q.cursor, idCursor);
    const past = await db
      .select()
      .from(broadcasts)
      .where(
        and(
          eq(broadcasts.ownerId, userId),
          eq(broadcasts.status, 'ENDED'),
          isNull(broadcasts.deletedAt),
          cursor ? lt(broadcasts.id, cursor.id) : undefined,
        ),
      )
      .orderBy(desc(broadcasts.id))
      .limit(q.limit + 1);
    const page = past.slice(0, q.limit);
    return c.json({
      channel: ownerRef,
      live: live ? listItem(live, ownerRef) : null,
      past: {
        items: page.map((b) => listItem(b, ownerRef)),
        nextCursor: past.length > q.limit ? encodeCursor({ id: page[page.length - 1]!.id }) : null,
      },
    });
  });

  return app;
}
