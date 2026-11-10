import { Redis } from 'ioredis';
import { createApp, type App } from '@/server/app';
import { loadConfig, type AppConfig } from '@/server/common/config';
import { createDb } from '@/server/common/db';
import { systemClock } from '@/server/common/ids';
import { createLogger } from '@/server/common/logger';
import { TossPaymentsClient } from '@/server/donation/toss';
import { BullJobScheduler, connectionFrom } from '@/server/jobs/queues';
import { MediaMtxControl } from '@/server/media/mediamtx-control';
import { TossError, type Deps, type PaymentGateway } from '@/server/ports';
import { FfmpegRecordingStorage } from '@/server/recording/ffmpeg-storage';
import { ObjectStore } from '@/server/recording/object-store';

/** 결제 키가 없을 때. 후원 API 는 그 전에 503 을 돌려주므로 실제로 불리지 않는다. */
const disabledPayments: PaymentGateway = {
  confirm: async () => {
    throw new TossError(503, 'DONATIONS_DISABLED', '후원 기능이 설정되지 않았습니다.');
  },
  getPayment: async () => {
    throw new TossError(503, 'DONATIONS_DISABLED', '후원 기능이 설정되지 않았습니다.');
  },
  getPaymentByOrderId: async () => null,
};

/** 운영 의존성 묶음. app 과 worker 가 같은 방식으로 만든다. */
export function createProductionDeps(config: AppConfig = loadConfig(), service = 'app') {
  const log = createLogger(config.logLevel).child({ service });
  const { db, close: closeDb } = createDb(config.databaseUrl);
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 3 });
  const store = new ObjectStore(config.s3);
  const jobs = new BullJobScheduler(connectionFrom(config.redisUrl), redis);
  const subscribers: Redis[] = [];
  const deps: Deps = {
    config,
    db,
    redis,
    createSubscriber: () => {
      const r = new Redis(config.redisUrl);
      subscribers.push(r);
      return r;
    },
    log,
    clock: systemClock,
    media: new MediaMtxControl(config.mediamtxApiUrl, log),
    payments: config.toss.secretKey ? new TossPaymentsClient(config.toss.secretKey) : disabledPayments,
    storage: new FfmpegRecordingStorage(config.recordingsDir, store, log),
    jobs,
  };
  const close = async () => {
    await jobs.close();
    await Promise.all(subscribers.map((s) => s.quit().catch(() => {})));
    await redis.quit().catch(() => {});
    await closeDb();
  };
  return { deps, store, close };
}

const globalForApp = globalThis as unknown as { __dudungApp?: App; __dudungDeps?: Deps };

/** Next.js Route Handler 가 쓰는 앱 싱글턴. 개발 중 HMR 로 모듈이 다시 읽혀도 연결을 하나로 유지한다. */
export function getApp(): App {
  if (!globalForApp.__dudungApp) {
    const { deps } = createProductionDeps();
    globalForApp.__dudungDeps = deps;
    globalForApp.__dudungApp = createApp(deps);
  }
  return globalForApp.__dudungApp;
}

export function getDeps(): Deps {
  getApp();
  return globalForApp.__dudungDeps!;
}
