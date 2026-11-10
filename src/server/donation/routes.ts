import { Hono } from 'hono';
import { z } from 'zod';
import {
  decodeCursor,
  encodeCursor,
  pageQuery,
  parseJson,
  parseWith,
  requireUser,
  uuidParam,
  type AppEnv,
} from '@/server/http';
import { MAX_AMOUNT, MIN_AMOUNT, type DonationService } from './service';

const orderSchema = z.object({
  amount: z
    .number()
    .int('금액은 원 단위 정수여야 합니다.')
    .min(MIN_AMOUNT, '1,000원부터 후원할 수 있습니다.')
    .max(MAX_AMOUNT, '100,000원까지 후원할 수 있습니다.'),
  message: z.string().trim().max(100).nullable().optional(),
});

const confirmSchema = z.object({
  paymentKey: z.string().min(1).max(200),
  orderId: z.string().min(6).max(64),
  amount: z.number().int(),
});

export function donationRoutes(service: DonationService) {
  const app = new Hono<AppEnv>();

  app.post('/broadcasts/:id/donations', async (c) => {
    const user = requireUser(c);
    const id = parseWith(uuidParam, c.req.param('id'));
    const input = await parseJson(c, orderSchema);
    return c.json(await service.createOrder(user.id, id, input), 201);
  });

  app.post('/donations/confirm', async (c) => {
    const user = requireUser(c);
    const input = await parseJson(c, confirmSchema);
    return c.json({ donation: await service.confirm(user.id, input) });
  });

  app.get('/broadcasts/:id/donations', async (c) => {
    const id = parseWith(uuidParam, c.req.param('id'));
    const q = parseWith(pageQuery, c.req.query());
    const cursor = decodeCursor(q.cursor, z.object({ id: z.string().uuid() }));
    const { total, items, nextId } = await service.summary(id, q.limit, cursor?.id ?? null);
    return c.json({ total, items, nextCursor: nextId ? encodeCursor({ id: nextId }) : null });
  });

  app.post('/webhooks/toss', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const result = await service.handleWebhook(body);
    c.get('log').info({ result }, 'toss webhook handled');
    return c.json({ ok: true, result });
  });

  return app;
}
