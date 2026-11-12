/**
 * 권한 매트릭스(README 와 scripts/authz-check.sh 가 같은 표를 쓴다).
 * 기능 × (비로그인, 다른 사용자, 소유자·작성자) 마다 서버가 돌려주는 상태 코드를 확인한다.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_RECORDING_ID } from '@/server/seed';
import { createHarness, type Actor, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(() => h.reset());
afterAll(() => h.close());

type Who = 'anon' | 'other' | 'owner';

interface World {
  owner: Actor;
  other: Actor;
  anon: Actor;
  ready: string;
  live: string;
  liveToken: string;
  otherToken: string;
  commentId: string;
}

async function world(): Promise<World> {
  const owner = await h.as('streamer1');
  const other = await h.as('streamer2');
  const ready = (await owner.post('/api/broadcasts', { title: '준비 중' })).body.broadcast.id;
  const live = (await owner.post('/api/broadcasts', { title: '방송 중' })).body.broadcast.id;
  const liveToken = (await owner.post(`/api/broadcasts/${live}/start`, { source: 'SCREEN' })).body.token;
  const othersOwn = (await other.post('/api/broadcasts', { title: '남의 방송' })).body.broadcast.id;
  const otherToken = (await other.post(`/api/broadcasts/${othersOwn}/start`, { source: 'SCREEN' })).body.token;
  // 댓글 행에서는 owner 가 "작성자", other 가 "다른 사용자"다.
  const commentId = (await owner.post(`/api/broadcasts/${live}/comments`, { body: '작성자 댓글' })).body.comment.id;
  return { owner, other, anon: h.anon(), ready, live, liveToken, otherToken, commentId };
}

type Cell = (w: World, a: Actor, who: Who) => Promise<number>;

const rows: Array<[string, Cell, Record<Who, number>]> = [
  ['방송 목록', (_w, a) => a.get('/api/broadcasts').then((r) => r.status), { anon: 200, other: 200, owner: 200 }],
  ['채널 페이지', (w, a) => a.get(`/api/channels/${w.owner.user!.id}`).then((r) => r.status), { anon: 200, other: 200, owner: 200 }],
  ['방송 상세·시청 정보', (w, a) => a.get(`/api/broadcasts/${w.live}`).then((r) => r.status), { anon: 200, other: 200, owner: 200 }],
  ['READY 방송 상세(대기 화면)', (w, a) => a.get(`/api/broadcasts/${w.ready}`).then((r) => r.status), { anon: 200, other: 200, owner: 200 }],
  ['방송 등록', (_w, a) => a.post('/api/broadcasts', { title: '새 방송' }).then((r) => r.status), { anon: 401, other: 201, owner: 201 }],
  ['내 방송 목록', (_w, a) => a.get('/api/me/broadcasts').then((r) => r.status), { anon: 401, other: 200, owner: 200 }],
  ['방송 수정', (w, a) => a.patch(`/api/broadcasts/${w.live}`, { title: '수정' }).then((r) => r.status), { anon: 401, other: 403, owner: 200 }],
  ['방송 삭제', (w, a) => a.del(`/api/broadcasts/${w.ready}`).then((r) => r.status), { anon: 401, other: 403, owner: 204 }],
  ['방송 시작', (w, a) => a.post(`/api/broadcasts/${w.ready}/start`, { source: 'CAMERA' }).then(async (r) => r.status), { anon: 401, other: 403, owner: 409 /* 이미 LIVE 1개 */ }],
  ['방송 종료', (w, a) => a.post(`/api/broadcasts/${w.live}/end`).then((r) => r.status), { anon: 401, other: 403, owner: 200 }],
  ['송출 토큰 재발급', (w, a) => a.post(`/api/broadcasts/${w.live}/publish-token`).then((r) => r.status), { anon: 401, other: 403, owner: 200 }],
  [
    'MediaMTX 송출(WHIP)',
    (w, _a, who) => {
      const token = who === 'owner' ? w.liveToken : who === 'other' ? w.otherToken : '';
      return h.hook('/internal/media/auth', { action: 'publish', path: `live/${w.live}`, query: token ? `token=${token}` : '' }).then((r) => r.status);
    },
    { anon: 401, other: 401, owner: 200 },
  ],
  ['MediaMTX 시청(WHEP)', (w) => h.hook('/internal/media/auth', { action: 'read', path: `live/${w.live}` }).then((r) => r.status), { anon: 200, other: 200, owner: 200 }],
  ['녹화 목록', (_w, a) => a.get('/api/recordings').then((r) => r.status), { anon: 200, other: 200, owner: 200 }],
  ['녹화 재생', (_w, a) => a.get(`/api/recordings/${DEMO_RECORDING_ID}`).then((r) => r.status), { anon: 200, other: 200, owner: 200 }],
  [
    '녹화 삭제',
    async (w, a) => {
      // 소유자의 LIVE 방송을 송출 → 종료 → 녹화 처리까지 진행해 READY 녹화를 만든다.
      h.media.setPublishing(`live/${w.live}`, true);
      await h.hook(`/internal/media/ready?path=live/${w.live}`);
      await w.owner.post(`/api/broadcasts/${w.live}/end`);
      await h.handlers.processRecording({ broadcastId: w.live }, { attempt: 1, maxAttempts: 3 });
      const rec = (await w.owner.get(`/api/broadcasts/${w.live}`)).body.broadcast.recording;
      return (await a.del(`/api/recordings/${rec.id}`)).status;
    },
    { anon: 401, other: 403, owner: 204 },
  ],
  ['댓글 조회', (w, a) => a.get(`/api/broadcasts/${w.live}/comments`).then((r) => r.status), { anon: 200, other: 200, owner: 200 }],
  ['댓글 작성', (w, a) => a.post(`/api/broadcasts/${w.live}/comments`, { body: '안녕' }).then((r) => r.status), { anon: 401, other: 201, owner: 201 }],
  ['댓글 수정', (w, a) => a.patch(`/api/comments/${w.commentId}`, { body: '수정' }).then((r) => r.status), { anon: 401, other: 403, owner: 200 }],
  ['댓글 삭제', (w, a) => a.del(`/api/comments/${w.commentId}`).then((r) => r.status), { anon: 401, other: 403, owner: 204 }],
  ['후원 요청', (w, a) => a.post(`/api/broadcasts/${w.live}/donations`, { amount: 1000 }).then((r) => r.status), { anon: 401, other: 201, owner: 403 }],
  ['후원 내역·합계', (w, a) => a.get(`/api/broadcasts/${w.live}/donations`).then((r) => r.status), { anon: 200, other: 200, owner: 200 }],
];

describe.each(rows)('%s', (_name, cell, expected) => {
  it.each(['anon', 'other', 'owner'] as const)('%s', async (who) => {
    const w = await world();
    expect(await cell(w, w[who], who)).toBe(expected[who]);
  });
});

describe('READY 방송 시작(LIVE 가 없는 소유자)', () => {
  it('소유자는 시작할 수 있다', async () => {
    const owner = await h.as('streamer3');
    const id = (await owner.post('/api/broadcasts', { title: '대기' })).body.broadcast.id;
    expect((await owner.post(`/api/broadcasts/${id}/start`, { source: 'CAMERA' })).status).toBe(200);
  });
});
