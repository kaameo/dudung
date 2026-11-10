'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/client/api';
import type { RecordingItem } from '@/lib/client/types';
import { formatDuration } from './broadcast-card';
import { Button, Card } from './ui';

type Detail = RecordingItem & { description: string | null; playbackUrl: string };

/** 다시보기 재생. presigned URL(1시간)이 만료되면 새로 받아 이어서 재생한다. */
export function RecordingView({ id }: { id: string }) {
  const [r, setR] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const load = useCallback(async () => {
    try {
      setR((await api<{ recording: Detail }>(`/api/recordings/${id}`)).recording);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setMissing(true);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onError = async () => {
    const at = videoRef.current?.currentTime ?? 0;
    await load();
    requestAnimationFrame(() => {
      if (videoRef.current) videoRef.current.currentTime = at;
    });
  };

  if (missing) return <Card className="p-10 text-center">다시보기를 찾을 수 없습니다.</Card>;
  if (!r) return <p className="text-sm text-muted">불러오는 중…</p>;
  return (
    <div className="space-y-3">
      <video
        ref={videoRef}
        key={r.playbackUrl}
        src={r.playbackUrl}
        controls
        playsInline
        className="aspect-video w-full rounded-xl bg-black"
        onError={() => void onError()}
        data-testid="recording-video"
      />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{r.title}</h1>
          <p className="text-sm text-muted">
            <Link href={`/channels/${r.owner.id}`} className="text-fg hover:text-accent">
              {r.owner.nickname}
            </Link>{' '}
            · {formatDuration(r.durationSec)} · {r.startedAt ? new Date(r.startedAt).toLocaleString('ko-KR') : ''}
          </p>
        </div>
        <Link href={`/broadcasts/${r.broadcastId}`}>
          <Button variant="secondary">방송 페이지</Button>
        </Link>
      </div>
      {r.description && <p className="whitespace-pre-wrap text-sm text-muted">{r.description}</p>}
    </div>
  );
}
