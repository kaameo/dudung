import { sql } from 'drizzle-orm';
import type { Db } from '@/server/common/db';
import { broadcasts, recordings, users } from '@/server/db/schema';
import { DISABLED_PASSWORD, hashPassword } from '@/server/auth/password';

export const TEST_ACCOUNTS = ['streamer1', 'streamer2', 'streamer3', 'viewer1', 'viewer2'] as const;
export type TestAccount = (typeof TEST_ACCOUNTS)[number];
export const TEST_PASSWORD = 'dudung1234!';

/** 로그인할 수 없는 demo 계정과 그 소유의 종료된 방송·녹화. 다른 사용자 방송과 다시보기 예시로 쓴다. */
export const DEMO_USER_ID = '01930000-0000-7000-8000-00000000d001';
export const DEMO_BROADCAST_ID = '01930000-0000-7000-8000-00000000b001';
export const DEMO_RECORDING_ID = '01930000-0000-7000-8000-00000000a001';
export const DEMO_RECORDING_KEY = 'recordings/demo.mp4';

const accountIds: Record<TestAccount, string> = {
  streamer1: '01930000-0000-7000-8000-000000000101',
  streamer2: '01930000-0000-7000-8000-000000000102',
  streamer3: '01930000-0000-7000-8000-000000000103',
  viewer1: '01930000-0000-7000-8000-000000000201',
  viewer2: '01930000-0000-7000-8000-000000000202',
};

let cachedHash: string | null = null;

/**
 * 고정 계정과 demo 데이터를 넣는다. 여러 번 실행해도 결과가 같다.
 * passwordHashCache 는 테스트에서 매번 argon2 를 다시 돌리지 않기 위한 옵션이다.
 */
export async function seed(
  db: Db,
  opts: { passwordHashCache?: boolean; demoRecording?: { sizeBytes: number; durationSec: number } } = {},
) {
  const hash = opts.passwordHashCache && cachedHash ? cachedHash : await hashPassword(TEST_PASSWORD);
  if (opts.passwordHashCache) cachedHash = hash;

  for (const account of TEST_ACCOUNTS) {
    await db
      .insert(users)
      .values({ id: accountIds[account], email: `${account}@dudung.test`, nickname: account, passwordHash: hash })
      .onConflictDoUpdate({ target: users.email, set: { passwordHash: hash } });
  }

  await db
    .insert(users)
    .values({ id: DEMO_USER_ID, email: 'demo@dudung.test', nickname: 'demo', passwordHash: DISABLED_PASSWORD })
    .onConflictDoNothing();

  const startedAt = new Date('2026-11-01T11:00:00.000Z');
  await db
    .insert(broadcasts)
    .values({
      id: DEMO_BROADCAST_ID,
      ownerId: DEMO_USER_ID,
      title: '[예시] 두둥 첫 방송 다시보기',
      description: 'seed 로 넣은 종료된 방송입니다. demo 계정은 로그인할 수 없어서 아무도 수정·삭제할 수 없습니다.',
      status: 'ENDED',
      source: 'SCREEN',
      pathName: `live/${DEMO_BROADCAST_ID}`,
      startedAt,
      firstPublishedAt: startedAt,
      endedAt: new Date(startedAt.getTime() + 20_000),
      endReason: 'OWNER',
      createdAt: new Date('2026-11-01T10:55:00.000Z'),
      updatedAt: startedAt,
    })
    .onConflictDoNothing();

  const demo = opts.demoRecording ?? { sizeBytes: 5 * 1024 * 1024, durationSec: 20 };
  await db
    .insert(recordings)
    .values({
      id: DEMO_RECORDING_ID,
      broadcastId: DEMO_BROADCAST_ID,
      status: 'READY',
      s3Key: DEMO_RECORDING_KEY,
      sizeBytes: demo.sizeBytes,
      durationSec: demo.durationSec,
      createdAt: new Date('2026-11-01T11:00:30.000Z'),
    })
    .onConflictDoUpdate({
      target: recordings.broadcastId,
      set: { sizeBytes: sql`excluded.size_bytes`, durationSec: sql`excluded.duration_sec` },
    });
}
