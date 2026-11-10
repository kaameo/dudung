import type { Logger } from '@/server/common/logger';
import type { MediaControl } from '@/server/ports';

interface PathItem {
  name: string;
  online?: boolean;
  ready?: boolean;
  source: { type: string; id: string } | null;
  readers: Array<{ type: string; id: string }>;
}

/** 송출 세션 종류별 Control API kick 경로 (MediaMTX v1.21 OpenAPI). */
const KICK_PATHS: Record<string, string> = {
  webRTCSession: 'webrtc/sessions',
  rtspSession: 'rtsp/sessions',
  rtspsSession: 'rtsps/sessions',
  rtmpConn: 'rtmp/conns',
  rtmpsConn: 'rtmps/conns',
  srtConn: 'srt/conns',
};

/** MediaMTX Control API 클라이언트. 127.0.0.1 에서만 열려 있어 인증 없이 부른다. */
export class MediaMtxControl implements MediaControl {
  constructor(
    private readonly baseUrl: string,
    private readonly log: Logger,
    private readonly timeoutMs = 3000,
  ) {}

  private async call(method: string, path: string): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, { method, signal: AbortSignal.timeout(this.timeoutMs) });
  }

  private async getPath(pathName: string): Promise<PathItem | null> {
    const res = await this.call('GET', `/v3/paths/get/${pathName}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`mediamtx paths/get ${res.status}`);
    return (await res.json()) as PathItem;
  }

  async listPublishingPaths(): Promise<string[]> {
    const names: string[] = [];
    for (let page = 0; page < 50; page++) {
      const res = await this.call('GET', `/v3/paths/list?page=${page}&itemsPerPage=200`);
      if (!res.ok) throw new Error(`mediamtx paths/list ${res.status}`);
      const body = (await res.json()) as { items: PathItem[]; pageCount: number };
      for (const p of body.items) if (p.source) names.push(p.name);
      if (page + 1 >= body.pageCount) break;
    }
    return names;
  }

  async getPathState(pathName: string) {
    const p = await this.getPath(pathName);
    return { hasPublisher: Boolean(p?.source), readers: p?.readers.length ?? 0 };
  }

  async kickPublisher(pathName: string): Promise<void> {
    const p = await this.getPath(pathName);
    if (!p?.source) return;
    const kind = KICK_PATHS[p.source.type];
    if (!kind) {
      this.log.warn({ pathName, sourceType: p.source.type }, 'cannot kick unsupported source type');
      return;
    }
    const res = await this.call('POST', `/v3/${kind}/kick/${p.source.id}`);
    if (!res.ok && res.status !== 404) throw new Error(`mediamtx kick ${res.status}`);
    this.log.info({ pathName, sessionId: p.source.id }, 'publisher kicked');
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.call('GET', '/v3/paths/list?itemsPerPage=1');
      return res.ok;
    } catch {
      return false;
    }
  }
}
