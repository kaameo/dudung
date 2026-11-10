'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { refreshSession } from '@/lib/client/api';

/**
 * 서버 컴포넌트가 access 토큰을 확인하지 못했을 때 쓴다(만료).
 * refresh 쿠키는 /api/auth 경로로만 가므로 클라이언트에서 refresh 한 뒤 페이지를 다시 그린다.
 */
export function RefreshGate({ next }: { next: string }) {
  const router = useRouter();
  useEffect(() => {
    const key = `dudung-refresh-gate:${next}`;
    const last = Number(sessionStorage.getItem(key) ?? 0);
    if (Date.now() - last < 10_000) {
      router.replace(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    sessionStorage.setItem(key, String(Date.now()));
    refreshSession().then((ok) => (ok ? router.refresh() : router.replace(`/login?next=${encodeURIComponent(next)}`)));
  }, [next, router]);
  return <p className="text-sm text-muted">로그인 상태를 확인하는 중…</p>;
}
