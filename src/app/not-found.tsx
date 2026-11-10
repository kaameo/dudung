import Link from 'next/link';
import { Button, Card } from '@/components/ui';

export default function NotFound() {
  return (
    <Card className="p-10 text-center">
      <p className="text-lg font-semibold">페이지를 찾을 수 없습니다.</p>
      <Link href="/" className="mt-4 inline-block">
        <Button variant="secondary">홈으로</Button>
      </Link>
    </Card>
  );
}
