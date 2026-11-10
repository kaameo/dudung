import { isUuid } from '@/server/common/ids';
import { notFound } from 'next/navigation';
import { WatchView } from '@/components/watch-view';

export const dynamic = 'force-dynamic';

export default async function BroadcastPage({ params }: PageProps<'/broadcasts/[id]'>) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const donationsEnabled = Boolean(process.env.TOSS_CLIENT_KEY && process.env.TOSS_SECRET_KEY);
  return <WatchView id={id} donationsEnabled={donationsEnabled} />;
}
