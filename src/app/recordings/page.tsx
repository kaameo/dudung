'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatDuration, timeAgo } from '@/components/broadcast-card';
import { Button } from '@/components/ui';
import { api } from '@/lib/client/api';
import type { Page, RecordingItem } from '@/lib/client/types';

/** 다시보기 목록. 처리가 끝난(READY) 녹화만, 삭제된 방송은 빼고 보여 준다. */
export default function RecordingsPage() {
  const [items, setItems] = useState<RecordingItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);

  useEffect(() => {
    api<Page<RecordingItem>>('/api/recordings?limit=24')
      .then((p) => {
        setItems(p.items);
        setCursor(p.nextCursor);
      })
      .catch(() => setItems([]));
  }, []);

  const more = async () => {
    const p = await api<Page<RecordingItem>>(`/api/recordings?limit=24&cursor=${cursor}`);
    setItems((prev) => [...(prev ?? []), ...p.items]);
    setCursor(p.nextCursor);
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">다시보기</h1>
      {items === null ? (
        <p className="text-sm text-muted">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">아직 다시보기가 없습니다.</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((r) => (
            <div key={r.id} className="group">
              <Link href={`/recordings/${r.id}`} className="block">
                <div className="relative grid aspect-video place-items-center rounded-xl border border-line bg-surface-2">
                  <span className="text-3xl opacity-60">▶</span>
                  <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs">{formatDuration(r.durationSec)}</span>
                </div>
                <h3 className="mt-2 line-clamp-2 text-sm font-semibold group-hover:text-accent">{r.title}</h3>
              </Link>
              <p className="text-xs text-muted">
                <Link href={`/channels/${r.owner.id}`} className="hover:text-fg">
                  {r.owner.nickname}
                </Link>{' '}
                · {timeAgo(r.endedAt ?? r.createdAt)}
              </p>
            </div>
          ))}
        </div>
      )}
      {cursor && (
        <div className="text-center">
          <Button variant="secondary" onClick={() => void more()}>
            더 보기
          </Button>
        </div>
      )}
    </div>
  );
}
