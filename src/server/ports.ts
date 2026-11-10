/**
 * 앱 경계 밖과 이어지는 출구 어댑터(포트) 정의.
 * 운영에서는 HTTP·ffmpeg·S3·BullMQ 구현을, 테스트에서는 가짜 구현을 주입한다.
 */
import type { Redis } from 'ioredis';
import type { Db } from '@/server/common/db';
import type { AppConfig } from '@/server/common/config';
import type { Clock } from '@/server/common/ids';
import type { Logger } from '@/server/common/logger';

/** MediaMTX Control API. */
export interface MediaControl {
  /** 지금 송출자가 붙어 있는 경로 이름 목록. */
  listPublishingPaths(): Promise<string[]>;
  /** 경로의 송출자 유무와 시청 세션 수. 경로가 없으면 송출자 없음, 시청자 0. */
  getPathState(pathName: string): Promise<{ hasPublisher: boolean; readers: number }>;
  /** 경로의 송출 세션을 끊는다. 송출자가 없으면 아무 일도 하지 않는다. */
  kickPublisher(pathName: string): Promise<void>;
  ping(): Promise<boolean>;
}

export interface TossPayment {
  paymentKey: string;
  orderId: string;
  totalAmount: number;
  /** READY, IN_PROGRESS, WAITING_FOR_DEPOSIT, DONE, CANCELED, PARTIAL_CANCELED, ABORTED, EXPIRED */
  status: string;
  approvedAt?: string | null;
}

/** 토스 API가 돌려준 실패. code 는 토스 에러 코드(예: ALREADY_PROCESSED_PAYMENT)다. */
export class TossError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TossError';
  }
}

/** 토스페이먼츠 결제 API. */
export interface PaymentGateway {
  confirm(input: { paymentKey: string; orderId: string; amount: number }): Promise<TossPayment>;
  getPayment(paymentKey: string): Promise<TossPayment>;
  /** 주문이 없으면 null. */
  getPaymentByOrderId(orderId: string): Promise<TossPayment | null>;
}

/** 녹화 저장소: 서버에 쌓인 조각을 하나로 합쳐 올리고, 지우고, 재생 URL을 만든다. */
export interface RecordingStorage {
  mergeAndUpload(input: {
    broadcastId: string;
    pathName: string;
    maxDurationSec: number;
  }): Promise<{ key: string; sizeBytes: number; durationSec: number }>;
  deleteObject(key: string): Promise<void>;
  presignedUrl(key: string, expiresInSec: number): Promise<string>;
}

/** 지연·비동기 작업 등록. 운영은 BullMQ, 테스트는 기록만 하는 가짜 구현이다. */
export interface JobScheduler {
  scheduleEndIfAbsent(broadcastId: string, delayMs: number): Promise<void>;
  cancelEndIfAbsent(broadcastId: string): Promise<void>;
  scheduleStartTimeout(broadcastId: string, delayMs: number): Promise<void>;
  enqueueProcessRecording(broadcastId: string): Promise<void>;
}

export interface Deps {
  config: AppConfig;
  db: Db;
  redis: Redis;
  /** SSE 구독 전용 연결을 만든다. subscribe 모드 연결은 다른 명령을 못 쓰기 때문이다. */
  createSubscriber: () => Redis;
  log: Logger;
  clock: Clock;
  media: MediaControl;
  payments: PaymentGateway;
  storage: RecordingStorage;
  jobs: JobScheduler;
}
