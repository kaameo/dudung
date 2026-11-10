import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, openEvents, type Actor, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(() => h.reset());
afterAll(() => h.close());

async function goLive(owner: Actor) {
  const created = await owner.post('/api/broadcasts', { title: '라이브' });
  const id = created.body.broadcast.id as string;
  const started = await owner.post(`/api/broadcasts/${id}/start`, { source: 'SCREEN' });
  expect(started.status).toBe(200);
  return { id, pathName: `live/${id}`, token: started.body.token as string };
}

const publishAuth = (pathName: string, token: string) =>
  h.hook('/internal/media/auth', { action: 'publish', path: pathName, protocol: 'webrtc', query: `token=${token}` });
const readAuth = (pathName: string) =>
  h.hook('/internal/media/auth', { action: 'read', path: pathName, protocol: 'webrtc', query: '' });

/** MediaMTX 에 송출이 붙고 runOnOnline 훅이 온 상태를 만든다. */
async function publisherConnects(pathName: string) {
  h.media.setPublishing(pathName, true);
  expect((await h.hook(`/internal/media/ready?path=${pathName}`)).status).toBe(204);
}
async function publisherDrops(pathName: string) {
  h.media.setPublishing(pathName, false);
  expect((await h.hook(`/internal/media/not-ready?path=${pathName}`)).status).toBe(204);
}

const statusOf = async (id: string) => (await h.anon().get(`/api/broadcasts/${id}`)).body.broadcast;

describe('MediaMTX 인증 훅', () => {
  it('송출은 유효한 토큰 + 소유자 + LIVE 일 때만 허용한다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    expect((await publishAuth(b.pathName, b.token)).status).toBe(200);
    expect((await publishAuth(b.pathName, 'forged-token')).status).toBe(401);
    expect(
      (await h.hook('/internal/media/auth', { action: 'publish', path: b.pathName, query: '' })).status,
    ).toBe(401);
  });

  it('다른 방송의 토큰으로는 송출할 수 없다', async () => {
    const s1 = await h.as('streamer1');
    const s2 = await h.as('streamer2');
    const mine = await goLive(s1);
    const theirs = await goLive(s2);
    expect((await publishAuth(theirs.pathName, mine.token)).status).toBe(401);
  });

  it('토큰은 Bearer 나 비밀번호 칸으로 와도 받는다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    expect((await h.hook('/internal/media/auth', { action: 'publish', path: b.pathName, token: b.token })).status).toBe(200);
  });

  it('시청은 LIVE 일 때만 허용하고 로그인은 필요 없다', async () => {
    const owner = await h.as('streamer1');
    const ready = await owner.post('/api/broadcasts', { title: '대기' });
    expect((await readAuth(`live/${ready.body.broadcast.id}`)).status).toBe(401);

    const b = await goLive(owner);
    expect((await readAuth(b.pathName)).status).toBe(200);
    await owner.post(`/api/broadcasts/${b.id}/end`);
    expect((await readAuth(b.pathName)).status).toBe(401);
  });

  it('녹화 재생·API 같은 다른 동작과 모르는 경로는 거절한다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    expect((await h.hook('/internal/media/auth', { action: 'playback', path: b.pathName })).status).toBe(401);
    expect((await h.hook('/internal/media/auth', { action: 'read', path: 'other/stream' })).status).toBe(401);
  });

  it('공유 비밀키가 없으면 내부 경로는 404', async () => {
    const res = await h.app.request('http://127.0.0.1:3000/internal/media/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'read', path: 'live/x' }),
    });
    expect(res.status).toBe(404);
    const viaQuery = await h.app.request(
      `http://127.0.0.1:3000/internal/media/auth?secret=test-internal-secret-0123456789`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'read', path: 'live/x' }) },
    );
    expect(viaQuery.status).toBe(401);
  });

  it('종료 후에는 이전 송출 토큰으로 다시 송출할 수 없다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    await publisherConnects(b.pathName);
    await owner.post(`/api/broadcasts/${b.id}/end`);
    expect((await publishAuth(b.pathName, b.token)).status).toBe(401);
  });
});

describe('송출 끊김과 30초 유예', () => {
  it('끊긴 뒤 30초가 지나도 돌아오지 않으면 DISCONNECTED 로 종료하고 시청자에게 알린다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    await publisherConnects(b.pathName);
    const viewer = await openEvents(h, b.id);

    await publisherDrops(b.pathName);
    h.clock.advanceSeconds(31);
    await h.handlers.endIfAbsent({ broadcastId: b.id });

    expect(await statusOf(b.id)).toMatchObject({ status: 'ENDED', endReason: 'DISCONNECTED' });
    expect((await viewer.next('broadcast.ended')).reason).toBe('DISCONNECTED');
    viewer.close();
    expect((await publishAuth(b.pathName, b.token)).status).toBe(401);
  });

  it('30초 안에 다시 붙으면 방송이 이어진다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    await publisherConnects(b.pathName);
    await publisherDrops(b.pathName);
    h.clock.advanceSeconds(10);
    await publisherConnects(b.pathName);
    h.clock.advanceSeconds(25);
    await h.handlers.endIfAbsent({ broadcastId: b.id });
    expect((await statusOf(b.id)).status).toBe('LIVE');
  });

  it('유예 시간이 덜 지났으면 끝내지 않는다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    await publisherConnects(b.pathName);
    await publisherDrops(b.pathName);
    h.clock.advanceSeconds(10);
    await h.handlers.endIfAbsent({ broadcastId: b.id });
    expect((await statusOf(b.id)).status).toBe('LIVE');
  });

  it('두 번 끊기면 마지막 끊김부터 30초를 센다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    await publisherConnects(b.pathName);
    await publisherDrops(b.pathName); // t=0
    h.clock.advanceSeconds(10);
    await publisherConnects(b.pathName);
    h.clock.advanceSeconds(15);
    await publisherDrops(b.pathName); // t=25
    h.clock.advanceSeconds(6);
    await h.handlers.endIfAbsent({ broadcastId: b.id }); // 첫 끊김의 작업이 t=31 에 실행
    expect((await statusOf(b.id)).status).toBe('LIVE');
    h.clock.advanceSeconds(25);
    await h.handlers.endIfAbsent({ broadcastId: b.id }); // 두 번째 작업
    expect((await statusOf(b.id)).status).toBe('ENDED');
  });

  it('송출 탭을 닫으면(끊김 훅 → 30초) 방송이 자동 종료되고 녹화 처리 작업이 걸린다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    await publisherConnects(b.pathName);
    await publisherDrops(b.pathName);
    h.clock.advanceSeconds(31);
    await h.handlers.endIfAbsent({ broadcastId: b.id });
    expect(h.jobs.scheduled).toContainEqual({ name: 'process-recording', broadcastId: b.id });
  });
});

describe('시작 후 2분 안에 송출이 붙지 않으면', () => {
  it('READY 로 돌아오고 같은 방송으로 다시 시작할 수 있다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    h.clock.advance(2 * 60 * 1000 + 1000);
    await h.handlers.startTimeout({ broadcastId: b.id });

    const after = await owner.get(`/api/broadcasts/${b.id}`);
    expect(after.body.broadcast.status).toBe('READY');
    expect((await publishAuth(b.pathName, b.token)).status).toBe(401);
    expect((await owner.post(`/api/broadcasts/${b.id}/start`, { source: 'CAMERA' })).status).toBe(200);
  });

  it('송출이 한 번이라도 붙었으면 그대로 LIVE', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    await publisherConnects(b.pathName);
    h.clock.advance(3 * 60 * 1000);
    await h.handlers.startTimeout({ broadcastId: b.id });
    expect((await statusOf(b.id)).status).toBe('LIVE');
  });

  it('되돌린 뒤 다시 시작한 방송은 이전 시작의 타임아웃 작업에 영향받지 않는다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    h.clock.advance(2 * 60 * 1000 + 1000);
    await h.handlers.startTimeout({ broadcastId: b.id });
    await owner.post(`/api/broadcasts/${b.id}/start`, { source: 'SCREEN' });
    h.clock.advanceSeconds(5);
    await h.handlers.startTimeout({ broadcastId: b.id }); // 늦게 실행된 예전 작업
    expect((await statusOf(b.id)).status).toBe('LIVE');
  });
});

describe('훅 순서 뒤바뀜과 중복 호출', () => {
  it('ready 훅이 두 번 와도 결과가 같다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    await publisherConnects(b.pathName);
    await publisherConnects(b.pathName);
    const detail = await owner.get(`/api/broadcasts/${b.id}`);
    expect(detail.body.broadcast.status).toBe('LIVE');
    expect(detail.body.broadcast.recording).toMatchObject({ status: 'RECORDING' });
  });

  it('not-ready 가 ready 보다 먼저 와도 송출 중이면 방송이 끝나지 않는다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    h.media.setPublishing(b.pathName, true);
    await h.hook(`/internal/media/not-ready?path=${b.pathName}`);
    await h.hook(`/internal/media/ready?path=${b.pathName}`);
    h.clock.advanceSeconds(31);
    await h.handlers.endIfAbsent({ broadcastId: b.id });
    expect((await statusOf(b.id)).status).toBe('LIVE');
  });

  it('not-ready 가 중복으로 와도 한 번만 종료된다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    await publisherConnects(b.pathName);
    await publisherDrops(b.pathName);
    await publisherDrops(b.pathName);
    h.clock.advanceSeconds(31);
    await Promise.all([h.handlers.endIfAbsent({ broadcastId: b.id }), h.handlers.endIfAbsent({ broadcastId: b.id })]);
    expect((await statusOf(b.id)).status).toBe('ENDED');
    expect(h.jobs.scheduled.filter((j) => j.name === 'process-recording')).toHaveLength(1);
  });

  it('종료된 방송의 늦은 ready 훅은 송출을 끊고 상태를 바꾸지 않는다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    await owner.post(`/api/broadcasts/${b.id}/end`);
    h.media.kicked = [];
    await publisherConnects(b.pathName);
    expect(h.media.kicked).toEqual([b.pathName]);
    expect((await statusOf(b.id)).status).toBe('ENDED');
  });
});

describe('정합성 정리', () => {
  it('DB 만 LIVE 이고 송출자가 없으면 RECONCILED 로 종료한다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    await publisherConnects(b.pathName);
    h.media.setPublishing(b.pathName, false); // 끊김 훅이 유실됐다
    h.clock.advance(3 * 60 * 1000);
    await h.handlers.reconcile();
    expect(await statusOf(b.id)).toMatchObject({ status: 'ENDED', endReason: 'RECONCILED' });
  });

  it('한 번도 송출되지 않은 LIVE 는 READY 로 되돌린다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    h.clock.advance(3 * 60 * 1000);
    await h.handlers.reconcile();
    expect((await owner.get(`/api/broadcasts/${b.id}`)).body.broadcast.status).toBe('READY');
  });

  it('시작한 지 2분이 안 된 방송은 건너뛴다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    h.clock.advanceSeconds(90);
    await h.handlers.reconcile();
    expect((await statusOf(b.id)).status).toBe('LIVE');
  });

  it('끊김 유예 30초 중인 방송은 건너뛴다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    await publisherConnects(b.pathName);
    h.clock.advance(5 * 60 * 1000);
    await publisherDrops(b.pathName);
    h.clock.advanceSeconds(10);
    await h.handlers.reconcile();
    expect((await statusOf(b.id)).status).toBe('LIVE');
  });

  it('MediaMTX 에서만 송출 중인 경로는 끊는다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    await publisherConnects(b.pathName);
    h.media.failKick = true;
    await owner.post(`/api/broadcasts/${b.id}/end`); // 끊기 실패
    h.media.failKick = false;
    h.media.setPublishing('live/01930000-0000-7000-8000-0000000000ff', true); // DB 에 없는 경로
    await h.handlers.reconcile();
    expect(new Set(h.media.kicked)).toEqual(new Set([b.pathName, 'live/01930000-0000-7000-8000-0000000000ff']));
  });

  it('송출 중인 정상 방송은 건드리지 않는다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    await publisherConnects(b.pathName);
    h.clock.advance(10 * 60 * 1000);
    await h.handlers.reconcile();
    expect((await statusOf(b.id)).status).toBe('LIVE');
    expect(h.media.kicked).toEqual([]);
  });

  it('두 워커가 동시에 돌아도 한쪽만 처리한다', async () => {
    const owner = await h.as('streamer1');
    const b = await goLive(owner);
    await publisherConnects(b.pathName);
    h.media.setPublishing(b.pathName, false);
    h.clock.advance(3 * 60 * 1000);
    await Promise.all([h.handlers.reconcile(), h.handlers.reconcile()]);
    expect((await statusOf(b.id)).status).toBe('ENDED');
    expect(h.jobs.scheduled.filter((j) => j.name === 'process-recording')).toHaveLength(1);
  });
});
