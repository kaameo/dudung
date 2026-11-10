'use client';
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { playWhep, SignalingError, type Playback } from '@/lib/client/webrtc';

/**
 * WHEP 로 LIVE 방송을 본다. 음소거 자동재생으로 시작하고 버튼으로 소리를 켠다.
 * 연결이 실패하면 3초 뒤 방송 상태를 확인하고, 아직 LIVE 면 다시 연결한다.
 */
export function LivePlayer({
  broadcastId,
  checkLive,
  overlay,
}: {
  broadcastId: string;
  checkLive: () => Promise<boolean>;
  overlay?: ReactNode;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [state, setState] = useState<'connecting' | 'playing' | 'waiting'>('connecting');
  // 부모가 렌더마다 새 함수를 넘겨도 연결을 다시 맺지 않는다.
  const stillLive = useEffectEvent(() => checkLive().catch(() => true));
  const checkLiveOrFalse = useEffectEvent(() => checkLive().catch(() => false));

  useEffect(() => {
    let cancelled = false;
    let current: Playback | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const retryLater = () => {
      if (cancelled) return;
      current?.close();
      current = null;
      setState('waiting');
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (cancelled) return;
        if (await stillLive()) void connect();
      }, 3000);
    };

    const connect = async () => {
      if (cancelled) return;
      setState('connecting');
      try {
        const p = await playWhep(`/media/live/${broadcastId}/whep`);
        if (cancelled) return p.close();
        current = p;
        const video = videoRef.current;
        if (video) {
          video.srcObject = p.stream;
          video.play().catch(() => {});
        }
        p.pc.addEventListener('connectionstatechange', () => {
          if (p !== current) return;
          if (p.pc.connectionState === 'connected') setState('playing');
          if (p.pc.connectionState === 'failed' || p.pc.connectionState === 'closed') retryLater();
        });
        p.pc.addEventListener('iceconnectionstatechange', () => {
          if (p === current && p.pc.iceConnectionState === 'connected') setState('playing');
        });
      } catch (err) {
        // 404: 아직 송출이 붙지 않았다. 401: 방송이 LIVE 가 아니다.
        if (err instanceof SignalingError && err.status === 401 && !(await checkLiveOrFalse())) return;
        retryLater();
      }
    };

    void connect();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      current?.close();
    };
  }, [broadcastId]);

  const unmute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    v.play().catch(() => {});
    setMuted(false);
  };

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
      <video ref={videoRef} className="h-full w-full object-contain" autoPlay playsInline muted={muted} data-testid="live-video" />
      {state !== 'playing' && (
        <div className="absolute inset-0 grid place-items-center bg-black/60 text-sm text-muted">
          {state === 'connecting' ? '연결 중…' : '방송 신호를 기다리는 중…'}
        </div>
      )}
      {state === 'playing' && muted && (
        <button
          onClick={unmute}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/75 px-4 py-2 text-sm font-semibold text-white ring-1 ring-white/20 hover:bg-black"
        >
          🔇 탭해서 소리 켜기
        </button>
      )}
      {overlay}
    </div>
  );
}

/** 후원 알림. 몇 초 동안 화면 위에 띄운다. */
export function DonationAlert({ alert }: { alert: { donor: string; amount: number; message: string | null } | null }) {
  if (!alert) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center px-4">
      <div className="animate-bounce rounded-xl bg-accent px-5 py-3 text-center text-accent-ink shadow-2xl">
        <p className="text-base font-black">
          {alert.donor}님이 {alert.amount.toLocaleString()}원 후원!
        </p>
        {alert.message && <p className="text-sm font-medium">{alert.message}</p>}
      </div>
    </div>
  );
}
