/**
 * worker: app 과 같은 이미지를 다른 실행 명령으로 띄운다.
 * 지연 작업(30초 유예 종료, 2분 시작 타임아웃), 녹화 처리, 반복 작업(정합성 정리, 후원 정리, DB 백업)을 처리한다.
 */
import { Queue, Worker, type Job } from 'bullmq';
import { createProductionDeps } from '@/server/container';
import { backupDatabase } from '@/server/jobs/db-backup';
import { createJobHandlers } from '@/server/jobs/handlers';
import {
  BROADCAST_QUEUE,
  MAINTENANCE_QUEUE,
  RECORDING_ATTEMPTS,
  RECORDING_QUEUE,
  connectionFrom,
} from '@/server/jobs/queues';

const { deps, store, close } = createProductionDeps(undefined, 'worker');
const { log, config } = deps;
const handlers = createJobHandlers(deps);
const connection = connectionFrom(config.redisUrl);

const broadcastWorker = new Worker(
  BROADCAST_QUEUE,
  async (job: Job) => {
    switch (job.name) {
      case 'end-if-absent':
        return handlers.endIfAbsent(job.data);
      case 'start-timeout':
        return handlers.startTimeout(job.data);
      case 'reconcile':
        return handlers.reconcile();
      case 'donation-sweep':
        return handlers.donationSweep();
      default:
        log.warn({ name: job.name }, 'unknown broadcast job');
    }
  },
  { connection, concurrency: 4 },
);

// ffmpeg 는 1 OCPU 를 나눠 쓰므로 한 번에 하나만 돌린다.
const recordingWorker = new Worker(
  RECORDING_QUEUE,
  async (job: Job<{ broadcastId: string }>) =>
    handlers.processRecording(job.data, {
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts ?? RECORDING_ATTEMPTS,
    }),
  { connection, concurrency: 1, lockDuration: 10 * 60 * 1000 },
);

const maintenanceWorker = new Worker(
  MAINTENANCE_QUEUE,
  async (job: Job) => {
    if (job.name === 'db-backup') return backupDatabase(config.databaseUrl, store, log);
  },
  { connection, concurrency: 1 },
);

for (const w of [broadcastWorker, recordingWorker, maintenanceWorker]) {
  w.on('failed', (job, err) => log.error({ err, job: job?.name, jobId: job?.id }, 'job failed'));
}

async function scheduleRepeatables() {
  const broadcastQueue = new Queue(BROADCAST_QUEUE, { connection });
  const maintenanceQueue = new Queue(MAINTENANCE_QUEUE, { connection });
  await broadcastQueue.upsertJobScheduler('reconcile', { every: 60_000 }, { name: 'reconcile' });
  await broadcastQueue.upsertJobScheduler('donation-sweep', { every: 5 * 60_000 }, { name: 'donation-sweep' });
  await maintenanceQueue.upsertJobScheduler('db-backup', { pattern: '0 30 18 * * *' }, { name: 'db-backup' }); // 매일 03:30 KST
  await Promise.all([broadcastQueue.close(), maintenanceQueue.close()]);
}

scheduleRepeatables()
  .then(() => log.info('worker started'))
  .catch((err) => {
    log.error({ err }, 'failed to schedule repeatable jobs');
    process.exit(1);
  });

async function shutdown(signal: string) {
  log.info({ signal }, 'worker shutting down');
  await Promise.all([broadcastWorker.close(), recordingWorker.close(), maintenanceWorker.close()]);
  await close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
