import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '@/server/app';
import { createHarness, openEvents, type Actor, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(() => h.reset());
afterAll(() => h.close());

async function liveBroadcast(owner: Actor) {
  const id = (await owner.post('/api/broadcasts', { title: '후원 받는 방송' })).body.broadcast.id as string;
  await owner.post(`/api/broadcasts/${id}/start`, { source: 'CAMERA' });
  return id;
}

async function order(donor: Actor, broadcastId: string, amount = 5000, message = '응원해요') {
  const res = await donor.post(`/api/broadcasts/${broadcastId}/donations`, { amount, message });
  expect(res.status).toBe(201);
  return res.body as { orderId: string; amount: number; recipient: { nickname: string } };
}

const summary = async (broadcastId: string) => (await h.anon().get(`/api/broadcasts/${broadcastId}/donations`)).body;

/** 토스 웹훅. 헤더의 전송 ID 는 재전송마다 바뀐다. */
const webhook = (data: Record<string, unknown>) =>
  h.anon().req('POST', '/api/webhooks/toss', {
    origin: null,
    headers: { 'tosspayments-webhook-transmission-id': crypto.randomUUID() },
    body: { eventType: 'PAYMENT_STATUS_CHANGED', createdAt: '2026-11-12T12:00:00.000000', data },
  });

describe('후원 주문', () => {
  it('LIVE 방송의 방송자에게 주문을 만든다. 받는 사람은 서버가 정한다', async () => {
    const streamer = await h.as('streamer1');
    const viewer = await h.as('viewer1');
    const b = await liveBroadcast(streamer);
    const res = await viewer.post(`/api/broadcasts/${b}/donations`, {
      amount: 3000,
      message: '화이팅',
      recipientId: viewer.user!.id, // 무시된다
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ amount: 3000, recipient: { nickname: 'streamer1' } });
    expect(res.body.orderId).toMatch(/^[A-Za-z0-9_-]{6,64}$/);
  });

  it('비로그인은 401', async () => {
    const b = await liveBroadcast(await h.as('streamer1'));
    expect((await h.anon().post(`/api/broadcasts/${b}/donations`, { amount: 1000 })).status).toBe(401);
  });

  it('자기 방송에는 후원할 수 없다', async () => {
    const streamer = await h.as('streamer1');
    const b = await liveBroadcast(streamer);
    const res = await streamer.post(`/api/broadcasts/${b}/donations`, { amount: 1000 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DONATION_SELF');
  });

  it('LIVE 가 아닌 방송은 거절한다', async () => {
    const streamer = await h.as('streamer1');
    const viewer = await h.as('viewer1');
    const ready = (await streamer.post('/api/broadcasts', { title: '대기' })).body.broadcast.id;
    const res = await viewer.post(`/api/broadcasts/${ready}/donations`, { amount: 1000 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BROADCAST_NOT_LIVE');
  });

  it('금액은 1,000~100,000원 정수', async () => {
    const viewer = await h.as('viewer1');
    const b = await liveBroadcast(await h.as('streamer1'));
    for (const amount of [999, 100_001, 1500.5]) {
      expect((await viewer.post(`/api/broadcasts/${b}/donations`, { amount })).status).toBe(400);
    }
    expect((await viewer.post(`/api/broadcasts/${b}/donations`, { amount: 100_000 })).status).toBe(201);
  });

  it('결제 키가 설정되지 않았으면 후원 기능이 꺼진다', async () => {
    const app = createApp({ ...h.deps, config: { ...h.deps.config, toss: {} } });
    const viewer = await h.as('viewer1');
    const b = await liveBroadcast(await h.as('streamer1'));
    const res = await app.request(`https://dudung.test/api/broadcasts/${b}/donations`, {
      method: 'POST',
      headers: { origin: 'https://dudung.test', cookie: viewer.cookieHeader('/api'), 'content-type': 'application/json' },
      body: JSON.stringify({ amount: 1000 }),
    });
    expect(res.status).toBe(503);
  });
});

describe('결제 승인 확정', () => {
  it('승인 결과·금액·대상을 확인하고 한 번 적립하고 방송 화면에 알린다', async () => {
    const viewer = await h.as('viewer1');
    const b = await liveBroadcast(await h.as('streamer1'));
    const o = await order(viewer, b, 5000, '최고!');
    const stream = await openEvents(h, b);

    const res = await viewer.post('/api/donations/confirm', { paymentKey: 'pk_1', orderId: o.orderId, amount: 5000 });
    expect(res.status).toBe(200);
    expect(res.body.donation).toMatchObject({ amount: 5000, status: 'DONE' });
    expect(h.payments.confirmCalls).toEqual([{ paymentKey: 'pk_1', orderId: o.orderId, amount: 5000 }]);
    expect(await stream.next('donation.created')).toMatchObject({ amount: 5000, message: '최고!', donor: { nickname: 'viewer1' } });
    stream.close();

    const s = await summary(b);
    expect(s.total).toBe(5000);
    expect(s.items).toHaveLength(1);
    expect((await h.anon().get(`/api/broadcasts/${b}`)).body.broadcast.donationTotal).toBe(5000);
  });

  it('요청 금액이 주문 금액과 다르면 토스를 부르지 않고 거절한다', async () => {
    const viewer = await h.as('viewer1');
    const b = await liveBroadcast(await h.as('streamer1'));
    const o = await order(viewer, b, 5000);
    const res = await viewer.post('/api/donations/confirm', { paymentKey: 'pk_x', orderId: o.orderId, amount: 100 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DONATION_AMOUNT_MISMATCH');
    expect(h.payments.confirmCalls).toEqual([]);
    expect((await summary(b)).total).toBe(0);
  });

  it('토스 응답의 금액이나 주문이 다르면 적립하지 않는다', async () => {
    const viewer = await h.as('viewer1');
    const b = await liveBroadcast(await h.as('streamer1'));
    const o = await order(viewer, b, 5000);
    h.payments.confirmOverride = (input) => ({ ...input, totalAmount: 1000, status: 'DONE' });
    const res = await viewer.post('/api/donations/confirm', { paymentKey: 'pk_2', orderId: o.orderId, amount: 5000 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PAYMENT_VERIFICATION_FAILED');
    expect((await summary(b)).total).toBe(0);
  });

  it('다른 사용자의 주문은 확정할 수 없고 비로그인은 401', async () => {
    const viewer = await h.as('viewer1');
    const other = await h.as('viewer2');
    const b = await liveBroadcast(await h.as('streamer1'));
    const o = await order(viewer, b);
    expect((await other.post('/api/donations/confirm', { paymentKey: 'pk', orderId: o.orderId, amount: 5000 })).status).toBe(403);
    expect((await h.anon().post('/api/donations/confirm', { paymentKey: 'pk', orderId: o.orderId, amount: 5000 })).status).toBe(401);
  });

  it('결제 후 새로고침으로 같은 확정을 다시 보내도 한 번만 적립된다', async () => {
    const viewer = await h.as('viewer1');
    const b = await liveBroadcast(await h.as('streamer1'));
    const o = await order(viewer, b, 7000);
    const body = { paymentKey: 'pk_3', orderId: o.orderId, amount: 7000 };
    expect((await viewer.post('/api/donations/confirm', body)).status).toBe(200);
    const again = await viewer.post('/api/donations/confirm', body);
    expect(again.status).toBe(200);
    expect(again.body.donation.status).toBe('DONE');
    expect((await summary(b)).total).toBe(7000);
  });

  it('같은 주문을 동시에 두 번 확정해도 적립은 한 건', async () => {
    const viewer = await h.as('viewer1');
    const b = await liveBroadcast(await h.as('streamer1'));
    const o = await order(viewer, b, 9000);
    const body = { paymentKey: 'pk_4', orderId: o.orderId, amount: 9000 };
    const results = await Promise.all([
      viewer.post('/api/donations/confirm', body),
      viewer.post('/api/donations/confirm', body),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const s = await summary(b);
    expect(s.total).toBe(9000);
    expect(s.items).toHaveLength(1);
  });

  it('토스가 동시 요청을 IDEMPOTENT_REQUEST_PROCESSING 으로 돌려줘도 주문이 실패 처리되지 않고 한 번 적립된다', async () => {
    const viewer = await h.as('viewer1');
    const b = await liveBroadcast(await h.as('streamer1'));
    const o = await order(viewer, b, 6000);
    h.payments.confirmDelayMs = 100;
    const body = { paymentKey: 'pk_idem', orderId: o.orderId, amount: 6000 };
    const results = await Promise.all([
      viewer.post('/api/donations/confirm', body),
      viewer.post('/api/donations/confirm', body),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results.map((r) => r.body.donation.status)).toEqual(['DONE', 'DONE']);
    const s = await summary(b);
    expect(s.total).toBe(6000);
    expect(s.items).toHaveLength(1);
  });

  it('ALREADY_PROCESSED_PAYMENT 를 받으면 결제 조회로 확인해 반영한다', async () => {
    const viewer = await h.as('viewer1');
    const b = await liveBroadcast(await h.as('streamer1'));
    const o = await order(viewer, b, 4000);
    // 이전 확정 요청이 토스에서는 승인됐지만 응답을 받기 전에 끊겼다.
    h.payments.seedPayment({ paymentKey: 'pk_5', orderId: o.orderId, totalAmount: 4000, status: 'DONE' });
    const res = await viewer.post('/api/donations/confirm', { paymentKey: 'pk_5', orderId: o.orderId, amount: 4000 });
    expect(res.status).toBe(200);
    expect((await summary(b)).total).toBe(4000);
  });
});

describe('토스 웹훅', () => {
  it('바디를 믿지 않고 결제 조회로 재확인한 뒤 반영한다', async () => {
    const viewer = await h.as('viewer1');
    const b = await liveBroadcast(await h.as('streamer1'));
    const o = await order(viewer, b, 6000);
    h.payments.seedPayment({ paymentKey: 'pk_w1', orderId: o.orderId, totalAmount: 6000, status: 'DONE' });
    const res = await webhook({ paymentKey: 'pk_w1', orderId: o.orderId, status: 'DONE', totalAmount: 6000 });
    expect(res.status).toBe(200);
    expect((await summary(b)).total).toBe(6000);
  });

  it('위조된 바디(조회 결과는 DONE 이 아님)로는 적립되지 않는다', async () => {
    const viewer = await h.as('viewer1');
    const b = await liveBroadcast(await h.as('streamer1'));
    const o = await order(viewer, b, 6000);
    h.payments.seedPayment({ paymentKey: 'pk_w2', orderId: o.orderId, totalAmount: 6000, status: 'IN_PROGRESS' });
    expect((await webhook({ paymentKey: 'pk_w2', orderId: o.orderId, status: 'DONE' })).status).toBe(200);
    expect((await webhook({ paymentKey: 'pk_unknown', orderId: o.orderId, status: 'DONE' })).status).toBe(200);
    expect((await summary(b)).total).toBe(0);
  });

  it('같은 승인 통지가 반복되어도 한 번만 적립된다', async () => {
    const viewer = await h.as('viewer1');
    const b = await liveBroadcast(await h.as('streamer1'));
    const o = await order(viewer, b, 8000);
    await viewer.post('/api/donations/confirm', { paymentKey: 'pk_w3', orderId: o.orderId, amount: 8000 });
    const stream = await openEvents(h, b);
    for (let i = 0; i < 3; i++) {
      expect((await webhook({ paymentKey: 'pk_w3', orderId: o.orderId, status: 'DONE' })).status).toBe(200);
    }
    await expect(stream.next('donation.created', 300)).rejects.toThrow(/timed out/);
    stream.close();
    expect((await summary(b)).total).toBe(8000);
  });

  it('처리에 실패한 웹훅은 재전송되면 반영된다', async () => {
    const viewer = await h.as('viewer1');
    const b = await liveBroadcast(await h.as('streamer1'));
    const o = await order(viewer, b, 2000);
    h.payments.seedPayment({ paymentKey: 'pk_w4', orderId: o.orderId, totalAmount: 2000, status: 'DONE' });
    h.payments.failNextGets = 1;
    expect((await webhook({ paymentKey: 'pk_w4', orderId: o.orderId, status: 'DONE' })).status).toBe(500);
    expect((await summary(b)).total).toBe(0);
    expect((await webhook({ paymentKey: 'pk_w4', orderId: o.orderId, status: 'DONE' })).status).toBe(200);
    expect((await summary(b)).total).toBe(2000);
  });

  it('웹훅 경로는 Origin 검사를 하지 않는다', async () => {
    const res = await webhook({ paymentKey: 'nothing' });
    expect(res.status).toBe(200);
  });
});

describe('미결 주문 정리', () => {
  it('승인 직후 서버 장애로 반영되지 않은 후원도 결국 반영된다', async () => {
    const viewer = await h.as('viewer1');
    const b = await liveBroadcast(await h.as('streamer1'));
    const o = await order(viewer, b, 3000);
    // 토스는 승인했지만 응답이 오기 전에 연결이 끊겼다.
    h.payments.confirmOverride = (input) => {
      h.payments.seedPayment({ ...input, totalAmount: input.amount, status: 'DONE' });
      throw new Error('socket hang up');
    };
    const res = await viewer.post('/api/donations/confirm', { paymentKey: 'pk_s1', orderId: o.orderId, amount: 3000 });
    expect(res.status).toBe(502);
    expect((await summary(b)).total).toBe(0);

    h.clock.advance(11 * 60 * 1000);
    await h.handlers.donationSweep();
    expect((await summary(b)).total).toBe(3000);
  });

  it('30분 넘게 결제되지 않은 주문은 FAILED 가 되어 더는 확정할 수 없다', async () => {
    const viewer = await h.as('viewer1');
    const b = await liveBroadcast(await h.as('streamer1'));
    const o = await order(viewer, b, 3000);
    h.clock.advance(31 * 60 * 1000);
    await h.handlers.donationSweep();
    await viewer.post('/api/auth/refresh'); // access 토큰(10분)이 그사이 만료됐다
    const res = await viewer.post('/api/donations/confirm', { paymentKey: 'pk_late', orderId: o.orderId, amount: 3000 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DONATION_NOT_PENDING');
  });

  it('주문번호 조회 API 를 쓸 수 없어도(결제위젯 키) 30분 넘은 미결제 주문은 FAILED 가 된다', async () => {
    const viewer = await h.as('viewer1');
    const b = await liveBroadcast(await h.as('streamer1'));
    const o = await order(viewer, b, 3000);
    h.payments.failOrderLookup = true;
    h.clock.advance(31 * 60 * 1000);
    await h.handlers.donationSweep();
    await viewer.post('/api/auth/refresh');
    const res = await viewer.post('/api/donations/confirm', { paymentKey: 'pk_late2', orderId: o.orderId, amount: 3000 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DONATION_NOT_PENDING');
  });

  it('10분이 안 된 주문은 건드리지 않는다', async () => {
    const viewer = await h.as('viewer1');
    const b = await liveBroadcast(await h.as('streamer1'));
    const o = await order(viewer, b, 3000);
    h.clock.advance(5 * 60 * 1000);
    await h.handlers.donationSweep();
    expect((await viewer.post('/api/donations/confirm', { paymentKey: 'pk_ok', orderId: o.orderId, amount: 3000 })).status).toBe(200);
  });
});

describe('후원 내역', () => {
  it('누구나 방송별 후원 내역과 합계를 본다', async () => {
    const v1 = await h.as('viewer1');
    const v2 = await h.as('viewer2');
    const b = await liveBroadcast(await h.as('streamer1'));
    const o1 = await order(v1, b, 1000, '첫 후원');
    const o2 = await order(v2, b, 20000, '두 번째');
    await order(v2, b, 50000, '결제 안 함');
    await v1.post('/api/donations/confirm', { paymentKey: 'a', orderId: o1.orderId, amount: 1000 });
    await v2.post('/api/donations/confirm', { paymentKey: 'b', orderId: o2.orderId, amount: 20000 });

    const s = await summary(b);
    expect(s.total).toBe(21000);
    expect(s.items.map((i: any) => [i.donor.nickname, i.amount, i.message])).toEqual([
      ['viewer2', 20000, '두 번째'],
      ['viewer1', 1000, '첫 후원'],
    ]);
  });
});
