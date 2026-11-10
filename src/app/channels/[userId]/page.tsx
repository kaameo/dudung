import { isUuid } from '@/server/common/ids';
import { notFound } from 'next/navigation';
import { ChannelView } from '@/components/channel-view';

export const dynamic = 'force-dynamic';

export default async function ChannelPage({ params }: PageProps<'/channels/[userId]'>) {
  const { userId } = await params;
  if (!isUuid(userId)) notFound();
  return <ChannelView userId={userId} />;
}
