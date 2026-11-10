import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEMO_BROADCAST_ID } from '@/server/seed';
import { createHarness, openEvents, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(() => h.reset());
afterAll(() => h.close());

const commentsOf = async (broadcastId: string) =>
  (await h.anon().get(`/api/broadcasts/${broadcastId}/comments`)).body.items as Array<{
    id: string;
    body: string;
    author: { nickname: string };
  }>;

describe('댓글 작성과 조회', () => {
  it('로그인한 사용자는 방송 상태와 상관없이 댓글을 쓰고, 누구나 목록을 본다', async () => {
    const owner = await h.as('streamer1');
    const viewer = await h.as('viewer1');
    const ready = (await owner.post('/api/broadcasts', { title: '대기' })).body.broadcast.id;

    expect((await viewer.post(`/api/broadcasts/${ready}/comments`, { body: '기다릴게요' })).status).toBe(201);
    expect((await viewer.post(`/api/broadcasts/${DEMO_BROADCAST_ID}/comments`, { body: '다시보기 잘 봤어요' })).status).toBe(201);

    const list = await commentsOf(DEMO_BROADCAST_ID);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ body: '다시보기 잘 봤어요', author: { nickname: 'viewer1' } });
  });

  it('비로그인은 댓글을 쓸 수 없다', async () => {
    const res = await h.anon().post(`/api/broadcasts/${DEMO_BROADCAST_ID}/comments`, { body: '익명' });
    expect(res.status).toBe(401);
  });

  it('댓글은 1~300자', async () => {
    const viewer = await h.as('viewer1');
    expect((await viewer.post(`/api/broadcasts/${DEMO_BROADCAST_ID}/comments`, { body: ' ' })).status).toBe(400);
    expect((await viewer.post(`/api/broadcasts/${DEMO_BROADCAST_ID}/comments`, { body: 'a'.repeat(301) })).status).toBe(400);
  });

  it('최신순으로 cursor 페이지네이션한다', async () => {
    const viewer = await h.as('viewer1');
    for (let i = 0; i < 3; i++) await viewer.post(`/api/broadcasts/${DEMO_BROADCAST_ID}/comments`, { body: `c${i}` });
    const first = await h.anon().get(`/api/broadcasts/${DEMO_BROADCAST_ID}/comments?limit=2`);
    expect(first.body.items.map((c: any) => c.body)).toEqual(['c2', 'c1']);
    const second = await h.anon().get(`/api/broadcasts/${DEMO_BROADCAST_ID}/comments?limit=2&cursor=${first.body.nextCursor}`);
    expect(second.body.items.map((c: any) => c.body)).toEqual(['c0']);
    expect(second.body.nextCursor).toBeNull();
  });

  it('없거나 삭제된 방송에는 쓸 수 없다', async () => {
    const owner = await h.as('streamer1');
    const id = (await owner.post('/api/broadcasts', { title: '지울 방송' })).body.broadcast.id;
    await owner.del(`/api/broadcasts/${id}`);
    expect((await owner.post(`/api/broadcasts/${id}/comments`, { body: 'x' })).status).toBe(404);
    expect((await h.anon().get(`/api/broadcasts/${id}/comments`)).status).toBe(404);
  });

  it('1분에 10개까지만 쓸 수 있다', async () => {
    const viewer = await h.as('viewer1');
    const statuses = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await viewer.post(`/api/broadcasts/${DEMO_BROADCAST_ID}/comments`, { body: `도배 ${i}` })).status);
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses[10]).toBe(429);
  });
});

describe('댓글 수정·삭제 권한', () => {
  async function setup() {
    const author = await h.as('viewer1');
    const other = await h.as('viewer2');
    const res = await author.post(`/api/broadcasts/${DEMO_BROADCAST_ID}/comments`, { body: '원래 댓글' });
    return { author, other, id: res.body.comment.id as string };
  }

  it('작성자는 수정하고 삭제한다', async () => {
    const { author, id } = await setup();
    const edited = await author.patch(`/api/comments/${id}`, { body: '고친 댓글' });
    expect(edited.status).toBe(200);
    expect((await commentsOf(DEMO_BROADCAST_ID))[0]!.body).toBe('고친 댓글');

    expect((await author.del(`/api/comments/${id}`)).status).toBe(204);
    expect(await commentsOf(DEMO_BROADCAST_ID)).toHaveLength(0);
    expect((await author.patch(`/api/comments/${id}`, { body: '부활' })).status).toBe(404);
  });

  it('다른 사용자는 403, 비로그인은 401', async () => {
    const { other, id } = await setup();
    const edit = await other.patch(`/api/comments/${id}`, { body: '남의 댓글' });
    expect(edit.status).toBe(403);
    expect(edit.body.code).toBe('COMMENT_NOT_AUTHOR');
    expect((await other.del(`/api/comments/${id}`)).status).toBe(403);
    expect((await h.anon().patch(`/api/comments/${id}`, { body: 'x' })).status).toBe(401);
    expect((await h.anon().del(`/api/comments/${id}`)).status).toBe(401);
    expect((await commentsOf(DEMO_BROADCAST_ID))[0]!.body).toBe('원래 댓글');
  });

  it('방송 소유자라도 남의 댓글은 고칠 수 없다', async () => {
    const owner = await h.as('streamer1');
    const viewer = await h.as('viewer1');
    const b = (await owner.post('/api/broadcasts', { title: '내 방송' })).body.broadcast.id;
    const c = (await viewer.post(`/api/broadcasts/${b}/comments`, { body: '안녕' })).body.comment.id;
    expect((await owner.patch(`/api/comments/${c}`, { body: '검열' })).status).toBe(403);
  });
});

describe('댓글 실시간 전파', () => {
  it('작성·수정·삭제가 SSE 로 시청 화면에 나타난다', async () => {
    const viewer = await h.as('viewer1');
    const stream = await openEvents(h, DEMO_BROADCAST_ID);

    const created = await viewer.post(`/api/broadcasts/${DEMO_BROADCAST_ID}/comments`, { body: '실시간' });
    expect(await stream.next('comment.created')).toMatchObject({ id: created.body.comment.id, body: '실시간', author: { nickname: 'viewer1' } });

    await viewer.patch(`/api/comments/${created.body.comment.id}`, { body: '수정됨' });
    expect(await stream.next('comment.updated')).toMatchObject({ id: created.body.comment.id, body: '수정됨' });

    await viewer.del(`/api/comments/${created.body.comment.id}`);
    expect(await stream.next('comment.deleted')).toMatchObject({ id: created.body.comment.id });
    stream.close();
  });
});
