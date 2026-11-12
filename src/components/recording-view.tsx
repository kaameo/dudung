'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage } from '@/lib/client/api';
import type { RecordingItem } from '@/lib/client/types';
import { useAuth } from './auth-provider';
import { formatDuration } from './broadcast-card';
import { Button, Card, Notice } from './ui';

type Detail = RecordingItem & { description: string | null; playbackUrl: string };

/** 다시보기 재생. presigned URL(1시간)이 만료되면 새로 받아 이어서 재생한다. */
export function RecordingView({ id }: { id: string }) {
  const [r, setR] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const router = useRouter();
  const { user } = useAuth();

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

  /** 방송 소유자만 보이는 버튼. 권한은 서버가 다시 확인한다. */
  const remove = async () => {
    if (!confirm('이 다시보기를 삭제할까요? 녹화 파일도 함께 지워지고 되돌릴 수 없습니다.')) return;
    setDeleting(true);
    setError(null);
    try {
      await api(`/api/recordings/${id}`, { method: 'DELETE' });
      router.replace('/recordings');
    } catch (err) {
      setError(errorMessage(err));
      setDeleting(false);
    }
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
        <div className="flex gap-2">
          <Link href={`/broadcasts/${r.broadcastId}`}>
            <Button variant="secondary">방송 페이지</Button>
          </Link>
          {user?.id === r.owner.id && (
            <Button variant="danger" disabled={deleting} onClick={() => void remove()} data-testid="delete-recording">
              삭제
            </Button>
          )}
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {r.description && <p className="whitespace-pre-wrap text-sm text-muted">{r.description}</p>}
    </div>
  );
}
