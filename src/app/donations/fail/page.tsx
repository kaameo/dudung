import Link from 'next/link';
import { Button, Card } from '@/components/ui';

export default async function DonationFailPage({ searchParams }: PageProps<'/donations/fail'>) {
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
  const broadcastId = one(q.broadcastId);
  return (
    <Card className="mx-auto max-w-md space-y-3 p-6 text-center">
      <p className="text-lg font-semibold">결제가 완료되지 않았습니다</p>
      <p className="text-sm text-muted">{one(q.message) || '결제가 취소되었거나 실패했습니다.'}</p>
      {one(q.code) && <p className="text-xs text-muted">코드: {one(q.code)}</p>}
      <Link href={broadcastId ? `/broadcasts/${broadcastId}` : '/'}>
        <Button variant="secondary">방송으로 돌아가기</Button>
      </Link>
    </Card>
  );
}
