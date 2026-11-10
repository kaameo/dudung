#!/usr/bin/env bash
# 권한 매트릭스를 curl 로 재현한다. UI 가 숨기는 서버 측 거절(401·403)을 직접 확인하는 용도다.
#   BASE_URL=https://dudung.duckdns.org scripts/authz-check.sh
# 필요: bash, curl, jq. 고정 테스트 계정(streamer1 = 소유자, streamer2 = 다른 사용자)과 TEST_LOGIN_ENABLED=true.
set -uo pipefail

BASE_URL="${BASE_URL:-http://localhost}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
FAIL=0

jar() { echo "$WORK/$1.cookies"; }

# req <actor> <method> <path> [json-body] → 상태 코드를 출력하고 본문은 $WORK/last.json 에 남긴다.
req() {
  local actor=$1 method=$2 path=$3 body=${4:-}
  local args=(-s -o "$WORK/last.json" -w '%{http_code}' -X "$method" "$BASE_URL$path")
  [[ $actor != anon ]] && args+=(-b "$(jar "$actor")" -c "$(jar "$actor")")
  [[ $method != GET ]] && args+=(-H "Origin: $BASE_URL")
  [[ -n $body ]] && args+=(-H 'Content-Type: application/json' --data "$body")
  curl "${args[@]}"
}

login() {
  local code
  code=$(req "$1" POST /api/auth/test-login "{\"account\":\"$2\"}")
  [[ $code == 200 ]] || { echo "테스트 로그인 실패($2): $code $(cat "$WORK/last.json")"; exit 1; }
}

printf '%-28s %-14s %-14s %-14s\n' '기능' '비로그인' '다른 사용자' '소유자·작성자'
printf '%s\n' '------------------------------------------------------------------------------'

# row <이름> <기대값 anon,other,owner> <명령 anon> <명령 other> <명령 owner>
row() {
  local name=$1 expected=$2; shift 2
  IFS=, read -r e_anon e_other e_owner <<<"$expected"
  local got_anon got_other got_owner
  got_anon=$(eval "$1"); got_other=$(eval "$2"); got_owner=$(eval "$3")
  # 기대값은 '201|503' 처럼 여러 개를 줄 수 있다.
  cell() { if [[ "|$1|" == *"|$2|"* ]]; then printf '✅ %-11s' "$2"; else printf '❌ %s≠%-6s' "$2" "$1"; FAIL=1; fi; }
  printf '%-28s ' "$name"; cell "$e_anon" "$got_anon"; cell "$e_other" "$got_other"; cell "$e_owner" "$got_owner"; echo
}

login owner streamer1
login other streamer2
OWNER_ID=$(req owner GET /api/me >/dev/null; jq -r .user.id "$WORK/last.json")

# 준비: 소유자 방송 2개(B1 은 시작해서 LIVE, B2 는 삭제용 READY), 다른 사용자의 LIVE 방송(OB).
req owner POST /api/broadcasts '{"title":"[authz] 시작할 방송"}' >/dev/null; B1=$(jq -r .broadcast.id "$WORK/last.json")
req owner POST /api/broadcasts '{"title":"[authz] 지울 방송"}' >/dev/null; B2=$(jq -r .broadcast.id "$WORK/last.json")
req other POST /api/broadcasts '{"title":"[authz] 다른 사용자 방송"}' >/dev/null; OB=$(jq -r .broadcast.id "$WORK/last.json")
req other POST "/api/broadcasts/$OB/start" '{"source":"CAMERA"}' >/dev/null; OTHER_TOKEN=$(jq -r .token "$WORK/last.json")

row '방송 목록'           200,200,200 "req anon GET /api/broadcasts" "req other GET /api/broadcasts" "req owner GET /api/broadcasts"
row '채널 페이지'         200,200,200 "req anon GET /api/channels/$OWNER_ID" "req other GET /api/channels/$OWNER_ID" "req owner GET /api/channels/$OWNER_ID"
row '방송 등록'           401,201,201 "req anon POST /api/broadcasts '{\"title\":\"x\"}'" "req other POST /api/broadcasts '{\"title\":\"[authz] tmp\"}'" "req owner POST /api/broadcasts '{\"title\":\"[authz] tmp\"}'"
row '내 방송 목록'        401,200,200 "req anon GET /api/me/broadcasts" "req other GET /api/me/broadcasts" "req owner GET /api/me/broadcasts"
row '방송 시작'           401,403,200 "req anon POST /api/broadcasts/$B1/start '{\"source\":\"SCREEN\"}'" "req other POST /api/broadcasts/$B1/start '{\"source\":\"SCREEN\"}'" "req owner POST /api/broadcasts/$B1/start '{\"source\":\"SCREEN\"}'"
OWNER_TOKEN=$(jq -r .token "$WORK/last.json")
row '방송 상세·시청 정보' 200,200,200 "req anon GET /api/broadcasts/$B1" "req other GET /api/broadcasts/$B1" "req owner GET /api/broadcasts/$B1"
row '방송 수정'           401,403,200 "req anon PATCH /api/broadcasts/$B1 '{\"title\":\"x\"}'" "req other PATCH /api/broadcasts/$B1 '{\"title\":\"x\"}'" "req owner PATCH /api/broadcasts/$B1 '{\"title\":\"[authz] 수정됨\"}'"
row '송출 토큰 재발급'    401,403,200 "req anon POST /api/broadcasts/$B1/publish-token" "req other POST /api/broadcasts/$B1/publish-token" "req owner POST /api/broadcasts/$B1/publish-token"

# WHIP: MediaMTX 가 인증 훅으로 앱에 묻는다. 허용되면 SDP 검사로 넘어가므로(가짜 SDP → 400) 401 이 아니면 허용이다.
whip() { curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/sdp' --data 'v=0' "$BASE_URL/media/live/$B1/whip$1"; }
whip_owner() { local c; c=$(whip "?token=$OWNER_TOKEN"); [[ $c != 401 ]] && echo 'allow' || echo 401; }
row 'MediaMTX 송출(WHIP)' 401,401,allow "whip ''" "whip '?token=$OTHER_TOKEN'" "whip_owner"

row '댓글 조회'           200,200,200 "req anon GET /api/broadcasts/$B1/comments" "req other GET /api/broadcasts/$B1/comments" "req owner GET /api/broadcasts/$B1/comments"
row '댓글 작성'           401,201,201 "req anon POST /api/broadcasts/$B1/comments '{\"body\":\"x\"}'" "req other POST /api/broadcasts/$B1/comments '{\"body\":\"[authz] 다른 사용자\"}'" "req owner POST /api/broadcasts/$B1/comments '{\"body\":\"[authz] 작성자\"}'"
C1=$(jq -r .comment.id "$WORK/last.json")
row '댓글 수정'           401,403,200 "req anon PATCH /api/comments/$C1 '{\"body\":\"x\"}'" "req other PATCH /api/comments/$C1 '{\"body\":\"x\"}'" "req owner PATCH /api/comments/$C1 '{\"body\":\"[authz] 수정\"}'"

# 토스 키를 설정하지 않은 환경에서는 후원 기능이 꺼져 있어 503 이다.
row '후원 요청'           '401,201|503,403' "req anon POST /api/broadcasts/$B1/donations '{\"amount\":1000}'" "req other POST /api/broadcasts/$B1/donations '{\"amount\":1000}'" "req owner POST /api/broadcasts/$B1/donations '{\"amount\":1000}'"
row '후원 내역·합계'      200,200,200 "req anon GET /api/broadcasts/$B1/donations" "req other GET /api/broadcasts/$B1/donations" "req owner GET /api/broadcasts/$B1/donations"
row '녹화 목록'           200,200,200 "req anon GET /api/recordings" "req other GET /api/recordings" "req owner GET /api/recordings"
row '방송 종료'           401,403,200 "req anon POST /api/broadcasts/$B1/end" "req other POST /api/broadcasts/$B1/end" "req owner POST /api/broadcasts/$B1/end"
row '댓글 삭제'           401,403,204 "req anon DELETE /api/comments/$C1" "req other DELETE /api/comments/$C1" "req owner DELETE /api/comments/$C1"
row '방송 삭제'           401,403,204 "req anon DELETE /api/broadcasts/$B2" "req other DELETE /api/broadcasts/$B2" "req owner DELETE /api/broadcasts/$B2"

# 정리: 이 스크립트가 만든 방송([authz] 접두사)을 지운다. LIVE 면 삭제가 먼저 종료한다.
for actor in owner other; do
  req "$actor" GET '/api/me/broadcasts?limit=50' >/dev/null
  for id in $(jq -r '.items[] | select(.title | startswith("[authz]")) | .id' "$WORK/last.json"); do
    req "$actor" DELETE "/api/broadcasts/$id" >/dev/null
  done
done

echo
if [[ $FAIL == 0 ]]; then echo '모든 칸이 기대한 결과와 같습니다.'; else echo '기대와 다른 칸이 있습니다.'; exit 1; fi
