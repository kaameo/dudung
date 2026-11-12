import { Hono } from 'hono';
import { z } from 'zod';
import { decodeCursor, encodeCursor, pageQuery, parseWith, requireUser, uuidParam, type AppEnv } from '@/server/http';
import type { RecordingService } from './service';

export function recordingRoutes(service: RecordingService) {
  const app = new Hono<AppEnv>();

  app.get('/recordings', async (c) => {
    const q = parseWith(pageQuery, c.req.query());
    const cursor = decodeCursor(q.cursor, z.object({ id: z.string().uuid() }));
    const { items, nextId } = await service.list(q.limit, cursor?.id ?? null);
    return c.json({ items, nextCursor: nextId ? encodeCursor({ id: nextId }) : null });
  });

  app.get('/recordings/:id', async (c) => {
    const id = parseWith(uuidParam, c.req.param('id'));
    return c.json({ recording: await service.detail(id) });
  });

  app.delete('/recordings/:id', async (c) => {
    const user = requireUser(c);
    const id = parseWith(uuidParam, c.req.param('id'));
    await service.remove(id, user.id);
    return c.body(null, 204);
  });

  return app;
}
