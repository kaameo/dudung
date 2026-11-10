import { isUuid } from '@/server/common/ids';
import { notFound } from 'next/navigation';
import { RecordingView } from '@/components/recording-view';

export const dynamic = 'force-dynamic';

export default async function RecordingPage({ params }: PageProps<'/recordings/[id]'>) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <RecordingView id={id} />;
}
