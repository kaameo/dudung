import { importPKCS8, importSPKI, jwtVerify, SignJWT, type CryptoKey } from 'jose';
import { AppError } from '@/server/common/errors';
import { newId } from '@/server/common/ids';
import type { Deps } from '@/server/ports';

export const ACCESS_TTL_SEC = 10 * 60;
export const REFRESH_TTL_SEC = 14 * 24 * 3600;
/** 교체된 refresh 토큰을 같은 결과로 받아 주는 유예 시간. 탭 여러 개가 동시에 refresh 하는 경우를 위한 것이다. */
export const REFRESH_GRACE_MS = 30_000;

export interface IssuedTokens {
  access: string;
  refresh: string;
}

const rtKey = (jti: string) => `auth:rt:${jti}`;
const familyKey = (family: string) => `auth:family:${family}`;
const blacklistKey = (jti: string) => `auth:bl:${jti}`;

/**
 * 교체(rotation)를 원자적으로 처리한다.
 * - 기록이 없으면 'missing'
 * - 이미 교체됐으면 교체 시각과 그때 발급한 토큰을 돌려준다
 * - 처음이면 교체 표시를 남기고 새 토큰을 등록한다
 */
const ROTATE_LUA = `
if redis.call('EXISTS', KEYS[1]) == 0 then return {'missing'} end
local rotatedAt = redis.call('HGET', KEYS[1], 'rotatedAt')
if rotatedAt then
  return {'rotated', rotatedAt, redis.call('HGET', KEYS[1], 'newAccess'), redis.call('HGET', KEYS[1], 'newRefresh')}
end
redis.call('HSET', KEYS[1], 'rotatedAt', ARGV[1], 'newAccess', ARGV[2], 'newRefresh', ARGV[3])
redis.call('HSET', KEYS[2], 'userId', ARGV[4], 'family', ARGV[5])
redis.call('EXPIRE', KEYS[2], ARGV[6])
redis.call('SADD', KEYS[3], ARGV[7])
redis.call('EXPIRE', KEYS[3], ARGV[6])
return {'ok'}
`;

export function createTokenService(deps: Pick<Deps, 'config' | 'redis' | 'clock' | 'log'>) {
  const { redis, clock } = deps;
  let keys: Promise<{ priv: CryptoKey; pub: CryptoKey }> | null = null;
  const getKeys = () =>
    (keys ??= Promise.all([
      importPKCS8(deps.config.jwtPrivateKeyPem, 'ES256'),
      importSPKI(deps.config.jwtPublicKeyPem, 'ES256'),
    ]).then(([priv, pub]) => ({ priv, pub })));

  const nowSec = () => Math.floor(clock().getTime() / 1000);

  async function sign(claims: Record<string, unknown>, sub: string, jti: string, ttl: number) {
    const { priv } = await getKeys();
    const iat = nowSec();
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256' })
      .setSubject(sub)
      .setJti(jti)
      .setIssuedAt(iat)
      .setExpirationTime(iat + ttl)
      .sign(priv);
  }

  async function verify(token: string, typ: 'access' | 'refresh') {
    const { pub } = await getKeys();
    try {
      const { payload } = await jwtVerify(token, pub, { algorithms: ['ES256'], currentDate: clock() });
      if (payload.typ !== typ || !payload.sub || !payload.jti || !payload.exp) return null;
      return payload as { sub: string; jti: string; exp: number; fam?: string };
    } catch {
      return null;
    }
  }

  async function mintPair(userId: string, family: string) {
    const refreshJti = newId();
    const [access, refresh] = await Promise.all([
      sign({ typ: 'access' }, userId, newId(), ACCESS_TTL_SEC),
      sign({ typ: 'refresh', fam: family }, userId, refreshJti, REFRESH_TTL_SEC),
    ]);
    return { access, refresh, refreshJti };
  }

  async function revokeFamily(family: string) {
    const members = await redis.smembers(familyKey(family));
    const pipeline = redis.pipeline();
    for (const jti of members) pipeline.del(rtKey(jti));
    pipeline.del(familyKey(family));
    await pipeline.exec();
  }

  return {
    /** 새 로그인: 새 family 를 만든다. */
    async issue(userId: string): Promise<IssuedTokens> {
      const family = newId();
      const { access, refresh, refreshJti } = await mintPair(userId, family);
      await redis
        .multi()
        .hset(rtKey(refreshJti), 'userId', userId, 'family', family)
        .expire(rtKey(refreshJti), REFRESH_TTL_SEC)
        .sadd(familyKey(family), refreshJti)
        .expire(familyKey(family), REFRESH_TTL_SEC)
        .exec();
      return { access, refresh };
    },

    async refresh(refreshToken: string | undefined): Promise<IssuedTokens> {
      const invalid = new AppError(401, 'REFRESH_INVALID', '다시 로그인해 주세요.');
      if (!refreshToken) throw invalid;
      const claims = await verify(refreshToken, 'refresh');
      if (!claims?.fam) throw invalid;

      const next = await mintPair(claims.sub, claims.fam);
      const now = clock().getTime();
      const result = (await redis.eval(
        ROTATE_LUA,
        3,
        rtKey(claims.jti),
        rtKey(next.refreshJti),
        familyKey(claims.fam),
        String(now),
        next.access,
        next.refresh,
        claims.sub,
        claims.fam,
        String(REFRESH_TTL_SEC),
        next.refreshJti,
      )) as string[];

      if (result[0] === 'ok') return { access: next.access, refresh: next.refresh };
      if (result[0] === 'rotated') {
        const rotatedAt = Number(result[1]);
        if (now - rotatedAt <= REFRESH_GRACE_MS) return { access: result[2]!, refresh: result[3]! };
        deps.log.warn({ family: claims.fam, userId: claims.sub }, 'refresh token reuse detected; revoking family');
        await revokeFamily(claims.fam);
        throw new AppError(401, 'REFRESH_REUSED', '보안을 위해 로그아웃되었습니다. 다시 로그인해 주세요.');
      }
      throw invalid;
    },

    /** access 토큰을 검증한다. 로그아웃으로 블랙리스트에 오른 토큰은 거절한다. */
    async verifyAccess(token: string | undefined) {
      if (!token) return null;
      const claims = await verify(token, 'access');
      if (!claims) return null;
      if (await redis.exists(blacklistKey(claims.jti))) return null;
      return { id: claims.sub, jti: claims.jti, exp: claims.exp };
    },

    async revoke(accessToken: string | undefined, refreshToken: string | undefined) {
      if (accessToken) {
        const claims = await verify(accessToken, 'access');
        if (claims) {
          const remaining = Math.max(1, claims.exp - nowSec());
          await redis.set(blacklistKey(claims.jti), '1', 'EX', remaining);
        }
      }
      if (refreshToken) {
        const claims = await verify(refreshToken, 'refresh');
        if (claims?.fam) {
          // 이 기기에서 이어진 토큰(같은 family) 전체를 지운다. 다른 기기의 로그인은 family 가 다르다.
          await revokeFamily(claims.fam);
        }
      }
    },
  };
}

export type TokenService = ReturnType<typeof createTokenService>;
