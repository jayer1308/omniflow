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
  export OMNIFLOW_WEBHOOK_SECRET="$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")"
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
  # Kho / ton (GOAL-004): tao kho -> nhap -> xuat -> xuat qua ton 400
  # -> giu -> giai phong -> chuyen kho -> kiem ke -> ton thap ->
  # idempotency gui lai -> race dong thoi -> RBAC 403 -> ngoai org 403.
  local wha_res whb_res wha_id whb_id var_id in_res out_res over_body lvl
  local res_res rel_res tr_res cnt_res low_res idem1 idem2 race_ok race_fail
  wha_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"name":"Kho A smoke"}' "http://127.0.0.1:$port/api/warehouses")" || return 1
  echo "$wha_res" | grep -q '"name":"Kho A smoke"' || { echo "tao kho A tra ve: $wha_res"; return 1; }
  wha_id="$(echo "$wha_res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
  whb_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"name":"Kho B smoke"}' "http://127.0.0.1:$port/api/warehouses")" || return 1
  whb_id="$(echo "$whb_res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
  var_id="$(echo "$var_res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const b=JSON.parse(s);console.log((b.variant||b).id)})")"
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$sales2_cookie" -H 'Content-Type: application/json' \
    -d '{"name":"Kho sales tao"}' "http://127.0.0.1:$port/api/warehouses")"
  [ "$code" = "403" ] || { echo "sales tao kho tra ve HTTP $code, mong 403"; return 1; }
  in_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"variant_id\":$var_id,\"qty\":50,\"reason\":\"nhap smoke\"}" \
    "http://127.0.0.1:$port/api/stock/in")" || return 1
  echo "$in_res" | grep -q '"on_hand":50' || { echo "nhap kho tra ve: $in_res"; return 1; }
  echo "$in_res" | grep -q '"available":50' || { echo "nhap kho available sai: $in_res"; return 1; }
  out_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"variant_id\":$var_id,\"qty\":20,\"reason\":\"xuat smoke\"}" \
    "http://127.0.0.1:$port/api/stock/out")" || return 1
  echo "$out_res" | grep -q '"on_hand":30' || { echo "xuat kho tra ve: $out_res"; return 1; }
  over_body="$(curl -s -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"variant_id\":$var_id,\"qty\":40,\"reason\":\"xuat qua ton\"}" \
    "http://127.0.0.1:$port/api/stock/out")"
  echo "$over_body" | grep -q 'insufficient_stock' || { echo "xuat qua ton thieu ma loi: $over_body"; return 1; }
  res_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"variant_id\":$var_id,\"qty\":10,\"reason\":\"giu smoke\"}" \
    "http://127.0.0.1:$port/api/stock/reserve")" || return 1
  echo "$res_res" | grep -q '"reserved":10' || { echo "giu hang tra ve: $res_res"; return 1; }
  echo "$res_res" | grep -q '"available":20' || { echo "giu hang available sai: $res_res"; return 1; }
  rel_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"variant_id\":$var_id,\"qty\":4,\"reason\":\"giai phong smoke\"}" \
    "http://127.0.0.1:$port/api/stock/release")" || return 1
  echo "$rel_res" | grep -q '"reserved":6' || { echo "giai phong tra ve: $rel_res"; return 1; }
  tr_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"from_warehouse_id\":$wha_id,\"to_warehouse_id\":$whb_id,\"variant_id\":$var_id,\"qty\":5,\"reason\":\"chuyen smoke\"}" \
    "http://127.0.0.1:$port/api/stock/transfer")" || return 1
  echo "$tr_res" | grep -q '"on_hand":25' || { echo "chuyen kho tra ve: $tr_res"; return 1; }
  lvl="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/stock/levels?warehouse_id=$whb_id&variant_id=$var_id")" || return 1
  echo "$lvl" | grep -q '"on_hand":5' || { echo "kho dich sau chuyen: $lvl"; return 1; }
  cnt_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$whb_id,\"variant_id\":$var_id,\"counted_qty\":8,\"reason\":\"kiem ke smoke\"}" \
    "http://127.0.0.1:$port/api/stock/count")" || return 1
  echo "$cnt_res" | grep -q '"on_hand":8' || { echo "kiem ke tra ve: $cnt_res"; return 1; }
  low_res="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/stock/low-stock")" || return 1
  echo "$low_res" | grep -q '"sku":"SKU-SEED-01-M"' || { echo "ton thap thieu cap seed: $low_res"; return 1; }
  idem1="$(curl -fsS -b "$cookie" -H 'Idempotency-Key: smoke-key-1' -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$whb_id,\"variant_id\":$var_id,\"qty\":5,\"reason\":\"nhap idem\"}" \
    "http://127.0.0.1:$port/api/stock/in")" || return 1
  echo "$idem1" | grep -q '"on_hand":13' || { echo "nhap idem lan 1 tra ve: $idem1"; return 1; }
  idem2="$(curl -fsS -b "$cookie" -H 'Idempotency-Key: smoke-key-1' -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$whb_id,\"variant_id\":$var_id,\"qty\":5,\"reason\":\"nhap idem\"}" \
    "http://127.0.0.1:$port/api/stock/in")" || return 1
  echo "$idem2" | grep -q '"replayed":true' || { echo "gui lai khong replay: $idem2"; return 1; }
  lvl="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/stock/levels?warehouse_id=$whb_id&variant_id=$var_id")" || return 1
  echo "$lvl" | grep -q '"on_hand":13' || { echo "gui lai van tru them: $lvl"; return 1; }
  # Race: giai phong het + kiem ke ve 50, 10 yeu cau xuat 10 dong thoi.
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"variant_id\":$var_id,\"qty\":6,\"reason\":\"giai phong het\"}" \
    "http://127.0.0.1:$port/api/stock/release" >/dev/null || return 1
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"variant_id\":$var_id,\"counted_qty\":50,\"reason\":\"kiem ke ve 50\"}" \
    "http://127.0.0.1:$port/api/stock/count" >/dev/null || return 1
  local i pids
  pids=()
  for i in $(seq 1 10); do
    ( curl -s -o /dev/null -w '%{http_code}\n' -b "$cookie" -H 'Content-Type: application/json' \
      -d "{\"warehouse_id\":$wha_id,\"variant_id\":$var_id,\"qty\":10,\"reason\":\"xuat race\"}" \
      "http://127.0.0.1:$port/api/stock/out" > "$tmpdir/race-$i.code" ) &
    pids+=($!)
  done
  wait "${pids[@]}"
  race_ok="$(cat "$tmpdir"/race-*.code | grep -c '^200$' || true)"
  race_fail="$(cat "$tmpdir"/race-*.code | grep -c '^400$' || true)"
  [ "$race_ok" = "5" ] || { echo "race: $race_ok yeu cau thanh cong, mong 5"; return 1; }
  [ "$race_fail" = "5" ] || { echo "race: $race_fail yeu cau bi 400, mong 5"; return 1; }
  lvl="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/stock/levels?warehouse_id=$wha_id&variant_id=$var_id")" || return 1
  echo "$lvl" | grep -q '"on_hand":0' || { echo "ton cuoi sau race: $lvl"; return 1; }
  # RBAC kho: sales nhap kho / xem movements bi 403; warehouse chi duoc kho duoc gan.
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$sales2_cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"variant_id\":$var_id,\"qty\":1,\"reason\":\"sales nhap\"}" \
    "http://127.0.0.1:$port/api/stock/in")"
  [ "$code" = "403" ] || { echo "sales nhap kho tra ve HTTP $code, mong 403"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$sales2_cookie" "http://127.0.0.1:$port/api/stock/movements")"
  [ "$code" = "403" ] || { echo "sales xem movements tra ve HTTP $code, mong 403"; return 1; }
  local wh2_pass wh2_res wh2_id wh2_cookie
  wh2_pass="$(node -e "console.log(require('crypto').randomBytes(12).toString('base64url'))")"
  wh2_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"email\":\"kho-scope-smoke@example.local\",\"password\":\"$wh2_pass\",\"role\":\"warehouse\",\"branch_id\":1}" \
    "http://127.0.0.1:$port/api/users/invite")" || return 1
  wh2_id="$(echo "$wh2_res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).user.id))")"
  curl -fsS -X PATCH -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id}" \
    "http://127.0.0.1:$port/api/users/$wh2_id/scope" >/dev/null || return 1
  wh2_cookie="$tmpdir/wh2-cookie.txt"
  curl -fsS -c "$wh2_cookie" -H 'Content-Type: application/json' \
    -d "{\"email\":\"kho-scope-smoke@example.local\",\"password\":\"$wh2_pass\"}" \
    "http://127.0.0.1:$port/login" >/dev/null || return 1
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$wh2_cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$whb_id,\"variant_id\":$var_id,\"qty\":1,\"reason\":\"ngoai pham vi\"}" \
    "http://127.0.0.1:$port/api/stock/in")"
  [ "$code" = "403" ] || { echo "warehouse nhap kho ngoai pham vi tra ve HTTP $code, mong 403"; return 1; }
  # Ngoai org: chen truc tiep org B + kho B vao DB tam roi goi tu org A.
  local orgb_id whb_org_id attempt
  orgb_id=""
  for attempt in 1 2 3 4 5; do
    orgb_id="$(sqlite3 "$tmpdir/smoke.db" "INSERT INTO orgs (name) VALUES ('Cong ty B smoke'); SELECT last_insert_rowid();" 2>/dev/null)" && [ -n "$orgb_id" ] && break
    sleep 0.2
  done
  [ -n "$orgb_id" ] || { echo "khong tao duoc org B de kiem tra ngoai org"; return 1; }
  whb_org_id="$(sqlite3 "$tmpdir/smoke.db" "INSERT INTO warehouses (org_id, name, status) VALUES ($orgb_id, 'Kho org B', 'active'); SELECT last_insert_rowid();")" || return 1
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$cookie" "http://127.0.0.1:$port/api/warehouses/$whb_org_id")"
  [ "$code" = "403" ] || { echo "doc kho org B tra ve HTTP $code, mong 403"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$whb_org_id,\"variant_id\":$var_id,\"qty\":1,\"reason\":\"ngoai org\"}" \
    "http://127.0.0.1:$port/api/stock/in")"
  [ "$code" = "403" ] || { echo "nhap kho org B tra ve HTTP $code, mong 403"; return 1; }
  # Don hang (GOAL-005): tao don tai quay -> xac nhan giu hang -> xu ly ->
  # hoan tat xuat kho -> tao don khac -> xac nhan -> huy khi dang xu ly
  # giai phong dung -> chuyen sai 400 -> idempotency gui lai khong tao don
  # moi -> race dong thoi khong ban qua ton -> RBAC 403 -> ngoai org 403.
  local ord1 ord1_id ord1_code ord1_replay ord1_total ord1_detail ord_lvl
  local ord2 ord2_id ord3 ord3_id race_oid
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"variant_id\":$var_id,\"qty\":50,\"reason\":\"nhap cho don smoke\"}" \
    "http://127.0.0.1:$port/api/stock/in" >/dev/null || return 1
  ord1="$(curl -fsS -b "$cookie" -H 'Idempotency-Key: smoke-order-1' -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"channel\":\"counter\",\"customer_name\":\"Khach smoke\",\"items\":[{\"variant_id\":$var_id,\"qty\":10}]}" \
    "http://127.0.0.1:$port/api/orders")" || return 1
  echo "$ord1" | grep -q '"status":"draft"' || { echo "tao don tra ve: $ord1"; return 1; }
  echo "$ord1" | grep -q '"total":1000000' || { echo "total don sai: $ord1"; return 1; }
  echo "$ord1" | grep -q '"unit_price":100000' || { echo "snapshot gia don sai: $ord1"; return 1; }
  echo "$ord1" | grep -q '"price_source":"base"' || { echo "price_source don sai: $ord1"; return 1; }
  ord1_id="$(echo "$ord1" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
  ord1_code="$(echo "$ord1" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).code))")"
  echo "$ord1_code" | grep -qE '^DH-[0-9]{8}-[0-9]{4}$' || { echo "ma don sai dinh dang: $ord1_code"; return 1; }
  ord1_replay="$(curl -fsS -b "$cookie" -H 'Idempotency-Key: smoke-order-1' -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"channel\":\"counter\",\"items\":[{\"variant_id\":$var_id,\"qty\":10}]}" \
    "http://127.0.0.1:$port/api/orders")" || return 1
  echo "$ord1_replay" | grep -q '"replayed":true' || { echo "gui lai don khong replay: $ord1_replay"; return 1; }
  echo "$ord1_replay" | grep -q "\"code\":\"$ord1_code\"" || { echo "gui lai don doi ma: $ord1_replay"; return 1; }
  ord1_total="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/orders" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).total))")"
  [ "$ord1_total" = "1" ] || { echo "gui lai van tao them don, total $ord1_total, mong 1"; return 1; }
  ord1_detail="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/orders/$ord1_id")" || return 1
  echo "$ord1_detail" | grep -q '"to_status":"draft"' || { echo "chi tiet don thieu event tao: $ord1_detail"; return 1; }
  local cfm proc done_lvl
  cfm="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/orders/$ord1_id/confirm")" || return 1
  echo "$cfm" | grep -q '"status":"confirmed"' || { echo "xac nhan don tra ve: $cfm"; return 1; }
  ord_lvl="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/stock/levels?warehouse_id=$wha_id&variant_id=$var_id")" || return 1
  echo "$ord_lvl" | grep -q '"reserved":10' || { echo "xac nhan khong giu hang: $ord_lvl"; return 1; }
  echo "$ord_lvl" | grep -q '"on_hand":50' || { echo "xac nhan doi on_hand: $ord_lvl"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/orders/$ord1_id/confirm")"
  [ "$code" = "400" ] || { echo "xac nhan 2 lan tra ve HTTP $code, mong 400"; return 1; }
  proc="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/orders/$ord1_id/process")" || return 1
  echo "$proc" | grep -q '"status":"processing"' || { echo "xu ly don tra ve: $proc"; return 1; }
  done_lvl="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/orders/$ord1_id/complete")" || return 1
  echo "$done_lvl" | grep -q '"status":"completed"' || { echo "hoan tat don tra ve: $done_lvl"; return 1; }
  ord_lvl="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/stock/levels?warehouse_id=$wha_id&variant_id=$var_id")" || return 1
  echo "$ord_lvl" | grep -q '"on_hand":40' || { echo "hoan tat khong tru on_hand: $ord_lvl"; return 1; }
  echo "$ord_lvl" | grep -q '"reserved":0' || { echo "hoan tat khong giai phong giu: $ord_lvl"; return 1; }
  ord2="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"channel\":\"counter\",\"items\":[{\"variant_id\":$var_id,\"qty\":5}]}" \
    "http://127.0.0.1:$port/api/orders")" || return 1
  ord2_id="$(echo "$ord2" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/orders/$ord2_id/confirm" >/dev/null || return 1
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/orders/$ord2_id/process" >/dev/null || return 1
  local cancel2
  cancel2="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{"note":"huy khi dang xu ly"}' \
    "http://127.0.0.1:$port/api/orders/$ord2_id/cancel")" || return 1
  echo "$cancel2" | grep -q '"status":"cancelled"' || { echo "huy don tra ve: $cancel2"; return 1; }
  ord_lvl="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/stock/levels?warehouse_id=$wha_id&variant_id=$var_id")" || return 1
  echo "$ord_lvl" | grep -q '"on_hand":40' || { echo "huy khong giu on_hand: $ord_lvl"; return 1; }
  echo "$ord_lvl" | grep -q '"reserved":0' || { echo "huy khong giai phong: $ord_lvl"; return 1; }
  ord3="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"channel\":\"counter\",\"items\":[{\"variant_id\":$var_id,\"qty\":1}]}" \
    "http://127.0.0.1:$port/api/orders")" || return 1
  ord3_id="$(echo "$ord3" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/orders/$ord3_id/complete")"
  [ "$code" = "400" ] || { echo "nhap -> hoan tat tra ve HTTP $code, mong 400"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$wh_cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"channel\":\"counter\",\"items\":[{\"variant_id\":$var_id,\"qty\":1}]}" \
    "http://127.0.0.1:$port/api/orders")"
  [ "$code" = "403" ] || { echo "warehouse tao don tra ve HTTP $code, mong 403"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$sales2_cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/orders/$ord3_id/process")"
  [ "$code" = "403" ] || { echo "sales xu ly don tra ve HTTP $code, mong 403"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$whb_org_id,\"channel\":\"counter\",\"items\":[{\"variant_id\":$var_id,\"qty\":1}]}" \
    "http://127.0.0.1:$port/api/orders")"
  { [ "$code" = "403" ] || [ "$code" = "404" ]; } || { echo "tao don kho org B tra ve HTTP $code, mong 403/404"; return 1; }
  # Race don: kiem ke ve 50, tao 10 don nhap qty 10 roi xac nhan dong thoi.
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"variant_id\":$var_id,\"counted_qty\":50,\"reason\":\"kiem ke ve 50 cho race don\"}" \
    "http://127.0.0.1:$port/api/stock/count" >/dev/null || return 1
  for i in $(seq 1 10); do
    race_oid="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
      -d "{\"warehouse_id\":$wha_id,\"channel\":\"counter\",\"items\":[{\"variant_id\":$var_id,\"qty\":10}]}" \
      "http://127.0.0.1:$port/api/orders" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")" || return 1
    echo "$race_oid" > "$tmpdir/race-order-$i.id"
  done
  pids=()
  for i in $(seq 1 10); do
    race_oid="$(cat "$tmpdir/race-order-$i.id")"
    ( curl -s -o /dev/null -w '%{http_code}\n' -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
      "http://127.0.0.1:$port/api/orders/$race_oid/confirm" > "$tmpdir/race-order-$i.code" ) &
    pids+=($!)
  done
  wait "${pids[@]}"
  race_ok="$(cat "$tmpdir"/race-order-*.code | grep -c '^200$' || true)"
  race_fail="$(cat "$tmpdir"/race-order-*.code | grep -c '^400$' || true)"
  [ "$race_ok" = "5" ] || { echo "race don: $race_ok xac nhan thanh cong, mong 5"; return 1; }
  [ "$race_fail" = "5" ] || { echo "race don: $race_fail xac nhan bi 400, mong 5"; return 1; }
  ord_lvl="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/stock/levels?warehouse_id=$wha_id&variant_id=$var_id")" || return 1
  echo "$ord_lvl" | grep -q '"on_hand":50' || { echo "ton cuoi sau race don: $ord_lvl"; return 1; }
  echo "$ord_lvl" | grep -q '"reserved":50' || { echo "giu cuoi sau race don: $ord_lvl"; return 1; }
  # Thanh toan + hoan tien (GOAL-006): thu tien mat mot phan -> thu qua cong
  # -> webhook paid chot -> webhook lap bi bo qua -> webhook sai chu ky 401
  # -> hoan mot phan -> doi soat dung so -> idempotency gui lai khong tao
  # payment moi -> RBAC 403 (warehouse tao, sales hoan) -> DELETE 404.
  local pay1 pay1_id pay2 pay_ref pay_sig pay_res dup_res bad_code
  local refund_res list_res idem_pay idem_replay list2
  pay1="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"method":"cash","amount":400000}' \
    "http://127.0.0.1:$port/api/orders/$ord1_id/payments")" || return 1
  echo "$pay1" | grep -q '"status":"paid"' || { echo "thu tien mat tra ve: $pay1"; return 1; }
  echo "$pay1" | grep -q '"paid_total":400000' || { echo "doi soat sau thu mat sai: $pay1"; return 1; }
  echo "$pay1" | grep -q '"payment_status":"partially_paid"' || { echo "trang thai sau thu mat sai: $pay1"; return 1; }
  pay1_id="$(echo "$pay1" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).payment.id))")"
  pay2="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"method":"gateway","amount":300000}' \
    "http://127.0.0.1:$port/api/orders/$ord1_id/payments")" || return 1
  echo "$pay2" | grep -q '"status":"requested"' || { echo "thu qua cong tra ve: $pay2"; return 1; }
  pay_ref="$(echo "$pay2" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).payment.gateway_reference))")"
  echo "$pay_ref" | grep -q '^FAKE-PAY-' || { echo "gateway_reference sai: $pay_ref"; return 1; }
  pay_sig="$(node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "$pay_ref:paid:300000:$OMNIFLOW_WEBHOOK_SECRET")"
  pay_res="$(curl -fsS -H 'Content-Type: application/json' -H "X-Fake-Signature: $pay_sig" \
    -d "{\"gateway_reference\":\"$pay_ref\",\"status\":\"paid\",\"amount\":300000}" \
    "http://127.0.0.1:$port/api/payments/webhook")" || return 1
  echo "$pay_res" | grep -q '"status":"paid"' || { echo "webhook paid tra ve: $pay_res"; return 1; }
  dup_res="$(curl -fsS -H 'Content-Type: application/json' -H "X-Fake-Signature: $pay_sig" \
    -d "{\"gateway_reference\":\"$pay_ref\",\"status\":\"paid\",\"amount\":300000}" \
    "http://127.0.0.1:$port/api/payments/webhook")" || return 1
  echo "$dup_res" | grep -q '"duplicate":true' || { echo "webhook lap khong duplicate: $dup_res"; return 1; }
  echo "$dup_res" | grep -q '"paid_total":700000' || { echo "webhook lap doi tong: $dup_res"; return 1; }
  bad_code="$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -H 'X-Fake-Signature: 0000000000000000000000000000000000000000000000000000000000000000' \
    -d "{\"gateway_reference\":\"$pay_ref\",\"status\":\"paid\",\"amount\":300000}" \
    "http://127.0.0.1:$port/api/payments/webhook")"
  [ "$bad_code" = "401" ] || { echo "webhook sai chu ky tra ve HTTP $bad_code, mong 401"; return 1; }
  refund_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"amount":200000,"reason":"hoan smoke"}' \
    "http://127.0.0.1:$port/api/payments/$pay1_id/refunds")" || return 1
  echo "$refund_res" | grep -q '"status":"completed"' || { echo "hoan tien tra ve: $refund_res"; return 1; }
  echo "$refund_res" | grep -q '"paid_total":500000' || { echo "doi soat sau hoan sai: $refund_res"; return 1; }
  echo "$refund_res" | grep -q '"refunded_total":200000' || { echo "tong hoan sai: $refund_res"; return 1; }
  echo "$refund_res" | grep -q '"outstanding":500000' || { echo "con thieu sau hoan sai: $refund_res"; return 1; }
  list_res="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/orders/$ord1_id/payments")" || return 1
  echo "$list_res" | grep -q '"payment_status":"partially_paid"' || { echo "trang thai doi soat sai: $list_res"; return 1; }
  idem_pay="$(curl -fsS -b "$cookie" -H 'Idempotency-Key: smoke-pay-1' -H 'Content-Type: application/json' \
    -d '{"method":"cash","amount":50000}' \
    "http://127.0.0.1:$port/api/orders/$ord1_id/payments")" || return 1
  echo "$idem_pay" | grep -q '"status":"paid"' || { echo "tao payment idem lan 1 tra ve: $idem_pay"; return 1; }
  idem_replay="$(curl -fsS -b "$cookie" -H 'Idempotency-Key: smoke-pay-1' -H 'Content-Type: application/json' \
    -d '{"method":"cash","amount":50000}' \
    "http://127.0.0.1:$port/api/orders/$ord1_id/payments")" || return 1
  echo "$idem_replay" | grep -q '"replayed":true' || { echo "gui lai payment khong replay: $idem_replay"; return 1; }
  list2="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/orders/$ord1_id/payments")" || return 1
  echo "$list2" | grep -q '"paid_total":550000' || { echo "gui lai payment van tinh them: $list2"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$wh_cookie" -H 'Content-Type: application/json' \
    -d '{"method":"cash","amount":1000}' \
    "http://127.0.0.1:$port/api/orders/$ord1_id/payments")"
  [ "$code" = "403" ] || { echo "warehouse tao payment tra ve HTTP $code, mong 403"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$sales2_cookie" -H 'Content-Type: application/json' \
    -d '{"amount":1000,"reason":"sales hoan"}' \
    "http://127.0.0.1:$port/api/payments/$pay1_id/refunds")"
  [ "$code" = "403" ] || { echo "sales hoan tien tra ve HTTP $code, mong 403"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$cookie" -X DELETE \
    "http://127.0.0.1:$port/api/payments/$pay1_id")"
  [ "$code" = "404" ] || { echo "DELETE payment tra ve HTTP $code, mong 404"; return 1; }
  # Giao hang + tra hang (GOAL-007): tao don moi (2 bien the moi de ton
  # sach) -> xac nhan -> xu ly -> hoan tat -> thu tien -> yeu cau giao
  # (phi/ETA tu adapter, ma van don deterministic) -> idempotency gui lai
  # -> cap nhat sai thu tu 400 -> in_transit -> lap cung trang thai khong
  # tao event -> delivered -> yeu cau tra (1 ban lai duoc + 1 hong) ->
  # duyet -> nhan (ton tang dung so ban lai duoc, hong khong nhap kho) ->
  # hoan tien -> doi soat dung so -> RBAC 403 -> DELETE 404.
  local g1_res g1_id g1v_res g1v_id g2_res g2_id g2v_res g2v_id
  local gord gord_id ship_res ship_id ship_replay ship_events ret_res ret_id ret_code
  local gpay glvl gmove gsum
  g1_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"code":"SP-SMOKE-G1","name":"San pham giao 1","price":100000,"unit":"cai"}' \
    "http://127.0.0.1:$port/api/products")" || return 1
  g1_id="$(echo "$g1_res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
  g1v_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"sku":"SKU-SMOKE-G1","name":"Bien the giao 1"}' \
    "http://127.0.0.1:$port/api/products/$g1_id/variants")" || return 1
  g1v_id="$(echo "$g1v_res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const b=JSON.parse(s);console.log((b.variant||b).id)})")"
  g2_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"code":"SP-SMOKE-G2","name":"San pham giao 2","price":50000,"unit":"cai"}' \
    "http://127.0.0.1:$port/api/products")" || return 1
  g2_id="$(echo "$g2_res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
  g2v_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"sku":"SKU-SMOKE-G2","name":"Bien the giao 2"}' \
    "http://127.0.0.1:$port/api/products/$g2_id/variants")" || return 1
  g2v_id="$(echo "$g2v_res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const b=JSON.parse(s);console.log((b.variant||b).id)})")"
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"variant_id\":$g1v_id,\"qty\":50,\"reason\":\"nhap giao smoke\"}" \
    "http://127.0.0.1:$port/api/stock/in" >/dev/null || return 1
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"variant_id\":$g2v_id,\"qty\":30,\"reason\":\"nhap giao smoke\"}" \
    "http://127.0.0.1:$port/api/stock/in" >/dev/null || return 1
  gord="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"channel\":\"counter\",\"items\":[{\"variant_id\":$g1v_id,\"qty\":2},{\"variant_id\":$g2v_id,\"qty\":1}]}" \
    "http://127.0.0.1:$port/api/orders")" || return 1
  echo "$gord" | grep -q '"total":250000' || { echo "total don giao sai: $gord"; return 1; }
  gord_id="$(echo "$gord" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
  # Don nhap khong giao duoc (400).
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"carrier":"GHN-fake","destination":"TP.HCM"}' \
    "http://127.0.0.1:$port/api/orders/$gord_id/shipments")"
  [ "$code" = "400" ] || { echo "don nhap yeu cau giao tra ve HTTP $code, mong 400"; return 1; }
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/orders/$gord_id/confirm" >/dev/null || return 1
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/orders/$gord_id/process" >/dev/null || return 1
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/orders/$gord_id/complete" >/dev/null || return 1
  gpay="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"method":"cash","amount":250000}' \
    "http://127.0.0.1:$port/api/orders/$gord_id/payments")" || return 1
  echo "$gpay" | grep -q '"status":"paid"' || { echo "thu tien don giao tra ve: $gpay"; return 1; }
  ship_res="$(curl -fsS -b "$cookie" -H 'Idempotency-Key: smoke-ship-1' -H 'Content-Type: application/json' \
    -d '{"carrier":"GHN-fake","destination":"Hà Nội"}' \
    "http://127.0.0.1:$port/api/orders/$gord_id/shipments")" || return 1
  echo "$ship_res" | grep -q '"status":"requested"' || { echo "yeu cau giao tra ve: $ship_res"; return 1; }
  echo "$ship_res" | grep -q '"fee":30000' || { echo "phi giao sai (mong 3 mon x 500g -> 30000): $ship_res"; return 1; }
  echo "$ship_res" | grep -q '"eta_days":1' || { echo "ETA Ha Noi sai (mong 1): $ship_res"; return 1; }
  echo "$ship_res" | grep -qE '"tracking_code":"FAKE-TRK-[0-9A-F]{12}"' || { echo "ma van don sai dinh dang: $ship_res"; return 1; }
  ship_id="$(echo "$ship_res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).shipment.id))")"
  ship_replay="$(curl -fsS -b "$cookie" -H 'Idempotency-Key: smoke-ship-1' -H 'Content-Type: application/json' \
    -d '{"carrier":"GHN-fake","destination":"Hà Nội"}' \
    "http://127.0.0.1:$port/api/orders/$gord_id/shipments")" || return 1
  echo "$ship_replay" | grep -q '"replayed":true' || { echo "gui lai giao khong replay: $ship_replay"; return 1; }
  [ "$(sqlite3 "$tmpdir/smoke.db" "SELECT COUNT(*) FROM shipments WHERE order_id=$gord_id;")" = "1" ] || { echo "gui lai van tao them shipment"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"status":"delivered"}' \
    "http://127.0.0.1:$port/api/shipments/$ship_id/status")"
  [ "$code" = "400" ] || { echo "requested -> delivered tra ve HTTP $code, mong 400"; return 1; }
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{"status":"in_transit"}' \
    "http://127.0.0.1:$port/api/shipments/$ship_id/status" | grep -q '"status":"in_transit"' || return 1
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{"status":"in_transit"}' \
    "http://127.0.0.1:$port/api/shipments/$ship_id/status" | grep -q '"status":"in_transit"' || return 1
  ship_events="$(sqlite3 "$tmpdir/smoke.db" "SELECT COUNT(*) FROM shipment_events WHERE shipment_id=$ship_id;")"
  [ "$ship_events" = "2" ] || { echo "gui lap cung trang thai tao event thua, so event $ship_events, mong 2"; return 1; }
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{"status":"delivered"}' \
    "http://127.0.0.1:$port/api/shipments/$ship_id/status" | grep -q '"status":"delivered"' || return 1
  ret_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"items\":[{\"variant_id\":$g1v_id,\"qty\":1,\"condition\":\"resalable\"},{\"variant_id\":$g2v_id,\"qty\":1,\"condition\":\"damaged\"}],\"reason\":\"tra giao smoke\"}" \
    "http://127.0.0.1:$port/api/orders/$gord_id/returns")" || return 1
  echo "$ret_res" | grep -q '"status":"requested"' || { echo "yeu cau tra tra ve: $ret_res"; return 1; }
  echo "$ret_res" | grep -qE '"code":"TH-[0-9]{8}-[0-9]{4}"' || { echo "ma tra sai dinh dang: $ret_res"; return 1; }
  ret_id="$(echo "$ret_res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).return.id))")"
  ret_code="$(echo "$ret_res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).return.code))")"
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/returns/$ret_id/approve" | grep -q '"status":"approved"' || return 1
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/returns/$ret_id/receive" | grep -q '"status":"received"' || return 1
  glvl="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/stock/levels?warehouse_id=$wha_id&variant_id=$g1v_id")" || return 1
  echo "$glvl" | grep -q '"on_hand":49' || { echo "nhan tra khong nhap lai dung so: $glvl"; return 1; }
  glvl="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/stock/levels?warehouse_id=$wha_id&variant_id=$g2v_id")" || return 1
  echo "$glvl" | grep -q '"on_hand":29' || { echo "hang hong lam doi ton: $glvl"; return 1; }
  gmove="$(sqlite3 "$tmpdir/smoke.db" "SELECT COUNT(*) FROM stock_movements WHERE reference='$ret_code';")"
  [ "$gmove" = "1" ] || { echo "so movement nhap lai $gmove, mong 1 (chi dong resalable)"; return 1; }
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/returns/$ret_id/refund" | grep -q '"status":"refunded"' || return 1
  gsum="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/orders/$gord_id/payments")" || return 1
  echo "$gsum" | grep -q '"paid_total":100000' || { echo "doi soat sau tra sai paid_total: $gsum"; return 1; }
  echo "$gsum" | grep -q '"refunded_total":150000' || { echo "doi soat sau tra sai refunded_total: $gsum"; return 1; }
  echo "$gsum" | grep -q '"payment_status":"partially_refunded"' || { echo "doi soat sau tra sai payment_status: $gsum"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$sales2_cookie" -H 'Content-Type: application/json' \
    -d '{"carrier":"GHN-fake","destination":"TP.HCM"}' \
    "http://127.0.0.1:$port/api/orders/$gord_id/shipments")"
  [ "$code" = "403" ] || { echo "sales yeu cau giao tra ve HTTP $code, mong 403"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$wh_cookie" -H 'Content-Type: application/json' \
    -d "{\"items\":[{\"variant_id\":$g1v_id,\"qty\":1,\"condition\":\"resalable\"}],\"reason\":\"kho tra\"}" \
    "http://127.0.0.1:$port/api/orders/$gord_id/returns")"
  [ "$code" = "403" ] || { echo "warehouse yeu cau tra tra ve HTTP $code, mong 403"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$sales2_cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/returns/$ret_id/approve")"
  [ "$code" = "403" ] || { echo "sales duyet tra tra ve HTTP $code, mong 403"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$cookie" -X DELETE \
    "http://127.0.0.1:$port/api/shipments/$ship_id")"
  [ "$code" = "404" ] || { echo "DELETE shipment tra ve HTTP $code, mong 404"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$cookie" -X DELETE \
    "http://127.0.0.1:$port/api/returns/$ret_id")"
  [ "$code" = "404" ] || { echo "DELETE return tra ve HTTP $code, mong 404"; return 1; }
  # Khach hang + CRM (GOAL-008): tao khach -> trung phone 409 -> tao don
  # gan khach -> xac nhan -> xu ly -> hoan tat -> thu tien -> tich diem
  # 250000d -> 25 diem -> tich lai 400 -> doi 10 diem tru 1000d (outstanding
  # 99000, van unpaid) -> doi vuot so du 400 -> ghi chu -> phan khuc new ->
  # frequent -> tim/loc theo ten + phan khuc -> hop nhat khong confirm 400
  # -> hop nhat co confirm (diem/lich su cong don) -> xuat du 4 phan ->
  # audit log khong chua phone -> xoa khach chua co don duoc, khach co don
  # 400 -> idempotency gui lai khong cong diem lan 2 -> RBAC 403.
  local crm_p1 crm_p1v crm_p2 crm_p2v cust_res cust_id cord cord_id earn_res
  local draft draft_id redeem_res pay_sum note_res seg search cust2_res
  local cust2_id cust2_ord merge_res export_res audit_log del_res code2
  local idem_ord idem_ord_id idem1 idem2 cust3_id
  crm_p1="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"code":"SP-CRM-1","name":"San pham CRM 1","price":100000,"unit":"cai"}' \
    "http://127.0.0.1:$port/api/products")" || return 1
  crm_p1="$(echo "$crm_p1" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
  crm_p1v="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"sku":"SKU-CRM-1","name":"Bien the CRM 1"}' \
    "http://127.0.0.1:$port/api/products/$crm_p1/variants" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const b=JSON.parse(s);console.log((b.variant||b).id)})")" || return 1
  crm_p2="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"code":"SP-CRM-2","name":"San pham CRM 2","price":50000,"unit":"cai"}' \
    "http://127.0.0.1:$port/api/products")" || return 1
  crm_p2="$(echo "$crm_p2" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
  crm_p2v="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"sku":"SKU-CRM-2","name":"Bien the CRM 2"}' \
    "http://127.0.0.1:$port/api/products/$crm_p2/variants" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const b=JSON.parse(s);console.log((b.variant||b).id)})")" || return 1
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"variant_id\":$crm_p1v,\"qty\":200,\"reason\":\"nhap CRM\"}" \
    "http://127.0.0.1:$port/api/stock/in" >/dev/null || return 1
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"variant_id\":$crm_p2v,\"qty\":100,\"reason\":\"nhap CRM\"}" \
    "http://127.0.0.1:$port/api/stock/in" >/dev/null || return 1
  cust_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"name":"Nguyen Van A","phone":"0901000001","email":"a@example.local","branch_id":1}' \
    "http://127.0.0.1:$port/api/customers")" || return 1
  echo "$cust_res" | grep -q '"segment":"new"' || { echo "tao khach tra ve: $cust_res"; return 1; }
  echo "$cust_res" | grep -q '"points_balance":0' || { echo "khach moi phai 0 diem: $cust_res"; return 1; }
  cust_id="$(echo "$cust_res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"name":"Trung So","phone":"0901000001"}' \
    "http://127.0.0.1:$port/api/customers")"
  [ "$code" = "409" ] || { echo "trung phone tra ve HTTP $code, mong 409"; return 1; }
  cord="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"channel\":\"counter\",\"customer_id\":$cust_id,\"items\":[{\"variant_id\":$crm_p1v,\"qty\":2},{\"variant_id\":$crm_p2v,\"qty\":1}]}" \
    "http://127.0.0.1:$port/api/orders")" || return 1
  echo "$cord" | grep -q '"total":250000' || { echo "total don CRM sai: $cord"; return 1; }
  cord_id="$(echo "$cord" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/orders/$cord_id/confirm" >/dev/null || return 1
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/orders/$cord_id/process" >/dev/null || return 1
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/orders/$cord_id/complete" | grep -q '"status":"completed"' || return 1
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"method":"cash","amount":250000}' \
    "http://127.0.0.1:$port/api/orders/$cord_id/payments" | grep -q '"status":"paid"' || return 1
  earn_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"order_id\":$cord_id}" \
    "http://127.0.0.1:$port/api/customers/$cust_id/points/earn")" || return 1
  echo "$earn_res" | grep -q '"points_earned":25' || { echo "tich diem sai (mong 25): $earn_res"; return 1; }
  echo "$earn_res" | grep -q '"points_balance":25' || { echo "so du sau tich sai: $earn_res"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"order_id\":$cord_id}" \
    "http://127.0.0.1:$port/api/customers/$cust_id/points/earn")"
  [ "$code" = "400" ] || { echo "tich lai cung don tra ve HTTP $code, mong 400"; return 1; }
  # Them 2 don completed (moi don 200000) -> 3 don -> segment frequent.
  local i extra_id
  for i in 1 2; do
    extra_id="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
      -d "{\"warehouse_id\":$wha_id,\"channel\":\"counter\",\"customer_id\":$cust_id,\"items\":[{\"variant_id\":$crm_p1v,\"qty\":2}]}" \
      "http://127.0.0.1:$port/api/orders" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")" || return 1
    curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
      "http://127.0.0.1:$port/api/orders/$extra_id/confirm" >/dev/null || return 1
    curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
      "http://127.0.0.1:$port/api/orders/$extra_id/process" >/dev/null || return 1
    curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
      "http://127.0.0.1:$port/api/orders/$extra_id/complete" | grep -q '"status":"completed"' || return 1
  done
  seg="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/customers/$cust_id")" || return 1
  echo "$seg" | grep -q '"segment":"frequent"' || { echo "phan khuc sai (mong frequent): $seg"; return 1; }
  echo "$seg" | grep -q '"total_spent":650000' || { echo "tong chi sai (mong 650000): $seg"; return 1; }
  # Doi diem: don draft 100000, doi 10 diem -> tru 1000d, outstanding 99000, van unpaid.
  draft="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"channel\":\"counter\",\"customer_id\":$cust_id,\"items\":[{\"variant_id\":$crm_p1v,\"qty\":1}]}" \
    "http://127.0.0.1:$port/api/orders")" || return 1
  draft_id="$(echo "$draft" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
  redeem_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"order_id\":$draft_id,\"points\":10}" \
    "http://127.0.0.1:$port/api/customers/$cust_id/points/redeem")" || return 1
  echo "$redeem_res" | grep -q '"discount":1000' || { echo "doi diem sai discount: $redeem_res"; return 1; }
  echo "$redeem_res" | grep -q '"points_balance":15' || { echo "so du sau doi sai: $redeem_res"; return 1; }
  pay_sum="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/orders/$draft_id/payments")" || return 1
  echo "$pay_sum" | grep -q '"outstanding":99000' || { echo "outstanding sau doi sai: $pay_sum"; return 1; }
  echo "$pay_sum" | grep -q '"payment_status":"unpaid"' || { echo "payment_status sau doi sai: $pay_sum"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"order_id\":$draft_id,\"points\":100}" \
    "http://127.0.0.1:$port/api/customers/$cust_id/points/redeem")"
  [ "$code" = "400" ] || { echo "doi vuot so du tra ve HTTP $code, mong 400"; return 1; }
  note_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"content":"Goi cham soc CRM"}' \
    "http://127.0.0.1:$port/api/customers/$cust_id/notes")" || return 1
  echo "$note_res" | grep -q '"content":"Goi cham soc CRM"' || { echo "ghi chu tra ve: $note_res"; return 1; }
  search="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/customers?name=nguyen&segment=frequent")" || return 1
  echo "$search" | grep -q "\"id\":$cust_id" || { echo "tim/loc khong thay khach: $search"; return 1; }
  echo "$search" | grep -q '"total":1' || { echo "tong tim/loc sai: $search"; return 1; }
  # Hop nhat: khach nguon + 1 don completed 100000 -> tich 10 diem.
  cust2_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"name":"Khach Nguon","phone":"0901000002"}' \
    "http://127.0.0.1:$port/api/customers")" || return 1
  cust2_id="$(echo "$cust2_res" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
  cust2_ord="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"channel\":\"counter\",\"customer_id\":$cust2_id,\"items\":[{\"variant_id\":$crm_p1v,\"qty\":1}]}" \
    "http://127.0.0.1:$port/api/orders" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")" || return 1
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/orders/$cust2_ord/confirm" >/dev/null || return 1
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/orders/$cust2_ord/process" >/dev/null || return 1
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/orders/$cust2_ord/complete" >/dev/null || return 1
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"order_id\":$cust2_ord}" \
    "http://127.0.0.1:$port/api/customers/$cust2_id/points/earn" | grep -q '"points_earned":10' || return 1
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"source_customer_id\":$cust2_id}" \
    "http://127.0.0.1:$port/api/customers/$cust_id/merge")"
  [ "$code" = "400" ] || { echo "hop nhat thieu confirm tra ve HTTP $code, mong 400"; return 1; }
  merge_res="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"source_customer_id\":$cust2_id,\"confirm\":true}" \
    "http://127.0.0.1:$port/api/customers/$cust_id/merge")" || return 1
  echo "$merge_res" | grep -q '"points_balance":25' || { echo "diem sau hop nhat sai (mong 25): $merge_res"; return 1; }
  echo "$merge_res" | grep -q '"total_spent":750000' || { echo "tong chi sau hop nhat sai (mong 750000): $merge_res"; return 1; }
  echo "$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/customers/$cust2_id")" | grep -q '"status":"merged"' || { echo "khach nguon khong chuyen merged"; return 1; }
  echo "$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/customers/$cust2_id")" | grep -q '"phone":null' || { echo "khach nguon phone khong ve NULL"; return 1; }
  export_res="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/customers/$cust_id/export")" || return 1
  echo "$export_res" | grep -q '"orders"' || { echo "export thieu orders: $export_res"; return 1; }
  echo "$export_res" | grep -q '"points"' || { echo "export thieu points"; return 1; }
  echo "$export_res" | grep -q '"notes"' || { echo "export thieu notes"; return 1; }
  echo "$export_res" | grep -q '"balance":25' || { echo "export sai so du diem: $export_res"; return 1; }
  audit_log="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/audit-log")" || return 1
  echo "$audit_log" | grep -q '0901000001' && { echo "audit log chua phone khach!"; return 1; }
  echo "$audit_log" | grep -q '"action":"earn-points"' || { echo "audit log thieu earn-points"; return 1; }
  echo "$audit_log" | grep -q '"action":"merge-customers"' || { echo "audit log thieu merge-customers"; return 1; }
  # Xoa: khach chua co don duoc, khach co don 400.
  cust3_id="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"name":"Khach Xoa","phone":"0901000003"}' \
    "http://127.0.0.1:$port/api/customers" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")" || return 1
  del_res="$(curl -fsS -b "$cookie" -X DELETE "http://127.0.0.1:$port/api/customers/$cust3_id")" || return 1
  echo "$del_res" | grep -q '"ok":true' || { echo "xoa khach chua co don tra ve: $del_res"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$cookie" "http://127.0.0.1:$port/api/customers/$cust3_id")"
  [ "$code" = "404" ] || { echo "GET khach da xoa tra ve HTTP $code, mong 404"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$cookie" -X DELETE "http://127.0.0.1:$port/api/customers/$cust_id")"
  [ "$code" = "400" ] || { echo "xoa khach co don tra ve HTTP $code, mong 400"; return 1; }
  # Idempotency tich diem: don completed moi 200000 -> 20 diem, gui lai replayed.
  idem_ord="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d "{\"warehouse_id\":$wha_id,\"channel\":\"counter\",\"customer_id\":$cust_id,\"items\":[{\"variant_id\":$crm_p1v,\"qty\":2}]}" \
    "http://127.0.0.1:$port/api/orders")" || return 1
  idem_ord_id="$(echo "$idem_ord" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")"
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/orders/$idem_ord_id/confirm" >/dev/null || return 1
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/orders/$idem_ord_id/process" >/dev/null || return 1
  curl -fsS -b "$cookie" -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$port/api/orders/$idem_ord_id/complete" >/dev/null || return 1
  idem1="$(curl -fsS -b "$cookie" -H 'Idempotency-Key: smoke-crm-earn-1' -H 'Content-Type: application/json' \
    -d "{\"order_id\":$idem_ord_id}" \
    "http://127.0.0.1:$port/api/customers/$cust_id/points/earn")" || return 1
  echo "$idem1" | grep -q '"points_earned":20' || { echo "tich idem lan 1 sai: $idem1"; return 1; }
  idem2="$(curl -fsS -b "$cookie" -H 'Idempotency-Key: smoke-crm-earn-1' -H 'Content-Type: application/json' \
    -d "{\"order_id\":$idem_ord_id}" \
    "http://127.0.0.1:$port/api/customers/$cust_id/points/earn")" || return 1
  echo "$idem2" | grep -q '"replayed":true' || { echo "gui lai tich diem khong replay: $idem2"; return 1; }
  seg="$(curl -fsS -b "$cookie" "http://127.0.0.1:$port/api/customers/$cust_id")" || return 1
  echo "$seg" | grep -q '"points_balance":45' || { echo "so du sau gui lai sai (mong 45): $seg"; return 1; }
  # RBAC CRM: warehouse tao khach 403, sales hop nhat 403, sales xoa 403,
  # sales xem khach chua gan chi nhanh 403.
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$wh_cookie" -H 'Content-Type: application/json' \
    -d '{"name":"Kho tao khach"}' "http://127.0.0.1:$port/api/customers")"
  [ "$code" = "403" ] || { echo "warehouse tao khach tra ve HTTP $code, mong 403"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$sales2_cookie" -H 'Content-Type: application/json' \
    -d "{\"source_customer_id\":$cust2_id,\"confirm\":true}" \
    "http://127.0.0.1:$port/api/customers/$cust_id/merge")"
  [ "$code" = "403" ] || { echo "sales hop nhat tra ve HTTP $code, mong 403"; return 1; }
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$sales2_cookie" -X DELETE \
    "http://127.0.0.1:$port/api/customers/$cust_id")"
  [ "$code" = "403" ] || { echo "sales xoa khach tra ve HTTP $code, mong 403"; return 1; }
  code2="$(curl -fsS -b "$cookie" -H 'Content-Type: application/json' \
    -d '{"name":"Khach Chua Gan","phone":"0901000004"}' \
    "http://127.0.0.1:$port/api/customers" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")" || return 1
  code="$(curl -s -o /dev/null -w '%{http_code}' -b "$sales2_cookie" "http://127.0.0.1:$port/api/customers/$code2")"
  [ "$code" = "403" ] || { echo "sales xem khach chua gan tra ve HTTP $code, mong 403"; return 1; }
  kill "$server_pid" 2>/dev/null
  wait "$server_pid" 2>/dev/null || true
  trap - RETURN
  rm -rf "$tmpdir"
  echo "smoke server tren port $port: health + login + owner-only + staff 403 + RBAC moi/khoa/audit/403 + san-pham/gia/CSV (tao san pham, bien the, trung SKU 409, gia rieng + fallback, lich su gia, preview/import/export CSV, RBAC 403) + kho (tao kho, nhap, xuat, xuat qua ton 400, giu, giai phong, chuyen kho, kiem ke, ton thap, idempotency, race 5/5, RBAC 403, ngoai org 403) + don (tao don snapshot gia, xac nhan giu, xu ly, hoan tat xuat kho, huy khi dang xu ly giai phong, chuyen sai 400, idempotency, race 5/5, RBAC 403, ngoai org 403) + thanh toan (thu tien mat, thu qua cong + webhook paid chot + webhook lap duplicate, webhook sai chu ky 401, hoan mot phan + doi soat dung so, idempotency, RBAC 403, DELETE 404) + giao/tra (don nhap khong giao 400, yeu cau giao phi 30000/ETA 1 + ma van don + idempotency, sai thu tu 400, lap cung trang thai khong tao event, delivered, tra 1 ban lai duoc + 1 hong -> duyet -> nhan dung so ton, hoan tien + doi soat partially_refunded, RBAC 403, DELETE 404)"
}
step "smoke server" smoke

if [ "$FAIL" -ne 0 ]; then echo "CHECK: FAIL"; exit 1; fi
echo "CHECK: PASS"
