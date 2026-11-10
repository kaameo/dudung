'use client';
import { useCallback, useEffect, useState } from 'react';
import { BroadcastCard } from '@/components/broadcast-card';
import { Button, Notice } from '@/components/ui';
import { api, errorMessage } from '@/lib/client/api';
import type { BroadcastItem, Page } from '@/lib/client/types';

/** 방송 목록. LIVE 가 위에 오고 10초마다 갱신한다. */
export default function HomePage() {
  const [items, setItems] = useState<BroadcastItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadFirst = useCallback(async () => {
    try {
      const page = await api<Page<BroadcastItem>>('/api/broadcasts?limit=24');
      setItems((prev) => {
        // 이미 더 불러온 항목은 유지하고 첫 페이지만 새로 고친다.
        if (!prev || prev.length <= page.items.length) return page.items;
        const fresh = new Set(page.items.map((i) => i.id));
        return [...page.items, ...prev.slice(page.items.length).filter((i) => !fresh.has(i.id))];
      });
      setCursor((c) => c ?? page.nextCursor);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void loadFirst();
    const t = setInterval(() => void loadFirst(), 10_000);
    return () => clearInterval(t);
  }, [loadFirst]);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await api<Page<BroadcastItem>>(`/api/broadcasts?limit=24&cursor=${cursor}`);
      setItems((prev) => [...(prev ?? []), ...page.items.filter((i) => !prev?.some((p) => p.id === i.id))]);
      setCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  };

  const live = items?.filter((i) => i.status === 'LIVE') ?? [];
  const ended = items?.filter((i) => i.status !== 'LIVE') ?? [];

  return (
    <div className="space-y-8">
      {error && <Notice tone="error">{error}</Notice>}
      <section>
        <h1 className="mb-3 flex items-center gap-2 text-xl font-bold">
          <span className="h-2 w-2 rounded-full bg-live" /> 지금 방송 중
        </h1>
        {items === null ? (
          <p className="text-sm text-muted">불러오는 중…</p>
        ) : live.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
            지금 진행 중인 방송이 없습니다. 첫 방송을 시작해 보세요!
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {live.map((b) => (
              <BroadcastCard key={b.id} b={b} />
            ))}
          </div>
        )}
      </section>
      {ended.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold">지난 방송</h2>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {ended.map((b) => (
              <BroadcastCard key={b.id} b={b} />
            ))}
          </div>
        </section>
      )}
      {cursor && (
        <div className="text-center">
          <Button variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
            더 보기
          </Button>
        </div>
      )}
    </div>
  );
}
