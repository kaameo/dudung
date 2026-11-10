import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@node-rs/argon2', 'bullmq', 'ioredis', 'pino', 'postgres'],
  poweredByHeader: false,
  // SSE(text/event-stream)가 압축 버퍼에 막히지 않도록 압축은 Caddy 에 맡긴다.
  compress: false,
};

export default nextConfig;
