'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useRequireLogin } from '@/components/auth-provider';
import { Button, Input, Notice, Textarea } from '@/components/ui';
import { api, errorMessage } from '@/lib/client/api';

/** 방송 등록(READY). 등록하면 스튜디오로 이동해 송출을 시작한다. */
export default function NewBroadcastPage() {
  const router = useRouter();
  const { user } = useRequireLogin('/broadcasts/new');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { broadcast } = await api<{ broadcast: { id: string } }>('/api/broadcasts', {
        method: 'POST',
        body: { title, description: description || null },
      });
      router.push(`/broadcasts/${broadcast.id}/studio`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (!user) return null;
  return (
    <form onSubmit={submit} className="mx-auto max-w-lg space-y-3">
      <h1 className="text-2xl font-bold">방송 등록</h1>
      <p className="text-sm text-muted">방송 정보를 먼저 등록하면 대기 상태(READY)가 됩니다. 스튜디오에서 송출을 시작하세요.</p>
      <Input placeholder="방송 제목 (1~100자)" value={title} maxLength={100} onChange={(e) => setTitle(e.target.value)} required />
      <Textarea placeholder="설명 (선택)" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" className="w-full" disabled={busy || !title.trim()}>
        등록하고 스튜디오로
      </Button>
    </form>
  );
}
