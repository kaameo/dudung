import { getApp } from '@/server/container';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 모든 /api/* 요청을 Hono 앱으로 넘긴다. 권한 판단은 전부 서버 서비스 계층에서 한다. */
const handler = (req: Request) => getApp().fetch(req);

export { handler as GET, handler as POST, handler as PATCH, handler as DELETE, handler as PUT };
