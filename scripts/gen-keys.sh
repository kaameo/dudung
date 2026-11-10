#!/usr/bin/env bash
# ES256 JWT 키쌍을 만들어 .env 형식(한 줄, \n 이스케이프)으로 출력한다.
#   scripts/gen-keys.sh >> deploy/compose/.env
set -euo pipefail
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
openssl ecparam -name prime256v1 -genkey -noout -out "$tmp/ec.pem"
openssl pkcs8 -topk8 -nocrypt -in "$tmp/ec.pem" -out "$tmp/private.pem"
openssl ec -in "$tmp/ec.pem" -pubout -out "$tmp/public.pem" 2>/dev/null
oneline() { awk 'BEGIN{ORS="\\n"} {print}' "$1"; }
echo "JWT_PRIVATE_KEY=\"$(oneline "$tmp/private.pem")\""
echo "JWT_PUBLIC_KEY=\"$(oneline "$tmp/public.pem")\""
