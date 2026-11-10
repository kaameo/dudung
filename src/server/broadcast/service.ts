import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import { conflict, forbidden, notFound, uniqueViolation } from '@/server/common/errors';
import { newId } from '@/server/common/ids';
import { broadcasts, donations, recordings, users, type Broadcast } from '@/server/db/schema';
import { issuePublishToken, pathNameFor, viewerCount } from '@/server/media/gateway';
import { publishEvent } from '@/server/realtime/hub';
import type { Deps } from '@/server/ports';

export type EndReason = 'OWNER' | 'DISCONNECTED' | 'DELETED' | 'RECONCILED';

/** 첫 송출이 이 시간 안에 붙지 않으면 READY 로 되돌린다. */
export const START_TIMEOUT_MS = 2 * 60 * 1000;
/** 송출이 끊긴 뒤 이 시간 안에 돌아오면 방송을 이어 간다. */
export const DISCONNECT_GRACE_MS = 30 * 1000;

const absentKey = (id: string) => `media:absent:${id}`;

export interface OwnerRef {
  id: string;
  nickname: string;
}

export const listItem = (b: Broadcast, owner: OwnerRef) => ({
  id: b.id,
  title: b.title,
  status: b.status,
  source: b.source,
  owner,
  startedAt: b.startedAt,
  endedAt: b.endedAt,
  createdAt: b.createdAt,
});

export const fullView = (b: Broadcast, owner: OwnerRef, viewerId: string | null) => ({
  ...listItem(b, owner),
  description: b.description,
  pathName: b.pathName,
  endReason: b.endReason,
  isOwner: viewerId === b.ownerId,
});

/** 소유자가 아닌 사람이 READY 방송을 열면 대기 화면에 필요한 정보만 준다. */
const waitingView = (b: Broadcast, owner: OwnerRef) => ({
  id: b.id,
  title: b.title,
  status: b.status,
  owner,
  isOwner: false,
});

export function createBroadcastService(deps: Deps) {
  const { db, redis, clock, log } = deps;

  async function findWithOwner(id: string) {
    const [row] = await db
      .select({ b: broadcasts, owner: { id: users.id, nickname: users.nickname } })
      .from(broadcasts)
      .innerJoin(users, eq(users.id, broadcasts.ownerId))
      .where(and(eq(broadcasts.id, id), isNull(broadcasts.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  async function mustFind(id: string) {
    const row = await findWithOwner(id);
    if (!row) throw notFound('BROADCAST_NOT_FOUND', '방송을 찾을 수 없습니다.');
    return row;
  }

  async function mustOwn(id: string, userId: string) {
    const row = await mustFind(id);
    if (row.b.ownerId !== userId) throw forbidden('BROADCAST_NOT_OWNER', '방송 소유자만 할 수 있습니다.');
    return row;
  }

  async function kick(pathName: string) {
    try {
      await deps.media.kickPublisher(pathName);
    } catch (err) {
      // 인증 훅이 재연결을 막고, 정합성 정리가 1분 안에 다시 끊는다.
      log.warn({ err, pathName }, 'failed to kick publisher; reconcile will retry');
    }
  }

  /**
   * LIVE → ENDED. 기대 상태일 때만 바꾸므로 종료 버튼과 훅이 동시에 와도 한 번만 처리된다.
   * DB 를 먼저 바꾼 뒤 송출을 끊는다.
   */
  async function end(id: string, reason: EndReason): Promise<Broadcast | null> {
    const now = clock();
    const [ended] = await db
      .update(broadcasts)
      .set({ status: 'ENDED', endedAt: now, endReason: reason, updatedAt: now })
      .where(and(eq(broadcasts.id, id), eq(broadcasts.status, 'LIVE')))
      .returning();
    if (!ended) return null;
    log.info({ broadcastId: id, reason }, 'broadcast ended');
    await redis.del(absentKey(id));
    await kick(ended.pathName);
    await publishEvent(deps, id, 'broadcast.ended', { id, reason, endedAt: ended.endedAt });
    if (ended.firstPublishedAt) await deps.jobs.enqueueProcessRecording(id);
    return ended;
  }

  /** 송출이 한 번도 붙지 않은 채 시작 후 2분이 지났으면 READY 로 되돌린다. 한 방향 원칙의 유일한 예외다. */
  async function revertIfNeverPublished(id: string): Promise<boolean> {
    const cutoff = new Date(clock().getTime() - START_TIMEOUT_MS);
    const [reverted] = await db
      .update(broadcasts)
      .set({ status: 'READY', startedAt: null, source: null, updatedAt: clock() })
      .where(
        and(
          eq(broadcasts.id, id),
          eq(broadcasts.status, 'LIVE'),
          isNull(broadcasts.firstPublishedAt),
          lte(broadcasts.startedAt, cutoff),
        ),
      )
      .returning();
    if (!reverted) return false;
    log.info({ broadcastId: id }, 'broadcast reverted to READY (no publish within timeout)');
    await kick(reverted.pathName);
    await publishEvent(deps, id, 'broadcast.updated', { id, status: 'READY' });
    return true;
  }

  return {
    mustFind,
    mustOwn,
    end,
    revertIfNeverPublished,
    kick,

    async create(ownerId: string, input: { title: string; description?: string | null }) {
      const id = newId();
      const now = clock();
      const [b] = await db
        .insert(broadcasts)
        .values({
          id,
          ownerId,
          title: input.title,
          description: input.description ?? null,
          pathName: pathNameFor(id),
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return b!;
    },

    async detail(id: string, viewerId: string | null) {
      const { b, owner } = await mustFind(id);
      if (b.status === 'READY' && b.ownerId !== viewerId) return waitingView(b, owner);
      const [recording] = await db
        .select({ id: recordings.id, status: recordings.status })
        .from(recordings)
        .where(eq(recordings.broadcastId, id));
      const [total] = await db
        .select({ sum: sql<string>`coalesce(sum(${donations.amount}), 0)` })
        .from(donations)
        .where(and(eq(donations.broadcastId, id), eq(donations.status, 'DONE')));
      return {
        ...fullView(b, owner, viewerId),
        viewerCount: b.status === 'LIVE' ? await viewerCount(deps, id) : 0,
        donationTotal: Number(total?.sum ?? 0),
        recording: recording ?? null,
      };
    },

    async update(id: string, userId: string, patch: { title?: string; description?: string | null }) {
      const { owner } = await mustOwn(id, userId);
      const [b] = await db
        .update(broadcasts)
        .set({ ...patch, updatedAt: clock() })
        .where(and(eq(broadcasts.id, id), isNull(broadcasts.deletedAt)))
        .returning();
      if (!b) throw notFound('BROADCAST_NOT_FOUND', '방송을 찾을 수 없습니다.');
      await publishEvent(deps, id, 'broadcast.updated', {
        id,
        title: b.title,
        description: b.description,
        status: b.status,
      });
      return fullView(b, owner, userId);
    },

    /** soft delete. LIVE 면 먼저 종료한다. 녹화와 후원 내역은 남기고 목록과 상세에서만 숨긴다. */
    async remove(id: string, userId: string) {
      const { b } = await mustOwn(id, userId);
      if (b.status === 'LIVE') await end(id, 'DELETED');
      await db
        .update(broadcasts)
        .set({ deletedAt: clock(), updatedAt: clock() })
        .where(and(eq(broadcasts.id, id), isNull(broadcasts.deletedAt)));
      log.info({ broadcastId: id }, 'broadcast deleted');
    },

    async start(id: string, userId: string, source: 'SCREEN' | 'CAMERA') {
      const { b: current, owner } = await mustOwn(id, userId);
      if (current.status !== 'READY') throw conflict('BROADCAST_NOT_READY', 'READY 상태의 방송만 시작할 수 있습니다.');
      const now = clock();
      let started: Broadcast | undefined;
      try {
        [started] = await db
          .update(broadcasts)
          .set({ status: 'LIVE', source, startedAt: now, firstPublishedAt: null, updatedAt: now })
          .where(and(eq(broadcasts.id, id), eq(broadcasts.status, 'READY'), isNull(broadcasts.deletedAt)))
          .returning();
      } catch (err) {
        if (uniqueViolation(err) === 'one_live_per_owner') {
          throw conflict('ALREADY_LIVE', '이미 진행 중인 방송이 있습니다. 먼저 종료해 주세요.');
        }
        throw err;
      }
      if (!started) throw conflict('BROADCAST_NOT_READY', 'READY 상태의 방송만 시작할 수 있습니다.');
      await redis.del(absentKey(id));
      const token = await issuePublishToken(redis, id, userId);
      await deps.jobs.scheduleStartTimeout(id, START_TIMEOUT_MS);
      await publishEvent(deps, id, 'broadcast.updated', { id, status: 'LIVE', title: started.title });
      log.info({ broadcastId: id, source }, 'broadcast started');
      return {
        broadcast: fullView(started, owner, userId),
        token,
        whipUrl: `${deps.config.appUrl}/media/${started.pathName}/whip`,
      };
    },

    async endByOwner(id: string, userId: string) {
      const { owner } = await mustOwn(id, userId);
      const ended = await end(id, 'OWNER');
      if (!ended) throw conflict('BROADCAST_NOT_LIVE', 'LIVE 상태의 방송만 종료할 수 있습니다.');
      return fullView(ended, owner, userId);
    },

    async reissuePublishToken(id: string, userId: string) {
      const { b } = await mustOwn(id, userId);
      if (b.status !== 'LIVE') throw conflict('BROADCAST_NOT_LIVE', 'LIVE 상태의 방송만 송출할 수 있습니다.');
      return {
        token: await issuePublishToken(redis, id, userId),
        whipUrl: `${deps.config.appUrl}/media/${b.pathName}/whip`,
      };
    },

    // ── MediaMTX 훅과 지연 작업 ─────────────────────────────────────────

    /** 송출이 붙었다(runOnOnline). 첫 송출 시각을 처음 한 번만 남기고 녹화를 시작한다. */
    async onPublisherReady(id: string) {
      const row = await db.query.broadcasts.findFirst({ where: eq(broadcasts.id, id) });
      if (!row) return;
      if (row.status !== 'LIVE' || row.deletedAt) {
        // 종료 직후 경합으로 붙은 송출이다. 인증 훅이 막지만 혹시 붙었다면 끊는다.
        await kick(row.pathName);
        return;
      }
      await redis.del(absentKey(id));
      await deps.jobs.cancelEndIfAbsent(id);
      await db
        .update(broadcasts)
        .set({ firstPublishedAt: clock(), updatedAt: clock() })
        .where(and(eq(broadcasts.id, id), eq(broadcasts.status, 'LIVE'), isNull(broadcasts.firstPublishedAt)));
      await db
        .insert(recordings)
        .values({ id: newId(), broadcastId: id, status: 'RECORDING', createdAt: clock(), updatedAt: clock() })
        .onConflictDoNothing({ target: recordings.broadcastId });
      log.info({ broadcastId: id }, 'publisher ready');
    },

    /** 송출이 끊겼다(runOnOffline). 30초 유예 작업을 건다. */
    async onPublisherGone(id: string) {
      const row = await db.query.broadcasts.findFirst({ where: eq(broadcasts.id, id) });
      if (!row || row.status !== 'LIVE') return;
      await redis.set(absentKey(id), String(clock().getTime()), 'EX', 600);
      await deps.jobs.scheduleEndIfAbsent(id, DISCONNECT_GRACE_MS);
      log.info({ broadcastId: id }, 'publisher gone; grace period started');
    },

    /** 끊긴 지 30초가 지나도 송출자가 없으면 ENDED(DISCONNECTED). */
    async endIfAbsent(id: string) {
      const row = await db.query.broadcasts.findFirst({ where: eq(broadcasts.id, id) });
      if (!row || row.status !== 'LIVE') return;
      const state = await deps.media.getPathState(row.pathName);
      if (state.hasPublisher) {
        await redis.del(absentKey(id));
        return;
      }
      const since = await redis.get(absentKey(id));
      if (since && clock().getTime() - Number(since) < DISCONNECT_GRACE_MS) return; // 더 늦은 작업이 다시 확인한다.
      if (!row.firstPublishedAt) return; // 송출이 한 번도 없었다면 시작 타임아웃이 처리한다.
      await end(id, 'DISCONNECTED');
    },

    /** 2분 안에 송출이 붙지 않았으면 READY 로 되돌린다. */
    async startTimeout(id: string) {
      await revertIfNeverPublished(id);
    },

    /** 판단의 기준인 DB 상태 목록. 정합성 정리가 쓴다. */
    async listLive() {
      return db.select().from(broadcasts).where(eq(broadcasts.status, 'LIVE')).orderBy(desc(broadcasts.id));
    },

    async absentSince(id: string): Promise<number | null> {
      const v = await redis.get(absentKey(id));
      return v ? Number(v) : null;
    },
  };
}

export type BroadcastService = ReturnType<typeof createBroadcastService>;
