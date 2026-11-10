import { exportPKCS8, exportSPKI, generateKeyPair } from 'jose';
import { Redis } from 'ioredis';
import { sql } from 'drizzle-orm';
import { inject } from 'vitest';
import { createApp, type App } from '@/server/app';
import { DEFAULT_LIMITS, RECORDING_CAP_BYTES, type AppConfig } from '@/server/common/config';
import { createDb } from '@/server/common/db';
import { createLogger } from '@/server/common/logger';
import { createJobHandlers } from '@/server/jobs/handlers';
import { seed } from '@/server/seed';
import type { Deps } from '@/server/ports';
import { FakeClock, FakeJobs, FakeMediaControl, FakePayments, FakeStorage } from './fakes';

export const APP_URL = 'https://dudung.test';
export const INTERNAL_SECRET = 'test-internal-secret-0123456789';

let ipSeq = 1;
const nextIp = () => `10.0.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

interface StoredCookie {
  value: string;
  path: string;
}

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

/** 쿠키를 기억하는 HTTP 사용자. 브라우저처럼 Path 를 지켜 쿠키를 보낸다. */
export class Actor {
  private jar = new Map<string, StoredCookie>();
  readonly ip = nextIp();
  user: { id: string; nickname: string; email: string } | null = null;

  constructor(private readonly h: { app: App }) {}

  cookieHeader(path: string): string {
    return [...this.jar.entries()]
      .filter(([, c]) => path === c.path || path.startsWith(c.path.endsWith('/') ? c.path : `${c.path}/`) || c.path === '/')
      .map(([k, c]) => `${k}=${c.value}`)
      .join('; ');
  }

  cookie(name: string): string | undefined {
    return this.jar.get(name)?.value;
  }

  setCookie(name: string, value: string, path = '/') {
    this.jar.set(name, { value, path });
  }

  /** 다른 기기처럼 같은 쿠키를 가진 사용자를 만든다(탈취·다중 탭 시나리오). */
  clone(): Actor {
    const a = new Actor(this.h);
    for (const [k, v] of this.jar) a.jar.set(k, { ...v });
    a.user = this.user;
    return a;
  }

  async req<T = any>(
    method: string,
    path: string,
    opts: { body?: unknown; headers?: Record<string, string>; origin?: string | null } = {},
  ): Promise<Res<T>> {
    const headers: Record<string, string> = { 'x-forwarded-for': this.ip, ...opts.headers };
    const pathname = path.split('?')[0]!;
    const cookie = this.cookieHeader(pathname);
    if (cookie) headers.cookie = cookie;
    if (opts.origin !== null && method !== 'GET') headers.origin = opts.origin ?? APP_URL;
    let body: string | undefined;
    if (opts.body !== undefined) {
      body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      headers['content-type'] ??= 'application/json';
    }
    const res = await this.h.app.request(`${APP_URL}${path}`, { method, headers, body });
    for (const sc of res.headers.getSetCookie()) this.absorb(sc);
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* 텍스트 응답 */
    }
    return { status: res.status, body: parsed, headers: res.headers };
  }

  get = <T = any>(path: string) => this.req<T>('GET', path);
  post = <T = any>(path: string, body?: unknown) => this.req<T>('POST', path, { body: body ?? {} });
  patch = <T = any>(path: string, body?: unknown) => this.req<T>('PATCH', path, { body: body ?? {} });
  del = <T = any>(path: string) => this.req<T>('DELETE', path);

  private absorb(setCookie: string) {
    const [pair, ...attrs] = setCookie.split(';').map((s) => s.trim());
    const eq = pair!.indexOf('=');
    const name = pair!.slice(0, eq);
    const value = pair!.slice(eq + 1);
    let path = '/';
    let expired = value === '';
    for (const a of attrs) {
      const [k, v] = a.split('=');
      if (k!.toLowerCase() === 'path') path = v ?? '/';
      if (k!.toLowerCase() === 'max-age' && Number(v) <= 0) expired = true;
    }
    if (expired) this.jar.delete(name);
    else this.jar.set(name, { value, path });
  }
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;

export async function createHarness(overrides: Partial<AppConfig> = {}) {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const config: AppConfig = {
    appUrl: APP_URL,
    appOrigin: APP_URL,
    secureCookies: true,
    databaseUrl: inject('pgUrl'),
    redisUrl: inject('redisUrl'),
    jwtPrivateKeyPem: await exportPKCS8(privateKey),
    jwtPublicKeyPem: await exportSPKI(publicKey),
    internalSecret: INTERNAL_SECRET,
    mediamtxApiUrl: 'http://mediamtx.test',
    recordingsDir: '/tmp/recordings',
    s3: { region: 'auto', bucket: 'test', forcePathStyle: true },
    toss: { clientKey: 'test_gck_x', secretKey: 'test_gsk_x' },
    testLoginEnabled: true,
    logLevel: 'silent',
    limits: DEFAULT_LIMITS,
    recordingCapBytes: RECORDING_CAP_BYTES,
    ...overrides,
  };
  const { db, close: closeDb } = createDb(config.databaseUrl, 5);
  const redis = new Redis(config.redisUrl);
  const subscribers: Redis[] = [];
  const clock = new FakeClock();
  const media = new FakeMediaControl();
  const payments = new FakePayments();
  const storage = new FakeStorage();
  const jobs = new FakeJobs();
  const deps: Deps = {
    config,
    db,
    redis,
    createSubscriber: () => {
      const r = new Redis(config.redisUrl);
      subscribers.push(r);
      return r;
    },
    log: createLogger('silent'),
    clock: clock.now,
    media,
    payments,
    storage,
    jobs,
  };
  const app = createApp(deps);
  const handlers = createJobHandlers(deps);

  const h = {
    app,
    deps,
    db,
    clock,
    media,
    payments,
    storage,
    jobs,
    handlers,
    /** 비로그인 사용자. */
    anon: (): Actor => new Actor(h),
    /** 고정 테스트 계정으로 로그인한 사용자. */
    as: async (account: 'streamer1' | 'streamer2' | 'streamer3' | 'viewer1' | 'viewer2'): Promise<Actor> => {
      const a = new Actor(h);
      const res = await a.post('/api/auth/test-login', { account });
      if (res.status !== 200) throw new Error(`test-login failed: ${res.status} ${JSON.stringify(res.body)}`);
      a.user = res.body.user;
      return a;
    },
    /** MediaMTX 가 보내는 내부 훅 호출. */
    hook: async (path: string, body?: unknown) => {
      const res = await h.app.request(`http://127.0.0.1:3000${path}`, {
        method: 'POST',
        headers: { 'x-internal-secret': INTERNAL_SECRET, 'content-type': 'application/json' },
        body: body === undefined ? '' : JSON.stringify(body),
      });
      return { status: res.status, body: await res.text() };
    },
    reset: async () => {
      await db.execute(
        sql`TRUNCATE webhook_events, donations, comments, recordings, broadcasts, users RESTART IDENTITY CASCADE`,
      );
      await redis.flushdb();
      media.kicked = [];
      media.failKick = false;
      for (const p of await media.listPublishingPaths()) media.setPublishing(p, false);
      payments.payments.clear();
      payments.confirmCalls = [];
      payments.failNextGets = 0;
      payments.confirmOverride = null;
      payments.confirmDelayMs = 0;
      payments.failOrderLookup = false;
      storage.sizes.clear();
      storage.failMerges = 0;
      storage.uploaded = [];
      storage.deleted = [];
      storage.merges = [];
      jobs.scheduled = [];
      await seed(db, { passwordHashCache: true });
    },
    close: async () => {
      await Promise.all(subscribers.map((s) => s.quit().catch(() => {})));
      await redis.quit();
      await closeDb();
    },
  };
  return h;
}

/** SSE 응답 본문에서 이벤트를 하나씩 읽는다. */
export async function openEvents(h: { app: App }, broadcastId: string) {
  const controller = new AbortController();
  const res = await h.app.request(`${APP_URL}/api/broadcasts/${broadcastId}/events`, {
    signal: controller.signal,
  });
  if (res.status !== 200 || !res.body) throw new Error(`SSE open failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const queue: Array<{ event: string; data: any }> = [];

  async function pump(deadline: number): Promise<void> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('timed out waiting for SSE event');
    const chunk = await Promise.race([
      reader.read(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timed out waiting for SSE event')), remaining)),
    ]);
    if (chunk.done) throw new Error('SSE stream closed');
    buf += decoder.decode(chunk.value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trim());
      }
      if (data.length) queue.push({ event, data: JSON.parse(data.join('\n')) });
    }
  }

  return {
    status: res.status,
    contentType: res.headers.get('content-type'),
    /** 주어진 종류의 이벤트가 올 때까지 기다린다. 다른 종류는 건너뛴다. */
    async next(type: string, timeoutMs = 3000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const i = queue.findIndex((e) => e.event === type);
        if (i >= 0) return queue.splice(i, 1)[0]!.data;
        await pump(deadline);
      }
    },
    close: () => {
      controller.abort();
      reader.cancel().catch(() => {});
    },
  };
}
