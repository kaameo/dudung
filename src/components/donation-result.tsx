'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/client/api';
import { Button, Card } from './ui';

export function DonationResult(props: { paymentKey: string; orderId: string; amount: number; broadcastId: string }) {
  const router = useRouter();
  const [state, setState] = useState<'pending' | 'done' | 'error'>('pending');
  const [message, setMessage] = useState('');
  const sent = useRef(false);
  const back = props.broadcastId ? `/broadcasts/${props.broadcastId}` : '/';

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    // 새로고침으로 다시 보내도 서버가 한 번만 적립한다.
    api('/api/donations/confirm', {
      method: 'POST',
      body: { paymentKey: props.paymentKey, orderId: props.orderId, amount: props.amount },
    })
      .then(() => {
        setState('done');
        setTimeout(() => router.replace(back), 2000);
      })
      .catch((err) => {
        setState('error');
        setMessage(errorMessage(err));
      });
  }, [props, router, back]);

  return (
    <Card className="mx-auto max-w-md space-y-3 p-6 text-center">
      {state === 'pending' && <p>결제를 확인하는 중…</p>}
      {state === 'done' && (
        <>
          <p className="text-lg font-semibold">💝 {props.amount.toLocaleString()}원 후원 완료!</p>
          <p className="text-sm text-muted">잠시 후 방송으로 돌아갑니다.</p>
        </>
      )}
      {state === 'error' && (
        <>
          <p className="text-lg font-semibold">후원을 확정하지 못했습니다</p>
          <p className="text-sm text-muted">{message}</p>
        </>
      )}
      <Link href={back}>
        <Button variant="secondary">방송으로 돌아가기</Button>
      </Link>
    </Card>
  );
}
