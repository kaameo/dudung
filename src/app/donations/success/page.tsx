import { DonationResult } from '@/components/donation-result';

export const dynamic = 'force-dynamic';

/** 토스 결제위젯 성공 리다이렉트. paymentKey·orderId·amount 를 서버에 보내 승인을 확정한다. */
export default async function DonationSuccessPage({ searchParams }: PageProps<'/donations/success'>) {
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  return (
    <DonationResult
      paymentKey={one(q.paymentKey)}
      orderId={one(q.orderId)}
      amount={Number(one(q.amount))}
      broadcastId={one(q.broadcastId)}
    />
  );
}
