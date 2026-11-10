import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_BROADCAST_ID, DEMO_USER_ID } from '@/server/seed';
import { createHarness, openEvents, type Actor, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(() => h.reset());
afterAll(() => h.close());

async function register(owner: Actor, title = '첫 방송', description = '설명') {
  const res = await owner.post('/api/broadcasts', { title, description });
  expect(res.status).toBe(201);
  return res.body.broadcast as { id: string; status: string; pathName: string };
}

async function goLive(owner: Actor, title = '라이브') {
  const b = await register(owner, title);
  const res = await owner.post(`/api/broadcasts/${b.id}/start`, { source: 'SCREEN' });
  expect(res.status).toBe(200);
  return { ...b, token: res.body.token as string };
}

describe('방송 등록', () => {
  it('로그인한 사용자는 READY 로 등록한다', async () => {
    const owner = await h.as('streamer1');
    const b = await register(owner, '코딩 방송', '타입스크립트');
    expect(b.status).toBe('READY');

    const detail = await owner.get(`/api/broadcasts/${b.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.broadcast).toMatchObject({ title: '코딩 방송', description: '타입스크립트', status: 'READY' });
  });

  it('비로그인 사용자는 등록할 수 없다', async () => {
    const res = await h.anon().post('/api/broadcasts', { title: '몰래 방송' });
    expect(res.status).toBe(401);
  });

  it('제목은 1~100자', async () => {
    const owner = await h.as('streamer1');
    expect((await owner.post('/api/broadcasts', { title: '' })).status).toBe(400);
    expect((await owner.post('/api/broadcasts', { title: 'a'.repeat(101) })).status).toBe(400);
    expect((await owner.post('/api/broadcasts', { title: 'a'.repeat(100) })).status).toBe(201);
  });
});

describe('READY 방송의 노출', () => {
  it('READY 방송은 공개 목록에 나오지 않고 내 방송 목록에만 나온다', async () => {
    const owner = await h.as('streamer1');
    const other = await h.as('streamer2');
    const b = await register(owner);

    const pub = await h.anon().get('/api/broadcasts');
    expect(pub.body.items.map((i: any) => i.id)).not.toContain(b.id);

    const mine = await owner.get('/api/me/broadcasts');
    expect(mine.body.items.map((i: any) => i.id)).toContain(b.id);
    const theirs = await other.get('/api/me/broadcasts');
    expect(theirs.body.items.map((i: any) => i.id)).not.toContain(b.id);
    expect((await h.anon().get('/api/me/broadcasts')).status).toBe(401);
  });

  it('READY 방송 상세는 소유자가 아니면 대기 정보만 준다', async () => {
    const owner = await h.as('streamer1');
    const b = await register(owner, '예고된 방송', '비공개 메모');
    const res = await h.anon().get(`/api/broadcasts/${b.id}`);
    expect(res.status).toBe(200);
    expect(res.body.broadcast.status).toBe('READY');
    expect(res.body.broadcast.title).toBe('예고된 방송');
    expect(res.body.broadcast.description).toBeUndefined();
    expect(res.body.broadcast.isOwner).toBe(false);
  });
});

describe('방송 수정·삭제 권한', () => {
  it('소유자는 READY·LIVE·ENDED 어느 상태에서든 제목과 설명을 고친다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    expect((await owner.patch(`/api/broadcasts/${b.id}`, { title: '라이브 중 수정' })).status).toBe(200);
    await owner.post(`/api/broadcasts/${b.id}/end`);
    const res = await owner.patch(`/api/broadcasts/${b.id}`, { description: '끝나고 수정' });
    expect(res.status).toBe(200);
    expect(res.body.broadcast).toMatchObject({ title: '라이브 중 수정', description: '끝나고 수정', status: 'ENDED' });
  });

  it('다른 사용자는 403, 비로그인은 401', async () => {
    const owner = await h.as('streamer1');
    const other = await h.as('viewer1');
    const b = await register(owner);
    for (const [method, path, body] of [
      ['PATCH', `/api/broadcasts/${b.id}`, { title: 'x' }],
      ['DELETE', `/api/broadcasts/${b.id}`, undefined],
      ['POST', `/api/broadcasts/${b.id}/start`, { source: 'CAMERA' }],
    ] as const) {
      expect((await other.req(method, path, { body })).status).toBe(403);
      expect((await h.anon().req(method, path, { body })).status).toBe(401);
    }
  });

  it('없는 방송은 404', async () => {
    const owner = await h.as('streamer1');
    const res = await owner.patch('/api/broadcasts/01930000-0000-7000-8000-0000000000ff', { title: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('BROADCAST_NOT_FOUND');
  });

  it('LIVE 방송을 삭제하면 먼저 종료하고 송출을 끊은 뒤 목록과 상세에서 사라진다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    h.media.setPublishing(b.pathName, true);
    const viewer = await openEvents(h, b.id);

    expect((await owner.del(`/api/broadcasts/${b.id}`)).status).toBe(204);
    expect((await viewer.next('broadcast.ended')).reason).toBe('DELETED');
    viewer.close();
    expect(h.media.kicked).toContain(b.pathName);
    expect((await h.anon().get(`/api/broadcasts/${b.id}`)).status).toBe(404);
    expect((await h.anon().get('/api/broadcasts')).body.items.map((i: any) => i.id)).not.toContain(b.id);
    expect((await owner.get('/api/me/broadcasts')).body.items.map((i: any) => i.id)).not.toContain(b.id);
    // 삭제된 방송으로는 다시 송출할 수 없다.
    expect((await h.hook('/internal/media/auth', { action: 'publish', path: b.pathName, query: `token=${b.token}` })).status).toBe(401);
  });

  it('demo 계정의 방송은 누구도 수정·삭제할 수 없다', async () => {
    const someone = await h.as('streamer2');
    expect((await someone.del(`/api/broadcasts/${DEMO_BROADCAST_ID}`)).status).toBe(403);
  });
});

describe('시작과 종료', () => {
  it('시작하면 LIVE 가 되고 송출 토큰과 WHIP URL 을 받는다', async () => {
    const owner = await h.as('streamer1');
    const b = await register(owner);
    const res = await owner.post(`/api/broadcasts/${b.id}/start`, { source: 'CAMERA' });
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.whipUrl).toBe(`https://dudung.test/media/live/${b.id}/whip`);
    expect(res.body.broadcast).toMatchObject({ status: 'LIVE', source: 'CAMERA' });
  });

  it('같은 방송을 동시에 두 번 시작하면 한 번만 성공한다', async () => {
    const owner = await h.as('streamer1');
    const b = await register(owner);
    const results = await Promise.all([
      owner.post(`/api/broadcasts/${b.id}/start`, { source: 'SCREEN' }),
      owner.post(`/api/broadcasts/${b.id}/start`, { source: 'SCREEN' }),
    ]);
    expect(results.map((r) => r.status).toSorted((x, y) => x - y)).toEqual([200, 409]);
  });

  it('LIVE 방송은 사용자당 하나뿐이다', async () => {
    const owner = await h.as('streamer1');
    await goLive(owner, '첫째');
    const second = await register(owner, '둘째');
    const res = await owner.post(`/api/broadcasts/${second.id}/start`, { source: 'SCREEN' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_LIVE');
  });

  it('종료하면 ENDED 가 되고 송출 세션을 끊고 시청자에게 알린다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    h.media.setPublishing(b.pathName, true);
    const viewer = await openEvents(h, b.id);

    const res = await owner.post(`/api/broadcasts/${b.id}/end`);
    expect(res.status).toBe(200);
    expect(res.body.broadcast).toMatchObject({ status: 'ENDED', endReason: 'OWNER' });
    expect(h.media.kicked).toEqual([b.pathName]);
    expect(await viewer.next('broadcast.ended')).toMatchObject({ id: b.id, reason: 'OWNER' });
    viewer.close();
  });

  it('종료된 방송은 다시 시작할 수 없고 다시 종료해도 409', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    await owner.post(`/api/broadcasts/${b.id}/end`);
    const restart = await owner.post(`/api/broadcasts/${b.id}/start`, { source: 'SCREEN' });
    expect(restart.status).toBe(409);
    expect(restart.body.code).toBe('BROADCAST_NOT_READY');
    const again = await owner.post(`/api/broadcasts/${b.id}/end`);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('BROADCAST_NOT_LIVE');
  });

  it('다른 사용자는 종료와 송출 토큰 재발급을 할 수 없다', async () => {
    const owner = await h.as('streamer1');
    const other = await h.as('streamer2');
    const b = await goLive(owner);
    expect((await other.post(`/api/broadcasts/${b.id}/end`)).status).toBe(403);
    expect((await other.post(`/api/broadcasts/${b.id}/publish-token`)).status).toBe(403);
    expect((await h.anon().post(`/api/broadcasts/${b.id}/end`)).status).toBe(401);
    expect((await h.anon().post(`/api/broadcasts/${b.id}/publish-token`)).status).toBe(401);
  });

  it('송출 토큰 재발급은 LIVE 일 때만', async () => {
    const owner = await h.as('streamer1');
    const b = await register(owner);
    expect((await owner.post(`/api/broadcasts/${b.id}/publish-token`)).status).toBe(409);
    await owner.post(`/api/broadcasts/${b.id}/start`, { source: 'SCREEN' });
    const res = await owner.post(`/api/broadcasts/${b.id}/publish-token`);
    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
  });

  it('종료 시 송출 세션 끊기가 실패해도 방송은 ENDED 이고 재송출은 거절된다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    h.media.setPublishing(b.pathName, true);
    h.media.failKick = true;
    expect((await owner.post(`/api/broadcasts/${b.id}/end`)).status).toBe(200);
    expect((await h.anon().get(`/api/broadcasts/${b.id}`)).body.broadcast.status).toBe('ENDED');
    const auth = await h.hook('/internal/media/auth', { action: 'publish', path: b.pathName, query: `token=${b.token}` });
    expect(auth.status).toBe(401);
  });
});

describe('공개 목록과 상세', () => {
  it('LIVE 가 위에 오고 READY 는 빠진다', async () => {
    const s1 = await h.as('streamer1');
    const s2 = await h.as('streamer2');
    const ended = await goLive(s1, '끝난 방송');
    await s1.post(`/api/broadcasts/${ended.id}/end`);
    const live = await goLive(s2, '지금 방송');
    await register(s1, '준비 중');

    const res = await h.anon().get('/api/broadcasts');
    expect(res.status).toBe(200);
    const titles = res.body.items.map((i: any) => i.title);
    expect(titles[0]).toBe('지금 방송');
    expect(titles).toContain('끝난 방송');
    expect(titles).not.toContain('준비 중');
    expect(res.body.items[0]).toMatchObject({ id: live.id, status: 'LIVE', owner: { nickname: 'streamer2' } });

    const onlyLive = await h.anon().get('/api/broadcasts?status=LIVE');
    expect(onlyLive.body.items.map((i: any) => i.id)).toEqual([live.id]);
  });

  it('cursor 로 다음 페이지를 받는다', async () => {
    const owner = await h.as('streamer1');
    for (let i = 0; i < 3; i++) {
      const b = await goLive(owner, `방송 ${i}`);
      await owner.post(`/api/broadcasts/${b.id}/end`);
    }
    const first = await h.anon().get('/api/broadcasts?limit=2');
    expect(first.body.items).toHaveLength(2);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const second = await h.anon().get(`/api/broadcasts?limit=2&cursor=${first.body.nextCursor}`);
    const all = [...first.body.items, ...second.body.items].map((i: any) => i.title);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toEqual(expect.arrayContaining(['방송 0', '방송 1', '방송 2', '[예시] 두둥 첫 방송 다시보기']));
  });

  it('LIVE 상세에는 시청자 수가 들어 있다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    h.media.setReaders(b.pathName, 3);
    const res = await h.anon().get(`/api/broadcasts/${b.id}`);
    expect(res.body.broadcast.viewerCount).toBe(3);
  });

  it('READY 방송의 수정 알림에는 비공개 설명을 싣지 않는다', async () => {
    const owner = await h.as('streamer1');
    const b = await register(owner, '예고', '공개 전 메모');
    const waiting = await openEvents(h, b.id);
    await owner.patch(`/api/broadcasts/${b.id}`, { title: '새 예고', description: '여전히 비공개' });
    const e = await waiting.next('broadcast.updated');
    waiting.close();
    expect(e).toMatchObject({ id: b.id, title: '새 예고', status: 'READY' });
    expect(e.description).toBeUndefined();
  });

  it('LIVE 중 제목을 바꾸면 시청 화면에 broadcast.updated 로 알린다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    const viewer = await openEvents(h, b.id);
    expect(viewer.contentType).toContain('text/event-stream');
    await owner.patch(`/api/broadcasts/${b.id}`, { title: '바뀐 제목' });
    expect(await viewer.next('broadcast.updated')).toMatchObject({ id: b.id, title: '바뀐 제목' });
    viewer.close();
  });
});

describe('채널', () => {
  it('채널 페이지는 지금 LIVE 인 방송과 지난 방송을 보여 준다', async () => {
    const owner = await h.as('streamer1');
    const past = await goLive(owner, '어제 방송');
    await owner.post(`/api/broadcasts/${past.id}/end`);
    const now = await goLive(owner, '오늘 방송');
    await register(owner, '준비 중');

    const res = await h.anon().get(`/api/channels/${owner.user!.id}`);
    expect(res.status).toBe(200);
    expect(res.body.channel).toMatchObject({ id: owner.user!.id, nickname: 'streamer1' });
    expect(res.body.live).toMatchObject({ id: now.id, status: 'LIVE' });
    expect(res.body.past.items.map((i: any) => i.title)).toEqual(['어제 방송']);
  });

  it('방송 중이 아니면 live 는 null 이다', async () => {
    const res = await h.anon().get(`/api/channels/${DEMO_USER_ID}`);
    expect(res.body.live).toBeNull();
    expect(res.body.past.items[0].id).toBe(DEMO_BROADCAST_ID);
  });

  it('없는 채널은 404', async () => {
    expect((await h.anon().get('/api/channels/01930000-0000-7000-8000-0000000000ff')).status).toBe(404);
  });
});
