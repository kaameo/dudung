'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { timeAgo } from '@/components/broadcast-card';
import { useRequireLogin } from '@/components/auth-provider';
import { Button, Card, StatusBadge } from '@/components/ui';
import { api } from '@/lib/client/api';
import type { BroadcastItem, Page } from '@/lib/client/types';

/** 내 방송 목록(READY 포함). READY 방송에서 스튜디오로 들어가 송출을 시작한다. */
export default function MyBroadcastsPage() {
  const { user } = useRequireLogin('/me/broadcasts');
  const [items, setItems] = useState<BroadcastItem[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api<Page<BroadcastItem>>('/api/me/broadcasts?limit=30')
      .then((p) => {
        setItems(p.items);
        setCursor(p.nextCursor);
      })
      .catch(() => setItems([]));
  }, [user]);

  const more = async () => {
    const p = await api<Page<BroadcastItem>>(`/api/me/broadcasts?limit=30&cursor=${cursor}`);
    setItems((prev) => [...(prev ?? []), ...p.items]);
    setCursor(p.nextCursor);
  };

  if (!user) return null;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">내 방송</h1>
        <Link href="/broadcasts/new">
          <Button>+ 새 방송 등록</Button>
        </Link>
      </div>
      {items === null ? (
        <p className="text-sm text-muted">불러오는 중…</p>
      ) : items.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted">아직 등록한 방송이 없습니다.</Card>
      ) : (
        <Card className="divide-y divide-line">
          {items.map((b) => (
            <div key={b.id} className="flex items-center gap-3 px-4 py-3">
              <StatusBadge status={b.status} />
              <Link href={`/broadcasts/${b.id}`} className="min-w-0 flex-1 truncate font-medium hover:text-accent">
                {b.title}
              </Link>
              <span className="hidden text-xs text-muted sm:inline">{timeAgo(b.createdAt)} 등록</span>
              {b.status === 'ENDED' ? (
                <Link href={`/broadcasts/${b.id}`}>
                  <Button variant="secondary" className="py-1.5">
                    보기
                  </Button>
                </Link>
              ) : (
                <Link href={`/broadcasts/${b.id}/studio`}>
                  <Button className="py-1.5">{b.status === 'LIVE' ? '스튜디오 (방송 중)' : '스튜디오'}</Button>
                </Link>
              )}
            </div>
          ))}
        </Card>
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
