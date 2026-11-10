import { Queue, type ConnectionOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import type { JobScheduler } from '@/server/ports';

export const BROADCAST_QUEUE = 'broadcast';
export const RECORDING_QUEUE = 'recording';
export const MAINTENANCE_QUEUE = 'maintenance';

export const RECORDING_ATTEMPTS = 3;

/** BullMQ 는 커스텀 job ID 에 ':' 를 허용하지 않는다. */
const endJobKey = (id: string) => `media:endjob:${id}`;

export function connectionFrom(url: string): ConnectionOptions {
  return { url, maxRetriesPerRequest: null } as ConnectionOptions;
}

/** 앱에서 지연·비동기 작업을 거는 쪽. 처리는 worker 프로세스가 한다. */
export class BullJobScheduler implements JobScheduler {
  private readonly broadcast: Queue;
  private readonly recording: Queue;

  constructor(
    connection: ConnectionOptions,
    private readonly redis: Redis,
  ) {
    this.broadcast = new Queue(BROADCAST_QUEUE, { connection });
    this.recording = new Queue(RECORDING_QUEUE, { connection });
  }

  async scheduleEndIfAbsent(broadcastId: string, delayMs: number) {
    const job = await this.broadcast.add(
      'end-if-absent',
      { broadcastId },
      { delay: delayMs, jobId: `eia-${broadcastId}-${Date.now()}`, removeOnComplete: true, removeOnFail: 100 },
    );
    if (job.id) await this.redis.set(endJobKey(broadcastId), job.id, 'EX', 600);
  }

  async cancelEndIfAbsent(broadcastId: string) {
    const jobId = await this.redis.get(endJobKey(broadcastId));
    if (!jobId) return;
    await this.broadcast.remove(jobId).catch(() => 0);
    await this.redis.del(endJobKey(broadcastId));
  }

  async scheduleStartTimeout(broadcastId: string, delayMs: number) {
    await this.broadcast.add(
      'start-timeout',
      { broadcastId },
      { delay: delayMs, jobId: `st-${broadcastId}-${Date.now()}`, removeOnComplete: true, removeOnFail: 100 },
    );
  }

  async enqueueProcessRecording(broadcastId: string) {
    await this.recording.add(
      'process-recording',
      { broadcastId },
      {
        jobId: `rec-${broadcastId}`,
        attempts: RECORDING_ATTEMPTS,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  }

  async close() {
    await Promise.all([this.broadcast.close(), this.recording.close()]);
  }
}
