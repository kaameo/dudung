'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, errorMessage } from '@/lib/client/api';
import {
  canShareScreen,
  captureCamera,
  captureScreen,
  level,
  mediaErrorMessage,
  PROFILES,
  reacquireCamera,
  type Captured,
  type Source,
} from '@/lib/client/media';
import type { BroadcastDetail } from '@/lib/client/types';
import { useBroadcastEvents } from '@/lib/client/use-broadcast-events';
import { publishWhip, SignalingError, type Publication } from '@/lib/client/webrtc';
import { DonationAlert } from './live-player';
import { Button, Card, Input, Notice, StatusBadge, Textarea } from './ui';

type Phase = 'idle' | 'preparing' | 'connecting' | 'live' | 'reconnecting' | 'ended';

/** 모바일에서 다른 앱에 다녀와도 방송을 이어 가는 시간. 서버의 끊김 유예와 같다. */
const RESUME_WINDOW_MS = 30_000;
const sameOrigin = (url: string) => {
  const u = new URL(url, location.href);
  return `${u.pathname}${u.search}`;
};

function Meter({ label, analyser }: { label: string; analyser: AnalyserNode | null }) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!analyser) return;
    const buf = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    let raf = 0;
    const tick = () => {
      if (bar.current) bar.current.style.width = `${Math.round(level(analyser, buf) * 100)}%`;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [analyser]);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-muted">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded bg-surface-2">
        <div ref={bar} className="h-full w-0 bg-accent transition-[width] duration-75" />
      </div>
    </div>
  );
}

/** 스튜디오: 소스 선택, 미리보기, 음량 미터, 시작·종료, 방송 정보 수정·삭제. 소유자만 들어온다(서버에서 확인). */
export function Studio({ id }: { id: string }) {
  const router = useRouter();
  const [b, setB] = useState<BroadcastDetail | null>(null);
  const [source, setSource] = useState<Source>('CAMERA');
  const [screenSupported, setScreenSupported] = useState(false);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<Captured | null>(null);
  const [edit, setEdit] = useState({ title: '', description: '' });
  const [saved, setSaved] = useState(false);
  const [alert, setAlert] = useState<{ donor: string; amount: number; message: string | null } | null>(null);
  const [viewers, setViewers] = useState(0);

  const previewRef = useRef<HTMLVideoElement>(null);
  const capturedRef = useRef<Captured | null>(null);
  const pubRef = useRef<Publication | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const ending = useRef(false);
  const hiddenAt = useRef<number | null>(null);
  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;

  const load = useCallback(async () => {
    const res = await api<{ broadcast: BroadcastDetail }>(`/api/broadcasts/${id}`);
    setB(res.broadcast);
    return res.broadcast;
  }, [id]);

  useEffect(() => {
    const screen = canShareScreen();
    setScreenSupported(screen);
    setSource(screen ? 'SCREEN' : 'CAMERA');
    load()
      .then((x) => setEdit({ title: x.title, description: x.description ?? '' }))
      .catch((err) => setError(errorMessage(err)));
  }, [load]);

  useEffect(() => {
    if (previewRef.current) previewRef.current.srcObject = captured?.preview ?? null;
  }, [captured]);

  useBroadcastEvents(id, {
    viewers: (d) => setViewers(d.count),
    'donation.created': (d) => {
      setAlert({ donor: d.donor.nickname, amount: d.amount, message: d.message });
      setTimeout(() => setAlert(null), 6000);
    },
    'broadcast.ended': () => {
      // 다른 기기에서 종료했거나 서버가 끊김을 확정했다.
      if (!ending.current) cleanup('ended');
      void load();
    },
  });

  /** 장치와 연결을 모두 정리한다. 서버가 세션을 끊어도 카메라·화면 캡처는 브라우저에서 따로 꺼야 한다. */
  const cleanup = useCallback((next: Phase) => {
    pubRef.current?.close();
    pubRef.current = null;
    capturedRef.current?.stop();
    capturedRef.current = null;
    setCaptured(null);
    wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
    setPhase(next);
  }, []);

  useEffect(() => () => cleanup('idle'), [cleanup]);

  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) wakeLock.current = await navigator.wakeLock.request('screen');
    } catch {
      /* 지원하지 않거나 거부되면 화면 꺼짐 방지 없이 진행한다. */
    }
  };

  const connect = useCallback(
    async (whipUrl: string, token: string) => {
      const cap = capturedRef.current;
      if (!cap) return;
      setPhase((p) => (p === 'live' ? 'reconnecting' : p === 'reconnecting' ? p : 'connecting'));
      const profile = PROFILES[cap.source];
      const pub = await publishWhip(
        `${sameOrigin(whipUrl)}?token=${encodeURIComponent(token)}`,
        { video: cap.video, audio: cap.audio },
        { maxBitrate: profile.maxBitrate, maxFramerate: profile.frameRate },
      );
      pubRef.current?.close();
      pubRef.current = pub;
      const onState = () => {
        if (pubRef.current !== pub) return;
        const s = pub.pc.connectionState;
        if (s === 'connected') setPhase('live');
        if (s === 'failed') void reconnect();
      };
      pub.pc.addEventListener('connectionstatechange', onState);
      onState();
    },
    [],
  );

  /** 연결이 완전히 끊기면 송출 토큰을 다시 받아 WHIP 로 다시 붙는다. 새 연결이 이전 송출을 대체한다. */
  const reconnect = useCallback(async () => {
    if (ending.current || phaseRef.current === 'ended') return;
    setPhase('reconnecting');
    for (let attempt = 0; attempt < 20 && !ending.current; attempt++) {
      await new Promise((r) => setTimeout(r, Math.min(2000 * (attempt + 1), 10_000)));
      try {
        const current = await load();
        if (current.status !== 'LIVE') {
          setError(current.status === 'READY' ? '송출이 연결되지 않아 방송이 대기 상태로 돌아갔습니다. 다시 시작해 주세요.' : null);
          cleanup(current.status === 'READY' ? 'idle' : 'ended');
          return;
        }
        const { whipUrl, token } = await api<{ whipUrl: string; token: string }>(`/api/broadcasts/${id}/publish-token`, {
          method: 'POST',
        });
        await connect(whipUrl, token);
        return;
      } catch (err) {
        console.warn('reconnect failed', err);
      }
    }
    setError('송출을 다시 연결하지 못했습니다. 네트워크를 확인해 주세요.');
  }, [cleanup, connect, id, load]);

  const end = useCallback(
    async (reason?: string) => {
      if (ending.current) return;
      ending.current = true;
      try {
        await api(`/api/broadcasts/${id}/end`, { method: 'POST' });
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 409)) setError(errorMessage(err));
      } finally {
        cleanup('ended');
        if (reason) setError(reason);
        await load().catch(() => {});
        ending.current = false;
      }
    },
    [cleanup, id, load],
  );

  /** 미디어 권한부터 확보하고, 거부되면 서버를 부르지 않는다(방송이 잘못 LIVE 로 바뀌지 않게). */
  const start = async () => {
    setError(null);
    setPhase('preparing');
    let cap: Captured;
    try {
      cap = source === 'SCREEN' ? await captureScreen() : await captureCamera(facing);
    } catch (err) {
      setPhase('idle');
      setError(mediaErrorMessage(err));
      return;
    }
    capturedRef.current = cap;
    setCaptured(cap);
    if (cap.source === 'SCREEN') {
      // 브라우저의 "공유 중지"를 누르면 방송을 끝낸다.
      cap.video.addEventListener('ended', () => void end());
    }
    try {
      const resumed = b?.status === 'LIVE';
      const res = resumed
        ? await api<{ whipUrl: string; token: string }>(`/api/broadcasts/${id}/publish-token`, { method: 'POST' })
        : await api<{ whipUrl: string; token: string; broadcast: BroadcastDetail }>(`/api/broadcasts/${id}/start`, {
            method: 'POST',
            body: { source },
          });
      if ('broadcast' in res) setB((prev) => ({ ...prev!, ...(res as { broadcast: BroadcastDetail }).broadcast }));
      await requestWakeLock();
      await connect(res.whipUrl, res.token);
    } catch (err) {
      if (err instanceof SignalingError) {
        void reconnect();
        return;
      }
      cleanup('idle');
      setError(errorMessage(err));
      void load();
    }
  };

  const flipCamera = async () => {
    const cap = capturedRef.current;
    if (!cap || cap.source !== 'CAMERA') return;
    const nextFacing = facing === 'user' ? 'environment' : 'user';
    try {
      await swapCameraTracks(nextFacing);
      setFacing(nextFacing);
    } catch (err) {
      setError(mediaErrorMessage(err));
    }
  };

  /** 연결은 그대로 두고 트랙만 갈아 끼운다. 송출과 녹화가 끊기지 않는다. */
  const swapCameraTracks = async (facingMode: 'user' | 'environment') => {
    const cap = capturedRef.current;
    if (!cap) return;
    const fresh = await reacquireCamera(facingMode);
    const video = fresh.getVideoTracks()[0]!;
    const audio = fresh.getAudioTracks()[0] ?? null;
    await pubRef.current?.videoSender.replaceTrack(video);
    if (audio) await pubRef.current?.audioSender?.replaceTrack(audio);
    const oldStop = cap.stop;
    cap.video.stop();
    cap.audio?.stop();
    const next: Captured = {
      ...cap,
      video,
      audio,
      preview: new MediaStream([video]),
      stop: () => {
        fresh.getTracks().forEach((t) => t.stop());
        oldStop();
      },
    };
    capturedRef.current = next;
    setCaptured(next);
  };

  // 모바일: 다른 앱에 갔다가 30초 안에 돌아오면 장치를 다시 얻어 트랙만 교체한다.
  useEffect(() => {
    const onVisibility = async () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
        return;
      }
      const away = hiddenAt.current ? Date.now() - hiddenAt.current : 0;
      hiddenAt.current = null;
      const p = phaseRef.current;
      if (p !== 'live' && p !== 'reconnecting' && p !== 'connecting') return;
      await requestWakeLock();
      const cap = capturedRef.current;
      if (away > RESUME_WINDOW_MS) {
        const current = await load().catch(() => null);
        if (current?.status !== 'LIVE') {
          cleanup('ended');
          setError('30초 넘게 자리를 비워 방송이 자동 종료되었습니다.');
          return;
        }
      }
      if (cap?.source === 'CAMERA' && (cap.video.readyState === 'ended' || cap.video.muted)) {
        await swapCameraTracks(facing).catch((err) => setError(mediaErrorMessage(err)));
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [facing, load, cleanup]);

  // 송출 중에 탭을 닫으려 하면 확인한다. 닫으면 서버가 30초 뒤 방송을 끝낸다.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (phaseRef.current === 'live' || phaseRef.current === 'reconnecting') e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const saveInfo = async () => {
    setError(null);
    try {
      const res = await api<{ broadcast: BroadcastDetail }>(`/api/broadcasts/${id}`, {
        method: 'PATCH',
        body: { title: edit.title, description: edit.description || null },
      });
      setB((prev) => ({ ...prev!, ...res.broadcast }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const remove = async () => {
    if (!confirm(b?.status === 'LIVE' ? '방송을 종료하고 삭제할까요?' : '방송을 삭제할까요?')) return;
    try {
      ending.current = true;
      await api(`/api/broadcasts/${id}`, { method: 'DELETE' });
      cleanup('ended');
      router.replace('/me/broadcasts');
    } catch (err) {
      ending.current = false;
      setError(errorMessage(err));
    }
  };

  if (!b) return <p className="text-sm text-muted">{error ?? '불러오는 중…'}</p>;

  const busy = phase === 'preparing' || phase === 'connecting';
  const onAir = phase === 'live' || phase === 'reconnecting' || phase === 'connecting';

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="space-y-3">
        <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
          <video
            ref={previewRef}
            className={`h-full w-full object-contain ${captured?.source === 'CAMERA' && facing === 'user' ? '-scale-x-100' : ''}`}
            autoPlay
            playsInline
            muted
            data-testid="studio-preview"
          />
          {!captured && (
            <div className="absolute inset-0 grid place-items-center text-sm text-muted">
              {b.status === 'ENDED' ? '종료된 방송입니다.' : '방송을 시작하면 미리보기가 나타납니다.'}
            </div>
          )}
          <div className="absolute left-3 top-3 flex items-center gap-2">
            {phase === 'live' && (
              <span data-testid="on-air">
                <StatusBadge status="LIVE" />
              </span>
            )}
            {phase === 'reconnecting' && <span className="rounded bg-warn px-1.5 py-0.5 text-[11px] font-bold text-black">재연결 중</span>}
            {phase === 'connecting' && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-bold">연결 중</span>}
            {onAir && <span className="rounded bg-black/60 px-1.5 py-0.5 text-[11px]">시청자 {viewers}명</span>}
          </div>
          <DonationAlert alert={alert} />
        </div>

        {captured && (
          <Card className="space-y-2 p-3">
            <Meter label="마이크" analyser={captured.micAnalyser} />
            {captured.source === 'SCREEN' && <Meter label="화면 소리" analyser={captured.screenAnalyser} />}
          </Card>
        )}
        {captured?.source === 'SCREEN' && !captured.hasScreenAudio && (
          <Notice tone="warn">
            화면 소리가 포함되지 않아 마이크만 송출됩니다. 탭·시스템 소리를 함께 보내려면 방송을 다시 시작하고 공유 창에서
            “탭 오디오 공유” 또는 “시스템 오디오 공유”를 켜 주세요.
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}

        <div className="flex flex-wrap items-center gap-2">
          {b.status !== 'ENDED' && !onAir && (
            <>
              <div className="flex rounded-lg bg-surface p-1" role="radiogroup" aria-label="송출 소스">
                {screenSupported && (
                  <button
                    role="radio"
                    aria-checked={source === 'SCREEN'}
                    onClick={() => setSource('SCREEN')}
                    className={`rounded-md px-3 py-1.5 text-sm ${source === 'SCREEN' ? 'bg-surface-2 font-semibold' : 'text-muted'}`}
                  >
                    🖥️ 화면 공유
                  </button>
                )}
                <button
                  role="radio"
                  aria-checked={source === 'CAMERA'}
                  onClick={() => setSource('CAMERA')}
                  className={`rounded-md px-3 py-1.5 text-sm ${source === 'CAMERA' ? 'bg-surface-2 font-semibold' : 'text-muted'}`}
                >
                  📱 카메라
                </button>
              </div>
              <Button onClick={() => void start()} disabled={busy} data-testid="start-broadcast">
                {b.status === 'LIVE' ? '송출 다시 연결' : busy ? '준비 중…' : '방송 시작'}
              </Button>
            </>
          )}
          {onAir && captured?.source === 'CAMERA' && (
            <Button variant="secondary" onClick={() => void flipCamera()}>
              🔄 카메라 전환
            </Button>
          )}
          {(onAir || b.status === 'LIVE') && (
            <Button variant="danger" onClick={() => void end()} data-testid="end-broadcast">
              ■ 방송 종료
            </Button>
          )}
          {b.status === 'ENDED' && (
            <Link href={`/broadcasts/${b.id}`}>
              <Button variant="secondary">방송 페이지로</Button>
            </Link>
          )}
        </div>
        {!screenSupported && b.status !== 'ENDED' && (
          <p className="text-xs text-muted">이 기기는 화면 공유 송출을 지원하지 않아 카메라만 선택할 수 있습니다.</p>
        )}
      </div>

      <Card className="h-fit space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">방송 정보</h2>
          <StatusBadge status={b.status} />
        </div>
        <label className="block text-sm">
          <span className="text-muted">제목</span>
          <Input value={edit.title} maxLength={100} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
        </label>
        <label className="block text-sm">
          <span className="text-muted">설명</span>
          <Textarea rows={4} value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
        </label>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => void saveInfo()} disabled={!edit.title.trim()}>
            {saved ? '저장됨 ✓' : '저장'}
          </Button>
          <Button variant="danger" onClick={() => void remove()}>
            삭제
          </Button>
        </div>
        <Link href={`/broadcasts/${b.id}`} className="block text-center text-sm text-muted hover:text-fg" target="_blank">
          시청 화면 새 탭으로 열기 ↗
        </Link>
        <p className="text-xs leading-relaxed text-muted">
          종료한 방송은 다시 켤 수 없습니다. 다시 방송하려면 새 방송을 등록하세요. 송출이 끊겨도 30초 안에 돌아오면 방송이 이어지고,
          시작 후 2분 안에 송출이 붙지 않으면 대기 상태로 돌아갑니다.
        </p>
      </Card>
    </div>
  );
}
