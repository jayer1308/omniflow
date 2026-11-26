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

step "npm ci" bash -c '
  # Gate worktree link node_modules tu main checkout bang symlink; npm ci ma
  # chay qua symlink se xoa sach thu muc dich o main checkout (APOS bug, da
  # tai hien: npm ci trong worktree -> main node_modules ve 0). Go link truoc
  # roi moi cai moi, de main checkout khong bi anh huong.
  if [ -L node_modules ]; then rm node_modules; fi
  npm ci --no-audit --no-fund
'
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
  trap 'kill "${server_pid:-}" 2>/dev/null; rm -rf "${tmpdir:-}"' RETURN
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
  # RBAC (GOAL-002): moi -> dang nhap vai moi -> khoa -> session cu bi chan
  # -> xem audit log -> truy cap ngoai pham vi bi 403.
  local invite_pass invite_res sales_cookie sales_login lock_res me_code login_code audit
  invite_pass="$(node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))")"
  invite_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"email\":\"sales-rbac@example.local\",\"password\":\"$invite_pass\",\"role\":\"sales\",\"branch_id\":1}" \
    "http://127.0.0.1:$port/api/users/invite")" || return 1
  echo "$invite_res" | grep -q '"status":"active"' || { echo "invite tra ve: $invite_res"; return 1; }
  echo "$invite_res" | grep -q "$invite_pass" && { echo "invite tra ve mat khau!"; return 1; }
  sales_cookie="$tmpdir/sales-rbac-cookie.txt"
  sales_login="$(curl -fsS -c "$sales_cookie" -H 'Content-Type: application/json' \
    -d "{\"email\":\"sales-rbac@example.local\",\"password\":\"$invite_pass\"}" \
    "http://127.0.0.1:$port/login")" || return 1
  echo "$sales_login" | grep -q '"ok":true' || { echo "login sales moi tra ve: $sales_login"; return 1; }
  # Sales dang active goi audit log phai bi 403 (sai vai); kiem tra luc session con song.
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$sales_cookie" "http://127.0.0.1:$port/api/audit-log")"
  [ "$code" = "403" ] || { echo "sales xem audit log tra ve HTTP $code, mong 403"; return 1; }
  local sales_id
  sales_id="$(echo "$invite_res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).user.id))")"
  lock_res="$(curl -fsS -X POST -b "$cookie" "http://127.0.0.1:$port/api/users/$sales_id/lock")" || return 1
  echo "$lock_res" | grep -q '"status":"locked"' || { echo "lock tra ve: $lock_res"; return 1; }
  me_code="$(curl -s -o /dev/null -w '%{http_code}' -b "$sales_cookie" "http://127.0.0.1:$port/me")"
  [ "$me_code" = "401" ] || { echo "session cu sau khi khoa tra ve HTTP $me_code, mong 401"; return 1; }
  login_code="$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
    -d "{\"email\":\"sales-rbac@example.local\",\"password\":\"$invite_pass\"}" \
    "http://127.0.0.1:$port/login")"
  [ "$login_code" = "403" ] || { echo "login tai khoan khoa tra ve HTTP $login_code, mong 403"; return 1; }
  audit="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/audit-log")" || return 1
  echo "$audit" | grep -q '"action":"invite"' || { echo "audit log thieu invite: $audit"; return 1; }
  echo "$audit" | grep -q '"action":"lock"' || { echo "audit log thieu lock: $audit"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$cookie" "http://127.0.0.1:$port/api/orgs/9999/branches")"
  [ "$code" = "403" ] || { echo "truy cap org khac tra ve HTTP $code, mong 403"; return 1; }
  # San pham / gia / CSV (GOAL-003): tao san pham -> bien the -> trung SKU 409
  # -> gia rieng + fallback -> lich su gia -> preview CSV loi (khong ghi)
  # -> import CSV loi (0 dong) -> import CSV sach -> export khop -> RBAC 403.
  local branch2_res branch2_id prod_res prod_id var_res dup_code price_res eff_price hist
  local wh_pass wh_res wh_cookie sales2_pass sales2_res sales2_cookie
  local preview_file import_bad import_clean export_csv count_before count_after
  branch2_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"name":"Chi nhanh 2"}' "http://127.0.0.1:$port/api/branches")" || return 1
  branch2_id="$(echo "$branch2_res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
  wh_pass="$(node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))")"
  wh_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"email\":\"kho-smoke@example.local\",\"password\":\"$wh_pass\",\"role\":\"warehouse\",\"branch_id\":1}" \
    "http://127.0.0.1:$port/api/users/invite")" || return 1
  wh_cookie="$tmpdir/wh-cookie.txt"
  curl -fsS -c "$wh_cookie" -H 'Content-Type: application/json' \
    -d "{\"email\":\"kho-smoke@example.local\",\"password\":\"$wh_pass\"}" \
    "http://127.0.0.1:$port/login" >/dev/null || return 1
  sales2_pass="$(node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))")"
  sales2_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"email\":\"sales2-smoke@example.local\",\"password\":\"$sales2_pass\",\"role\":\"sales\",\"branch_id\":1}" \
    "http://127.0.0.1:$port/api/users/invite")" || return 1
  sales2_cookie="$tmpdir/sales2-cookie.txt"
  curl -fsS -c "$sales2_cookie" -H 'Content-Type: application/json' \
    -d "{\"email\":\"sales2-smoke@example.local\",\"password\":\"$sales2_pass\"}" \
    "http://127.0.0.1:$port/login" >/dev/null || return 1
  prod_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"code":"SP-SMOKE","name":"San pham smoke","price":100000,"unit":"cai"}' \
    "http://127.0.0.1:$port/api/products")" || return 1
  echo "$prod_res" | grep -q '"code":"SP-SMOKE"' || { echo "tao san pham tra ve: $prod_res"; return 1; }
  prod_id="$(echo "$prod_res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
  var_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"sku":"SKU-SMOKE","name":"Bien the smoke"}' \
    "http://127.0.0.1:$port/api/products/$prod_id/variants")" || return 1
  echo "$var_res" | grep -q '"sku":"SKU-SMOKE"' || { echo "tao bien the tra ve: $var_res"; return 1; }
  dup_code="$(curl -s -o /dev/null -w '%{http_code}' -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"sku":"SKU-SMOKE","name":"Trung SKU"}' \
    "http://127.0.0.1:$port/api/products/$prod_id/variants")"
  [ "$dup_code" = "409" ] || { echo "trung SKU tra ve HTTP $dup_code, mong 409"; return 1; }
  price_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"channel\":\"web\",\"branch_id\":$branch2_id,\"price\":130000,\"reason\":\"gia web CN2\"}" \
    "http://127.0.0.1:$port/api/products/$prod_id/prices")" || return 1
  echo "$price_res" | grep -q '"price":130000' || { echo "dat gia rieng tra ve: $price_res"; return 1; }
  eff_price="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/products/$prod_id/price?channel=web&branch_id=$branch2_id")" || return 1
  echo "$eff_price" | grep -q '"price":130000' || { echo "gia hieu dung tra ve: $eff_price"; return 1; }
  echo "$eff_price" | grep -q '"source":"channel_branch"' || { echo "source gia tra ve: $eff_price"; return 1; }
  hist="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/products/$prod_id/price-history")" || return 1
  echo "$hist" | grep -q '"new_price":130000' || { echo "lich su gia thieu dong moi: $hist"; return 1; }
  printf 'code,name,price,unit,min_stock,status,category,barcode\nSP-PV-SMOKE,Ao smoke,100000,cai\nSP-PV-BAD,Quan loi,-5000,cai\n' > "$tmpdir/preview.csv"
  preview_file="$(curl -fsS -b "$cookie" -F "file=@$tmpdir/preview.csv" \
    "http://127.0.0.1:$port/api/products/import/preview")" || return 1
  echo "$preview_file" | grep -q '"line":3' || { echo "preview CSV tra ve: $preview_file"; return 1; }
  count_before="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/products" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).length))")"
  printf 'code,name,price,unit\nSP-IM-BAD1,Ao loi 1,100000,cai\nSP-IM-BAD2,Quan loi 2,-100,cai\n' > "$tmpdir/import-bad.csv"
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$cookie" -F "file=@$tmpdir/import-bad.csv" \
    "http://127.0.0.1:$port/api/products/import")"
  [ "$code" = "422" ] || { echo "import CSV loi tra ve HTTP $code, mong 422"; return 1; }
  count_after="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/products" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).length))")"
  [ "$count_before" = "$count_after" ] || { echo "import loi van ghi: truoc $count_before, sau $count_after"; return 1; }
  printf 'code,name,price,unit\nSP-IM-OK1,Ao ok 1,100000,cai\nSP-IM-OK2,Quan ok 2,200000,cai\n' > "$tmpdir/import-ok.csv"
  import_clean="$(curl -fsS -b "$cookie" -F "file=@$tmpdir/import-ok.csv" \
    "http://127.0.0.1:$port/api/products/import")" || return 1
  echo "$import_clean" | grep -q '"imported":2' || { echo "import CSV sach tra ve: $import_clean"; return 1; }
  export_csv="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/products/export")" || return 1
  echo "$export_csv" | grep -q 'SP-SMOKE' || { echo "export CSV thieu SP-SMOKE"; return 1; }
  echo "$export_csv" | grep -q 'SP-IM-OK1' || { echo "export CSV thieu SP-IM-OK1"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$sales2_cookie" -H 'Content-Type: application/json' \
    -d '{"channel":"web","price":140000,"reason":"sales doi gia"}' \
    "http://127.0.0.1:$port/api/products/$prod_id/prices")"
  [ "$code" = "403" ] || { echo "sales doi gia tra ve HTTP $code, mong 403"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$wh_cookie" -H 'Content-Type: application/json' \
    -d '{"code":"SP-WH","name":"Kho tao","price":1000,"unit":"cai"}' \
    "http://127.0.0.1:$port/api/products")"
  [ "$code" = "403" ] || { echo "warehouse tao san pham tra ve HTTP $code, mong 403"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$sales2_cookie" -F "file=@$tmpdir/import-ok.csv" \
    "http://127.0.0.1:$port/api/products/import")"
  [ "$code" = "403" ] || { echo "sales import CSV tra ve HTTP $code, mong 403"; return 1; }
  kill "$server_pid" 2>/dev/null
  wait "$server_pid" 2>/dev/null || true
  trap - RETURN
  rm -rf "$tmpdir"
  echo "smoke server tren port $port: health + login + owner-only + staff 403 + RBAC moi/khoa/audit/403 + san-pham/gia/CSV (tao san pham, bien the, trung SKU 409, gia rieng + fallback, lich su gia, preview/import/export CSV, RBAC 403)"
}
step "smoke server" smoke

if [ "$FAIL" -ne 0 ]; then echo "CHECK: FAIL"; exit 1; fi
echo "CHECK: PASS"
