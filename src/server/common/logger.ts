import pino from 'pino';

export type Logger = pino.Logger;

export function createLogger(level = process.env.LOG_LEVEL ?? 'info'): Logger {
  return pino({
    level,
    base: { service: process.env.SERVICE_NAME ?? 'app' },
    // 송출 토큰과 인증 쿠키는 로그에 남기지 않는다.
    redact: { paths: ['token', '*.token', 'cookie', '*.cookie', 'headers.cookie'], censor: '[redacted]' },
  });
}
