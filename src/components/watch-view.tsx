'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/client/api';
import type { BroadcastDetail } from '@/lib/client/types';
import { useBroadcastEvents } from '@/lib/client/use-broadcast-events';
import { CommentsPanel, type CommentsHandle } from './comments-panel';
import { DonateButton, DonationList } from './donation';
import { DonationAlert, LivePlayer } from './live-player';
import { Button, Card, StatusBadge } from './ui';

type Alert = { donor: string; amount: number; message: string | null };

/** 방송 상세·시청. READY 는 대기 화면, LIVE 는 플레이어·댓글·후원, ENDED 는 종료 안내와 다시보기. */
export function WatchView({ id, donationsEnabled }: { id: string; donationsEnabled: boolean }) {
  const [b, setB] = useState<BroadcastDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [donationVersion, setDonationVersion] = useState(0);
  const [alert, setAlert] = useState<Alert | null>(null);
  const comments = useRef<CommentsHandle>(null);
  const alertTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const load = useCallback(async () => {
    try {
      const res = await api<{ broadcast: BroadcastDetail }>(`/api/broadcasts/${id}`);
      setB(res.broadcast);
      return res.broadcast;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setMissing(true);
      return null;
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // READY 면 5초마다 상태를 확인해서 시작되면 자동으로 플레이어로 바꾼다.
  useEffect(() => {
    if (b?.status !== 'READY') return;
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [b?.status, load]);

  useBroadcastEvents(missing ? null : id, {
    'broadcast.updated': (d) => {
      setB((prev) => (prev ? { ...prev, ...d } : prev));
      if (d.status && d.status !== b?.status) void load();
    },
    'broadcast.ended': () => {
      setB((prev) => (prev ? { ...prev, status: 'ENDED' } : prev));
      setTimeout(() => void load(), 1500);
    },
    viewers: (d) => setB((prev) => (prev ? { ...prev, viewerCount: d.count } : prev)),
    'comment.created': (c) => comments.current?.created(c),
    'comment.updated': (c) => comments.current?.updated(c),
    'comment.deleted': (d) => comments.current?.deleted(d.id),
    'donation.created': (d) => {
      setB((prev) => (prev ? { ...prev, donationTotal: (prev.donationTotal ?? 0) + d.amount } : prev));
      setDonationVersion((v) => v + 1);
      setAlert({ donor: d.donor.nickname, amount: d.amount, message: d.message });
      clearTimeout(alertTimer.current);
      alertTimer.current = setTimeout(() => setAlert(null), 6000);
    },
    reconnected: () => {
      comments.current?.reload();
      void load();
    },
  });

  const checkLive = useCallback(async () => (await load())?.status === 'LIVE', [load]);

  if (missing) {
    return (
      <Card className="p-10 text-center">
        <p className="text-lg font-semibold">방송을 찾을 수 없습니다.</p>
        <p className="mt-1 text-sm text-muted">삭제되었거나 주소가 잘못되었습니다.</p>
        <Link href="/" className="mt-4 inline-block">
          <Button variant="secondary">방송 목록으로</Button>
        </Link>
      </Card>
    );
  }
  if (!b) return <p className="text-sm text-muted">불러오는 중…</p>;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="min-w-0 space-y-4">
        {b.status === 'LIVE' ? (
          <LivePlayer key={b.startedAt ?? 'live'} broadcastId={b.id} checkLive={checkLive} overlay={<DonationAlert alert={alert} />} />
        ) : b.status === 'READY' ? (
          <div className="grid aspect-video place-items-center rounded-xl border border-line bg-surface-2 text-center" data-testid="waiting-screen">
            <div>
              <p className="text-lg font-semibold">곧 방송이 시작됩니다</p>
              <p className="mt-1 text-sm text-muted">시작되면 자동으로 재생됩니다.</p>
              {b.isOwner && (
                <Link href={`/broadcasts/${b.id}/studio`} className="mt-4 inline-block">
                  <Button>스튜디오에서 시작하기</Button>
                </Link>
              )}
            </div>
          </div>
        ) : (
          <div className="grid aspect-video place-items-center rounded-xl border border-line bg-surface-2 text-center" data-testid="ended-screen">
            <div>
              <p className="text-lg font-semibold">방송이 종료되었습니다</p>
              {b.recording?.status === 'READY' ? (
                <Link href={`/recordings/${b.recording.id}`} className="mt-4 inline-block">
                  <Button>▶ 다시보기</Button>
                </Link>
              ) : b.recording && b.recording.status !== 'FAILED' ? (
                <p className="mt-1 text-sm text-muted">다시보기를 준비하고 있습니다…</p>
              ) : null}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StatusBadge status={b.status} />
              <h1 className="truncate text-xl font-bold" data-testid="broadcast-title">
                {b.title}
              </h1>
            </div>
            <p className="mt-1 text-sm text-muted">
              <Link href={`/channels/${b.owner.id}`} className="font-medium text-fg hover:text-accent">
                {b.owner.nickname}
              </Link>
              {b.status === 'LIVE' && <> · 시청자 {b.viewerCount ?? 0}명</>}
              {b.donationTotal ? <> · 후원 {b.donationTotal.toLocaleString()}원</> : null}
            </p>
          </div>
          <div className="flex gap-2">
            {b.isOwner && (
              <Link href={`/broadcasts/${b.id}/studio`}>
                <Button variant="secondary">스튜디오</Button>
              </Link>
            )}
            {b.status === 'LIVE' && !b.isOwner && donationsEnabled && <DonateButton broadcastId={b.id} recipient={b.owner} />}
          </div>
        </div>
        {b.description && <p className="whitespace-pre-wrap text-sm text-muted">{b.description}</p>}
        {b.status !== 'READY' && <DonationList broadcastId={b.id} version={donationVersion} />}
      </div>
      <CommentsPanel ref={comments} broadcastId={b.id} className="h-[480px] lg:h-[calc(100dvh-8rem)]" />
    </div>
  );
}
