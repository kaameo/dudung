import { expect, test, type Browser, type Page } from '@playwright/test';

async function loginAs(browser: Browser, account: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByTestId('test-login').getByRole('button', { name: new RegExp(account) }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  return page;
}

async function startCameraBroadcast(streamer: Page, title: string) {
  await streamer.goto('/broadcasts/new');
  await streamer.getByPlaceholder('방송 제목').fill(title);
  await streamer.getByRole('button', { name: '등록하고 스튜디오로' }).click();
  await streamer.waitForURL(/\/studio$/);
  const id = streamer.url().split('/').at(-2)!;
  await streamer.getByRole('button', { name: /카메라/ }).click();
  const startRes = streamer.waitForResponse((r) => r.url().endsWith(`/api/broadcasts/${id}/start`));
  await streamer.getByTestId('start-broadcast').click();
  const { token } = await (await startRes).json();
  // 송출 연결이 실제로 붙어야(connectionState=connected) 보이는 표시.
  await expect(streamer.getByTestId('on-air')).toBeVisible({ timeout: 30_000 });
  return { id, token: token as string };
}

/** 영상이 실제로 디코딩되고 있는지 본다. */
const playing = (page: Page, testId: string) =>
  expect
    .poll(
      () =>
        page.getByTestId(testId).evaluate((v: HTMLVideoElement) => v.readyState >= 2 && v.videoWidth > 0),
      { timeout: 45_000 },
    )
    .toBe(true);

test('송출 → 다른 브라우저에서 비로그인 시청 → 종료 → 시청 화면이 종료 안내로 바뀐다', async ({ browser }) => {
  const streamer = await loginAs(browser, 'streamer1');
  const { id } = await startCameraBroadcast(streamer, `E2E 송출 ${Date.now()}`);

  const viewerCtx = await browser.newContext();
  const viewer = await viewerCtx.newPage();
  await viewer.goto(`/broadcasts/${id}`);
  await playing(viewer, 'live-video');

  await streamer.getByTestId('end-broadcast').click();
  await expect(viewer.getByTestId('ended-screen')).toBeVisible({ timeout: 20_000 });
  await expect(viewer.getByText('방송이 종료되었습니다')).toBeVisible();

  // 종료하면 스튜디오의 카메라·마이크가 꺼진다.
  await expect
    .poll(() => streamer.getByTestId('studio-preview').evaluate((v: HTMLVideoElement) => v.srcObject === null))
    .toBe(true);
});

test('종료 후 같은 송출 토큰으로 WHIP 재송출은 거절된다', async ({ browser }) => {
  const streamer = await loginAs(browser, 'streamer2');
  const { id, token } = await startCameraBroadcast(streamer, `E2E 재송출 ${Date.now()}`);
  await streamer.getByTestId('end-broadcast').click();
  await expect(streamer.getByText('종료된 방송입니다.')).toBeVisible();

  const status = await streamer.evaluate(
    async (args) => {
      const pc = new RTCPeerConnection();
      pc.addTransceiver('video', { direction: 'sendonly' });
      pc.addTransceiver('audio', { direction: 'sendonly' });
      await pc.setLocalDescription(await pc.createOffer());
      const res = await fetch(`/media/live/${args.id}/whip?token=${encodeURIComponent(args.token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/sdp' },
        body: pc.localDescription!.sdp,
        signal: AbortSignal.timeout(15_000),
      });
      pc.close();
      return res.status;
    },
    { id, token },
  );
  expect(status).toBe(401);
});

test('녹화가 READY 가 되면 다시보기에서 재생된다', async ({ browser, request }) => {
  const streamer = await loginAs(browser, 'streamer3');
  const { id } = await startCameraBroadcast(streamer, `E2E 녹화 ${Date.now()}`);
  await streamer.waitForTimeout(8_000); // 몇 초 분량을 녹화한다.
  await streamer.getByTestId('end-broadcast').click();

  let recordingId = '';
  await expect
    .poll(
      async () => {
        const res = await request.get(`/api/broadcasts/${id}`);
        const { broadcast } = await res.json();
        recordingId = broadcast.recording?.id ?? '';
        return broadcast.recording?.status;
      },
      { timeout: 90_000, intervals: [2000] },
    )
    .toBe('READY');

  const viewer = await (await browser.newContext()).newPage();
  await viewer.goto(`/recordings/${recordingId}`);
  await expect
    .poll(() => viewer.getByTestId('recording-video').evaluate((v: HTMLVideoElement) => v.readyState >= 1 && v.duration > 3), {
      timeout: 30_000,
    })
    .toBe(true);

  // 방송 소유자는 다시보기를 지울 수 있다(녹화 파일도 함께 지워진다).
  await streamer.goto(`/recordings/${recordingId}`);
  streamer.once('dialog', (d) => void d.accept());
  await streamer.getByTestId('delete-recording').click();
  await streamer.waitForURL(/\/recordings$/);
  expect((await request.get(`/api/recordings/${recordingId}`)).status()).toBe(404);
  // 소유자가 아니면 삭제 버튼이 보이지 않는다(demo 다시보기).
  await viewer.goto('/recordings/01930000-0000-7000-8000-00000000a001');
  await expect(viewer.getByTestId('recording-video')).toBeVisible();
  await expect(viewer.getByTestId('delete-recording')).toHaveCount(0);
});
