import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_RECORDING_ID } from '@/server/seed';
import { createHarness, type Actor, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(() => h.reset());
afterAll(() => h.close());

const GB = 1024 ** 3;

/** 등록 → 시작 → 송출 붙음 → 종료까지 진행한 방송. */
async function endedWithRecording(owner: Actor, title = '녹화된 방송') {
  const id = (await owner.post('/api/broadcasts', { title })).body.broadcast.id as string;
  await owner.post(`/api/broadcasts/${id}/start`, { source: 'SCREEN' });
  h.media.setPublishing(`live/${id}`, true);
  await h.hook(`/internal/media/ready?path=live/${id}`);
  await owner.post(`/api/broadcasts/${id}/end`);
  return id;
}

const processRecording = (broadcastId: string, attempt = 1) =>
  h.handlers.processRecording({ broadcastId }, { attempt, maxAttempts: 3 });

const recordingOf = async (owner: Actor, broadcastId: string) =>
  (await owner.get(`/api/broadcasts/${broadcastId}`)).body.broadcast.recording;

const listedBroadcastIds = async () =>
  ((await h.anon().get('/api/recordings')).body.items as Array<{ broadcastId: string }>).map((r) => r.broadcastId);

describe('녹화', () => {
  it('송출이 붙으면 자동으로 녹화가 시작되고, 종료하면 처리 작업이 걸린다', async () => {
    const owner = await h.as('streamer1');
    const id = await endedWithRecording(owner);
    expect(await recordingOf(owner, id)).toMatchObject({ status: 'RECORDING' });
    expect(h.jobs.scheduled).toContainEqual({ name: 'process-recording', broadcastId: id });
  });

  it('송출이 한 번도 붙지 않은 방송은 녹화가 없다', async () => {
    const owner = await h.as('streamer1');
    const id = (await owner.post('/api/broadcasts', { title: '송출 없음' })).body.broadcast.id;
    await owner.post(`/api/broadcasts/${id}/start`, { source: 'SCREEN' });
    await owner.post(`/api/broadcasts/${id}/end`);
    expect(await recordingOf(owner, id)).toBeNull();
    expect(h.jobs.scheduled.map((j) => j.name)).not.toContain('process-recording');
  });

  it('처리에 성공하면 READY 가 되고 다시보기 목록과 상세에서 재생한다', async () => {
    const owner = await h.as('streamer1');
    const id = await endedWithRecording(owner, '다시보기 대상');
    await processRecording(id);

    expect(h.storage.merges).toEqual([{ broadcastId: id, pathName: `live/${id}`, maxDurationSec: 3600 }]);
    const rec = await recordingOf(owner, id);
    expect(rec.status).toBe('READY');

    const list = await h.anon().get('/api/recordings');
    expect(list.body.items[0]).toMatchObject({ broadcastId: id, title: '다시보기 대상', durationSec: 42, owner: { nickname: 'streamer1' } });

    const detail = await h.anon().get(`/api/recordings/${rec.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.recording.playbackUrl).toBe(`https://storage.test/recordings/${id}.mp4?expires=3600`);
  });

  it('처리가 한 번 실패해도 재시도에 성공하면 READY', async () => {
    const owner = await h.as('streamer1');
    const id = await endedWithRecording(owner);
    h.storage.failMerges = 1;
    await expect(processRecording(id, 1)).rejects.toThrow('ffmpeg failed');
    await processRecording(id, 2);
    expect((await recordingOf(owner, id)).status).toBe('READY');
  });

  it('3회 실패하면 FAILED 가 되고 다시보기에 나오지 않는다', async () => {
    const owner = await h.as('streamer1');
    const id = await endedWithRecording(owner);
    h.storage.failMerges = 3;
    for (const attempt of [1, 2, 3]) await expect(processRecording(id, attempt)).rejects.toThrow('ffmpeg failed');
    const rec = await recordingOf(owner, id);
    expect(rec.status).toBe('FAILED');
    expect(await listedBroadcastIds()).not.toContain(id);
    expect((await h.anon().get(`/api/recordings/${rec.id}`)).status).toBe(404);
  });

  it('같은 처리 작업이 두 번 와도 한 번만 올린다', async () => {
    const owner = await h.as('streamer1');
    const id = await endedWithRecording(owner);
    await processRecording(id);
    await processRecording(id);
    expect(h.storage.uploaded).toEqual([`recordings/${id}.mp4`]);
  });

  it('삭제된 방송의 녹화는 목록과 상세에서 숨긴다', async () => {
    const owner = await h.as('streamer1');
    const id = await endedWithRecording(owner);
    await processRecording(id);
    const rec = await recordingOf(owner, id);
    await owner.del(`/api/broadcasts/${id}`);
    expect(await listedBroadcastIds()).not.toContain(id);
    expect((await h.anon().get(`/api/recordings/${rec.id}`)).status).toBe(404);
  });

  it('demo 녹화는 seed 로 들어 있고 누구나 재생한다', async () => {
    const res = await h.anon().get(`/api/recordings/${DEMO_RECORDING_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.recording.owner.nickname).toBe('demo');
  });
});

describe('녹화 용량 정책', () => {
  it('READY 녹화 합이 8GB 를 넘으면 demo 를 빼고 가장 오래된 것부터 지운다', async () => {
    const s1 = await h.as('streamer1');
    const s2 = await h.as('streamer2');
    const oldest = await endedWithRecording(s1, '가장 오래된');
    const middle = await endedWithRecording(s2, '중간');
    const newest = await endedWithRecording(s1, '최신');
    h.storage.sizes.set(oldest, 3 * GB);
    h.storage.sizes.set(middle, 3 * GB);
    h.storage.sizes.set(newest, 3 * GB);

    await processRecording(oldest);
    await processRecording(middle);
    expect(h.storage.deleted).toEqual([]);
    await processRecording(newest); // 9GB + demo > 8GB

    expect(h.storage.deleted).toEqual([`recordings/${oldest}.mp4`]);
    const listed = await listedBroadcastIds();
    expect(listed).not.toContain(oldest);
    expect(listed).toEqual(expect.arrayContaining([middle, newest]));
    expect((await h.anon().get(`/api/recordings/${DEMO_RECORDING_ID}`)).status).toBe(200);
  });
});
