import { hash, verify } from '@node-rs/argon2';

// @node-rs/argon2 기본값이 argon2id(m=19456, t=2, p=1)다. OWASP 권장 최소값과 같다.
export const hashPassword = (password: string): Promise<string> => hash(password);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // demo 계정처럼 해시가 아닌 값이 들어 있으면 로그인할 수 없다.
    return false;
  }
}

/** 로그인할 수 없는 계정에 넣는 값. argon2 해시 형식이 아니라서 어떤 비밀번호도 맞지 않는다. */
export const DISABLED_PASSWORD = '!login-disabled';
