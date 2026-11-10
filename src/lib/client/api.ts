'use client';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly problem?: Record<string, unknown>,
  ) {
    super(message);
  }
}

let inflight: Promise<boolean> | null = null;

/**
 * access 토큰이 만료되면 refresh 한다. 같은 탭의 동시 요청은 promise 하나로,
 * 여러 탭의 동시 요청은 navigator.locks 로 하나씩 처리한다(서버도 30초 유예로 같은 결과를 준다).
 */
export function refreshSession(): Promise<boolean> {
  inflight ??= (async () => {
    const run = async () => {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' });
      if (res.ok) authChannel()?.postMessage('refreshed');
      return res.ok;
    };
    try {
      if (typeof navigator !== 'undefined' && navigator.locks) {
        return await navigator.locks.request('dudung-auth-refresh', run);
      }
      return await run();
    } catch {
      return false;
    } finally {
      setTimeout(() => (inflight = null), 0);
    }
  })();
  return inflight;
}

let channel: BroadcastChannel | null | undefined;
/** 탭 사이에 로그인·로그아웃을 알린다. */
export function authChannel(): BroadcastChannel | null {
  if (channel === undefined) {
    channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('dudung-auth') : null;
  }
  return channel;
}

export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const doFetch = () =>
    fetch(path, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: init.body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: init.signal,
      cache: 'no-store',
    });
  let res = await doFetch();
  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    if (await refreshSession()) res = await doFetch();
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, json?.code ?? 'UNKNOWN', json?.title ?? '요청을 처리하지 못했습니다.', json);
  }
  return json as T;
}

export const errorMessage = (err: unknown) =>
  err instanceof ApiError ? err.message : err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
