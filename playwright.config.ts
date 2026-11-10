import { defineConfig } from '@playwright/test';

/**
 * 브라우저 E2E (미디어 경로만). 로컬 compose 로 전체 스택을 띄운 뒤 실행한다.
 *   docker compose -f deploy/compose/compose.local.yml up -d --build
 *   pnpm test:e2e
 * 가짜 카메라·마이크 장치를 쓴다. H.264 인코더가 있는 Google Chrome 채널을 쓴다.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost',
    channel: process.env.PW_CHANNEL ?? 'chrome',
    headless: true,
    permissions: ['camera', 'microphone'],
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    },
    trace: 'retain-on-failure',
  },
});
