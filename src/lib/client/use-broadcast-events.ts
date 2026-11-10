'use client';
import { useEffect, useRef } from 'react';

export interface BroadcastEventHandlers {
  'comment.created'?: (data: any) => void;
  'comment.updated'?: (data: any) => void;
  'comment.deleted'?: (data: { id: string }) => void;
  'donation.created'?: (data: any) => void;
  'broadcast.updated'?: (data: any) => void;
  'broadcast.ended'?: (data: { id: string; reason: string }) => void;
  viewers?: (data: { count: number }) => void;
  /** 끊겼다가 다시 연결됐을 때. 빠진 댓글을 목록 API 로 보정한다. */
  reconnected?: () => void;
}

const EVENTS = [
  'comment.created',
  'comment.updated',
  'comment.deleted',
  'donation.created',
  'broadcast.updated',
  'broadcast.ended',
  'viewers',
] as const;

/** 방송별 SSE 구독. EventSource 가 끊기면 브라우저가 알아서 다시 연결한다. */
export function useBroadcastEvents(broadcastId: string | null, handlers: BroadcastEventHandlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!broadcastId) return;
    const es = new EventSource(`/api/broadcasts/${broadcastId}/events`);
    let hadError = false;
    es.onopen = () => {
      if (hadError) ref.current.reconnected?.();
      hadError = false;
    };
    es.onerror = () => {
      hadError = true;
    };
    for (const name of EVENTS) {
      es.addEventListener(name, (e) => {
        try {
          (ref.current[name] as ((d: unknown) => void) | undefined)?.(JSON.parse((e as MessageEvent).data));
        } catch {
          /* 잘못된 이벤트는 버린다. */
        }
      });
    }
    return () => es.close();
  }, [broadcastId]);
}
