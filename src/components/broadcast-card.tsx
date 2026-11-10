'use client';
import Link from 'next/link';
import type { BroadcastItem } from '@/lib/client/types';
import { StatusBadge } from './ui';

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return '방금';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  return `${Math.floor(diff / 86400)}일 전`;
}

export function formatDuration(sec: number | null | undefined): string {
  if (!sec && sec !== 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function BroadcastCard({ b }: { b: BroadcastItem }) {
  const live = b.status === 'LIVE';
  return (
    <div className="group">
      <Link href={`/broadcasts/${b.id}`} className="block">
        <div
          className={`relative grid aspect-video place-items-center overflow-hidden rounded-xl border ${
            live ? 'border-live/50 bg-gradient-to-br from-live/25 via-surface-2 to-surface' : 'border-line bg-surface-2'
          }`}
        >
          <span className="text-4xl opacity-60">{b.source === 'CAMERA' ? '📱' : '🖥️'}</span>
          <div className="absolute left-2 top-2">
            <StatusBadge status={b.status} />
          </div>
        </div>
        <h3 className="mt-2 line-clamp-2 text-sm font-semibold group-hover:text-accent">{b.title}</h3>
      </Link>
      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
        <Link href={`/channels/${b.owner.id}`} className="hover:text-fg">
          {b.owner.nickname}
        </Link>
        <span>·</span>
        <span>{live ? `${timeAgo(b.startedAt)} 시작` : b.status === 'ENDED' ? `${timeAgo(b.endedAt)} 종료` : '시작 전'}</span>
      </div>
    </div>
  );
}
