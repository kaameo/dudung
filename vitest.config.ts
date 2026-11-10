import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/integration/**/*.test.ts', 'src/**/*.test.ts'],
    globalSetup: ['tests/integration/global-setup.ts'],
    // 모든 파일이 컨테이너 하나(Postgres, Redis)를 공유하므로 파일을 순서대로 돌린다.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
