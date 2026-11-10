import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { forbidden, notFound } from '@/server/common/errors';
import { newId } from '@/server/common/ids';
import { enforceRateLimit } from '@/server/common/rate-limit';
import { comments, users, type Comment } from '@/server/db/schema';
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
import type { BroadcastService } from '@/server/broadcast/service';
import type { Deps } from '@/server/ports';
import { publishEvent } from '@/server/realtime/hub';

const bodySchema = z.object({ body: z.string().trim().min(1, '내용을 입력해 주세요.').max(300) });

const view = (c: Comment, author: { id: string; nickname: string }) => ({
  id: c.id,
  broadcastId: c.broadcastId,
  body: c.body,
  author,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
  edited: c.updatedAt.getTime() !== c.createdAt.getTime(),
});

export function commentRoutes(deps: Deps, broadcasts: BroadcastService) {
  const { db, clock } = deps;
  const app = new Hono<AppEnv>();

  app.get('/broadcasts/:id/comments', async (c) => {
    const broadcastId = parseWith(uuidParam, c.req.param('id'));
    await broadcasts.mustFind(broadcastId);
    const q = parseWith(pageQuery, c.req.query());
    const cursor = decodeCursor(q.cursor, z.object({ id: z.string().uuid() }));
    const rows = await db
      .select({ c: comments, author: { id: users.id, nickname: users.nickname } })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(
        and(
          eq(comments.broadcastId, broadcastId),
          isNull(comments.deletedAt),
          cursor ? lt(comments.id, cursor.id) : undefined,
        ),
      )
      .orderBy(desc(comments.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    return c.json({
      items: page.map((r) => view(r.c, r.author)),
      nextCursor: rows.length > q.limit ? encodeCursor({ id: page[page.length - 1]!.c.id }) : null,
    });
  });

  app.post('/broadcasts/:id/comments', async (c) => {
    const user = requireUser(c);
    const broadcastId = parseWith(uuidParam, c.req.param('id'));
    await enforceRateLimit(deps.redis, 'comment', user.id, deps.config.limits.commentPerMinute);
    const { body } = await parseJson(c, bodySchema);
    await broadcasts.mustFind(broadcastId);
    const author = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    if (!author) throw notFound('USER_NOT_FOUND', '사용자를 찾을 수 없습니다.');
    const now = clock();
    const [row] = await db
      .insert(comments)
      .values({ id: newId(), broadcastId, authorId: user.id, body, createdAt: now, updatedAt: now })
      .returning();
    const comment = view(row!, { id: author.id, nickname: author.nickname });
    await publishEvent(deps, broadcastId, 'comment.created', comment);
    return c.json({ comment }, 201);
  });

  async function mustAuthor(commentId: string, userId: string) {
    const [row] = await db
      .select({ c: comments, author: { id: users.id, nickname: users.nickname } })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(and(eq(comments.id, commentId), isNull(comments.deletedAt)));
    if (!row) throw notFound('COMMENT_NOT_FOUND', '댓글을 찾을 수 없습니다.');
    if (row.c.authorId !== userId) throw forbidden('COMMENT_NOT_AUTHOR', '작성자만 할 수 있습니다.');
    return row;
  }

  app.patch('/comments/:id', async (c) => {
    const user = requireUser(c);
    const id = parseWith(uuidParam, c.req.param('id'));
    const { body } = await parseJson(c, bodySchema);
    const { author } = await mustAuthor(id, user.id);
    const [row] = await db
      .update(comments)
      .set({ body, updatedAt: clock() })
      .where(and(eq(comments.id, id), isNull(comments.deletedAt)))
      .returning();
    if (!row) throw notFound('COMMENT_NOT_FOUND', '댓글을 찾을 수 없습니다.');
    const comment = view(row, author);
    await publishEvent(deps, row.broadcastId, 'comment.updated', comment);
    return c.json({ comment });
  });

  app.delete('/comments/:id', async (c) => {
    const user = requireUser(c);
    const id = parseWith(uuidParam, c.req.param('id'));
    const { c: existing } = await mustAuthor(id, user.id);
    await db
      .update(comments)
      .set({ deletedAt: clock() })
      .where(and(eq(comments.id, id), isNull(comments.deletedAt)));
    await publishEvent(deps, existing.broadcastId, 'comment.deleted', { id });
    return c.body(null, 204);
  });

  return app;
}
