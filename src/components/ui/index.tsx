'use client';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110',
  secondary: 'bg-surface-2 text-fg hover:bg-line',
  danger: 'bg-live text-white hover:brightness-110',
  ghost: 'text-muted hover:text-fg hover:bg-surface-2',
};

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        className,
      )}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none',
        className,
      )}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cx(
        'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-muted focus:border-accent focus:outline-none',
        className,
      )}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-xl border border-line bg-surface', className)}>{children}</div>;
}

export function StatusBadge({ status }: { status: 'READY' | 'LIVE' | 'ENDED' }) {
  if (status === 'LIVE')
    return (
      <span className="inline-flex items-center gap-1 rounded bg-live px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-white">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
        LIVE
      </span>
    );
  if (status === 'READY')
    return <span className="rounded bg-warn/20 px-1.5 py-0.5 text-[11px] font-bold text-warn">대기</span>;
  return <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-bold text-muted">종료</span>;
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error'; children: ReactNode }) {
  const tones = {
    info: 'border-line bg-surface-2 text-fg',
    warn: 'border-warn/40 bg-warn/10 text-warn',
    error: 'border-live/40 bg-live/10 text-live',
  };
  return <div className={cx('rounded-lg border px-3 py-2 text-sm', tones[tone])}>{children}</div>;
}

export { cx };
