'use client';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, authChannel } from '@/lib/client/api';
import type { Me } from '@/lib/client/types';

interface AuthState {
  user: Me | null;
  loading: boolean;
  reload: () => Promise<void>;
  setUser: (u: Me | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * 인증 상태. /api/me 가 401 이면 api() 가 /api/auth/refresh 를 한 번 시도한다.
 * refresh 쿠키는 Path=/api/auth 라서 페이지 이동만으로는 재발급되지 않기 때문이다.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const res = await api<{ user: Me }>('/api/me');
      setUser(res.user);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) console.warn(err);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const ch = authChannel();
    const onMessage = (e: MessageEvent) => {
      if (e.data === 'login' || e.data === 'logout') {
        void reload();
        router.refresh();
      }
    };
    ch?.addEventListener('message', onMessage);
    return () => ch?.removeEventListener('message', onMessage);
  }, [reload, router]);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    authChannel()?.postMessage('logout');
    router.refresh();
  }, [router]);

  const value = useMemo(
    () => ({
      user,
      loading,
      reload,
      setUser: (u: Me | null) => {
        setUser(u);
        authChannel()?.postMessage(u ? 'login' : 'logout');
      },
      logout,
    }),
    [user, loading, reload, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** 로그인이 필요한 화면. 비로그인이면 로그인 화면으로 안내한다. */
export function useRequireLogin(next: string) {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(next)}`);
  }, [loading, user, router, next]);
  return { user, loading };
}
