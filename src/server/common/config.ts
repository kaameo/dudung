import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  APP_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_PRIVATE_KEY: z.string().min(1),
  JWT_PUBLIC_KEY: z.string().min(1),
  INTERNAL_SECRET: z.string().min(16),
  MEDIAMTX_API_URL: z.string().url().default('http://127.0.0.1:9997'),
  RECORDINGS_DIR: z.string().default('/recordings'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().default('dudung'),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,
  /** presigned URL을 브라우저가 열 수 있는 주소로 바꿔야 할 때(로컬 S3) 쓴다. */
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  TOSS_CLIENT_KEY: z.string().optional(),
  TOSS_SECRET_KEY: z.string().optional(),
  TEST_LOGIN_ENABLED: bool,
  LOG_LEVEL: z.string().default('info'),
});

export interface AppConfig {
  appUrl: string;
  appOrigin: string;
  secureCookies: boolean;
  databaseUrl: string;
  redisUrl: string;
  jwtPrivateKeyPem: string;
  jwtPublicKeyPem: string;
  internalSecret: string;
  mediamtxApiUrl: string;
  recordingsDir: string;
  s3: {
    endpoint?: string;
    publicEndpoint?: string;
    region: string;
    bucket: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    forcePathStyle: boolean;
  };
  toss: { clientKey?: string; secretKey?: string };
  testLoginEnabled: boolean;
  logLevel: string;
  limits: {
    loginPerMinute: number;
    signupPerMinute: number;
    commentPerMinute: number;
  };
  /** READY 녹화 크기 합의 상한. 넘으면 demo 를 제외하고 오래된 녹화부터 지운다. */
  recordingCapBytes: number;
}

export const DEFAULT_LIMITS = { loginPerMinute: 5, signupPerMinute: 3, commentPerMinute: 10 };
export const RECORDING_CAP_BYTES = 8 * 1024 ** 3;

const pem = (v: string) => v.replace(/\\n/g, '\n');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const e = envSchema.parse(env);
  const url = new URL(e.APP_URL);
  return {
    appUrl: e.APP_URL.replace(/\/$/, ''),
    appOrigin: url.origin,
    secureCookies: url.protocol === 'https:',
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    jwtPrivateKeyPem: pem(e.JWT_PRIVATE_KEY),
    jwtPublicKeyPem: pem(e.JWT_PUBLIC_KEY),
    internalSecret: e.INTERNAL_SECRET,
    mediamtxApiUrl: e.MEDIAMTX_API_URL.replace(/\/$/, ''),
    recordingsDir: e.RECORDINGS_DIR,
    s3: {
      endpoint: e.S3_ENDPOINT || undefined,
      publicEndpoint: e.S3_PUBLIC_ENDPOINT || undefined,
      region: e.S3_REGION,
      bucket: e.S3_BUCKET,
      accessKeyId: e.S3_ACCESS_KEY_ID || undefined,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY || undefined,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
    },
    toss: { clientKey: e.TOSS_CLIENT_KEY || undefined, secretKey: e.TOSS_SECRET_KEY || undefined },
    testLoginEnabled: e.TEST_LOGIN_ENABLED,
    logLevel: e.LOG_LEVEL,
    limits: DEFAULT_LIMITS,
    recordingCapBytes: RECORDING_CAP_BYTES,
  };
}
