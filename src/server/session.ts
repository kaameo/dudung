import { cookies } from 'next/headers';
import { ACCESS_COOKIE } from '@/server/auth/routes';
import { createTokenService, type TokenService } from '@/server/auth/tokens';
import { getDeps } from '@/server/container';

let tokens: TokenService | null = null;

/** 서버 컴포넌트에서 현재 로그인 사용자를 확인한다. access 가 만료됐으면 null(클라이언트가 refresh 한다). */
export async function getSessionUser() {
  tokens ??= createTokenService(getDeps());
  const store = await cookies();
  return tokens.verifyAccess(store.get(ACCESS_COOKIE)?.value);
}
