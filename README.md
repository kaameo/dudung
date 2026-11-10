# 두둥 (Dudung) — 브라우저 라이브 방송

PC 화면공유와 휴대폰 카메라로 **브라우저만으로** 송출하고, **로그인 없이** 다른 기기에서 실시간으로 보는 라이브 방송 서비스입니다.

| 항목 | 내용 |
| --- | --- |
| **서비스 주소** | https://dudung.duckdns.org _(배포 후 확정 — 아래 「운영 배포」 참고)_ |
| **시연 영상** | _(촬영 후 링크 추가: PC 송출·모바일 송출·시청·종료·권한·선택 기능)_ |
| **테스트 로그인** | 로그인 화면의 **「테스트 계정으로 바로 로그인」** 버튼 (회원가입 불필요) |

---

## 1. 테스트 계정

| 계정 | 이메일 | 비밀번호 | 용도 |
| --- | --- | --- | --- |
| 방송자 1 | `streamer1@dudung.test` | `dudung1234!` | 방송 소유자 |
| 방송자 2 | `streamer2@dudung.test` | `dudung1234!` | 다른 사용자(권한 거절 확인) |
| 방송자 3 | `streamer3@dudung.test` | `dudung1234!` | 여분 |
| 시청자 1 | `viewer1@dudung.test` | `dudung1234!` | 댓글·후원 |
| 시청자 2 | `viewer2@dudung.test` | `dudung1234!` | 댓글·후원 |
| demo | `demo@dudung.test` | _(로그인 불가)_ | 지울 수 없는 「다른 사용자 방송」과 다시보기 예시 |

- `/login` 화면 위쪽 버튼을 누르면 해당 계정으로 바로 로그인됩니다. 이메일·비밀번호로 직접 로그인해도 됩니다.
- **소유자와 다른 사용자 비교**: 브라우저 두 개(또는 일반 창 + 시크릿 창)에서 각각 `방송자 1`, `방송자 2`로 로그인하세요.
- 모든 고정 계정은 서버가 시작될 때 seed 로 다시 만들어집니다.

## 2. 기능 확인 절차

### PC 라이브 방송 (화면 + 탭/시스템 소리 + 마이크)
1. PC Chrome 에서 `방송자 1`로 로그인 → 상단 **방송하기** → 제목 입력 → **등록하고 스튜디오로**.
2. 스튜디오에서 **🖥️ 화면 공유** 선택 → **방송 시작**.
3. 공유 창에서 탭·창·전체 화면 중 하나를 고르고, **「탭 오디오 공유」(탭) 또는 「시스템 오디오 공유」(전체 화면)** 를 켭니다. 마이크 권한도 허용합니다.
   - 송출 중인 스튜디오 탭 자신은 공유 목록에 나오지 않습니다(무한 반복 화면 방지).
   - **마이크 / 화면 소리 음량 미터**로 소리가 실제로 들어가는지 확인합니다. 화면 소리를 빼면 경고가 뜨고 마이크만 송출됩니다.
4. 휴대폰(또는 다른 브라우저)에서 서비스 주소를 열면 목록 맨 위에 LIVE 방송이 보입니다. 로그인 없이 눌러서 시청하고, **🔇 탭해서 소리 켜기**로 소리를 켭니다.
5. 스튜디오의 **■ 방송 종료** 또는 브라우저의 **「공유 중지」** 를 누르면 방송이 끝나고, 시청 화면은 **「방송이 종료되었습니다」** 로 바뀝니다.

### 모바일 라이브 방송 (카메라 + 마이크)
1. 휴대폰(iOS Safari / Android Chrome)에서 서비스 주소(HTTPS) 접속 → 로그인 → **방송하기** → 등록.
2. 스튜디오에는 **📱 카메라**만 보입니다(모바일은 화면공유 송출을 지원하지 않음). **방송 시작** → 카메라·마이크 허용.
3. **🔄 카메라 전환**으로 전·후면을 바꿉니다. 방송 중에는 화면이 꺼지지 않습니다(Wake Lock).
4. PC 에서 방송을 열어 시청합니다. 다른 앱에 갔다가 30초 안에 돌아오면 방송이 이어집니다.
5. 휴대폰의 **■ 방송 종료**로 끝내면 PC 시청 화면이 종료 안내로 바뀝니다.

### 방송 관리와 시청
- **내 방송**(`/me/broadcasts`): READY(대기) 방송을 포함한 내 방송 목록. 여기서 스튜디오로 들어갑니다.
- 제목·설명은 READY·LIVE·ENDED 어느 상태에서든 스튜디오에서 수정할 수 있고, LIVE 중 수정은 시청 화면에 바로 반영됩니다.
- **삭제**하면 LIVE 방송은 먼저 종료된 뒤 목록·상세·다시보기에서 사라집니다.
- 종료된 방송은 다시 켤 수 없습니다. 다시 방송하려면 새 방송을 등록합니다.
- **채널 페이지**(`/channels/:userId`, 방송자 닉네임 클릭): 지금 LIVE 면 플레이어, 아니면 지난 방송 목록. 열어 두면 방송이 시작될 때 자동으로 재생됩니다.
- READY 방송 링크로 들어온 시청자는 대기 화면을 보다가 시작되면 자동으로 재생됩니다.
- 서버를 재시작해도 방송 정보·상태·지난 방송은 PostgreSQL 에 남아 있습니다.

### 선택 기능
- **댓글**: 방송 상세 오른쪽 패널. 로그인하면 상태와 상관없이 작성하고, LIVE 중에는 실시간(SSE)으로 나타납니다. 내 댓글에 마우스를 올리면 수정·삭제가 보입니다.
- **후원**: 다른 사람의 LIVE 방송에서 **💝 후원하기** → 받는 사람(방송자 닉네임)을 확인하고 금액(1,000~100,000원)·메시지 입력 → 토스페이먼츠 **테스트 결제**(실제 출금 없음). 결제가 확정되면 방송 화면에 후원 알림이 뜨고, 상세 화면 아래에 후원 내역과 합계가 보입니다. 내 방송에는 후원할 수 없습니다.
- **다시보기**: LIVE 방송은 자동으로 녹화됩니다. 종료 후 처리(합치기·업로드)가 끝나면 종료된 방송 상세의 **▶ 다시보기** 또는 상단 **다시보기** 메뉴에서 재생합니다. demo 계정의 예시 다시보기가 기본으로 들어 있습니다.

## 3. 권한 확인

권한 판단은 모두 서버(서비스 계층)에서 합니다. UI 는 권한 없는 버튼을 숨기므로, 서버 측 거절은 아래 스크립트로 직접 확인합니다.

| 기능 | 비로그인 | 다른 사용자 | 소유자 |
| --- | --- | --- | --- |
| 방송 목록·채널 페이지 | 허용 | 허용 | 허용 |
| 방송 상세·시청 | 허용 (READY 는 대기 화면) | 허용 (READY 는 대기 화면) | 허용 |
| 방송 등록 | 401 | 허용 | 허용 |
| 내 방송 목록 | 401 | 본인 것만 | 본인 것만 |
| 방송 수정·삭제 | 401 | 403 | 허용 |
| 방송 시작·종료·송출 토큰 재발급 | 401 | 403 | 허용 |
| MediaMTX 송출 (WHIP) | 거절 | 거절 | 허용 (유효 토큰 + LIVE) |
| 녹화 목록·재생 | 허용 | 허용 | 허용 |
| 댓글 조회 | 허용 | 허용 | 허용 |
| 댓글 작성 | 401 | 허용 | 허용 |
| 댓글 수정·삭제 | 401 | 403 (작성자만) | 작성자만 |
| 후원 요청 | 401 | 허용 (LIVE 만) | 403 (자기 방송 후원 불가) |
| 후원 내역·합계 조회 | 허용 | 허용 | 허용 |

```bash
# 필요: bash, curl, jq
BASE_URL=https://dudung.duckdns.org scripts/authz-check.sh
```
각 칸을 비로그인·다른 사용자(`streamer2`)·소유자(`streamer1`)로 요청해 기대 코드와 비교하고 ✅/❌ 로 출력합니다. 스크립트가 만든 방송은 끝에 지웁니다. 같은 표가 통합 테스트(`tests/integration/authz-matrix.test.ts`)의 케이스 목록입니다.

## 4. 지원 환경

| 환경 | 화면 송출 | 탭 소리 | 시스템 소리 | 카메라 송출 | 시청 |
| --- | --- | --- | --- | --- | --- |
| Windows Chrome·Edge | O | O | O | O | O |
| macOS Chrome | O | O | 실기기 확인 필요 (macOS 14.2+ 에서 지원) | O | O |
| macOS Safari | O | X | X | O | O |
| Firefox (Windows·macOS) | O | X | X | O | O |
| Android Chrome | X | X | X | O | O |
| iOS Safari | X | X | X | O | O |

- 영상은 H.264 를 우선합니다(PC 1080p 15fps 최대 2.5Mbps, 모바일 720p 30fps 최대 1.5Mbps).
- 미디어는 UDP 8189 로 주고받고, UDP 가 막히면 TCP 8189 로 시도합니다. **443 포트만 열린 엄격한 회사·학교망에서는 시청이 안 될 수 있습니다**(TURN 서버 미사용).
- 모바일 송출은 HTTPS 가 필요해서 배포 서버로 확인합니다. PC 는 `http://localhost` 도 동작합니다.

## 5. 실행 방법

### 로컬 (명령 하나로 전체 스택)
필요: Docker (Desktop) · Node 24 · pnpm 10 (`corepack enable`)

```bash
scripts/gen-keys.sh > deploy/compose/.env                          # ES256 JWT 키쌍 (한 번만)
echo "MEDIA_HOST_IP=$(ipconfig getifaddr en0)" >> deploy/compose/.env  # PC 의 LAN IP (Linux: hostname -I | cut -d' ' -f1)
docker compose -f deploy/compose/compose.local.yml up -d --build
open http://localhost
```
app, worker, PostgreSQL, Redis, MediaMTX, Caddy, S3 호환 저장소(SeaweedFS — R2 대체)를 띄웁니다. 도메인·클라우드 계정이 필요 없습니다.
`MEDIA_HOST_IP` 는 MediaMTX 가 WebRTC 후보로 알릴 주소입니다. 크롬은 `127.0.0.1` 후보로는 연결하지 않아서 PC 의 LAN IP 를 씁니다(UDP·TCP 8189 를 엽니다).
토스 테스트 키가 있으면 `deploy/compose/.env` 에 `TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY` 를 추가하세요. 없으면 후원 UI 만 숨겨지고 나머지는 그대로 동작합니다.

### 테스트
```bash
pnpm install
pnpm typecheck
pnpm lint        # oxlint (타입 정보가 필요한 규칙 포함, 경고도 실패로 본다)
pnpm test        # 통합 테스트: testcontainers 로 PostgreSQL·Redis 를 띄운다 (Docker 필요)
pnpm test:e2e    # 브라우저 E2E: 위 로컬 스택을 띄운 뒤 실행 (Google Chrome, 가짜 카메라·마이크)
```

### 환경변수 (`.env.example`)
| 이름 | 설명 |
| --- | --- |
| `APP_URL` | 서비스 주소. 쿠키 Secure 여부와 Origin 검사 기준 |
| `DATABASE_URL`, `REDIS_URL` | PostgreSQL, Redis |
| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` | ES256 PEM (`scripts/gen-keys.sh`) |
| `INTERNAL_SECRET` | MediaMTX 훅 → 앱 내부 API 공유 비밀키 |
| `MEDIAMTX_API_URL`, `MEDIAMTX_PUBLIC_IP` | Control API 주소, WebRTC 로 알릴 서버 공인 IP |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | 녹화·백업 저장소 (Cloudflare R2) |
| `TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY` | 토스페이먼츠 결제위젯 **테스트** 키 (`test_gck_…`, `test_gsk_…`) |
| `TEST_LOGIN_ENABLED` | 고정 계정 원클릭 로그인 |

### 운영 배포 (Oracle Cloud Always Free ARM, 월 0원)
1. 사람이 할 일: DuckDNS 서브도메인 → 서버 공인 IP, Oracle VCN 보안 목록과 서버 iptables 에서 **80, 443, 8189(UDP·TCP)** 열기, R2 버킷·API 토큰, 토스 테스트 키, GitHub Secrets(`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`)와 변수 `DEPLOY_ENABLED=true`.
2. 서버의 `~/dudung/.env` 에 `.env.example` 값을 채웁니다(실제 비밀값은 서버와 GitHub Secrets 에만).
3. `main` 에 머지하면 GitHub Actions 가 ARM64 이미지를 빌드해 GHCR 에 올리고, SSH 로 `docker compose pull && up -d` 합니다. 마이그레이션과 seed 는 one-shot `migrate` 컨테이너가 앱보다 먼저 실행합니다.
4. 외부 업타임 모니터로 `https://<도메인>/readyz` 를 1분마다 확인합니다(DB·Redis·MediaMTX 까지 검사). DB 는 매일 `pg_dump` 를 R2 `backups/` 에 올리고 7일 보관합니다.

## 6. 설계 요약

```
브라우저 ──HTTPS──▶ Caddy ──▶ app (Next.js + Hono API, SSE)  ──▶ PostgreSQL / Redis
   │                  └─/media/*─▶ MediaMTX (WHIP·WHEP, 녹화) ──인증·송출 훅──▶ app
   └──── UDP/TCP 8189 (영상 패킷, Caddy·앱을 거치지 않음) ────▶ MediaMTX
worker (BullMQ): 30초 유예 종료 · 2분 시작 타임아웃 · 정합성 정리(1분) · 녹화 합치기(ffmpeg) → R2 · 후원 정리 · DB 백업
```
- **채널과 방송**: 사용자 한 명이 채널 하나. 방송 하나는 송출 한 번입니다.
- **상태 전환**: `READY → LIVE → ENDED`. 모든 전환은 「기대 상태일 때만 바꾸는」 조건부 업데이트라 종료 버튼과 훅이 동시에 와도 한 번만 처리됩니다. 사용자당 LIVE 는 부분 UNIQUE 인덱스로 하나만 허용합니다.
  - 시작 후 **2분** 안에 송출이 한 번도 붙지 않으면 READY 로 돌아갑니다(유일한 역방향 전환).
  - 송출이 끊겨도 **30초** 안에 돌아오면 이어지고, 아니면 `ENDED(DISCONNECTED)`.
  - 종료 사유: `OWNER`(종료 버튼), `DISCONNECTED`(30초 미복귀), `DELETED`(LIVE 중 삭제), `RECONCILED`(정합성 정리).
  - 종료는 DB 를 먼저 ENDED 로 바꾼 뒤 송출 세션을 끊습니다. 끊기가 실패해도 인증 훅이 재송출을 막고, 정합성 정리가 1분 안에 다시 끊습니다.
- **미디어 인증**: MediaMTX 가 송출·시청 요청마다 앱에 묻습니다. 송출은 유효한 송출 토큰(15분, Redis) + 토큰 사용자 = 소유자 + LIVE 일 때만, 시청은 LIVE 일 때만 허용합니다.
- **인증**: ES256 JWT. access 10분(쿠키 `Path=/`), refresh 14일(쿠키 `Path=/api/auth`), 둘 다 httpOnly. refresh 는 사용할 때마다 교체하고, 교체된 토큰이 30초 안에 다시 오면(탭 여러 개) 같은 결과를 주며, 30초가 지나 다시 오면 탈취로 보고 그 로그인 계열 전체를 폐기합니다. 로그아웃은 access 를 남은 수명 동안 블랙리스트에 올립니다. 쓰기 요청은 Origin 을 검사합니다(웹훅 제외). 로그인 5회/분, 회원가입 3회/분, 댓글 10회/분 제한.
- **후원**: 서버가 받는 사람을 방송 소유자로 고정하고, 승인 시 저장 금액과 요청 금액을 대조한 뒤 토스 승인(Idempotency-Key = orderId) → 응답의 orderId·금액·DONE 재확인 → `PENDING` 일 때만 `DONE`. 같은 승인 통지가 confirm·웹훅·정리 작업 어디로 반복되어도 한 번만 적립됩니다. 웹훅은 바디를 믿지 않고 결제 조회로 재확인하며, 이벤트 기록을 상태 변경과 같은 트랜잭션에 넣어 처리 실패 시 재전송이 반영되게 합니다. 승인 직후 장애가 나도 10분 뒤 정리 작업이 조회해서 반영합니다.
- **녹화 용량 정책**: 녹화는 방송당 **60분**까지 저장합니다. 업로드 후 READY 녹화 크기 합이 **8GB**(R2 무료 10GB의 80%)를 넘으면 **demo 계정 것을 제외하고 가장 오래된 녹화부터** R2 객체와 행을 지웁니다.

## 7. 오픈소스 출처

| 이름 | 용도 | 라이선스 |
| --- | --- | --- |
| [MediaMTX](https://github.com/bluenviron/mediamtx) | WebRTC 미디어 서버(WHIP/WHEP, 녹화). `src/lib/client/webrtc.ts` 는 저장소의 publisher/reader 예제를 참고 | MIT |
| [Next.js](https://github.com/vercel/next.js), [React](https://github.com/facebook/react) | 웹 앱 | MIT |
| [Hono](https://github.com/honojs/hono) | API 라우팅·SSE | MIT |
| [Drizzle ORM](https://github.com/drizzle-team/drizzle-orm), [postgres.js](https://github.com/porsager/postgres) | DB | Apache-2.0, Unlicense |
| [BullMQ](https://github.com/taskforcesh/bullmq), [ioredis](https://github.com/redis/ioredis) | 작업 큐, Redis | MIT |
| [jose](https://github.com/panva/jose) | JWT | MIT |
| [@node-rs/argon2](https://github.com/napi-rs/node-rs) | 비밀번호 해시(argon2id) | MIT |
| [zod](https://github.com/colinhacks/zod), [pino](https://github.com/pinojs/pino), [uuid](https://github.com/uuidjs/uuid) | 검증, 로깅, UUIDv7 | MIT |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) | 스타일. UI 컴포넌트는 [shadcn/ui](https://github.com/shadcn-ui/ui)(MIT) 형태를 참고해 직접 작성 | MIT |
| [AWS SDK for JavaScript v3](https://github.com/aws/aws-sdk-js-v3) | R2(S3 호환) 업로드·presigned URL | Apache-2.0 |
| [토스페이먼츠 JavaScript SDK](https://www.npmjs.com/package/@tosspayments/tosspayments-sdk) | 결제위젯(테스트 모드) | 토스페이먼츠 이용약관 |
| [Caddy](https://github.com/caddyserver/caddy) | HTTPS·리버스 프록시 | Apache-2.0 |
| [FFmpeg](https://ffmpeg.org) | 녹화 조각 합치기 | LGPL/GPL |
| [SeaweedFS](https://github.com/seaweedfs/seaweedfs) | 로컬 개발용 S3 호환 저장소 | Apache-2.0 |
| [Vitest](https://github.com/vitest-dev/vitest), [Testcontainers](https://github.com/testcontainers/testcontainers-node), [Playwright](https://github.com/microsoft/playwright) | 테스트 | MIT, MIT, Apache-2.0 |
| [Oxlint](https://github.com/oxc-project/oxc), [oxlint-tsgolint](https://github.com/oxc-project/tsgolint) | 린트 | MIT |

설계 근거는 `plan.html`(설계 문서)과 `REQUIREMENTS.md`(공모 요강)에 있습니다.
