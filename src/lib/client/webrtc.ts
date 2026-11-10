'use client';
/**
 * WHIP(송출)와 WHEP(시청) 클라이언트.
 * SDP offer/answer 를 HTTP 로 한 번 주고받는다. MediaMTX 저장소의 publisher/reader 예제(MIT)를 참고해 줄였다.
 * https://github.com/bluenviron/mediamtx/tree/main/internal/servers/webrtc
 */

export class SignalingError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** MediaMTX 는 프록시 접두사(/media)를 모르고 세션 주소를 /live/... 로 돌려준다. */
export function resolveSessionUrl(endpoint: string, location: string | null): string | null {
  if (!location) return null;
  // endpoint 는 상대 경로(/media/...)일 수 있어서 현재 페이지 주소를 기준으로 푼다.
  const base = new URL(endpoint, typeof window !== 'undefined' ? window.location.href : 'http://localhost');
  const url = new URL(location, base);
  if (!url.pathname.startsWith('/media/')) url.pathname = `/media${url.pathname}`;
  return url.toString();
}

function waitIceGathering(pc: RTCPeerConnection, timeoutMs = 2500): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/** H.264 를 앞에 둔다. 녹화(MP4)에 재인코딩 없이 담을 수 있고 iOS 에서도 재생된다. */
function preferH264(transceiver: RTCRtpTransceiver) {
  try {
    const caps =
      (typeof RTCRtpReceiver !== 'undefined' && RTCRtpReceiver.getCapabilities?.('video')) ||
      (typeof RTCRtpSender !== 'undefined' && RTCRtpSender.getCapabilities?.('video'));
    if (!caps || !transceiver.setCodecPreferences) return;
    const h264 = caps.codecs.filter((c) => c.mimeType.toLowerCase() === 'video/h264');
    const rest = caps.codecs.filter((c) => c.mimeType.toLowerCase() !== 'video/h264');
    if (h264.length) transceiver.setCodecPreferences([...h264, ...rest]);
  } catch {
    /* 지원하지 않는 브라우저는 기본 순서로 협상한다. */
  }
}

async function exchange(endpoint: string, pc: RTCPeerConnection) {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIceGathering(pc);
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/sdp' },
    body: pc.localDescription!.sdp,
  });
  if (res.status !== 201) {
    throw new SignalingError(res.status, (await res.text().catch(() => '')) || `signaling failed (${res.status})`);
  }
  const answer = await res.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answer });
  return resolveSessionUrl(endpoint, res.headers.get('location'));
}

export interface Publication {
  pc: RTCPeerConnection;
  videoSender: RTCRtpSender;
  audioSender: RTCRtpSender | null;
  close: () => void;
}

export async function publishWhip(
  endpoint: string,
  tracks: { video: MediaStreamTrack; audio: MediaStreamTrack | null },
  opts: { maxBitrate: number; maxFramerate: number },
): Promise<Publication> {
  const pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
  try {
    const video = pc.addTransceiver(tracks.video, {
      direction: 'sendonly',
      sendEncodings: [{ maxBitrate: opts.maxBitrate, maxFramerate: opts.maxFramerate }],
    });
    preferH264(video);
    const audio = tracks.audio ? pc.addTransceiver(tracks.audio, { direction: 'sendonly' }) : null;
    const sessionUrl = await exchange(endpoint, pc);
    return {
      pc,
      videoSender: video.sender,
      audioSender: audio?.sender ?? null,
      close: () => {
        pc.close();
        if (sessionUrl) fetch(sessionUrl, { method: 'DELETE' }).catch(() => {});
      },
    };
  } catch (err) {
    pc.close();
    throw err;
  }
}

export interface Playback {
  pc: RTCPeerConnection;
  stream: MediaStream;
  close: () => void;
}

export async function playWhep(endpoint: string): Promise<Playback> {
  const pc = new RTCPeerConnection({ bundlePolicy: 'max-bundle' });
  const stream = new MediaStream();
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.ontrack = (e) => stream.addTrack(e.track);
  try {
    const sessionUrl = await exchange(endpoint, pc);
    return {
      pc,
      stream,
      close: () => {
        pc.close();
        if (sessionUrl) fetch(sessionUrl, { method: 'DELETE' }).catch(() => {});
      },
    };
  } catch (err) {
    pc.close();
    throw err;
  }
}
