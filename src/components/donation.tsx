'use client';
import Link from 'next/link';
import type { TossPaymentsWidgets } from '@tosspayments/tosspayments-sdk';
import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '@/lib/client/api';
import type { DonationItem, Page, UserRef } from '@/lib/client/types';
import { useAuth } from './auth-provider';
import { timeAgo } from './broadcast-card';
import { Button, Card, Input, Notice } from './ui';

const PRESETS = [1000, 5000, 10000, 50000];

interface Order {
  orderId: string;
  amount: number;
  orderName: string;
  recipient: UserRef;
  customerKey: string;
  clientKey: string;
}

/** 후원 창. 받는 사람을 크게 보여 주고, 서버가 만든 주문으로 토스 결제위젯(테스트 모드)을 띄운다. */
export function DonateButton({ broadcastId, recipient }: { broadcastId: string; recipient: UserRef }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user) {
    return (
      <Link href={`/login?next=${encodeURIComponent(`/broadcasts/${broadcastId}`)}`}>
        <Button variant="secondary">💝 로그인하고 후원하기</Button>
      </Link>
    );
  }
  return (
    <>
      <Button onClick={() => setOpen(true)}>💝 후원하기</Button>
      {open && <DonateModal broadcastId={broadcastId} recipient={recipient} onClose={() => setOpen(false)} />}
    </>
  );
}

function DonateModal({ broadcastId, recipient, onClose }: { broadcastId: string; recipient: UserRef; onClose: () => void }) {
  const [amount, setAmount] = useState(5000);
  const [message, setMessage] = useState('');
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const widgetsRef = useRef<TossPaymentsWidgets | null>(null);

  // Esc 로 닫는다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const createOrder = async () => {
    setBusy(true);
    setError(null);
    try {
      setOrder(await api<Order>(`/api/broadcasts/${broadcastId}/donations`, { method: 'POST', body: { amount, message } }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!order) return;
    let cancelled = false;
    void (async () => {
      try {
        const { loadTossPayments } = await import('@tosspayments/tosspayments-sdk');
        const toss = await loadTossPayments(order.clientKey);
        const widgets = toss.widgets({ customerKey: order.customerKey });
        await widgets.setAmount({ currency: 'KRW', value: order.amount });
        if (cancelled) return;
        await Promise.all([
          widgets.renderPaymentMethods({ selector: '#toss-payment-methods', variantKey: 'DEFAULT' }),
          widgets.renderAgreement({ selector: '#toss-agreement', variantKey: 'AGREEMENT' }),
        ]);
        widgetsRef.current = widgets;
      } catch (err) {
        setError(`결제위젯을 불러오지 못했습니다: ${errorMessage(err)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [order]);

  const pay = async () => {
    if (!order || !widgetsRef.current) return;
    setError(null);
    const back = encodeURIComponent(broadcastId);
    try {
      await widgetsRef.current.requestPayment({
        orderId: order.orderId,
        orderName: order.orderName,
        successUrl: `${location.origin}/donations/success?broadcastId=${back}`,
        failUrl: `${location.origin}/donations/fail?broadcastId=${back}`,
      });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4">
      <dialog
        open
        aria-modal="true"
        aria-label="후원하기"
        className="static m-0 max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-xl border border-line bg-surface p-5 text-fg"
      >
        <div className="space-y-4">
          <div className="text-center">
            <p className="text-xs text-muted">받는 사람</p>
            <p className="text-2xl font-black text-accent" data-testid="donation-recipient">
              {recipient.nickname}
            </p>
          </div>
          {!order ? (
            <>
              <div className="grid grid-cols-4 gap-2">
                {PRESETS.map((p) => (
                  <Button key={p} variant={amount === p ? 'primary' : 'secondary'} className="px-1" onClick={() => setAmount(p)}>
                    {p.toLocaleString()}
                  </Button>
                ))}
              </div>
              <label className="block text-sm">
                <span className="text-muted">금액 (1,000~100,000원)</span>
                <Input type="number" min={1000} max={100000} step={1000} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
              </label>
              <label className="block text-sm">
                <span className="text-muted">메시지 (선택, 100자)</span>
                <Input value={message} maxLength={100} onChange={(e) => setMessage(e.target.value)} placeholder="응원 메시지" />
              </label>
              {error && <Notice tone="error">{error}</Notice>}
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={onClose}>
                  취소
                </Button>
                <Button className="flex-1" disabled={busy} onClick={() => void createOrder()}>
                  {amount.toLocaleString()}원 결제하기
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-center text-sm">
                {order.recipient.nickname}님에게 <b>{order.amount.toLocaleString()}원</b> · 테스트 결제(실제 출금 없음)
              </p>
              <div id="toss-payment-methods" className="rounded-lg bg-white" />
              <div id="toss-agreement" className="rounded-lg bg-white" />
              {error && <Notice tone="error">{error}</Notice>}
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={onClose}>
                  취소
                </Button>
                <Button className="flex-1" onClick={() => void pay()}>
                  결제 요청
                </Button>
              </div>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}

/** 후원 내역과 합계. 새 후원이 오면 부모가 key 를 바꿔 다시 불러온다. */
export function DonationList({ broadcastId }: { broadcastId: string }) {
  const [data, setData] = useState<(Page<DonationItem> & { total: number }) | null>(null);
  useEffect(() => {
    api<Page<DonationItem> & { total: number }>(`/api/broadcasts/${broadcastId}/donations?limit=20`)
      .then(setData)
      .catch(() => {});
  }, [broadcastId]);
  if (!data) return null;
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="font-semibold">후원 내역</h3>
        <p className="text-sm">
          합계 <b className="text-accent" data-testid="donation-total">{data.total.toLocaleString()}원</b>
        </p>
      </div>
      {data.items.length === 0 ? (
        <p className="text-sm text-muted">아직 후원이 없습니다.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {data.items.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-1.5">
              <span className="min-w-0 truncate">
                <b>{d.donor.nickname}</b> {d.message && <span className="text-muted">· {d.message}</span>}
              </span>
              <span className="shrink-0 text-xs text-muted">
                {d.amount.toLocaleString()}원 · {timeAgo(d.approvedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
