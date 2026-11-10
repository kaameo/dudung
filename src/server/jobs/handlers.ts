import { reconcile } from '@/server/broadcast/reconcile';
import { createBroadcastService } from '@/server/broadcast/service';
import { createDonationService } from '@/server/donation/service';
import type { Deps } from '@/server/ports';
import { createRecordingService } from '@/server/recording/service';

/**
 * 워커 작업 처리기. BullMQ 워커가 부르고, 테스트는 시간 경과를 흉내 내며 직접 부른다.
 */
export function createJobHandlers(deps: Deps) {
  const broadcasts = createBroadcastService(deps);
  const donations = createDonationService(deps, broadcasts);
  const recordings = createRecordingService(deps);
  return {
    endIfAbsent: (data: { broadcastId: string }) => broadcasts.endIfAbsent(data.broadcastId),
    startTimeout: (data: { broadcastId: string }) => broadcasts.startTimeout(data.broadcastId),
    reconcile: () => reconcile(deps, broadcasts),
    donationSweep: () => donations.sweep(),
    processRecording: (data: { broadcastId: string }, attempt: { attempt: number; maxAttempts: number }) =>
      recordings.process(data.broadcastId, attempt),
  };
}

export type JobHandlers = ReturnType<typeof createJobHandlers>;
