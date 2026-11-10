import type { Context } from 'hono';
import { z } from 'zod';
import { badRequest, unauthorized } from '@/server/common/errors';
import type { Logger } from '@/server/common/logger';

export interface AuthUser {
  id: string;
  /** access 토큰 식별자. 로그아웃 시 블랙리스트에 올린다. */
  jti: string;
  exp: number;
}

export type AppEnv = {
  Variables: {
    requestId: string;
    log: Logger;
    user: AuthUser | null;
  };
};

export type Ctx = Context<AppEnv>;

export function requireUser(c: Ctx): AuthUser {
  const user = c.get('user');
  if (!user) throw unauthorized();
  return user;
}

export async function parseJson<S extends z.ZodType>(c: Ctx, schema: S): Promise<z.infer<S>> {
  let raw: unknown = {};
  const text = await c.req.text();
  if (text) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw badRequest('INVALID_JSON', '요청 본문이 올바른 JSON이 아닙니다.');
    }
  }
  return parseWith(schema, raw);
}

export function parseWith<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest('VALIDATION_FAILED', '입력값이 올바르지 않습니다.', {
      errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return parsed.data;
}

/** Caddy 뒤에서만 받으므로 X-Forwarded-For 의 마지막 값이 실제 클라이언트다. */
export function clientIp(c: Ctx): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1]!;
  }
  return 'unknown';
}

export const uuidParam = z.string().uuid();

/** 목록 API 공통 cursor 파라미터. */
export const pageQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export function encodeCursor(v: unknown): string {
  return Buffer.from(JSON.stringify(v)).toString('base64url');
}

export function decodeCursor<T>(cursor: string | undefined, schema: z.ZodType<T>): T | null {
  if (!cursor) return null;
  try {
    return parseWith(schema, JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw badRequest('INVALID_CURSOR', 'cursor 값이 올바르지 않습니다.');
  }
}
