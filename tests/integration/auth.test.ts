import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '@/server/app';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
beforeEach(() => h.reset());
afterAll(() => h.close());

const signupBody = (n: string) => ({ email: `${n}@example.com`, password: 'password123!', nickname: n });

describe('회원가입', () => {
  it('가입하면 바로 로그인된다', async () => {
    const a = h.anon();
    const res = await a.post('/api/auth/signup', signupBody('alice'));
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'alice@example.com', nickname: 'alice' });

    const me = await a.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.user.nickname).toBe('alice');
  });

  it('이미 쓰는 이메일과 닉네임은 거절한다', async () => {
    await h.anon().post('/api/auth/signup', signupBody('bob'));
    const dupEmail = await h.anon().post('/api/auth/signup', { ...signupBody('bob'), nickname: 'other' });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body.code).toBe('EMAIL_TAKEN');
    const dupNick = await h.anon().post('/api/auth/signup', { ...signupBody('bob'), email: 'x@example.com' });
    expect(dupNick.status).toBe(409);
    expect(dupNick.body.code).toBe('NICKNAME_TAKEN');
  });

  it('형식이 틀린 입력은 problem+json 400으로 거절한다', async () => {
    const res = await h.anon().post('/api/auth/signup', { email: 'nope', password: '1', nickname: '' });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });
});

describe('로그인과 고정 계정', () => {
  it('README의 고정 계정 이메일·비밀번호로 로그인한다', async () => {
    const a = h.anon();
    const res = await a.post('/api/auth/login', { email: 'streamer1@dudung.test', password: 'dudung1234!' });
    expect(res.status).toBe(200);
    expect((await a.get('/api/me')).body.user.email).toBe('streamer1@dudung.test');
  });

  it('비밀번호가 틀리면 401', async () => {
    const res = await h.anon().post('/api/auth/login', { email: 'streamer1@dudung.test', password: 'wrong-pass' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('원클릭 테스트 로그인으로 고정 계정에 들어간다', async () => {
    const a = await h.as('viewer2');
    expect((await a.get('/api/me')).body.user.email).toBe('viewer2@dudung.test');
  });

  it('플래그가 꺼져 있으면 테스트 로그인이 없다', async () => {
    const app = createApp({ ...h.deps, config: { ...h.deps.config, testLoginEnabled: false } });
    const res = await app.request('https://dudung.test/api/auth/test-login', {
      method: 'POST',
      headers: { origin: 'https://dudung.test', 'content-type': 'application/json' },
      body: JSON.stringify({ account: 'streamer1' }),
    });
    expect(res.status).toBe(404);
  });

  it('demo 계정으로는 로그인할 수 없다', async () => {
    const res = await h.anon().post('/api/auth/login', { email: 'demo@dudung.test', password: 'dudung1234!' });
    expect(res.status).toBe(401);
  });

  it('로그인하지 않으면 /api/me 는 401', async () => {
    const res = await h.anon().get('/api/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });
});

describe('토큰 수명과 refresh', () => {
  it('access 가 만료되면 refresh 로 다시 받는다', async () => {
    const a = await h.as('streamer1');
    h.clock.advance(11 * 60 * 1000);
    expect((await a.get('/api/me')).status).toBe(401);

    const r = await a.post('/api/auth/refresh');
    expect(r.status).toBe(200);
    expect((await a.get('/api/me')).status).toBe(200);
  });

  it('refresh 쿠키는 인증 API 경로로만 보낸다', async () => {
    const a = h.anon();
    const res = await a.post('/api/auth/login', { email: 'viewer1@dudung.test', password: 'dudung1234!' });
    const rt = res.headers.getSetCookie().find((c: string) => c.startsWith('rt='))!;
    expect(rt).toContain('Path=/api/auth');
    expect(rt).toContain('HttpOnly');
    expect(rt).toContain('SameSite=Lax');
  });

  it('14일 동안은 다시 로그인하지 않아도 된다', async () => {
    const a = await h.as('streamer1');
    h.clock.advance(13 * 24 * 3600 * 1000);
    expect((await a.post('/api/auth/refresh')).status).toBe(200);
    expect((await a.get('/api/me')).status).toBe(200);
  });

  it('탭 두 개가 같은 refresh 토큰으로 동시에 refresh 해도 둘 다 성공하고 로그아웃되지 않는다', async () => {
    const tab1 = await h.as('streamer1');
    const tab2 = tab1.clone();
    h.clock.advance(11 * 60 * 1000);

    const [r1, r2] = await Promise.all([tab1.post('/api/auth/refresh'), tab2.post('/api/auth/refresh')]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(tab1.cookie('rt')).toBe(tab2.cookie('rt'));
    expect((await tab1.get('/api/me')).status).toBe(200);
    expect((await tab2.get('/api/me')).status).toBe(200);

    // 회전된 새 토큰으로 계속 쓸 수 있다.
    h.clock.advance(11 * 60 * 1000);
    expect((await tab1.post('/api/auth/refresh')).status).toBe(200);
  });

  it('30초가 지난 뒤 교체된 refresh 토큰이 다시 오면 탈취로 보고 그 로그인 계열 전체를 폐기한다', async () => {
    const victim = await h.as('streamer1');
    const attacker = victim.clone();

    expect((await victim.post('/api/auth/refresh')).status).toBe(200);
    h.clock.advanceSeconds(31);

    const stolen = await attacker.post('/api/auth/refresh');
    expect(stolen.status).toBe(401);
    expect(stolen.body.code).toBe('REFRESH_REUSED');

    // 피해자가 가진 새 refresh 토큰도 함께 폐기된다.
    expect((await victim.post('/api/auth/refresh')).status).toBe(401);
  });

  it('다른 기기의 로그인은 영향받지 않는다', async () => {
    const pc = await h.as('streamer1');
    const phone = await h.as('streamer1');
    const attacker = pc.clone();
    await pc.post('/api/auth/refresh');
    h.clock.advanceSeconds(31);
    await attacker.post('/api/auth/refresh');
    expect((await phone.post('/api/auth/refresh')).status).toBe(200);
  });
});

describe('로그아웃', () => {
  it('로그아웃하면 그 기기의 access 와 refresh 가 즉시 끊긴다', async () => {
    const a = await h.as('viewer1');
    const stolenCopy = a.clone();
    const out = await a.post('/api/auth/logout');
    expect(out.status).toBe(204);

    expect((await a.get('/api/me')).status).toBe(401);
    // 로그아웃 전에 복사해 둔 쿠키도 더는 통하지 않는다.
    expect((await stolenCopy.get('/api/me')).status).toBe(401);
    expect((await stolenCopy.post('/api/auth/refresh')).status).toBe(401);
  });
});

describe('보호 장치', () => {
  it('로그인은 IP당 1분에 5번까지', async () => {
    const a = h.anon();
    const tries = [];
    for (let i = 0; i < 6; i++) {
      tries.push((await a.post('/api/auth/login', { email: 'viewer1@dudung.test', password: 'wrong-pass' })).status);
    }
    expect(tries.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(tries[5]).toBe(429);
  });

  it('회원가입은 IP당 1분에 3번까지', async () => {
    const a = h.anon();
    const statuses = [];
    for (let i = 0; i < 4; i++) statuses.push((await a.post('/api/auth/signup', signupBody(`rl${i}`))).status);
    expect(statuses).toEqual([201, 201, 201, 429]);
  });

  it('쓰기 요청은 앱 도메인 Origin 만 받는다', async () => {
    const a = h.anon();
    const noOrigin = await a.req('POST', '/api/auth/login', {
      body: { email: 'viewer1@dudung.test', password: 'dudung1234!' },
      origin: null,
    });
    expect(noOrigin.status).toBe(403);
    expect(noOrigin.body.code).toBe('ORIGIN_MISMATCH');
    const evil = await a.req('POST', '/api/auth/login', {
      body: { email: 'viewer1@dudung.test', password: 'dudung1234!' },
      origin: 'https://evil.example',
    });
    expect(evil.status).toBe(403);
  });
});
