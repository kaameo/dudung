import type { Redis } from 'ioredis';
import { tooManyRequests } from '@/server/common/errors';

/** 고정 창(1분) 카운터. 한도를 넘으면 429. */
export async function enforceRateLimit(
  redis: Redis,
  route: string,
  subject: string,
  limit: number,
  windowSec = 60,
): Promise<void> {
  const key = `rl:${route}:${subject}`;
  const [[, count]] = (await redis.multi().incr(key).expire(key, windowSec, 'NX').exec()) as [
    [Error | null, number],
    [Error | null, number],
  ];
  if (count > limit) throw tooManyRequests();
}
