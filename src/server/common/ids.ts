import { randomBytes } from 'node:crypto';
import { v7 } from 'uuid';

export const newId = (): string => v7();

/** URL 안전한 무작위 문자열. 송출 토큰과 주문 번호에 쓴다. */
export const randomToken = (bytes = 24): string => randomBytes(bytes).toString('base64url');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string): boolean => UUID_RE.test(v);

export type Clock = () => Date;
export const systemClock: Clock = () => new Date();
