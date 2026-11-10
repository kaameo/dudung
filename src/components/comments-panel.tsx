'use client';
import Link from 'next/link';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage } from '@/lib/client/api';
import type { CommentItem, Page } from '@/lib/client/types';
import { useAuth } from './auth-provider';
import { Button, Input } from './ui';

export interface CommentsHandle {
  created: (c: CommentItem) => void;
  updated: (c: CommentItem) => void;
  deleted: (id: string) => void;
  reload: () => void;
}

/** 방송별 댓글. 최신 댓글이 아래에 오고, SSE 로 받은 변경을 바로 반영한다. */
export const CommentsPanel = forwardRef<CommentsHandle, { broadcastId: string; className?: string }>(
  function CommentsPanel({ broadcastId, className }, ref) {
    const { user } = useAuth();
    const [items, setItems] = useState<CommentItem[]>([]);
    const [cursor, setCursor] = useState<string | null>(null);
    const [body, setBody] = useState('');
    const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const stickToBottom = useRef(true);

    const reload = useCallback(async () => {
      const page = await api<Page<CommentItem>>(`/api/broadcasts/${broadcastId}/comments?limit=50`);
      setItems(page.items.slice().reverse());
      setCursor(page.nextCursor);
    }, [broadcastId]);

    useEffect(() => {
      void reload().catch(() => {});
    }, [reload]);

    useImperativeHandle(ref, () => ({
      created: (c) => setItems((prev) => (prev.some((p) => p.id === c.id) ? prev : [...prev, c])),
      updated: (c) => setItems((prev) => prev.map((p) => (p.id === c.id ? c : p))),
      deleted: (id) => setItems((prev) => prev.filter((p) => p.id !== id)),
      reload: () => void reload().catch(() => {}),
    }));

    useEffect(() => {
      const el = listRef.current;
      if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
    }, [items]);

    const loadOlder = async () => {
      if (!cursor) return;
      const page = await api<Page<CommentItem>>(`/api/broadcasts/${broadcastId}/comments?limit=50&cursor=${cursor}`);
      stickToBottom.current = false;
      setItems((prev) => [...page.items.slice().reverse(), ...prev]);
      setCursor(page.nextCursor);
    };

    const submit = async (e: FormEvent) => {
      e.preventDefault();
      if (!body.trim()) return;
      setError(null);
      try {
        const { comment } = await api<{ comment: CommentItem }>(`/api/broadcasts/${broadcastId}/comments`, {
          method: 'POST',
          body: { body },
        });
        stickToBottom.current = true;
        setItems((prev) => (prev.some((p) => p.id === comment.id) ? prev : [...prev, comment]));
        setBody('');
      } catch (err) {
        setError(errorMessage(err));
      }
    };

    const saveEdit = async () => {
      if (!editing) return;
      try {
        const { comment } = await api<{ comment: CommentItem }>(`/api/comments/${editing.id}`, {
          method: 'PATCH',
          body: { body: editing.body },
        });
        setItems((prev) => prev.map((p) => (p.id === comment.id ? comment : p)));
        setEditing(null);
      } catch (err) {
        setError(errorMessage(err));
      }
    };

    const remove = async (id: string) => {
      if (!confirm('댓글을 삭제할까요?')) return;
      try {
        await api(`/api/comments/${id}`, { method: 'DELETE' });
        setItems((prev) => prev.filter((p) => p.id !== id));
      } catch (err) {
        setError(errorMessage(err));
      }
    };

    return (
      <div className={`flex min-h-0 flex-col rounded-xl border border-line bg-surface ${className ?? ''}`}>
        <div className="border-b border-line px-4 py-2.5 text-sm font-semibold">채팅 · 댓글</div>
        <div
          ref={listRef}
          className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3"
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
          data-testid="comments"
        >
          {cursor && (
            <button onClick={() => void loadOlder()} className="w-full text-center text-xs text-muted hover:text-fg">
              이전 댓글 더 보기
            </button>
          )}
          {items.length === 0 && <p className="py-6 text-center text-xs text-muted">첫 댓글을 남겨 보세요.</p>}
          {items.map((c) => (
            <div key={c.id} className="group text-sm leading-relaxed">
              {editing?.id === c.id ? (
                <div className="flex gap-1">
                  <Input value={editing.body} maxLength={300} onChange={(e) => setEditing({ id: c.id, body: e.target.value })} />
                  <Button className="px-2 py-1" onClick={() => void saveEdit()}>
                    저장
                  </Button>
                  <Button variant="ghost" className="px-2 py-1" onClick={() => setEditing(null)}>
                    취소
                  </Button>
                </div>
              ) : (
                <p className="break-words">
                  <span className="mr-1.5 font-semibold text-accent">{c.author.nickname}</span>
                  {c.body}
                  {c.edited && <span className="ml-1 text-xs text-muted">(수정됨)</span>}
                  {user?.id === c.author.id && (
                    <span className="ml-2 hidden gap-1 text-xs text-muted group-hover:inline-flex">
                      <button onClick={() => setEditing({ id: c.id, body: c.body })} className="hover:text-fg">
                        수정
                      </button>
                      <button onClick={() => void remove(c.id)} className="hover:text-live">
                        삭제
                      </button>
                    </span>
                  )}
                </p>
              )}
            </div>
          ))}
        </div>
        <div className="border-t border-line p-3">
          {error && <p className="mb-2 text-xs text-live">{error}</p>}
          {user ? (
            <form onSubmit={submit} className="flex gap-2">
              <Input placeholder="댓글 입력 (300자)" value={body} maxLength={300} onChange={(e) => setBody(e.target.value)} />
              <Button type="submit" disabled={!body.trim()}>
                전송
              </Button>
            </form>
          ) : (
            <Link
              href={`/login?next=${encodeURIComponent(`/broadcasts/${broadcastId}`)}`}
              className="block rounded-lg bg-surface-2 py-2 text-center text-sm text-muted hover:text-fg"
            >
              로그인하고 댓글 쓰기
            </Link>
          )}
        </div>
      </div>
    );
  },
);
