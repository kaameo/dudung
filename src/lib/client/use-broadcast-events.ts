'use client';
import { useEffect, useEffectEvent } from 'react';
import type { BroadcastDetail, CommentItem, DonationItem } from './types';

/** 서버가 보내는 방송별 이벤트와 그 내용. */
export interface BroadcastEvents {
  'comment.created': CommentItem;
  'comment.updated': CommentItem;
  'comment.deleted': { id: string };
  'donation.created': DonationItem;
  'broadcast.updated': Partial<BroadcastDetail> & { id: string };
  'broadcast.ended': { id: string; reason: string };
  viewers: { count: number };
}

type EventName = keyof BroadcastEvents;

export type BroadcastEventHandlers = { [K in EventName]?: (data: BroadcastEvents[K]) => void } & {
  /** 끊겼다가 다시 연결됐을 때. 빠진 댓글을 목록 API 로 보정한다. */
  reconnected?: () => void;
};

const EVENTS: EventName[] = [
  'comment.created',
  'comment.updated',
  'comment.deleted',
  'donation.created',
  'broadcast.updated',
  'broadcast.ended',
  'viewers',
];

/** 방송별 SSE 구독. EventSource 가 끊기면 브라우저가 알아서 다시 연결한다. */
export function useBroadcastEvents(broadcastId: string | null, handlers: BroadcastEventHandlers) {
  // 핸들러가 렌더마다 바뀌어도 연결을 다시 맺지 않고 최신 핸들러를 부른다.
  const dispatch = useEffectEvent(<K extends EventName>(name: K, data: BroadcastEvents[K]) => {
    (handlers[name] as ((d: BroadcastEvents[K]) => void) | undefined)?.(data);
  });
  const onReconnected = useEffectEvent(() => handlers.reconnected?.());

  useEffect(() => {
    if (!broadcastId) return;
    const es = new EventSource(`/api/broadcasts/${broadcastId}/events`);
    let hadError = false;
    es.addEventListener('open', () => {
      if (hadError) onReconnected();
      hadError = false;
    });
    es.addEventListener('error', () => {
      hadError = true;
    });
    for (const name of EVENTS) {
      es.addEventListener(name, (e) => {
        try {
          dispatch(name, JSON.parse((e as MessageEvent<string>).data));
        } catch {
          /* 잘못된 이벤트는 버린다. */
        }
      });
    }
    return () => es.close();
  }, [broadcastId]);
}
