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

demo_step "npm ci" bash -c '
  # Nhu check.sh: go symlink node_modules cua gate worktree truoc khi npm ci,
  # keo npm ci xoa sach thu muc dich o main checkout.
  if [ -L node_modules ]; then rm node_modules; fi
  npm ci --no-audit --no-fund
'
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

# RBAC (GOAL-002): moi -> dang nhap vai moi -> khoa -> session cu bi chan -> audit log -> 403 ngoai pham vi.
INVITE_PASS="$(node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))")"
RBAC_COOKIE="$TMPDIR_DEMO/rbac-cookie.txt"
RBAC_ID_FILE="$TMPDIR_DEMO/rbac-id.txt"

rbac_invite_login() {
  local res
  res="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"email\":\"sales-demo@example.local\",\"password\":\"$INVITE_PASS\",\"role\":\"sales\",\"branch_id\":1}" \
    "http://127.0.0.1:$PORT_DEMO/api/users/invite")"
  echo "$res" | grep -q '"status":"active"' || { echo "invite tra ve: $res"; return 1; }
  echo "$res" | grep -q "$INVITE_PASS" && { echo "invite tra ve mat khau!"; return 1; }
  echo "$res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).user.id))" > "$RBAC_ID_FILE"
  curl -fsS -c "$RBAC_COOKIE" -H 'Content-Type: application/json' \
    -d "{\"email\":\"sales-demo@example.local\",\"password\":\"$INVITE_PASS\"}" \
    "http://127.0.0.1:$PORT_DEMO/login" | grep -q '"ok":true'
}
demo_step "RBAC: owner moi sales moi, dang nhap duoc bang mat khau ban dau" rbac_invite_login

rbac_lock_old_session() {
  local id lock_res
  id="$(cat "$RBAC_ID_FILE")"
  lock_res="$(curl -fsS -X POST -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/users/$id/lock")"
  echo "$lock_res" | grep -q '"status":"locked"' || { echo "lock tra ve: $lock_res"; return 1; }
  [ "$(curl -s -o /dev/null -w '%{http_code}' -b "$RBAC_COOKIE" "http://127.0.0.1:$PORT_DEMO/me")" = "401" ] || return 1
  [ "$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
    -d "{\"email\":\"sales-demo@example.local\",\"password\":\"$INVITE_PASS\"}" \
    "http://127.0.0.1:$PORT_DEMO/login")" = "403" ] || return 1
  curl -fsS -X POST -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/users/$id/unlock" | grep -q '"status":"active"'
}
demo_step "RBAC: khoa xong session cu bi chan 401, dang nhap lai bi 403, mo khoa duoc" rbac_lock_old_session

rbac_audit_log() {
  local log
  log="$(curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/audit-log")"
  echo "$log" | grep -q '"action":"invite"' || { echo "audit log thieu invite"; return 1; }
  echo "$log" | grep -q '"action":"lock"' || { echo "audit log thieu lock"; return 1; }
  curl -fsS -c "$RBAC_COOKIE" -H 'Content-Type: application/json' \
    -d "{\"email\":\"sales-demo@example.local\",\"password\":\"$INVITE_PASS\"}" \
    "http://127.0.0.1:$PORT_DEMO/login" >/dev/null
  [ "$(curl -s -o /dev/null -w '%{http_code}' -b "$RBAC_COOKIE" "http://127.0.0.1:$PORT_DEMO/api/audit-log")" = "403" ]
}
demo_step "RBAC: audit log ghi invite + lock, sales xem log bi chan 403" rbac_audit_log

rbac_cross_scope() {
  [ "$(curl -s -o /dev/null -w '%{http_code}' -b "$RBAC_COOKIE" -H 'Content-Type: application/json' \
    -d '{"email":"x-demo@example.local","password":"gia-lap-demo-123","role":"sales","branch_id":1}' \
    "http://127.0.0.1:$PORT_DEMO/api/users/invite")" = "403" ]
}
demo_step "RBAC: sales moi nhan vien bi chan 403 (sai vai)" rbac_cross_scope

# San pham / gia / CSV (GOAL-003): tao san pham -> bien the -> trung SKU 409
# -> gia rieng + fallback -> lich su gia -> preview CSV loi (khong ghi)
# -> import CSV loi (0 dong) -> import CSV sach -> export khop -> RBAC 403.
WH_PASS="$(node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))")"
WH_COOKIE="$TMPDIR_DEMO/wh-cookie.txt"
BRANCH2_FILE="$TMPDIR_DEMO/branch2.txt"
PROD_FILE="$TMPDIR_DEMO/prod.txt"

san_pham_setup() {
  local res
  res="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d '{"name":"Chi nhanh 2"}' "http://127.0.0.1:$PORT_DEMO/api/branches")"
  echo "$res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))" > "$BRANCH2_FILE"
  curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"email\":\"kho-demo@example.local\",\"password\":\"$WH_PASS\",\"role\":\"warehouse\",\"branch_id\":1}" \
    "http://127.0.0.1:$PORT_DEMO/api/users/invite" | grep -q '"status":"active"' || return 1
  curl -fsS -c "$WH_COOKIE" -H 'Content-Type: application/json' \
    -d "{\"email\":\"kho-demo@example.local\",\"password\":\"$WH_PASS\"}" \
    "http://127.0.0.1:$PORT_DEMO/login" | grep -q '"ok":true'
}
demo_step "san-pham: tao chi nhanh 2, moi warehouse, dang nhap duoc" san_pham_setup

san_pham_tao() {
  local res dup
  res="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d '{"code":"SP-DEMO","name":"San pham demo","price":100000,"unit":"cai"}' \
    "http://127.0.0.1:$PORT_DEMO/api/products")"
  echo "$res" | grep -q '"code":"SP-DEMO"' || { echo "tao san pham tra ve: $res"; return 1; }
  echo "$res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))" > "$PROD_FILE"
  local id
  id="$(cat "$PROD_FILE")"
  curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d '{"sku":"SKU-DEMO","name":"Bien the demo"}' \
    "http://127.0.0.1:$PORT_DEMO/api/products/$id/variants" | grep -q '"sku":"SKU-DEMO"' || return 1
  dup="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -H 'Content-Type: application/json' \
    -d '{"sku":"SKU-DEMO","name":"Trung SKU"}' \
    "http://127.0.0.1:$PORT_DEMO/api/products/$id/variants")"
  [ "$dup" = "409" ] || { echo "trung SKU tra ve HTTP $dup, mong 409"; return 1; }
}
demo_step "san-pham: tao san pham + bien the, trung SKU bi 409" san_pham_tao

san_pham_gia() {
  local id branch2 eff hist
  id="$(cat "$PROD_FILE")"
  branch2="$(cat "$BRANCH2_FILE")"
  curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"channel\":\"web\",\"branch_id\":$branch2,\"price\":130000,\"reason\":\"gia web CN2\"}" \
    "http://127.0.0.1:$PORT_DEMO/api/products/$id/prices" | grep -q '"price":130000' || return 1
  eff="$(curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/products/$id/price?channel=web&branch_id=$branch2")"
  echo "$eff" | grep -q '"price":130000' || { echo "gia hieu dung tra ve: $eff"; return 1; }
  echo "$eff" | grep -q '"source":"channel_branch"' || { echo "source gia tra ve: $eff"; return 1; }
  hist="$(curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/products/$id/price-history")"
  echo "$hist" | grep -q '"new_price":130000' || { echo "lich su gia thieu dong moi"; return 1; }
}
demo_step "san-pham: dat gia rieng, fallback dung, lich su gia ghi du" san_pham_gia

san_pham_csv() {
  local before after preview import_bad import_ok export_csv
  printf 'code,name,price,unit\nSP-CSV-PV,Ao csv,100000,cai\nSP-CSV-BAD,Quan loi,-5000,cai\n' > "$TMPDIR_DEMO/preview.csv"
  preview="$(curl -fsS -b "$COOKIE" -F "file=@$TMPDIR_DEMO/preview.csv" \
    "http://127.0.0.1:$PORT_DEMO/api/products/import/preview")"
  echo "$preview" | grep -q '"line":3' || { echo "preview CSV tra ve: $preview"; return 1; }
  before="$(curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/products" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).length))")"
  printf 'code,name,price,unit\nSP-CSV-BAD1,Ao loi,100000,cai\nSP-CSV-BAD2,Quan loi,-100,cai\n' > "$TMPDIR_DEMO/import-bad.csv"
  import_bad="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -F "file=@$TMPDIR_DEMO/import-bad.csv" \
    "http://127.0.0.1:$PORT_DEMO/api/products/import")"
  [ "$import_bad" = "422" ] || { echo "import CSV loi tra ve HTTP $import_bad, mong 422"; return 1; }
  after="$(curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/products" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).length))")"
  [ "$before" = "$after" ] || { echo "import loi van ghi: truoc $before, sau $after"; return 1; }
  printf 'code,name,price,unit\nSP-CSV-OK1,Ao ok,100000,cai\nSP-CSV-OK2,Quan ok,200000,cai\n' > "$TMPDIR_DEMO/import-ok.csv"
  import_ok="$(curl -fsS -b "$COOKIE" -F "file=@$TMPDIR_DEMO/import-ok.csv" \
    "http://127.0.0.1:$PORT_DEMO/api/products/import")"
  echo "$import_ok" | grep -q '"imported":2' || { echo "import CSV sach tra ve: $import_ok"; return 1; }
  export_csv="$(curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/products/export")"
  echo "$export_csv" | grep -q 'SP-DEMO' || { echo "export CSV thieu SP-DEMO"; return 1; }
  echo "$export_csv" | grep -q 'SP-CSV-OK1' || { echo "export CSV thieu SP-CSV-OK1"; return 1; }
}
demo_step "san-pham: preview CSV loi khong ghi, import loi 422 ghi 0 dong, import sach, export khop" san_pham_csv

san_pham_rbac() {
  local id code
  id="$(cat "$PROD_FILE")"
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$RBAC_COOKIE" -H 'Content-Type: application/json' \
    -d '{"channel":"web","price":140000,"reason":"sales doi gia"}' \
    "http://127.0.0.1:$PORT_DEMO/api/products/$id/prices")"
  [ "$code" = "403" ] || { echo "sales doi gia tra ve HTTP $code, mong 403"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$WH_COOKIE" -H 'Content-Type: application/json' \
    -d '{"code":"SP-WH","name":"Kho tao","price":1000,"unit":"cai"}' \
    "http://127.0.0.1:$PORT_DEMO/api/products")"
  [ "$code" = "403" ] || { echo "warehouse tao san pham tra ve HTTP $code, mong 403"; return 1; }
}
demo_step "san-pham: sales doi gia bi 403, warehouse tao san pham bi 403" san_pham_rbac

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
  local before
  before="$(sqlite3 "$OMNIFLOW_DB" 'SELECT COUNT(*) FROM users;')"
  sqlite3 "$OMNIFLOW_DB" "DELETE FROM users;" || return 1
  [ "$(sqlite3 "$OMNIFLOW_DB" 'SELECT COUNT(*) FROM users;')" = "0" ] || return 1
  ./scripts/restore.sh "$TMPDIR_DEMO/backup.db" "$OMNIFLOW_DB" >/dev/null
  [ "$(sqlite3 "$OMNIFLOW_DB" 'SELECT COUNT(*) FROM users;')" = "$before" ]
}
demo_step "backup tao file, restore dua du lieu ve dung trang thai" backup_restore_demo

docs_present() {
  [ -f docs/ROADMAP.md ] && [ -f docs/DECISIONS.md ] && [ -f docs/SETUP.md ] \
    && grep -q 'D1' docs/DECISIONS.md && grep -q 'D10' docs/DECISIONS.md
}
demo_step "docs ROADMAP/DECISIONS/SETUP co mat" docs_present

if [ "$FAIL" -ne 0 ]; then echo "DEMO: FAIL"; exit 1; fi
echo "DEMO: PASS"
