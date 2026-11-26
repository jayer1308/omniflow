#!/usr/bin/env bash
# CHK-2 cho GOAL-001: demo từng bước, in PASS/FAIL từng bước.
# Tự chứa: build, test, seed + start server trên port riêng với DB tạm,
# demo health/login/owner-only/idempotency/backup-restore rồi dọn dẹp.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
FAIL=0
TMPDIR_DEMO="$(mktemp -d)"
SERVER_PID=""
cleanup() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$TMPDIR_DEMO"
}
trap cleanup EXIT

demo_step() {
  local name="$1"; shift
  if "$@" >"$TMPDIR_DEMO/step.log" 2>&1; then
    echo "PASS: $name"
  else
    echo "FAIL: $name"
    sed 's/^/  /' "$TMPDIR_DEMO/step.log" | tail -20
    FAIL=1
  fi
}

demo_step "tsc --noEmit" npx tsc --noEmit
demo_step "vitest" npx vitest run

PORT_DEMO="$(node -e "const s=require('net').createServer();s.listen(0,()=>{console.log(s.address().port);s.close();})")"
OWNER_PASS="$(node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))")"
STAFF_PASS="$(node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))")"
export OMNIFLOW_DB="$TMPDIR_DEMO/demo.db"
export OMNIFLOW_SEED_OWNER_PASSWORD="$OWNER_PASS"
export OMNIFLOW_SEED_STAFF_PASSWORD="$STAFF_PASS"
export PORT="$PORT_DEMO"

demo_step "seed du lieu gia lap" npm run seed
npx tsx src/server.ts >"$TMPDIR_DEMO/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 50); do
  curl -fsS "http://127.0.0.1:$PORT_DEMO/health" >/dev/null 2>&1 && break
  sleep 0.2
done

check_health() {
  [ "$(curl -fsS "http://127.0.0.1:$PORT_DEMO/health")" = '{"status":"ok"}' ]
}
demo_step "GET /health tra {status: ok}" check_health

COOKIE="$TMPDIR_DEMO/cookie.txt"
login_owner() {
  curl -fsS -c "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"email\":\"owner@example.local\",\"password\":\"$OWNER_PASS\"}" \
    "http://127.0.0.1:$PORT_DEMO/login" | grep -q '"ok":true'
}
demo_step "dang nhap owner bang tai khoan seed" login_owner

owner_only_ok() {
  curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/owner-only" | grep -q '"ok":true'
}
demo_step "owner goi route owner-only duoc phep" owner_only_ok

STAFF_COOKIE="$TMPDIR_DEMO/staff-cookie.txt"
staff_blocked() {
  curl -fsS -c "$STAFF_COOKIE" -H 'Content-Type: application/json' \
    -d "{\"email\":\"staff@example.local\",\"password\":\"$STAFF_PASS\"}" \
    "http://127.0.0.1:$PORT_DEMO/login" >/dev/null
  [ "$(curl -s -o /dev/null -w '%{http_code}' -b "$STAFF_COOKIE" "http://127.0.0.1:$PORT_DEMO/owner-only")" = "403" ]
}
demo_step "staff goi route owner-only bi chan 403" staff_blocked

cross_org_blocked() {
  [ "$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/orgs/9999/branches")" = "403" ]
}
demo_step "truy cap org khac bi chan 403" cross_org_blocked

idempotency_demo() {
  local first second
  first="$(curl -fsS -b "$COOKIE" -H 'Idempotency-Key: demo-key-1' -H 'Content-Type: application/json' \
    -d '{"value":"xin-chao"}' "http://127.0.0.1:$PORT_DEMO/api/idempotent-demo")"
  second="$(curl -fsS -b "$COOKIE" -H 'Idempotency-Key: demo-key-1' -H 'Content-Type: application/json' \
    -d '{"value":"xin-chao"}' "http://127.0.0.1:$PORT_DEMO/api/idempotent-demo")"
  [ "$first" = "$second" ] || { echo "lan 1: $first"; echo "lan 2: $second"; return 1; }
  [ "$(sqlite3 "$OMNIFLOW_DB" "SELECT COUNT(*) FROM audit_log WHERE action='idempotent-demo';")" = "1" ]
}
demo_step "gui lai cung idempotency key khong thuc thi lai" idempotency_demo

backup_restore_demo() {
  ./scripts/backup.sh "$OMNIFLOW_DB" "$TMPDIR_DEMO/backup.db" >/dev/null
  [ -s "$TMPDIR_DEMO/backup.db" ] || return 1
  sqlite3 "$OMNIFLOW_DB" "DELETE FROM users;" || return 1
  [ "$(sqlite3 "$OMNIFLOW_DB" 'SELECT COUNT(*) FROM users;')" = "0" ] || return 1
  ./scripts/restore.sh "$TMPDIR_DEMO/backup.db" "$OMNIFLOW_DB" >/dev/null
  [ "$(sqlite3 "$OMNIFLOW_DB" 'SELECT COUNT(*) FROM users;')" = "2" ]
}
demo_step "backup tao file, restore dua du lieu ve dung trang thai" backup_restore_demo

docs_present() {
  [ -f docs/ROADMAP.md ] && [ -f docs/DECISIONS.md ] && [ -f docs/SETUP.md ] \
    && grep -q 'D1' docs/DECISIONS.md && grep -q 'D10' docs/DECISIONS.md
}
demo_step "docs ROADMAP/DECISIONS/SETUP co mat" docs_present

if [ "$FAIL" -ne 0 ]; then echo "DEMO: FAIL"; exit 1; fi
echo "DEMO: PASS"
