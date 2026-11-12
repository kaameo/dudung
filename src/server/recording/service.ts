import { and, asc, desc, eq, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { conflict, forbidden, notFound } from '@/server/common/errors';
import { broadcasts, recordings, users } from '@/server/db/schema';
import type { Deps } from '@/server/ports';
import { DEMO_USER_ID } from '@/server/seed';

/** 방송당 녹화 최대 길이. 넘는 부분은 잘라낸다. */
export const MAX_RECORDING_SEC = 60 * 60;
export const PLAYBACK_URL_TTL_SEC = 60 * 60;

const listColumns = {
  id: recordings.id,
  broadcastId: recordings.broadcastId,
  durationSec: recordings.durationSec,
  s3Key: recordings.s3Key,
  createdAt: recordings.createdAt,
  title: broadcasts.title,
  description: broadcasts.description,
  startedAt: broadcasts.startedAt,
  endedAt: broadcasts.endedAt,
  ownerId: users.id,
  ownerNickname: users.nickname,
};

interface Row {
  id: string;
  broadcastId: string;
  durationSec: number | null;
  title: string;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  ownerId: string;
  ownerNickname: string;
}

const view = (r: Row) => ({
  id: r.id,
  broadcastId: r.broadcastId,
  title: r.title,
  durationSec: r.durationSec,
  owner: { id: r.ownerId, nickname: r.ownerNickname },
  startedAt: r.startedAt,
  endedAt: r.endedAt,
  createdAt: r.createdAt,
});

export function createRecordingService(deps: Deps) {
  const { db, clock, log, storage } = deps;

  /** 다시보기에 보여도 되는 녹화: READY 이고 방송이 삭제되지 않았다. */
  const visible = and(eq(recordings.status, 'READY'), isNull(broadcasts.deletedAt));

  /** READY 크기 합이 상한을 넘으면 demo 를 제외하고 가장 오래된 녹화부터 객체와 행을 지운다. */
  async function enforceCapacity() {
    const [sum] = await db
      .select({ total: sql<string>`coalesce(sum(${recordings.sizeBytes}), 0)` })
      .from(recordings)
      .where(eq(recordings.status, 'READY'));
    let total = Number(sum?.total ?? 0);
    const cap = deps.config.recordingCapBytes;
    if (total <= cap) return;

    const candidates = await db
      .select({ id: recordings.id, key: recordings.s3Key, size: recordings.sizeBytes })
      .from(recordings)
      .innerJoin(broadcasts, eq(broadcasts.id, recordings.broadcastId))
      .where(and(eq(recordings.status, 'READY'), ne(broadcasts.ownerId, DEMO_USER_ID)))
      .orderBy(asc(recordings.createdAt), asc(recordings.id));
    for (const c of candidates) {
      if (total <= cap) break;
      if (c.key) await storage.deleteObject(c.key);
      await db.delete(recordings).where(eq(recordings.id, c.id));
      total -= c.size ?? 0;
      log.info({ recordingId: c.id, freedBytes: c.size }, 'recording evicted by capacity policy');
    }
  }

  return {
    /**
     * 처리 작업: PROCESSING → 조각을 합쳐 올림 → READY. 마지막 시도까지 실패하면 FAILED.
     * 같은 작업이 다시 와도 이미 끝난 녹화는 건드리지 않는다.
     */
    async process(broadcastId: string, attempt: { attempt: number; maxAttempts: number }) {
      const rec = await db.query.recordings.findFirst({ where: eq(recordings.broadcastId, broadcastId) });
      if (!rec || rec.status === 'READY' || rec.status === 'FAILED') return;
      const b = await db.query.broadcasts.findFirst({ where: eq(broadcasts.id, broadcastId) });
      if (!b || b.status !== 'ENDED') return;

      await db
        .update(recordings)
        .set({ status: 'PROCESSING', updatedAt: clock() })
        .where(eq(recordings.id, rec.id));
      try {
        const out = await storage.mergeAndUpload({
          broadcastId,
          pathName: b.pathName,
          maxDurationSec: MAX_RECORDING_SEC,
        });
        await db
          .update(recordings)
          .set({
            status: 'READY',
            s3Key: out.key,
            sizeBytes: out.sizeBytes,
            durationSec: Math.min(Math.round(out.durationSec), MAX_RECORDING_SEC),
            error: null,
            updatedAt: clock(),
          })
          .where(eq(recordings.id, rec.id));
        log.info({ broadcastId, sizeBytes: out.sizeBytes, durationSec: out.durationSec }, 'recording ready');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const final = attempt.attempt >= attempt.maxAttempts;
        await db
          .update(recordings)
          .set({ status: final ? 'FAILED' : 'PROCESSING', error: message.slice(0, 500), updatedAt: clock() })
          .where(eq(recordings.id, rec.id));
        log.error({ err, broadcastId, attempt: attempt.attempt, final }, 'recording processing failed');
        throw err;
      }
      await enforceCapacity();
    },

    async list(limit: number, cursorId: string | null) {
      const rows = await db
        .select(listColumns)
        .from(recordings)
        .innerJoin(broadcasts, eq(broadcasts.id, recordings.broadcastId))
        .innerJoin(users, eq(users.id, broadcasts.ownerId))
        .where(and(visible, cursorId ? lt(recordings.id, cursorId) : undefined))
        .orderBy(desc(recordings.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      return { items: page.map(view), nextId: rows.length > limit ? page[page.length - 1]!.id : null };
    },

    /**
     * 방송 소유자가 다시보기를 지운다. 처리가 끝난(READY·FAILED) 녹화만 지울 수 있다.
     * 행을 먼저 지운 뒤 저장소 객체를 지운다. 객체 삭제가 실패해도 화면에는 다시 나타나지 않는다.
     */
    async remove(id: string, userId: string) {
      const [row] = await db
        .select({ status: recordings.status, ownerId: broadcasts.ownerId })
        .from(recordings)
        .innerJoin(broadcasts, eq(broadcasts.id, recordings.broadcastId))
        .where(and(eq(recordings.id, id), isNull(broadcasts.deletedAt)));
      if (!row) throw notFound('RECORDING_NOT_FOUND', '다시보기를 찾을 수 없습니다.');
      if (row.ownerId !== userId) throw forbidden('RECORDING_NOT_OWNER', '방송 소유자만 다시보기를 지울 수 있습니다.');
      const [deleted] = await db
        .delete(recordings)
        .where(and(eq(recordings.id, id), inArray(recordings.status, ['READY', 'FAILED'])))
        .returning();
      if (!deleted) throw conflict('RECORDING_IN_PROGRESS', '녹화를 처리하는 중이라 지금은 지울 수 없습니다.');
      if (deleted.s3Key) {
        try {
          await storage.deleteObject(deleted.s3Key);
        } catch (err) {
          log.error({ err, key: deleted.s3Key }, 'failed to delete recording object; orphan left in storage');
        }
      }
      log.info({ recordingId: id, broadcastId: deleted.broadcastId }, 'recording deleted by owner');
    },

    async detail(id: string) {
      const [row] = await db
        .select(listColumns)
        .from(recordings)
        .innerJoin(broadcasts, eq(broadcasts.id, recordings.broadcastId))
        .innerJoin(users, eq(users.id, broadcasts.ownerId))
        .where(and(eq(recordings.id, id), visible));
      if (!row?.s3Key) throw notFound('RECORDING_NOT_FOUND', '다시보기를 찾을 수 없습니다.');
      return {
        ...view(row),
        description: row.description,
        playbackUrl: await storage.presignedUrl(row.s3Key, PLAYBACK_URL_TTL_SEC),
        playbackUrlExpiresInSec: PLAYBACK_URL_TTL_SEC,
      };
    },
  };
}

export type RecordingService = ReturnType<typeof createRecordingService>;
