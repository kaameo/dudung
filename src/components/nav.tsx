'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './auth-provider';
import { Button, cx } from './ui';

export function Nav() {
  const { user, loading, logout } = useAuth();
  const pathname = usePathname();
  const link = (href: string, label: string) => (
    <Link
      href={href}
      className={cx(
        'rounded-md px-2.5 py-1.5 text-sm font-medium transition',
        pathname === href ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg',
      )}
    >
      {label}
    </Link>
  );
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
        <Link href="/" className="mr-2 flex items-center gap-1.5 text-lg font-black tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-accent text-accent-ink">♪</span>
          두둥
        </Link>
        <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
          {link('/', '방송')}
          {link('/recordings', '다시보기')}
          {user && link('/me/broadcasts', '내 방송')}
        </nav>
        {loading ? null : user ? (
          <div className="flex items-center gap-2">
            <Link href="/broadcasts/new" className="hidden sm:block">
              <Button className="py-1.5">방송하기</Button>
            </Link>
            <Link href={`/channels/${user.id}`} className="max-w-28 truncate text-sm text-muted hover:text-fg">
              {user.nickname}
            </Link>
            <Button variant="ghost" className="px-2 py-1.5" onClick={() => void logout()}>
              로그아웃
            </Button>
          </div>
        ) : (
          <Link href={`/login?next=${encodeURIComponent(pathname)}`}>
            <Button variant="secondary" className="py-1.5">
              로그인
            </Button>
          </Link>
        )}
      </div>
    </header>
  );
}
