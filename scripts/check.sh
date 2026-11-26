#!/usr/bin/env bash
# CHK-1 cho GOAL-001: tự chứa hoàn toàn — npm ci, tsc, vitest, secret-scan,
# rồi smoke test server trên port riêng với DB tạm. Không dựa vào server/DB
# chạy sẵn ngoài repo. In PASS/FAIL từng bước, exit 0 chỉ khi tất cả xanh.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
FAIL=0

step() {
  local name="$1"; shift
  if "$@" >"/tmp/omniflow-check-step.log" 2>&1; then
    echo "PASS: $name"
  else
    echo "FAIL: $name"
    sed 's/^/  /' "/tmp/omniflow-check-step.log" | tail -30
    FAIL=1
  fi
}

step "npm ci" npm ci --no-audit --no-fund
step "tsc --noEmit" npx tsc --noEmit
step "vitest (L1+L2+L3)" npx vitest run

# Secret-scan: tìm literal gán mật khẩu/token/secret trong code và script.
# Chỉ quét src/ và scripts/ (không quét tests/ — fixture test ghi rõ là giả),
# bỏ qua dòng ghi chú placeholder/fake/example và đọc từ biến môi trường.
step "secret-scan" bash -c '
  hits=$(grep -rEn "(password|passwd|secret|api[_-]?key|access[_-]?token)[[:space:]]*[:=][[:space:]]*['\''\"][^'\''\"]+['\''\"]" src scripts --include="*.ts" --include="*.sh" 2>/dev/null | grep -viE "placeholder|fake|gia-lap|example|process\.env" || true)
  if [ -n "$hits" ]; then echo "$hits"; exit 1; fi
  echo "khong thay credential that trong src/ scripts/"
'

# Smoke test: server thật trên port riêng, DB tạm, seed bằng mật khẩu sinh ngẫu nhiên.
smoke() {
  local tmpdir port server_pid owner_pass staff_pass cookie health login owner_only staff_only
  tmpdir="$(mktemp -d)"
  trap 'kill "$server_pid" 2>/dev/null; rm -rf "$tmpdir"' RETURN
  port="$(node -e "const s=require('net').createServer();s.listen(0,()=>{console.log(s.address().port);s.close();})")"
  owner_pass="$(node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))")"
  staff_pass="$(node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))")"
  export OMNIFLOW_DB="$tmpdir/smoke.db"
  export OMNIFLOW_SEED_OWNER_PASSWORD="$owner_pass"
  export OMNIFLOW_SEED_STAFF_PASSWORD="$staff_pass"
  export PORT="$port"
  npm run seed >/dev/null 2>&1 || return 1
  (npx tsx src/server.ts >"$tmpdir/server.log" 2>&1 & echo $! >"$tmpdir/pid")
  server_pid="$(cat "$tmpdir/pid")"
  local i
  for i in $(seq 1 50); do
    if curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1; then break; fi
    sleep 0.2
  done
  health="$(curl -fsS "http://127.0.0.1:$port/health")" || return 1
  [ "$health" = '{"status":"ok"}' ] || { echo "health tra ve: $health"; return 1; }
  cookie="$tmpdir/cookie.txt"
  login="$(curl -fsS -c "$cookie" -H 'Content-Type: application/json' \
    -d "{\"email\":\"owner@example.local\",\"password\":\"$owner_pass\"}" \
    "http://127.0.0.1:$port/login")" || return 1
  echo "$login" | grep -q '"ok":true' || { echo "login tra ve: $login"; return 1; }
  owner_only="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/owner-only")" || return 1
  echo "$owner_only" | grep -q '"ok":true' || { echo "owner-only tra ve: $owner_only"; return 1; }
  # staff đăng nhập rồi gọi owner-only phải bị chặn
  local staff_cookie="$tmpdir/staff-cookie.txt"
  curl -fsS -c "$staff_cookie" -H 'Content-Type: application/json' \
    -d "{\"email\":\"staff@example.local\",\"password\":\"$staff_pass\"}" \
    "http://127.0.0.1:$port/login" >/dev/null || return 1
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$staff_cookie" "http://127.0.0.1:$port/owner-only")"
  [ "$code" = "403" ] || { echo "staff owner-only tra ve HTTP $code, mong 403"; return 1; }
  kill "$server_pid" 2>/dev/null
  wait "$server_pid" 2>/dev/null || true
  trap - RETURN
  rm -rf "$tmpdir"
  echo "smoke server tren port $port: health + login + owner-only + staff 403"
}
step "smoke server" smoke

if [ "$FAIL" -ne 0 ]; then echo "CHECK: FAIL"; exit 1; fi
echo "CHECK: PASS"
