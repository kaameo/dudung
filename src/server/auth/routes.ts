import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { AppError, conflict, notFound, uniqueViolation, unauthorized } from '@/server/common/errors';
import { newId } from '@/server/common/ids';
import { enforceRateLimit } from '@/server/common/rate-limit';
import { users } from '@/server/db/schema';
import { clientIp, parseJson, requireUser, type AppEnv, type Ctx } from '@/server/http';
import type { Deps } from '@/server/ports';
import { TEST_ACCOUNTS } from '@/server/seed';
import { hashPassword, verifyPassword } from './password';
import { ACCESS_TTL_SEC, REFRESH_TTL_SEC, type IssuedTokens, type TokenService } from './tokens';

export const ACCESS_COOKIE = 'at';
export const REFRESH_COOKIE = 'rt';
const REFRESH_PATH = '/api/auth';

const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8, '비밀번호는 8자 이상이어야 합니다.').max(128),
  nickname: z.string().trim().min(2).max(20),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});

const testLoginSchema = z.object({ account: z.enum(TEST_ACCOUNTS) });

export const publicUser = (u: { id: string; email: string; nickname: string }) => ({
  id: u.id,
  email: u.email,
  nickname: u.nickname,
});

export function authRoutes(deps: Deps, tokens: TokenService) {
  const { db, redis, config } = deps;
  const app = new Hono<AppEnv>();

  const setSession = (c: Ctx, t: IssuedTokens) => {
    const base = { httpOnly: true, secure: config.secureCookies, sameSite: 'Lax' as const };
    setCookie(c, ACCESS_COOKIE, t.access, { ...base, path: '/', maxAge: ACCESS_TTL_SEC });
    setCookie(c, REFRESH_COOKIE, t.refresh, { ...base, path: REFRESH_PATH, maxAge: REFRESH_TTL_SEC });
  };

  const clearSession = (c: Ctx) => {
    deleteCookie(c, ACCESS_COOKIE, { path: '/', secure: config.secureCookies });
    deleteCookie(c, REFRESH_COOKIE, { path: REFRESH_PATH, secure: config.secureCookies });
  };

  app.post('/auth/signup', async (c) => {
    await enforceRateLimit(redis, 'signup', clientIp(c), config.limits.signupPerMinute);
    const input = await parseJson(c, signupSchema);
    const id = newId();
    try {
      await db.insert(users).values({
        id,
        email: input.email,
        nickname: input.nickname,
        passwordHash: await hashPassword(input.password),
      });
    } catch (err) {
      const constraint = uniqueViolation(err);
      if (constraint?.includes('email')) throw conflict('EMAIL_TAKEN', '이미 가입된 이메일입니다.');
      if (constraint?.includes('nickname')) throw conflict('NICKNAME_TAKEN', '이미 쓰는 닉네임입니다.');
      throw err;
    }
    setSession(c, await tokens.issue(id));
    c.get('log').info({ userId: id }, 'user signed up');
    return c.json({ user: publicUser({ id, email: input.email, nickname: input.nickname }) }, 201);
  });

  app.post('/auth/login', async (c) => {
    await enforceRateLimit(redis, 'login', clientIp(c), config.limits.loginPerMinute);
    const input = await parseJson(c, loginSchema);
    const user = await db.query.users.findFirst({ where: eq(users.email, input.email) });
    if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
      throw new AppError(401, 'INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다.');
    }
    setSession(c, await tokens.issue(user.id));
    return c.json({ user: publicUser(user) });
  });

  app.post('/auth/test-login', async (c) => {
    if (!config.testLoginEnabled) throw notFound('NOT_FOUND', '찾을 수 없습니다.');
    const { account } = await parseJson(c, testLoginSchema);
    const user = await db.query.users.findFirst({ where: eq(users.email, `${account}@dudung.test`) });
    if (!user) throw notFound('TEST_ACCOUNT_MISSING', '테스트 계정이 아직 준비되지 않았습니다(seed 필요).');
    setSession(c, await tokens.issue(user.id));
    return c.json({ user: publicUser(user) });
  });

  app.post('/auth/refresh', async (c) => {
    try {
      setSession(c, await tokens.refresh(getCookie(c, REFRESH_COOKIE)));
    } catch (err) {
      clearSession(c);
      throw err;
    }
    return c.json({ ok: true });
  });

  app.post('/auth/logout', async (c) => {
    await tokens.revoke(getCookie(c, ACCESS_COOKIE), getCookie(c, REFRESH_COOKIE));
    clearSession(c);
    return c.body(null, 204);
  });

  app.get('/me', async (c) => {
    const { id } = requireUser(c);
    const user = await db.query.users.findFirst({ where: eq(users.id, id) });
    if (!user) throw unauthorized();
    return c.json({ user: publicUser(user) });
  });

  return app;
}
