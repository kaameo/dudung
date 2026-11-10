'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/client/api';
import type { BroadcastItem, Page, UserRef } from '@/lib/client/types';
import { BroadcastCard } from './broadcast-card';
import { LivePlayer } from './live-player';
import { Button, Card, StatusBadge } from './ui';

interface ChannelData {
  channel: UserRef;
  live: BroadcastItem | null;
  past: Page<BroadcastItem>;
}

/** 채널 페이지. 5초마다 LIVE 를 확인해서 방송이 시작되면 자동으로 플레이어로 바꾼다. */
export function ChannelView({ userId }: { userId: string }) {
  const [data, setData] = useState<ChannelData | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<ChannelData>(`/api/channels/${userId}?limit=12`);
      setData(d);
      return d;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setMissing(true);
      return null;
    }
  }, [userId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  const checkLive = useCallback(async () => Boolean((await load())?.live), [load]);

  if (missing) return <Card className="p-10 text-center">채널을 찾을 수 없습니다.</Card>;
  if (!data) return <p className="text-sm text-muted">불러오는 중…</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="grid h-12 w-12 place-items-center rounded-full bg-surface-2 text-lg font-bold">
          {data.channel.nickname.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <h1 className="text-xl font-bold">{data.channel.nickname}</h1>
          <p className="text-sm text-muted">{data.live ? '지금 방송 중' : '오프라인'}</p>
        </div>
      </div>

      {data.live ? (
        <div className="space-y-2">
          <LivePlayer key={data.live.id} broadcastId={data.live.id} checkLive={checkLive} />
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <StatusBadge status="LIVE" />
              <span className="truncate font-semibold">{data.live.title}</span>
            </div>
            <Link href={`/broadcasts/${data.live.id}`}>
              <Button variant="secondary">댓글·후원 보기</Button>
            </Link>
          </div>
        </div>
      ) : (
        <Card className="p-8 text-center text-sm text-muted">
          지금은 방송 중이 아닙니다. 이 페이지를 열어 두면 방송이 시작될 때 자동으로 재생됩니다.
        </Card>
      )}

      <section>
        <h2 className="mb-3 text-lg font-bold">지난 방송</h2>
        {data.past.items.length === 0 ? (
          <p className="text-sm text-muted">지난 방송이 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {data.past.items.map((b) => (
              <BroadcastCard key={b.id} b={b} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
