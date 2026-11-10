import type { Redis } from 'ioredis';
import { isUuid, randomToken } from '@/server/common/ids';
import type { Deps } from '@/server/ports';

export const PUBLISH_TOKEN_TTL_SEC = 15 * 60;
const pubKey = (token: string) => `media:pub:${token}`;

export const pathNameFor = (broadcastId: string) => `live/${broadcastId}`;

/** MediaMTX 경로 이름(live/{uuid})에서 방송 ID를 꺼낸다. 형식이 다르면 null. */
export function broadcastIdFromPath(pathName: string | null | undefined): string | null {
  const m = /^live\/([0-9a-f-]{36})$/i.exec(pathName ?? '');
  return m && isUuid(m[1]!) ? m[1]!.toLowerCase() : null;
}

/** 송출 토큰은 연결을 맺을 때만 쓴다. 송출 중에 만료돼도 연결은 유지된다. */
export async function issuePublishToken(redis: Redis, broadcastId: string, userId: string): Promise<string> {
  const token = randomToken(24);
  await redis.set(pubKey(token), JSON.stringify({ broadcastId, userId }), 'EX', PUBLISH_TOKEN_TTL_SEC);
  return token;
}

export async function readPublishToken(
  redis: Redis,
  token: string,
): Promise<{ broadcastId: string; userId: string } | null> {
  const raw = await redis.get(pubKey(token));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 시청자 수는 Control API 결과를 5초 캐시한다. */
export async function viewerCount(deps: Pick<Deps, 'redis' | 'media' | 'log'>, broadcastId: string): Promise<number> {
  const key = `viewers:${broadcastId}`;
  const cached = await deps.redis.get(key);
  if (cached !== null) return Number(cached);
  try {
    const { readers } = await deps.media.getPathState(pathNameFor(broadcastId));
    await deps.redis.set(key, String(readers), 'EX', 5);
    return readers;
  } catch (err) {
    deps.log.warn({ err, broadcastId }, 'failed to read viewer count');
    return 0;
  }
}
