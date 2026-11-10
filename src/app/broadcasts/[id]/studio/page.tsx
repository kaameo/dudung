import { and, eq, isNull } from 'drizzle-orm';
import { isUuid } from '@/server/common/ids';
import { notFound, redirect } from 'next/navigation';
import { RefreshGate } from '@/components/refresh-gate';
import { Studio } from '@/components/studio';
import { getDeps } from '@/server/container';
import { broadcasts } from '@/server/db/schema';
import { getSessionUser } from '@/server/session';

export const dynamic = 'force-dynamic';
export const metadata = { title: '스튜디오' };

/** 스튜디오는 서버에서 소유자를 확인하고, 소유자가 아니면 상세 화면으로 보낸다. */
export default async function StudioPage({ params }: PageProps<'/broadcasts/[id]/studio'>) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const user = await getSessionUser();
  if (!user) return <RefreshGate next={`/broadcasts/${id}/studio`} />;
  const b = await getDeps().db.query.broadcasts.findFirst({
    where: and(eq(broadcasts.id, id), isNull(broadcasts.deletedAt)),
  });
  if (!b) notFound();
  if (b.ownerId !== user.id) redirect(`/broadcasts/${id}`);
  return <Studio id={id} />;
}
