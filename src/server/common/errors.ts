/**
 * 앱 전체에서 쓰는 에러. HTTP 경계에서 application/problem+json 으로 바뀐다.
 * code 는 클라이언트와 테스트가 기대하는 안정된 식별자다.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const unauthorized = (message = '로그인이 필요합니다.') =>
  new AppError(401, 'UNAUTHENTICATED', message);

export const notFound = (code: string, message: string) => new AppError(404, code, message);

export const forbidden = (code: string, message: string) => new AppError(403, code, message);

export const conflict = (code: string, message: string) => new AppError(409, code, message);

export const badRequest = (code: string, message: string, extra?: Record<string, unknown>) =>
  new AppError(400, code, message, extra);

export const tooManyRequests = (message = '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.') =>
  new AppError(429, 'RATE_LIMITED', message);

export interface Problem {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  [key: string]: unknown;
}

export function toProblem(err: AppError): Problem {
  return {
    type: 'about:blank',
    title: err.message,
    status: err.status,
    code: err.code,
    ...(err.extra ?? {}),
  };
}

/** Postgres 고유 제약 위반인지, 그리고 어느 제약인지 확인한다. Drizzle은 원인 에러를 cause 로 감싼다. */
export function uniqueViolation(err: unknown): string | null {
  let cur: unknown = err;
  for (let i = 0; i < 3 && cur; i++) {
    const e = cur as { code?: string; constraint_name?: string; constraint?: string; cause?: unknown };
    if (e.code === '23505') return e.constraint_name ?? e.constraint ?? 'unknown';
    cur = e.cause;
  }
  return null;
}
