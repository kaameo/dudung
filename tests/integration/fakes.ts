import {
  TossError,
  type JobScheduler,
  type MediaControl,
  type PaymentGateway,
  type RecordingStorage,
  type TossPayment,
} from '@/server/ports';

export class FakeClock {
  private t = new Date('2026-11-12T03:00:00.000Z').getTime();
  now = () => new Date(this.t);
  advance(ms: number) {
    this.t += ms;
  }
  advanceSeconds(s: number) {
    this.advance(s * 1000);
  }
}

/** MediaMTX 가짜. 경로별 송출자 유무와 시청자 수를 테스트가 정한다. */
export class FakeMediaControl implements MediaControl {
  private publishers = new Set<string>();
  private readers = new Map<string, number>();
  kicked: string[] = [];
  failKick = false;

  setPublishing(pathName: string, on: boolean) {
    if (on) this.publishers.add(pathName);
    else this.publishers.delete(pathName);
  }
  setReaders(pathName: string, n: number) {
    this.readers.set(pathName, n);
  }
  async listPublishingPaths() {
    return [...this.publishers];
  }
  async getPathState(pathName: string) {
    return { hasPublisher: this.publishers.has(pathName), readers: this.readers.get(pathName) ?? 0 };
  }
  async kickPublisher(pathName: string) {
    if (this.failKick) throw new Error('mediamtx unreachable');
    this.kicked.push(pathName);
    this.publishers.delete(pathName);
  }
  async ping() {
    return true;
  }
}

/** 토스 가짜. 승인된 결제를 기억하고, 같은 결제를 다시 승인하면 ALREADY_PROCESSED_PAYMENT 를 낸다. */
export class FakePayments implements PaymentGateway {
  payments = new Map<string, TossPayment>();
  confirmCalls: Array<{ paymentKey: string; orderId: string; amount: number }> = [];
  /** 다음 getPayment 호출 n번을 실패시킨다. */
  failNextGets = 0;
  /** 승인 응답을 바꿔치기한다(위조·불일치 시나리오). */
  confirmOverride: ((input: { paymentKey: string; orderId: string; amount: number }) => TossPayment) | null =
    null;

  /** 승인 처리에 걸리는 시간. 이 사이에 같은 주문이 다시 오면 토스처럼 IDEMPOTENT_REQUEST_PROCESSING 을 낸다. */
  confirmDelayMs = 0;
  /** orderId 조회 API 를 실패시킨다(결제위젯 시크릿 키로는 이 API 를 쓸 수 없다). */
  failOrderLookup = false;
  private inflight = new Set<string>();

  async confirm(input: { paymentKey: string; orderId: string; amount: number }) {
    this.confirmCalls.push(input);
    if (this.confirmOverride) return this.confirmOverride(input);
    if (this.inflight.has(input.orderId)) {
      throw new TossError(409, 'IDEMPOTENT_REQUEST_PROCESSING', '이전 멱등 요청이 처리 중입니다.');
    }
    this.inflight.add(input.orderId);
    try {
      if (this.confirmDelayMs) await new Promise((r) => setTimeout(r, this.confirmDelayMs));
      return this.approve(input);
    } finally {
      this.inflight.delete(input.orderId);
    }
  }

  private approve(input: { paymentKey: string; orderId: string; amount: number }) {
    const existing = this.payments.get(input.paymentKey);
    if (existing) throw new TossError(400, 'ALREADY_PROCESSED_PAYMENT', '이미 처리된 결제 입니다.');
    const p: TossPayment = {
      paymentKey: input.paymentKey,
      orderId: input.orderId,
      totalAmount: input.amount,
      status: 'DONE',
      approvedAt: new Date().toISOString(),
    };
    this.payments.set(input.paymentKey, p);
    return p;
  }
  /** 브라우저 결제창에서 결제가 끝났지만 아직 서버 승인 전인 상태 대신, 토스 쪽에 이미 DONE으로 존재하는 결제를 만든다. */
  seedPayment(p: TossPayment) {
    this.payments.set(p.paymentKey, p);
  }
  async getPayment(paymentKey: string) {
    if (this.failNextGets > 0) {
      this.failNextGets--;
      throw new Error('toss unreachable');
    }
    const p = this.payments.get(paymentKey);
    if (!p) throw new TossError(404, 'NOT_FOUND_PAYMENT', '존재하지 않는 결제 입니다.');
    return p;
  }
  async getPaymentByOrderId(orderId: string) {
    if (this.failOrderLookup) throw new TossError(403, 'FORBIDDEN_REQUEST', '결제위젯 키로는 사용할 수 없는 API 입니다.');
    for (const p of this.payments.values()) if (p.orderId === orderId) return p;
    return null;
  }
}

export class FakeStorage implements RecordingStorage {
  /** 방송 ID별 합친 결과 크기. 정하지 않으면 1MB. */
  sizes = new Map<string, number>();
  failMerges = 0;
  uploaded: string[] = [];
  deleted: string[] = [];
  merges: Array<{ broadcastId: string; pathName: string; maxDurationSec: number }> = [];

  async mergeAndUpload(input: { broadcastId: string; pathName: string; maxDurationSec: number }) {
    this.merges.push(input);
    if (this.failMerges > 0) {
      this.failMerges--;
      throw new Error('ffmpeg failed');
    }
    const key = `recordings/${input.broadcastId}.mp4`;
    this.uploaded.push(key);
    return { key, sizeBytes: this.sizes.get(input.broadcastId) ?? 1024 * 1024, durationSec: 42 };
  }
  async deleteObject(key: string) {
    this.deleted.push(key);
  }
  async presignedUrl(key: string, expiresInSec: number) {
    return `https://storage.test/${key}?expires=${expiresInSec}`;
  }
}

export class FakeJobs implements JobScheduler {
  scheduled: Array<{ name: string; broadcastId: string; delayMs?: number }> = [];
  async scheduleEndIfAbsent(broadcastId: string, delayMs: number) {
    this.scheduled.push({ name: 'end-if-absent', broadcastId, delayMs });
  }
  async cancelEndIfAbsent(broadcastId: string) {
    this.scheduled.push({ name: 'cancel-end-if-absent', broadcastId });
  }
  async scheduleStartTimeout(broadcastId: string, delayMs: number) {
    this.scheduled.push({ name: 'start-timeout', broadcastId, delayMs });
  }
  async enqueueProcessRecording(broadcastId: string) {
    this.scheduled.push({ name: 'process-recording', broadcastId });
  }
}
