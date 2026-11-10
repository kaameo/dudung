'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/client/api';
import type { Me } from '@/lib/client/types';
import { useAuth } from './auth-provider';
import { Button, Card, Input, Notice } from './ui';

const TEST_ACCOUNTS = [
  { account: 'streamer1', label: '방송자 1' },
  { account: 'streamer2', label: '방송자 2' },
  { account: 'streamer3', label: '방송자 3' },
  { account: 'viewer1', label: '시청자 1' },
  { account: 'viewer2', label: '시청자 2' },
] as const;

const safeNext = (next: string | undefined) => (next && next.startsWith('/') && !next.startsWith('//') ? next : '/');

export function LoginForm({ next, testLoginEnabled }: { next?: string; testLoginEnabled: boolean }) {
  const router = useRouter();
  const { setUser } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const done = (user: Me) => {
    setUser(user);
    router.replace(safeNext(next));
    router.refresh();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      done((await api<{ user: Me }>('/api/auth/login', { method: 'POST', body: { email, password } })).user);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const testLogin = async (account: string) => {
    setBusy(true);
    setError(null);
    try {
      done((await api<{ user: Me }>('/api/auth/test-login', { method: 'POST', body: { account } })).user);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-2xl font-bold">로그인</h1>
      {testLoginEnabled && (
        <Card className="space-y-3 p-4">
          <div>
            <p className="font-semibold">테스트 계정으로 바로 로그인</p>
            <p className="text-xs text-muted">심사용 고정 계정입니다. 브라우저 두 개에서 서로 다른 계정을 고르면 소유자·다른 사용자 권한을 비교할 수 있습니다.</p>
          </div>
          <div className="grid grid-cols-2 gap-2" data-testid="test-login">
            {TEST_ACCOUNTS.map((a) => (
              <Button key={a.account} variant="secondary" disabled={busy} onClick={() => void testLogin(a.account)}>
                {a.label}
                <span className="text-xs font-normal text-muted">{a.account}</span>
              </Button>
            ))}
          </div>
        </Card>
      )}
      <form onSubmit={submit} className="space-y-3">
        <Input type="email" placeholder="이메일" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input type="password" placeholder="비밀번호" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" className="w-full" disabled={busy}>
          로그인
        </Button>
      </form>
      <p className="text-center text-sm text-muted">
        계정이 없나요?{' '}
        <Link className="text-accent" href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ''}`}>
          회원가입
        </Link>
      </p>
    </div>
  );
}

export function SignupForm({ next }: { next?: string }) {
  const router = useRouter();
  const { setUser } = useAuth();
  const [form, setForm] = useState({ email: '', password: '', nickname: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { user } = await api<{ user: Me }>('/api/auth/signup', { method: 'POST', body: form });
      setUser(user);
      router.replace(safeNext(next));
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto max-w-sm space-y-3">
      <h1 className="mb-2 text-2xl font-bold">회원가입</h1>
      <Input type="email" placeholder="이메일" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
      <Input placeholder="닉네임 (2~20자)" value={form.nickname} minLength={2} maxLength={20} onChange={(e) => setForm({ ...form, nickname: e.target.value })} required />
      <Input type="password" placeholder="비밀번호 (8자 이상)" autoComplete="new-password" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" className="w-full" disabled={busy}>
        가입하고 시작하기
      </Button>
      <p className="text-center text-sm text-muted">
        이미 계정이 있나요?{' '}
        <Link className="text-accent" href="/login">
          로그인
        </Link>
      </p>
    </form>
  );
}
