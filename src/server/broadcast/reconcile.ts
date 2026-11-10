import { sql } from 'drizzle-orm';
import { broadcastIdFromPath } from '@/server/media/gateway';
import type { Deps } from '@/server/ports';
import { DISCONNECT_GRACE_MS, START_TIMEOUT_MS, type BroadcastService } from './service';

const RECONCILE_LOCK_KEY = 7_400_001;

/**
 * DB 와 MediaMTX 의 상태를 맞춘다. 워커가 1분마다 돌리고, 여러 워커 중 advisory lock 을 잡은 쪽만 처리한다.
 * - DB 는 LIVE 인데 송출자가 없다 → 시작 2분 이내·끊김 유예 30초 이내면 건너뛰고, 아니면 종료(RECONCILED)
 *   또는 송출이 한 번도 없었다면 READY 로 되돌린다.
 * - MediaMTX 에서는 송출 중인데 DB 는 LIVE 가 아니다 → 송출을 끊는다.
 */
export async function reconcile(deps: Deps, service: BroadcastService): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const rows = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(${RECONCILE_LOCK_KEY}) as locked`,
    );
    if (!rows[0]?.locked) return;

    const publishing = new Set(await deps.media.listPublishingPaths());
    const live = await service.listLive();
    const now = deps.clock().getTime();
    const stillLive = new Set<string>();

    for (const b of live) {
      if (publishing.has(b.pathName)) {
        stillLive.add(b.pathName);
        continue;
      }
      const startedAt = b.startedAt?.getTime() ?? 0;
      const absentSince = await service.absentSince(b.id);
      const skip =
        now - startedAt < START_TIMEOUT_MS || (absentSince !== null && now - absentSince < DISCONNECT_GRACE_MS);
      if (skip) {
        stillLive.add(b.pathName);
        continue;
      }
      deps.log.warn({ broadcastId: b.id }, 'reconcile: LIVE in DB without publisher');
      if (b.firstPublishedAt) await service.end(b.id, 'RECONCILED');
      else await service.revertIfNeverPublished(b.id);
    }

    for (const pathName of publishing) {
      if (stillLive.has(pathName)) continue;
      const id = broadcastIdFromPath(pathName);
      if (id && live.some((b) => b.id === id)) continue;
      deps.log.warn({ pathName }, 'reconcile: publisher without LIVE broadcast; kicking');
      await service.kick(pathName);
    }
  });
}
