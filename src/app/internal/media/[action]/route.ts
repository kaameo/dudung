import { getApp } from '@/server/container';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** MediaMTX 인증·송출 훅. 공유 비밀키는 Hono 앱이 확인한다. */
const handler = (req: Request) => getApp().fetch(req);

export { handler as POST };
