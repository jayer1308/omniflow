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
export OMNIFLOW_WEBHOOK_SECRET="$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")"
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
VAR_FILE="$TMPDIR_DEMO/var.txt"
WHA_FILE="$TMPDIR_DEMO/wha.txt"
WHB_FILE="$TMPDIR_DEMO/whb.txt"

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
  local res dup vres
  res="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d '{"code":"SP-DEMO","name":"San pham demo","price":100000,"unit":"cai"}' \
    "http://127.0.0.1:$PORT_DEMO/api/products")"
  echo "$res" | grep -q '"code":"SP-DEMO"' || { echo "tao san pham tra ve: $res"; return 1; }
  echo "$res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))" > "$PROD_FILE"
  local id
  id="$(cat "$PROD_FILE")"
  vres="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d '{"sku":"SKU-DEMO","name":"Bien the demo"}' \
    "http://127.0.0.1:$PORT_DEMO/api/products/$id/variants")"
  echo "$vres" | grep -q '"sku":"SKU-DEMO"' || { echo "tao bien the tra ve: $vres"; return 1; }
  echo "$vres" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const b=JSON.parse(s);console.log((b.variant||b).id)})" > "$VAR_FILE"
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

# Kho / ton (GOAL-004): tao kho -> nhap -> xuat -> xuat qua ton 400 -> giu
# -> giai phong -> chuyen kho -> kiem ke -> ton thap -> idempotency gui lai
# -> race dong thoi -> RBAC 403 (sales nhap, warehouse ngoai pham vi, ngoai org).

kho_tao() {
  local wha whb
  wha="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d '{"name":"Kho A demo"}' "http://127.0.0.1:$PORT_DEMO/api/warehouses")"
  echo "$wha" | grep -q '"name":"Kho A demo"' || { echo "tao kho A tra ve: $wha"; return 1; }
  echo "$wha" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))" > "$WHA_FILE"
  whb="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d '{"name":"Kho B demo"}' "http://127.0.0.1:$PORT_DEMO/api/warehouses")"
  echo "$whb" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))" > "$WHB_FILE"
  [ "$(curl -s -o /dev/null -w '%{http_code}' -b "$RBAC_COOKIE" -H 'Content-Type: application/json' \
    -d '{"name":"Kho sales tao"}' "http://127.0.0.1:$PORT_DEMO/api/warehouses")" = "403" ] || return 1
}
demo_step "kho: owner tao 2 kho, sales tao kho bi 403" kho_tao

kho_nhap_xuat() {
  local wha var in_res out_res over
  wha="$(cat "$WHA_FILE")"
  var="$(cat "$VAR_FILE")"
  in_res="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha,\"variant_id\":$var,\"qty\":50,\"reason\":\"nhap demo\"}" \
    "http://127.0.0.1:$PORT_DEMO/api/stock/in")"
  echo "$in_res" | grep -q '"on_hand":50' || { echo "nhap kho tra ve: $in_res"; return 1; }
  echo "$in_res" | grep -q '"available":50' || { echo "nhap kho available sai: $in_res"; return 1; }
  out_res="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha,\"variant_id\":$var,\"qty\":20,\"reason\":\"xuat demo\"}" \
    "http://127.0.0.1:$PORT_DEMO/api/stock/out")"
  echo "$out_res" | grep -q '"on_hand":30' || { echo "xuat kho tra ve: $out_res"; return 1; }
  over="$(curl -s -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha,\"variant_id\":$var,\"qty\":40,\"reason\":\"xuat qua ton\"}" \
    "http://127.0.0.1:$PORT_DEMO/api/stock/out")"
  echo "$over" | grep -q 'insufficient_stock' || { echo "xuat qua ton thieu ma loi: $over"; return 1; }
}
demo_step "kho: nhap 50 -> xuat 20 con 30, xuat qua ton bi 400 insufficient_stock" kho_nhap_xuat

kho_giu_chuyen_kiemke() {
  local wha whb var res rel tr lvl cnt
  wha="$(cat "$WHA_FILE")"
  whb="$(cat "$WHB_FILE")"
  var="$(cat "$VAR_FILE")"
  res="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha,\"variant_id\":$var,\"qty\":10,\"reason\":\"giu demo\"}" \
    "http://127.0.0.1:$PORT_DEMO/api/stock/reserve")"
  echo "$res" | grep -q '"reserved":10' || { echo "giu hang tra ve: $res"; return 1; }
  echo "$res" | grep -q '"available":20' || { echo "giu hang available sai: $res"; return 1; }
  rel="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha,\"variant_id\":$var,\"qty\":4,\"reason\":\"giai phong demo\"}" \
    "http://127.0.0.1:$PORT_DEMO/api/stock/release")"
  echo "$rel" | grep -q '"reserved":6' || { echo "giai phong tra ve: $rel"; return 1; }
  tr="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"from_warehouse_id\":$wha,\"to_warehouse_id\":$whb,\"variant_id\":$var,\"qty\":5,\"reason\":\"chuyen demo\"}" \
    "http://127.0.0.1:$PORT_DEMO/api/stock/transfer")"
  echo "$tr" | grep -q '"on_hand":25' || { echo "chuyen kho tra ve: $tr"; return 1; }
  lvl="$(curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/stock/levels?warehouse_id=$whb&variant_id=$var")"
  echo "$lvl" | grep -q '"on_hand":5' || { echo "kho dich sau chuyen: $lvl"; return 1; }
  cnt="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$whb,\"variant_id\":$var,\"counted_qty\":8,\"reason\":\"kiem ke demo\"}" \
    "http://127.0.0.1:$PORT_DEMO/api/stock/count")"
  echo "$cnt" | grep -q '"on_hand":8' || { echo "kiem ke tra ve: $cnt"; return 1; }
}
demo_step "kho: giu 10 -> giai phong 4, chuyen 5 sang kho B, kiem ke kho B ve 8" kho_giu_chuyen_kiemke

kho_ton_thap() {
  local low
  low="$(curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/stock/low-stock")"
  echo "$low" | grep -q '"sku":"SKU-SEED-01-M"' || { echo "ton thap thieu cap seed: $low"; return 1; }
}
demo_step "kho: ton thap liet ke dung cap seed (Kho Chinh 3 < min_stock 5)" kho_ton_thap

kho_idempotency() {
  local whb var first second lvl
  whb="$(cat "$WHB_FILE")"
  var="$(cat "$VAR_FILE")"
  first="$(curl -fsS -b "$COOKIE" -H 'Idempotency-Key: demo-stock-1' -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$whb,\"variant_id\":$var,\"qty\":5,\"reason\":\"nhap idem\"}" \
    "http://127.0.0.1:$PORT_DEMO/api/stock/in")"
  echo "$first" | grep -q '"on_hand":13' || { echo "nhap idem lan 1 tra ve: $first"; return 1; }
  second="$(curl -fsS -b "$COOKIE" -H 'Idempotency-Key: demo-stock-1' -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$whb,\"variant_id\":$var,\"qty\":5,\"reason\":\"nhap idem\"}" \
    "http://127.0.0.1:$PORT_DEMO/api/stock/in")"
  echo "$second" | grep -q '"replayed":true' || { echo "gui lai khong replay: $second"; return 1; }
  lvl="$(curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/stock/levels?warehouse_id=$whb&variant_id=$var")"
  echo "$lvl" | grep -q '"on_hand":13' || { echo "gui lai van tru them: $lvl"; return 1; }
}
demo_step "kho: gui lai cung idempotency key tra replayed, khong tru 2 lan" kho_idempotency

kho_race() {
  local wha var i ok fail lvl pids
  wha="$(cat "$WHA_FILE")"
  var="$(cat "$VAR_FILE")"
  curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha,\"variant_id\":$var,\"qty\":6,\"reason\":\"giai phong het\"}" \
    "http://127.0.0.1:$PORT_DEMO/api/stock/release" >/dev/null
  curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha,\"variant_id\":$var,\"counted_qty\":50,\"reason\":\"kiem ke ve 50\"}" \
    "http://127.0.0.1:$PORT_DEMO/api/stock/count" >/dev/null
  # Chi wait cac job race: server demo cung la job nen cua shell nay, wait
  # tran se doi ca server (chay mai) nen treo. Gom PID roi wait rieng.
  pids=()
  for i in $(seq 1 10); do
    ( curl -s -o /dev/null -w '%{http_code}\n' -b "$COOKIE" -H 'Content-Type: application/json' \
      -d "{\"warehouse_id\":$wha,\"variant_id\":$var,\"qty\":10,\"reason\":\"xuat race\"}" \
      "http://127.0.0.1:$PORT_DEMO/api/stock/out" > "$TMPDIR_DEMO/race-$i.code" ) &
    pids+=($!)
  done
  wait "${pids[@]}"
  ok="$(cat "$TMPDIR_DEMO"/race-*.code | grep -c '^200$' || true)"
  fail="$(cat "$TMPDIR_DEMO"/race-*.code | grep -c '^400$' || true)"
  [ "$ok" = "5" ] || { echo "race: $ok yeu cau thanh cong, mong 5"; return 1; }
  [ "$fail" = "5" ] || { echo "race: $fail yeu cau bi 400, mong 5"; return 1; }
  lvl="$(curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/stock/levels?warehouse_id=$wha&variant_id=$var")"
  echo "$lvl" | grep -q '"on_hand":0' || { echo "ton cuoi sau race: $lvl"; return 1; }
}
demo_step "kho: 10 yeu cau xuat 10 dong thoi khi available 50 -> 5 thanh cong, 5 bi 400, ton cuoi 0" kho_race

kho_rbac() {
  local wha whb var code wh2_pass wh2_res wh2_id wh2_cookie orgb_id whb_org_id attempt
  wha="$(cat "$WHA_FILE")"
  whb="$(cat "$WHB_FILE")"
  var="$(cat "$VAR_FILE")"
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$RBAC_COOKIE" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha,\"variant_id\":$var,\"qty\":1,\"reason\":\"sales nhap\"}" \
    "http://127.0.0.1:$PORT_DEMO/api/stock/in")"
  [ "$code" = "403" ] || { echo "sales nhap kho tra ve HTTP $code, mong 403"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$RBAC_COOKIE" "http://127.0.0.1:$PORT_DEMO/api/stock/movements")"
  [ "$code" = "403" ] || { echo "sales xem movements tra ve HTTP $code, mong 403"; return 1; }
  wh2_pass="$(node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))")"
  wh2_res="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"email\":\"kho-scope-demo@example.local\",\"password\":\"$wh2_pass\",\"role\":\"warehouse\",\"branch_id\":1}" \
    "http://127.0.0.1:$PORT_DEMO/api/users/invite")"
  wh2_id="$(echo "$wh2_res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).user.id))")"
  curl -fsS -X PATCH -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha}" \
    "http://127.0.0.1:$PORT_DEMO/api/users/$wh2_id/scope" >/dev/null
  wh2_cookie="$TMPDIR_DEMO/wh2-cookie.txt"
  curl -fsS -c "$wh2_cookie" -H 'Content-Type: application/json' \
    -d "{\"email\":\"kho-scope-demo@example.local\",\"password\":\"$wh2_pass\"}" \
    "http://127.0.0.1:$PORT_DEMO/login" >/dev/null
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$wh2_cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$whb,\"variant_id\":$var,\"qty\":1,\"reason\":\"ngoai pham vi\"}" \
    "http://127.0.0.1:$PORT_DEMO/api/stock/in")"
  [ "$code" = "403" ] || { echo "warehouse nhap kho ngoai pham vi tra ve HTTP $code, mong 403"; return 1; }
  orgb_id=""
  for attempt in 1 2 3 4 5; do
    orgb_id="$(sqlite3 "$OMNIFLOW_DB" "INSERT INTO orgs (name) VALUES ('Cong ty B demo'); SELECT last_insert_rowid();" 2>/dev/null)" && [ -n "$orgb_id" ] && break
    sleep 0.2
  done
  [ -n "$orgb_id" ] || { echo "khong tao duoc org B de kiem tra ngoai org"; return 1; }
  whb_org_id="$(sqlite3 "$OMNIFLOW_DB" "INSERT INTO warehouses (org_id, name, status) VALUES ($orgb_id, 'Kho org B', 'active'); SELECT last_insert_rowid();")"
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/warehouses/$whb_org_id")"
  [ "$code" = "403" ] || { echo "doc kho org B tra ve HTTP $code, mong 403"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$whb_org_id,\"variant_id\":$var,\"qty\":1,\"reason\":\"ngoai org\"}" \
    "http://127.0.0.1:$PORT_DEMO/api/stock/in")"
  [ "$code" = "403" ] || { echo "nhap kho org B tra ve HTTP $code, mong 403"; return 1; }
}
demo_step "kho: sales nhap/xem movements bi 403, warehouse ngoai pham vi bi 403, ngoai org bi 403" kho_rbac

# Don hang (GOAL-005): tao don web snapshot gia seed -> xac nhan giu hang
# -> xu ly -> hoan tat xuat kho -> tao don khac -> xac nhan -> huy khi dang
# xu ly giai phong dung -> chuyen sai 400 -> idempotency gui lai khong tao
# don moi -> race dong thoi khong ban qua ton -> RBAC 403 + ngoai org 403.
ORD1_FILE="$TMPDIR_DEMO/ord1.txt"
ORD3_FILE="$TMPDIR_DEMO/ord3.txt"
SEED_VAR_FILE="$TMPDIR_DEMO/seed-var.txt"
KHO_PHU_FILE="$TMPDIR_DEMO/kho-phu.txt"

don_tao() {
  local seed_var kho_phu res lvl
  seed_var="$(sqlite3 "$OMNIFLOW_DB" "SELECT id FROM product_variants WHERE sku='SKU-SEED-01-M';")"
  kho_phu="$(sqlite3 "$OMNIFLOW_DB" "SELECT id FROM warehouses WHERE name='Kho Phụ';")"
  [ -n "$seed_var" ] && [ -n "$kho_phu" ] || { echo "khong tim duoc bien the/kho seed"; return 1; }
  echo "$seed_var" > "$SEED_VAR_FILE"
  echo "$kho_phu" > "$KHO_PHU_FILE"
  res="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$kho_phu,\"channel\":\"web\",\"customer_name\":\"Khach Web demo\",\"items\":[{\"variant_id\":$seed_var,\"qty\":2}]}" \
    "http://127.0.0.1:$PORT_DEMO/api/orders")"
  echo "$res" | grep -q '"status":"draft"' || { echo "tao don tra ve: $res"; return 1; }
  echo "$res" | grep -q '"total":320000' || { echo "total don sai (mong 2 x gia web 160000): $res"; return 1; }
  echo "$res" | grep -q '"unit_price":160000' || { echo "snapshot gia web sai: $res"; return 1; }
  echo "$res" | grep -q '"price_source":"channel"' || { echo "price_source sai: $res"; return 1; }
  echo "$res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))" > "$ORD1_FILE"
  echo "$res" | grep -qE '"code":"DH-[0-9]{8}-[0-9]{4}"' || { echo "ma don sai dinh dang: $res"; return 1; }
  # Tao don KHONG giu hang, KHONG tru kho.
  lvl="$(curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/stock/levels?warehouse_id=$kho_phu&variant_id=$seed_var")"
  echo "$lvl" | grep -q '"on_hand":20' || { echo "tao don doi on_hand: $lvl"; return 1; }
  echo "$lvl" | grep -q '"reserved":0' || { echo "tao don giu hang: $lvl"; return 1; }
}
demo_step "don: tao don web snapshot gia 160000, total 320000, o draft, ton khong doi" don_tao

don_vong_doi() {
  local id kho_phu seed_var cfm proc done lvl detail
  id="$(cat "$ORD1_FILE")"
  kho_phu="$(cat "$KHO_PHU_FILE")"
  seed_var="$(cat "$SEED_VAR_FILE")"
  cfm="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$PORT_DEMO/api/orders/$id/confirm")"
  echo "$cfm" | grep -q '"status":"confirmed"' || { echo "xac nhan don tra ve: $cfm"; return 1; }
  lvl="$(curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/stock/levels?warehouse_id=$kho_phu&variant_id=$seed_var")"
  echo "$lvl" | grep -q '"reserved":2' || { echo "xac nhan khong giu 2: $lvl"; return 1; }
  echo "$lvl" | grep -q '"on_hand":20' || { echo "xac nhan doi on_hand: $lvl"; return 1; }
  proc="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$PORT_DEMO/api/orders/$id/process")"
  echo "$proc" | grep -q '"status":"processing"' || { echo "xu ly don tra ve: $proc"; return 1; }
  done="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$PORT_DEMO/api/orders/$id/complete")"
  echo "$done" | grep -q '"status":"completed"' || { echo "hoan tat don tra ve: $done"; return 1; }
  lvl="$(curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/stock/levels?warehouse_id=$kho_phu&variant_id=$seed_var")"
  echo "$lvl" | grep -q '"on_hand":18' || { echo "hoan tat khong tru on_hand ve 18: $lvl"; return 1; }
  echo "$lvl" | grep -q '"reserved":0' || { echo "hoan tat khong giai phong giu: $lvl"; return 1; }
  detail="$(curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/orders/$id")"
  echo "$detail" | grep -q '"to_status":"completed"' || { echo "lich su don thieu completed: $detail"; return 1; }
}
demo_step "don: xac nhan giu 2 -> xu ly -> hoan tat xuat kho (on_hand 20 ve 18, reserved ve 0)" don_vong_doi

don_huy_khi_xu_ly() {
  local kho_phu seed_var res id lvl cancel
  kho_phu="$(cat "$KHO_PHU_FILE")"
  seed_var="$(cat "$SEED_VAR_FILE")"
  res="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$kho_phu,\"channel\":\"counter\",\"items\":[{\"variant_id\":$seed_var,\"qty\":3}]}" \
    "http://127.0.0.1:$PORT_DEMO/api/orders")"
  id="$(echo "$res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
  curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$PORT_DEMO/api/orders/$id/confirm" >/dev/null
  curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$PORT_DEMO/api/orders/$id/process" >/dev/null
  cancel="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' -d '{"note":"huy khi dang xu ly"}' \
    "http://127.0.0.1:$PORT_DEMO/api/orders/$id/cancel")"
  echo "$cancel" | grep -q '"status":"cancelled"' || { echo "huy don tra ve: $cancel"; return 1; }
  lvl="$(curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/stock/levels?warehouse_id=$kho_phu&variant_id=$seed_var")"
  echo "$lvl" | grep -q '"on_hand":18' || { echo "huy doi on_hand: $lvl"; return 1; }
  echo "$lvl" | grep -q '"reserved":0' || { echo "huy khong giai phong: $lvl"; return 1; }
}
demo_step "don: tao don khac -> xac nhan -> huy khi dang xu ly, giai phong dung (on_hand 18, reserved 0)" don_huy_khi_xu_ly

don_chuyen_sai_va_idempotency() {
  local kho_phu seed_var res id code first second total
  kho_phu="$(cat "$KHO_PHU_FILE")"
  seed_var="$(cat "$SEED_VAR_FILE")"
  res="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$kho_phu,\"channel\":\"counter\",\"items\":[{\"variant_id\":$seed_var,\"qty\":1}]}" \
    "http://127.0.0.1:$PORT_DEMO/api/orders")"
  id="$(echo "$res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
  echo "$id" > "$ORD3_FILE"
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$PORT_DEMO/api/orders/$id/complete")"
  [ "$code" = "400" ] || { echo "nhap -> hoan tat tra ve HTTP $code, mong 400"; return 1; }
  first="$(curl -fsS -b "$COOKIE" -H 'Idempotency-Key: demo-order-1' -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$kho_phu,\"channel\":\"counter\",\"items\":[{\"variant_id\":$seed_var,\"qty\":1}]}" \
    "http://127.0.0.1:$PORT_DEMO/api/orders")"
  echo "$first" | grep -q '"status":"draft"' || { echo "tao don idem lan 1 tra ve: $first"; return 1; }
  code="$(echo "$first" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).code))")"
  second="$(curl -fsS -b "$COOKIE" -H 'Idempotency-Key: demo-order-1' -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$kho_phu,\"channel\":\"counter\",\"items\":[{\"variant_id\":$seed_var,\"qty\":1}]}" \
    "http://127.0.0.1:$PORT_DEMO/api/orders")"
  echo "$second" | grep -q '"replayed":true' || { echo "gui lai don khong replay: $second"; return 1; }
  echo "$second" | grep -q "\"code\":\"$code\"" || { echo "gui lai don doi ma: $second"; return 1; }
  total="$(curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/orders" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).total))")"
  [ "$total" = "4" ] || { echo "gui lai van tao them don, total $total, mong 4"; return 1; }
}
demo_step "don: nhap -> hoan tat bi 400, gui lai cung idempotency key tra replayed, khong tao don moi" don_chuyen_sai_va_idempotency

don_race() {
  local wha var i ok fail lvl pids oid
  wha="$(cat "$WHA_FILE")"
  var="$(cat "$VAR_FILE")"
  curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha,\"variant_id\":$var,\"counted_qty\":50,\"reason\":\"kiem ke ve 50 cho race don\"}" \
    "http://127.0.0.1:$PORT_DEMO/api/stock/count" >/dev/null
  for i in $(seq 1 10); do
    oid="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
      -d "{\"warehouse_id\":$wha,\"channel\":\"counter\",\"items\":[{\"variant_id\":$var,\"qty\":10}]}" \
      "http://127.0.0.1:$PORT_DEMO/api/orders" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
    echo "$oid" > "$TMPDIR_DEMO/race-order-$i.id"
  done
  pids=()
  for i in $(seq 1 10); do
    oid="$(cat "$TMPDIR_DEMO/race-order-$i.id")"
    ( curl -s -o /dev/null -w '%{http_code}\n' -b "$COOKIE" -H 'Content-Type: application/json' -d '{}' \
      "http://127.0.0.1:$PORT_DEMO/api/orders/$oid/confirm" > "$TMPDIR_DEMO/race-order-$i.code" ) &
    pids+=($!)
  done
  wait "${pids[@]}"
  ok="$(cat "$TMPDIR_DEMO"/race-order-*.code | grep -c '^200$' || true)"
  fail="$(cat "$TMPDIR_DEMO"/race-order-*.code | grep -c '^400$' || true)"
  [ "$ok" = "5" ] || { echo "race don: $ok xac nhan thanh cong, mong 5"; return 1; }
  [ "$fail" = "5" ] || { echo "race don: $fail xac nhan bi 400, mong 5"; return 1; }
  lvl="$(curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/stock/levels?warehouse_id=$wha&variant_id=$var")"
  echo "$lvl" | grep -q '"on_hand":50' || { echo "ton cuoi sau race don: $lvl"; return 1; }
  echo "$lvl" | grep -q '"reserved":50' || { echo "giu cuoi sau race don: $lvl"; return 1; }
}
demo_step "don: 10 don nhap qty 10 xac nhan dong thoi khi available 50 -> 5 thanh cong, 5 bi 400" don_race

don_rbac() {
  local wha var code ord3 orgb_id whb_org_id attempt
  wha="$(cat "$WHA_FILE")"
  var="$(cat "$VAR_FILE")"
  ord3="$(cat "$ORD3_FILE")"
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$WH_COOKIE" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha,\"channel\":\"counter\",\"items\":[{\"variant_id\":$var,\"qty\":1}]}" \
    "http://127.0.0.1:$PORT_DEMO/api/orders")"
  [ "$code" = "403" ] || { echo "warehouse tao don tra ve HTTP $code, mong 403"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$RBAC_COOKIE" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$PORT_DEMO/api/orders/$ord3/process")"
  [ "$code" = "403" ] || { echo "sales xu ly don tra ve HTTP $code, mong 403"; return 1; }
  orgb_id=""
  for attempt in 1 2 3 4 5; do
    orgb_id="$(sqlite3 "$OMNIFLOW_DB" "INSERT INTO orgs (name) VALUES ('Cong ty B don demo'); SELECT last_insert_rowid();" 2>/dev/null)" && [ -n "$orgb_id" ] && break
    sleep 0.2
  done
  [ -n "$orgb_id" ] || { echo "khong tao duoc org B de kiem tra ngoai org"; return 1; }
  whb_org_id="$(sqlite3 "$OMNIFLOW_DB" "INSERT INTO warehouses (org_id, name, status) VALUES ($orgb_id, 'Kho org B don', 'active'); SELECT last_insert_rowid();")"
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$whb_org_id,\"channel\":\"counter\",\"items\":[{\"variant_id\":$var,\"qty\":1}]}" \
    "http://127.0.0.1:$PORT_DEMO/api/orders")"
  { [ "$code" = "403" ] || [ "$code" = "404" ]; } || { echo "tao don kho org B tra ve HTTP $code, mong 403/404"; return 1; }
}
demo_step "don: warehouse tao don bi 403, sales xu ly don bi 403, tao don kho org B bi 403/404" don_rbac

# Thanh toan + hoan tien (GOAL-006): thu tien mat mot phan -> thu qua cong
# -> webhook paid chot -> webhook lap bi bo qua -> hoan mot phan -> doi
# soat dung so -> idempotency gui lai khong tao payment moi -> RBAC 403
# (warehouse tao, sales hoan) + webhook sai chu ky 401. Dung don ORD1
# (total 320000, da hoan tat) — thanh toan khong doi trang thai don.
PAY1_FILE="$TMPDIR_DEMO/pay1.txt"
PAY2_FILE="$TMPDIR_DEMO/pay2.txt"
PAYREF_FILE="$TMPDIR_DEMO/payref.txt"

thanh_toan_tien_mat() {
  local id res
  id="$(cat "$ORD1_FILE")"
  res="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d '{"method":"cash","amount":100000}' \
    "http://127.0.0.1:$PORT_DEMO/api/orders/$id/payments")"
  echo "$res" | grep -q '"status":"paid"' || { echo "thu tien mat tra ve: $res"; return 1; }
  echo "$res" | grep -q '"paid_total":100000' || { echo "doi soat sau thu mat sai: $res"; return 1; }
  echo "$res" | grep -q '"outstanding":220000' || { echo "con thieu sau thu mat sai: $res"; return 1; }
  echo "$res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).payment.id))" > "$PAY1_FILE"
}
demo_step "thanh toan: thu tien mat 100000 -> paid ngay, con thieu 220000" thanh_toan_tien_mat

thanh_toan_gateway_webhook() {
  local id res ref sig paid dup
  id="$(cat "$ORD1_FILE")"
  res="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d '{"method":"gateway","amount":100000}' \
    "http://127.0.0.1:$PORT_DEMO/api/orders/$id/payments")"
  echo "$res" | grep -q '"status":"requested"' || { echo "thu qua cong tra ve: $res"; return 1; }
  echo "$res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).payment.id))" > "$PAY2_FILE"
  ref="$(echo "$res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).payment.gateway_reference))")"
  echo "$ref" | grep -q '^FAKE-PAY-' || { echo "gateway_reference sai: $ref"; return 1; }
  echo "$ref" > "$PAYREF_FILE"
  sig="$(node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "$ref:paid:100000:$OMNIFLOW_WEBHOOK_SECRET")"
  paid="$(curl -fsS -H 'Content-Type: application/json' -H "X-Fake-Signature: $sig" \
    -d "{\"gateway_reference\":\"$ref\",\"status\":\"paid\",\"amount\":100000}" \
    "http://127.0.0.1:$PORT_DEMO/api/payments/webhook")"
  echo "$paid" | grep -q '"status":"paid"' || { echo "webhook paid tra ve: $paid"; return 1; }
  echo "$paid" | grep -q '"paid_total":200000' || { echo "doi soat sau webhook sai: $paid"; return 1; }
  dup="$(curl -fsS -H 'Content-Type: application/json' -H "X-Fake-Signature: $sig" \
    -d "{\"gateway_reference\":\"$ref\",\"status\":\"paid\",\"amount\":100000}" \
    "http://127.0.0.1:$PORT_DEMO/api/payments/webhook")"
  echo "$dup" | grep -q '"duplicate":true' || { echo "webhook lap khong duplicate: $dup"; return 1; }
  echo "$dup" | grep -q '"paid_total":200000' || { echo "webhook lap doi tong: $dup"; return 1; }
}
demo_step "thanh toan: thu qua cong -> webhook paid chot, gui lap duplicate:true, tong chi tinh 1 lan" thanh_toan_gateway_webhook

thanh_toan_hoan_tien() {
  local pay1 res
  pay1="$(cat "$PAY1_FILE")"
  res="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d '{"amount":50000,"reason":"hoan demo"}' \
    "http://127.0.0.1:$PORT_DEMO/api/payments/$pay1/refunds")"
  echo "$res" | grep -q '"status":"completed"' || { echo "hoan tien tra ve: $res"; return 1; }
  echo "$res" | grep -q '"paid_total":150000' || { echo "doi soat sau hoan sai: $res"; return 1; }
  echo "$res" | grep -q '"refunded_total":50000' || { echo "tong hoan sai: $res"; return 1; }
  echo "$res" | grep -q '"outstanding":170000' || { echo "con thieu sau hoan sai: $res"; return 1; }
  echo "$res" | grep -q '"payment_status":"partially_paid"' || { echo "trang thai sau hoan sai: $res"; return 1; }
}
demo_step "thanh toan: hoan mot phan 50000 -> completed, paid_total 150000, refunded_total 50000" thanh_toan_hoan_tien

thanh_toan_idempotency() {
  local id first second list
  id="$(cat "$ORD1_FILE")"
  first="$(curl -fsS -b "$COOKIE" -H 'Idempotency-Key: demo-pay-1' -H 'Content-Type: application/json' \
    -d '{"method":"cash","amount":10000}' \
    "http://127.0.0.1:$PORT_DEMO/api/orders/$id/payments")"
  echo "$first" | grep -q '"status":"paid"' || { echo "tao payment idem lan 1 tra ve: $first"; return 1; }
  second="$(curl -fsS -b "$COOKIE" -H 'Idempotency-Key: demo-pay-1' -H 'Content-Type: application/json' \
    -d '{"method":"cash","amount":10000}' \
    "http://127.0.0.1:$PORT_DEMO/api/orders/$id/payments")"
  echo "$second" | grep -q '"replayed":true' || { echo "gui lai payment khong replay: $second"; return 1; }
  list="$(curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/orders/$id/payments")"
  echo "$list" | grep -q '"paid_total":160000' || { echo "gui lai payment van tinh them: $list"; return 1; }
}
demo_step "thanh toan: gui lai cung idempotency key tra replayed, khong tao payment moi" thanh_toan_idempotency

thanh_toan_rbac() {
  local id pay1 code ref
  id="$(cat "$ORD1_FILE")"
  pay1="$(cat "$PAY1_FILE")"
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$WH_COOKIE" -H 'Content-Type: application/json' \
    -d '{"method":"cash","amount":1000}' \
    "http://127.0.0.1:$PORT_DEMO/api/orders/$id/payments")"
  [ "$code" = "403" ] || { echo "warehouse tao payment tra ve HTTP $code, mong 403"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$RBAC_COOKIE" -H 'Content-Type: application/json' \
    -d '{"amount":1000,"reason":"sales hoan"}' \
    "http://127.0.0.1:$PORT_DEMO/api/payments/$pay1/refunds")"
  [ "$code" = "403" ] || { echo "sales hoan tien tra ve HTTP $code, mong 403"; return 1; }
  ref="$(cat "$PAYREF_FILE")"
  code="$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -H 'X-Fake-Signature: 0000000000000000000000000000000000000000000000000000000000000000' \
    -d "{\"gateway_reference\":\"$ref\",\"status\":\"paid\",\"amount\":100000}" \
    "http://127.0.0.1:$PORT_DEMO/api/payments/webhook")"
  [ "$code" = "401" ] || { echo "webhook sai chu ky tra ve HTTP $code, mong 401"; return 1; }
}
demo_step "thanh toan: warehouse tao payment bi 403, sales hoan tien bi 403, webhook sai chu ky bi 401" thanh_toan_rbac

# Giao hang + tra hang (GOAL-007): tao don moi (2 bien the moi de ton
# sach) -> xac nhan -> xu ly -> hoan tat -> thu tien -> yeu cau giao
# (phi/ETA tu adapter, ma van don deterministic) -> idempotency gui lai
# -> cap nhat sai thu tu 400 -> in_transit -> lap cung trang thai khong
# tao event -> delivered -> yeu cau tra (1 ban lai duoc + 1 hong) -> duyet
# -> nhan (ton tang dung so ban lai duoc, hong khong nhap kho) -> hoan
# tien -> doi soat dung so -> RBAC 403 -> DELETE 404.
GORD_FILE="$TMPDIR_DEMO/gord.txt"
GSHIP_FILE="$TMPDIR_DEMO/gship.txt"
GRET_FILE="$TMPDIR_DEMO/gret.txt"
GRETCODE_FILE="$TMPDIR_DEMO/gretcode.txt"
G1V_FILE="$TMPDIR_DEMO/g1v.txt"
G2V_FILE="$TMPDIR_DEMO/g2v.txt"

giao_tra_chuan_bi() {
  local wha p1 v1 p2 v2 res id
  wha="$(cat "$WHA_FILE")"
  p1="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d '{"code":"SP-DEMO-G1","name":"San pham giao 1","price":100000,"unit":"cai"}' \
    "http://127.0.0.1:$PORT_DEMO/api/products" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
  v1="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d '{"sku":"SKU-DEMO-G1","name":"Bien the giao 1"}' \
    "http://127.0.0.1:$PORT_DEMO/api/products/$p1/variants" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const b=JSON.parse(s);console.log((b.variant||b).id)})")"
  p2="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d '{"code":"SP-DEMO-G2","name":"San pham giao 2","price":50000,"unit":"cai"}' \
    "http://127.0.0.1:$PORT_DEMO/api/products" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
  v2="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d '{"sku":"SKU-DEMO-G2","name":"Bien the giao 2"}' \
    "http://127.0.0.1:$PORT_DEMO/api/products/$p2/variants" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const b=JSON.parse(s);console.log((b.variant||b).id)})")"
  echo "$v1" > "$G1V_FILE"
  echo "$v2" > "$G2V_FILE"
  curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha,\"variant_id\":$v1,\"qty\":50,\"reason\":\"nhap giao demo\"}" \
    "http://127.0.0.1:$PORT_DEMO/api/stock/in" >/dev/null
  curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha,\"variant_id\":$v2,\"qty\":30,\"reason\":\"nhap giao demo\"}" \
    "http://127.0.0.1:$PORT_DEMO/api/stock/in" >/dev/null
  res="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha,\"channel\":\"counter\",\"items\":[{\"variant_id\":$v1,\"qty\":2},{\"variant_id\":$v2,\"qty\":1}]}" \
    "http://127.0.0.1:$PORT_DEMO/api/orders")"
  echo "$res" | grep -q '"total":250000' || { echo "total don giao sai: $res"; return 1; }
  id="$(echo "$res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
  echo "$id" > "$GORD_FILE"
  curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$PORT_DEMO/api/orders/$id/confirm" | grep -q '"status":"confirmed"' || return 1
  curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$PORT_DEMO/api/orders/$id/process" | grep -q '"status":"processing"' || return 1
  curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$PORT_DEMO/api/orders/$id/complete" | grep -q '"status":"completed"' || return 1
  curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d '{"method":"cash","amount":250000}' \
    "http://127.0.0.1:$PORT_DEMO/api/orders/$id/payments" | grep -q '"status":"paid"' || return 1
}
demo_step "giao/tra: tao don moi 250000 -> xac nhan -> xu ly -> hoan tat -> thu tien mat 250000" giao_tra_chuan_bi

giao_tra_yeu_cau() {
  local id res replay
  id="$(cat "$GORD_FILE")"
  res="$(curl -fsS -b "$COOKIE" -H 'Idempotency-Key: demo-ship-1' -H 'Content-Type: application/json' \
    -d '{"carrier":"GHN-fake","destination":"Hà Nội"}' \
    "http://127.0.0.1:$PORT_DEMO/api/orders/$id/shipments")"
  echo "$res" | grep -q '"status":"requested"' || { echo "yeu cau giao tra ve: $res"; return 1; }
  echo "$res" | grep -q '"fee":30000' || { echo "phi giao sai (mong 3 mon x 500g -> 30000): $res"; return 1; }
  echo "$res" | grep -q '"eta_days":1' || { echo "ETA Ha Noi sai (mong 1): $res"; return 1; }
  echo "$res" | grep -qE '"tracking_code":"FAKE-TRK-[0-9A-F]{12}"' || { echo "ma van don sai dinh dang: $res"; return 1; }
  echo "$res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).shipment.id))" > "$GSHIP_FILE"
  replay="$(curl -fsS -b "$COOKIE" -H 'Idempotency-Key: demo-ship-1' -H 'Content-Type: application/json' \
    -d '{"carrier":"GHN-fake","destination":"Hà Nội"}' \
    "http://127.0.0.1:$PORT_DEMO/api/orders/$id/shipments")"
  echo "$replay" | grep -q '"replayed":true' || { echo "gui lai giao khong replay: $replay"; return 1; }
  [ "$(sqlite3 "$OMNIFLOW_DB" "SELECT COUNT(*) FROM shipments WHERE order_id=$id;")" = "1" ] || { echo "gui lai van tao them shipment"; return 1; }
}
demo_step "giao/tra: yeu cau giao 201 requested, phi 30000/ETA 1 ngay Ha Noi, ma van don FAKE-TRK-..., gui lai replayed" giao_tra_yeu_cau

giao_tra_trang_thai() {
  local ship code events
  ship="$(cat "$GSHIP_FILE")"
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -H 'Content-Type: application/json' \
    -d '{"status":"delivered"}' \
    "http://127.0.0.1:$PORT_DEMO/api/shipments/$ship/status")"
  [ "$code" = "400" ] || { echo "requested -> delivered tra ve HTTP $code, mong 400"; return 1; }
  curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' -d '{"status":"in_transit"}' \
    "http://127.0.0.1:$PORT_DEMO/api/shipments/$ship/status" | grep -q '"status":"in_transit"' || return 1
  curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' -d '{"status":"in_transit"}' \
    "http://127.0.0.1:$PORT_DEMO/api/shipments/$ship/status" | grep -q '"status":"in_transit"' || return 1
  events="$(sqlite3 "$OMNIFLOW_DB" "SELECT COUNT(*) FROM shipment_events WHERE shipment_id=$ship;")"
  [ "$events" = "2" ] || { echo "gui lap cung trang thai tao event thua, so event $events, mong 2"; return 1; }
  curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' -d '{"status":"delivered"}' \
    "http://127.0.0.1:$PORT_DEMO/api/shipments/$ship/status" | grep -q '"status":"delivered"' || return 1
}
demo_step "giao/tra: sai thu tu 400, in_transit 200, lap cung trang thai khong tao event, delivered 200" giao_tra_trang_thai

giao_tra_tra_hang() {
  local id v1 v2 res ret lvl moves
  id="$(cat "$GORD_FILE")"
  v1="$(cat "$G1V_FILE")"
  v2="$(cat "$G2V_FILE")"
  res="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' \
    -d "{\"items\":[{\"variant_id\":$v1,\"qty\":1,\"condition\":\"resalable\"},{\"variant_id\":$v2,\"qty\":1,\"condition\":\"damaged\"}],\"reason\":\"tra giao demo\"}" \
    "http://127.0.0.1:$PORT_DEMO/api/orders/$id/returns")"
  echo "$res" | grep -q '"status":"requested"' || { echo "yeu cau tra tra ve: $res"; return 1; }
  echo "$res" | grep -qE '"code":"TH-[0-9]{8}-[0-9]{4}"' || { echo "ma tra sai dinh dang: $res"; return 1; }
  ret="$(echo "$res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).return.id))")"
  echo "$ret" > "$GRET_FILE"
  echo "$res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).return.code))" > "$GRETCODE_FILE"
  curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$PORT_DEMO/api/returns/$ret/approve" | grep -q '"status":"approved"' || return 1
  curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$PORT_DEMO/api/returns/$ret/receive" | grep -q '"status":"received"' || return 1
  lvl="$(curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/stock/levels?warehouse_id=$(cat "$WHA_FILE")&variant_id=$v1")"
  echo "$lvl" | grep -q '"on_hand":49' || { echo "nhan tra khong nhap lai dung so: $lvl"; return 1; }
  lvl="$(curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/stock/levels?warehouse_id=$(cat "$WHA_FILE")&variant_id=$v2")"
  echo "$lvl" | grep -q '"on_hand":29' || { echo "hang hong lam doi ton: $lvl"; return 1; }
  moves="$(sqlite3 "$OMNIFLOW_DB" "SELECT COUNT(*) FROM stock_movements WHERE reference='$(cat "$GRETCODE_FILE")';")"
  [ "$moves" = "1" ] || { echo "so movement nhap lai $moves, mong 1 (chi dong resalable)"; return 1; }
}
demo_step "giao/tra: yeu cau tra 201 ma TH-..., duyet -> nhan, ton tang dung so ban lai duoc, hong khong nhap kho" giao_tra_tra_hang

giao_tra_hoan_doi_soat() {
  local id ret res sum
  id="$(cat "$GORD_FILE")"
  ret="$(cat "$GRET_FILE")"
  res="$(curl -fsS -b "$COOKIE" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$PORT_DEMO/api/returns/$ret/refund")"
  echo "$res" | grep -q '"status":"refunded"' || { echo "hoan tien tra tra ve: $res"; return 1; }
  sum="$(curl -fsS -b "$COOKIE" "http://127.0.0.1:$PORT_DEMO/api/orders/$id/payments")"
  echo "$sum" | grep -q '"paid_total":100000' || { echo "doi soat sau tra sai paid_total: $sum"; return 1; }
  echo "$sum" | grep -q '"refunded_total":150000' || { echo "doi soat sau tra sai refunded_total: $sum"; return 1; }
  echo "$sum" | grep -q '"payment_status":"partially_refunded"' || { echo "doi soat sau tra sai payment_status: $sum"; return 1; }
}
demo_step "giao/tra: hoan tien tra 150000 -> refunded, doi soat paid_total 100000, refunded_total 150000, partially_refunded" giao_tra_hoan_doi_soat

giao_tra_rbac() {
  local id ret ship code
  id="$(cat "$GORD_FILE")"
  ret="$(cat "$GRET_FILE")"
  ship="$(cat "$GSHIP_FILE")"
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$RBAC_COOKIE" -H 'Content-Type: application/json' \
    -d '{"carrier":"GHN-fake","destination":"TP.HCM"}' \
    "http://127.0.0.1:$PORT_DEMO/api/orders/$id/shipments")"
  [ "$code" = "403" ] || { echo "sales yeu cau giao tra ve HTTP $code, mong 403"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$WH_COOKIE" -H 'Content-Type: application/json' \
    -d "{\"items\":[{\"variant_id\":$(cat "$G1V_FILE"),\"qty\":1,\"condition\":\"resalable\"}],\"reason\":\"kho tra\"}" \
    "http://127.0.0.1:$PORT_DEMO/api/orders/$id/returns")"
  [ "$code" = "403" ] || { echo "warehouse yeu cau tra tra ve HTTP $code, mong 403"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$RBAC_COOKIE" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$PORT_DEMO/api/returns/$ret/approve")"
  [ "$code" = "403" ] || { echo "sales duyet tra tra ve HTTP $code, mong 403"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X DELETE \
    "http://127.0.0.1:$PORT_DEMO/api/shipments/$ship")"
  [ "$code" = "404" ] || { echo "DELETE shipment tra ve HTTP $code, mong 404"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$COOKIE" -X DELETE \
    "http://127.0.0.1:$PORT_DEMO/api/returns/$ret")"
  [ "$code" = "404" ] || { echo "DELETE return tra ve HTTP $code, mong 404"; return 1; }
}
demo_step "giao/tra: sales yeu cau giao 403, warehouse yeu cau tra 403, sales duyet tra 403, DELETE 404" giao_tra_rbac

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
    && grep -q 'D1' docs/DECISIONS.md && grep -q 'D10' docs/DECISIONS.md \
    && grep -q 'D24' docs/DECISIONS.md && grep -q 'D25' docs/DECISIONS.md
}
demo_step "docs ROADMAP/DECISIONS/SETUP co mat" docs_present

if [ "$FAIL" -ne 0 ]; then echo "DEMO: FAIL"; exit 1; fi
echo "DEMO: PASS"
