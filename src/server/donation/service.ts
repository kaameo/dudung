import { and, desc, eq, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { AppError, badRequest, conflict, forbidden, notFound, uniqueViolation } from '@/server/common/errors';
import { newId, randomToken } from '@/server/common/ids';
import { donations, users, webhookEvents, type Donation } from '@/server/db/schema';
import type { BroadcastService } from '@/server/broadcast/service';
import { TossError, type Deps, type TossPayment } from '@/server/ports';
import { publishEvent } from '@/server/realtime/hub';

export const MIN_AMOUNT = 1000;
export const MAX_AMOUNT = 100_000;
/** 이 시간이 지난 PENDING 주문은 토스에 조회해서 반영한다. */
export const SWEEP_AFTER_MS = 10 * 60 * 1000;
/** 이 시간이 지나도 결제되지 않은 주문은 FAILED. */
export const EXPIRE_AFTER_MS = 30 * 60 * 1000;

const TERMINAL_FAILURES = new Set(['CANCELED', 'ABORTED', 'EXPIRED']);

export const donationView = (d: Donation, donor: { id: string; nickname: string }) => ({
  id: d.id,
  broadcastId: d.broadcastId,
  amount: d.amount,
  message: d.message,
  status: d.status,
  donor,
  approvedAt: d.approvedAt,
  createdAt: d.createdAt,
});

export function createDonationService(deps: Deps, broadcasts: BroadcastService) {
  const { db, clock, log, payments } = deps;

  const enabled = () => Boolean(deps.config.toss.clientKey && deps.config.toss.secretKey);

  async function withDonor(d: Donation) {
    const donor = await db.query.users.findFirst({ where: eq(users.id, d.donorId) });
    return donationView(d, { id: d.donorId, nickname: donor?.nickname ?? '알 수 없음' });
  }

  /** 토스가 돌려준 결제가 우리 주문과 맞는지 확인한다. */
  const verified = (d: Donation, p: TossPayment) =>
    p.orderId === d.orderId && p.totalAmount === d.amount && p.status === 'DONE';

  /**
   * PENDING → DONE 조건부 업데이트. 바뀐 행이 있을 때만 알림을 보낸다.
   * 같은 결제가 confirm·웹훅·정리 작업 어디로 들어와도 한 번만 적립된다.
   */
  async function markDone(d: Donation, p: TossPayment, executor: Pick<typeof db, 'update'> = db) {
    const [row] = await executor
      .update(donations)
      .set({ status: 'DONE', paymentKey: p.paymentKey, approvedAt: p.approvedAt ? new Date(p.approvedAt) : clock() })
      .where(and(eq(donations.id, d.id), eq(donations.status, 'PENDING')))
      .returning();
    return row ?? null;
  }

  async function announce(row: Donation) {
    log.info({ donationId: row.id, broadcastId: row.broadcastId, amount: row.amount }, 'donation confirmed');
    await publishEvent(deps, row.broadcastId, 'donation.created', await withDonor(row));
  }

  async function markFailed(id: string) {
    await db
      .update(donations)
      .set({ status: 'FAILED' })
      .where(and(eq(donations.id, id), eq(donations.status, 'PENDING')));
  }

  async function settle(d: Donation, p: TossPayment): Promise<Donation> {
    if (!verified(d, p)) {
      log.warn({ orderId: d.orderId, tossStatus: p.status }, 'payment verification failed');
      if (TERMINAL_FAILURES.has(p.status) || p.status === 'DONE') await markFailed(d.id);
      throw badRequest('PAYMENT_VERIFICATION_FAILED', '결제 정보가 주문과 일치하지 않습니다.');
    }
    const row = await markDone(d, p);
    if (row) {
      await announce(row);
      return row;
    }
    const current = await db.query.donations.findFirst({ where: eq(donations.id, d.id) });
    if (current?.status !== 'DONE') throw conflict('DONATION_NOT_PENDING', '이미 처리된 주문입니다.');
    return current;
  }

  /** 처리 중인 승인 결과를 잠시 조회해 본다. 끝나지 않았으면 502 를 돌려주고 정리 작업이 반영한다. */
  async function waitForApproval(paymentKey: string, orderId: string): Promise<TossPayment> {
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const p = await payments.getPayment(paymentKey).catch(() => null);
      if (p && p.status === 'DONE') return p;
    }
    log.warn({ orderId }, 'concurrent toss confirm still processing; sweep will settle');
    throw new AppError(502, 'PAYMENT_GATEWAY_ERROR', '결제 확인이 지연되고 있습니다. 잠시 후 자동으로 반영됩니다.');
  }

  return {
    enabled,

    async createOrder(donorId: string, broadcastId: string, input: { amount: number; message?: string | null }) {
      const { b, owner } = await broadcasts.mustFind(broadcastId);
      if (b.ownerId === donorId) throw forbidden('DONATION_SELF', '내 방송에는 후원할 수 없습니다.');
      if (b.status !== 'LIVE') throw conflict('BROADCAST_NOT_LIVE', '방송 중일 때만 후원할 수 있습니다.');
      if (!enabled()) throw new AppError(503, 'DONATIONS_DISABLED', '후원 기능이 설정되지 않았습니다.');
      const orderId = `dd_${randomToken(18)}`;
      await db.insert(donations).values({
        id: newId(),
        orderId,
        broadcastId,
        donorId,
        recipientId: b.ownerId, // 받는 사람은 서버가 방송 소유자로 고정한다.
        amount: input.amount,
        message: input.message || null,
        createdAt: clock(),
      });
      return {
        orderId,
        amount: input.amount,
        orderName: `${owner.nickname}님에게 후원`,
        recipient: owner,
        customerKey: donorId,
        clientKey: deps.config.toss.clientKey,
      };
    },

    async confirm(userId: string, input: { paymentKey: string; orderId: string; amount: number }) {
      const d = await db.query.donations.findFirst({ where: eq(donations.orderId, input.orderId) });
      if (!d) throw notFound('DONATION_NOT_FOUND', '주문을 찾을 수 없습니다.');
      if (d.donorId !== userId) throw forbidden('DONATION_NOT_DONOR', '내 주문만 확정할 수 있습니다.');
      if (d.status === 'DONE') {
        if (d.paymentKey === input.paymentKey) return withDonor(d);
        throw conflict('DONATION_NOT_PENDING', '이미 처리된 주문입니다.');
      }
      if (d.status === 'FAILED') throw conflict('DONATION_NOT_PENDING', '만료되었거나 실패한 주문입니다.');
      if (input.amount !== d.amount) {
        throw badRequest('DONATION_AMOUNT_MISMATCH', '결제 금액이 주문 금액과 다릅니다.');
      }

      // 승인 전에 paymentKey 를 남겨 둔다. 승인 직후 장애가 나도 정리 작업이 이 키로 조회해 반영한다.
      try {
        const [remembered] = await db
          .update(donations)
          .set({ paymentKey: input.paymentKey })
          .where(
            and(
              eq(donations.id, d.id),
              eq(donations.status, 'PENDING'),
              or(isNull(donations.paymentKey), eq(donations.paymentKey, input.paymentKey)),
            ),
          )
          .returning({ id: donations.id });
        if (!remembered) throw conflict('DONATION_NOT_PENDING', '이미 다른 결제로 처리 중인 주문입니다.');
      } catch (err) {
        if (uniqueViolation(err)) throw conflict('PAYMENT_KEY_IN_USE', '이미 사용된 결제입니다.');
        throw err;
      }

      let payment: TossPayment;
      try {
        payment = await payments.confirm({ paymentKey: input.paymentKey, orderId: d.orderId, amount: d.amount });
      } catch (err) {
        if (err instanceof TossError && err.code === 'ALREADY_PROCESSED_PAYMENT') {
          payment = await payments.getPayment(input.paymentKey);
        } else if (err instanceof TossError && (err.code === 'IDEMPOTENT_REQUEST_PROCESSING' || err.httpStatus === 409)) {
          // 같은 주문의 다른 승인 요청이 처리 중이다. 실패로 보지 않고 그 결과를 기다린다.
          payment = await waitForApproval(input.paymentKey, d.orderId);
        } else if (err instanceof TossError && err.httpStatus >= 400 && err.httpStatus < 500) {
          log.info({ orderId: d.orderId, tossCode: err.code }, 'payment rejected by toss');
          await markFailed(d.id);
          throw badRequest('PAYMENT_REJECTED', err.message, { tossCode: err.code });
        } else {
          log.error({ err, orderId: d.orderId }, 'toss confirm failed; sweep will retry');
          throw new AppError(502, 'PAYMENT_GATEWAY_ERROR', '결제 확인이 지연되고 있습니다. 잠시 후 자동으로 반영됩니다.');
        }
      }
      return withDonor(await settle(d, payment));
    },

    /** 토스 웹훅(보조 경로). 바디는 믿지 않고 paymentKey 로 다시 조회한다. */
    async handleWebhook(body: { eventType?: string; data?: { paymentKey?: string } }) {
      const paymentKey = body.data?.paymentKey;
      if (body.eventType !== 'PAYMENT_STATUS_CHANGED' || !paymentKey) return 'ignored' as const;

      const lockKey = `wh:toss:${paymentKey}`;
      if ((await deps.redis.set(lockKey, '1', 'EX', 30, 'NX')) !== 'OK') {
        throw conflict('WEBHOOK_IN_PROGRESS', '같은 결제를 처리하는 중입니다.');
      }
      try {
        let payment: TossPayment;
        try {
          payment = await payments.getPayment(paymentKey);
        } catch (err) {
          if (err instanceof TossError && err.httpStatus === 404) return 'ignored' as const;
          throw err;
        }
        const d = await db.query.donations.findFirst({ where: eq(donations.orderId, payment.orderId) });
        if (!d) return 'ignored' as const;

        // 이벤트 기록과 상태 변경을 한 트랜잭션에 넣는다. 처리가 실패하면 함께 롤백돼서 재전송이 버려지지 않는다.
        const done = await db.transaction(async (tx) => {
          const inserted = await tx
            .insert(webhookEvents)
            .values({ source: 'toss', eventId: `${payment.paymentKey}:${payment.status}`, receivedAt: clock() })
            .onConflictDoNothing()
            .returning();
          if (!inserted.length) return null;
          if (verified(d, payment)) return markDone(d, payment, tx);
          if (TERMINAL_FAILURES.has(payment.status)) {
            await tx
              .update(donations)
              .set({ status: 'FAILED' })
              .where(and(eq(donations.id, d.id), eq(donations.status, 'PENDING')));
          }
          return null;
        });
        if (done) await announce(done);
        return 'processed' as const;
      } finally {
        await deps.redis.del(lockKey);
      }
    },

    /** 10분 넘은 PENDING 은 조회해서 반영하고, 30분 넘게 결제가 없으면 FAILED. */
    async sweep() {
      const now = clock().getTime();
      const stale = await db
        .select()
        .from(donations)
        .where(and(eq(donations.status, 'PENDING'), lte(donations.createdAt, new Date(now - SWEEP_AFTER_MS))));
      for (const d of stale) {
        let payment: TossPayment | null = null;
        try {
          payment = d.paymentKey
            ? await payments.getPayment(d.paymentKey)
            : await payments.getPaymentByOrderId(d.orderId);
        } catch (err) {
          const notFound = err instanceof TossError && err.httpStatus === 404;
          if (!notFound) log.warn({ err, orderId: d.orderId }, 'donation sweep lookup failed');
          // paymentKey 가 있으면 승인을 시도한 주문이라 조회가 될 때까지 기다린다.
          // 없으면 승인 요청 자체가 없었으므로(confirm 이 승인 전에 키를 남긴다) 아래 30분 만료 규칙을 그대로 적용한다.
          if (!notFound && d.paymentKey) continue;
        }
        if (payment && verified(d, payment)) {
          const row = await markDone(d, payment);
          if (row) await announce(row);
        } else if (
          (payment && TERMINAL_FAILURES.has(payment.status)) ||
          d.createdAt.getTime() <= now - EXPIRE_AFTER_MS
        ) {
          await markFailed(d.id);
          log.info({ orderId: d.orderId }, 'stale donation marked FAILED');
        }
      }
    },

    async summary(broadcastId: string, limit: number, cursorId: string | null) {
      await broadcasts.mustFind(broadcastId);
      const rows = await db
        .select({ d: donations, donor: { id: users.id, nickname: users.nickname } })
        .from(donations)
        .innerJoin(users, eq(users.id, donations.donorId))
        .where(
          and(
            eq(donations.broadcastId, broadcastId),
            eq(donations.status, 'DONE'),
            cursorId ? lt(donations.id, cursorId) : undefined,
          ),
        )
        .orderBy(desc(donations.id))
        .limit(limit + 1);
      const [total] = await db
        .select({ sum: sql<string>`coalesce(sum(${donations.amount}), 0)` })
        .from(donations)
        .where(and(eq(donations.broadcastId, broadcastId), eq(donations.status, 'DONE')));
      const page = rows.slice(0, limit);
      return {
        total: Number(total?.sum ?? 0),
        items: page.map((r) => donationView(r.d, r.donor)),
        nextId: rows.length > limit ? page[page.length - 1]!.d.id : null,
      };
    },
  };
}

export type DonationService = ReturnType<typeof createDonationService>;
