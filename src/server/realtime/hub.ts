import type { Redis } from 'ioredis';
import type { Deps } from '@/server/ports';

/** 방송별 실시간 이벤트 이름. 시청 화면이 EventSource 로 구독한다. */
export type BroadcastEventType =
  | 'comment.created'
  | 'comment.updated'
  | 'comment.deleted'
  | 'donation.created'
  | 'broadcast.updated'
  | 'broadcast.ended'
  | 'viewers';

export const channelOf = (broadcastId: string) => `bc:${broadcastId}`;

/** DB 반영 뒤에 부른다. 앱 인스턴스가 여러 개여도 Redis 를 거쳐 모든 SSE 연결로 전달된다. */
export async function publishEvent(
  deps: Pick<Deps, 'redis' | 'log'>,
  broadcastId: string,
  type: BroadcastEventType,
  data: unknown,
): Promise<void> {
  try {
    await deps.redis.publish(channelOf(broadcastId), JSON.stringify({ type, data }));
  } catch (err) {
    // 알림 실패가 쓰기 요청을 실패시키지는 않는다. 클라이언트는 재연결 때 목록 API로 보정한다.
    deps.log.warn({ err, broadcastId, type }, 'failed to publish realtime event');
  }
}

type Listener = (event: { type: BroadcastEventType; data: unknown }) => void;

/**
 * 프로세스당 구독 연결 하나로 여러 SSE 연결에 이벤트를 나눠 준다.
 * 채널의 첫 구독자가 생기면 SUBSCRIBE, 마지막 구독자가 떠나면 UNSUBSCRIBE 한다.
 */
export class RealtimeHub {
  private sub: Redis | null = null;
  private listeners = new Map<string, Set<Listener>>();

  constructor(private readonly createSubscriber: () => Redis) {}

  private connection(): Redis {
    if (!this.sub) {
      this.sub = this.createSubscriber();
      this.sub.on('message', (channel: string, message: string) => {
        const set = this.listeners.get(channel);
        if (!set) return;
        let parsed: { type: BroadcastEventType; data: unknown };
        try {
          parsed = JSON.parse(message);
        } catch {
          return;
        }
        for (const l of set) l(parsed);
      });
    }
    return this.sub;
  }

  /** 구독이 Redis 에 등록된 뒤에 돌아온다. 돌려받은 함수로 구독을 푼다. */
  async subscribe(broadcastId: string, listener: Listener): Promise<() => void> {
    const channel = channelOf(broadcastId);
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
      set.add(listener);
      await this.connection().subscribe(channel);
    } else {
      set.add(listener);
    }
    return () => {
      const s = this.listeners.get(channel);
      if (!s) return;
      s.delete(listener);
      if (s.size === 0) {
        this.listeners.delete(channel);
        this.sub?.unsubscribe(channel).catch(() => {});
      }
    };
  }
}
