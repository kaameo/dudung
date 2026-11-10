'use client';

export type Source = 'SCREEN' | 'CAMERA';

export const PROFILES = {
  SCREEN: { width: 1920, height: 1080, frameRate: 15, maxBitrate: 2_500_000 },
  CAMERA: { width: 1280, height: 720, frameRate: 30, maxBitrate: 1_500_000 },
} as const;

export const canShareScreen = () =>
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices?.getDisplayMedia &&
  !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

export interface Captured {
  source: Source;
  video: MediaStreamTrack;
  /** 송출할 음성 트랙 하나(마이크 + 화면 소리를 섞은 것). */
  audio: MediaStreamTrack | null;
  hasScreenAudio: boolean;
  micAnalyser: AnalyserNode | null;
  screenAnalyser: AnalyserNode | null;
  preview: MediaStream;
  stop: () => void;
}

/**
 * PC 화면공유: 화면(탭·창·전체) + 시스템/탭 소리 + 마이크를 WebAudio 로 섞어 음성 트랙 하나로 만든다.
 * 반드시 클릭 핸들러 안에서 불러야 한다(AudioContext 와 화면공유 모두 사용자 동작이 필요).
 */
export async function captureScreen(): Promise<Captured> {
  const p = PROFILES.SCREEN;
  const display = await navigator.mediaDevices.getDisplayMedia({
    video: { width: { ideal: p.width, max: p.width }, height: { ideal: p.height, max: p.height }, frameRate: { ideal: p.frameRate, max: p.frameRate } },
    // 화면 소리는 에코 제거와 잡음 억제를 끈다. 게임·영상 소리가 깎이지 않게 하기 위해서다.
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    // @ts-expect-error: 크롬 전용 옵션(시스템 소리 포함, 송출 탭 자신은 공유 목록에서 뺀다)
    systemAudio: 'include',
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
  });
  let mic: MediaStream | null = null;
  try {
    mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    display.getTracks().forEach((t) => t.stop());
    throw err;
  }
  const video = display.getVideoTracks()[0]!;
  if ('contentHint' in video) video.contentHint = 'detail'; // 글자 선명도를 프레임보다 우선한다.

  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const micSource = ctx.createMediaStreamSource(mic);
  const micAnalyser = ctx.createAnalyser();
  micSource.connect(micAnalyser);
  micSource.connect(dest);
  let screenAnalyser: AnalyserNode | null = null;
  const hasScreenAudio = display.getAudioTracks().length > 0;
  if (hasScreenAudio) {
    const screenSource = ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks()));
    screenAnalyser = ctx.createAnalyser();
    screenSource.connect(screenAnalyser);
    screenSource.connect(dest);
  }
  const audio = dest.stream.getAudioTracks()[0] ?? null;
  return {
    source: 'SCREEN',
    video,
    audio,
    hasScreenAudio,
    micAnalyser,
    screenAnalyser,
    preview: new MediaStream([video]),
    stop: () => {
      display.getTracks().forEach((t) => t.stop());
      mic?.getTracks().forEach((t) => t.stop());
      audio?.stop();
      ctx.close().catch(() => {});
    },
  };
}

/** 휴대폰 카메라 + 마이크. 음성은 마이크 트랙을 그대로 보내고 음량 미터만 WebAudio 로 그린다. */
export async function captureCamera(facingMode: 'user' | 'environment'): Promise<Captured> {
  const p = PROFILES.CAMERA;
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode, width: { ideal: p.width }, height: { ideal: p.height }, frameRate: { ideal: p.frameRate, max: p.frameRate } },
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const video = stream.getVideoTracks()[0]!;
  const audio = stream.getAudioTracks()[0] ?? null;
  let ctx: AudioContext | null = null;
  let micAnalyser: AnalyserNode | null = null;
  try {
    ctx = new AudioContext();
    micAnalyser = ctx.createAnalyser();
    if (audio) ctx.createMediaStreamSource(new MediaStream([audio])).connect(micAnalyser);
  } catch {
    /* 음량 미터 없이도 송출은 된다. */
  }
  return {
    source: 'CAMERA',
    video,
    audio,
    hasScreenAudio: false,
    micAnalyser,
    screenAnalyser: null,
    preview: new MediaStream([video]),
    stop: () => {
      stream.getTracks().forEach((t) => t.stop());
      ctx?.close().catch(() => {});
    },
  };
}

/** 카메라만 새로 얻는다(전·후면 전환, 백그라운드에서 돌아왔을 때 트랙 교체용). */
export async function reacquireCamera(facingMode: 'user' | 'environment') {
  const p = PROFILES.CAMERA;
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode, width: { ideal: p.width }, height: { ideal: p.height }, frameRate: { ideal: p.frameRate, max: p.frameRate } },
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
}

export function level(analyser: AnalyserNode | null, buf: Uint8Array<ArrayBuffer>): number {
  if (!analyser) return 0;
  analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i]! - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / buf.length) * 3);
}

export function mediaErrorMessage(err: unknown): string {
  const name = (err as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return '카메라·마이크·화면 권한이 거부되었습니다. 브라우저 설정에서 허용한 뒤 다시 시도해 주세요.';
  if (name === 'NotFoundError') return '사용할 수 있는 카메라나 마이크가 없습니다.';
  if (name === 'NotReadableError') return '다른 앱이 카메라나 마이크를 쓰고 있습니다.';
  if (name === 'AbortError') return '화면 선택이 취소되었습니다.';
  return (err as Error)?.message ?? '장치를 가져오지 못했습니다.';
}
