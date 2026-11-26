# GOAL-005 v1: solo-direct

Mot package WP-MAIN duy nhat xay toan bo don hang da kenh trong mot lan: migration 010 tao orders/order_items/order_events (UNIQUE org/code DH-YYYYMMDD-NNNN, UNIQUE don/bien the, CHECK state machine + qty/total); module moi src/orders.ts (state machine canTransition, dinh dang ma don, service tao/chuyen trang thai dung applyMovement + withStockIdempotency); tach ham resolve gia dung chung tu route GET /api/products/:id/price de don snapshot dung effectivePrice() theo kenh + chi nhanh; routes POST /api/orders, GET /api/orders + /:id, POST /api/orders/:id/confirm|process|complete|cancel (xac nhan giu nguyen tu moi dong, huy giai phong dung so, hoan tat release + out trong CUNG MOT transaction, KHONG them loai movement moi); mo rong src/rbac.ts them 6 actions don theo ma tran (Target dung branchId + warehouseId da co); audit log moi thao tac don voi action create-order/confirm-order/process-order/complete-order/cancel-order va detail target_order_id/order_code/from_status/to_status/total; docs/RBAC.md + D19/D20; mo rong check.sh/demo.sh them buoc don, giu cac buoc GOAL-001..004 xanh.

```json
{
  "id": "GOAL-005",
  "version": 1,
  "goalId": "GOAL-005",
  "goalVersion": 1,
  "mode": "solo-direct",
  "approach": "Mot package WP-MAIN duy nhat xay toan bo don hang da kenh trong mot lan: migration 010 tao orders/order_items/order_events (UNIQUE org/code DH-YYYYMMDD-NNNN, UNIQUE don/bien the, CHECK state machine + qty/total); module moi src/orders.ts (state machine canTransition, dinh dang ma don, service tao/chuyen trang thai dung applyMovement + withStockIdempotency); tach ham resolve gia dung chung tu route GET /api/products/:id/price de don snapshot dung effectivePrice() theo kenh + chi nhanh; routes POST /api/orders, GET /api/orders + /:id, POST /api/orders/:id/confirm|process|complete|cancel (xac nhan giu nguyen tu moi dong, huy giai phong dung so, hoan tat release + out trong CUNG MOT transaction, KHONG them loai movement moi); mo rong src/rbac.ts them 6 actions don theo ma tran (Target dung branchId + warehouseId da co); audit log moi thao tac don voi action create-order/confirm-order/process-order/complete-order/cancel-order va detail target_order_id/order_code/from_status/to_status/total; docs/RBAC.md + D19/D20; mo rong check.sh/demo.sh them buoc don, giu cac buoc GOAL-001..004 xanh.",
  "risks": [
    "Hoan tat don sai so hoc la rui ro lon nhat: applyMovement 'out' yeu cau qty <= available va KHONG tru reserved (D17) — hoan tat bang 1 movement out duy nhat se de reserved treo mai; bat buoc release + out trong cung transaction BEGIN IMMEDIATE, test hoan tat kiem tra ca reserved ve 0 VA on_hand tru dung VA available cuoi.",
    "Xac nhan nua voi: giu tung dong rieng le khong boc chung transaction se de lai don giu duoc mot nua khi dong sau thieu ton — bat buoc giu moi dong trong CUNG MOT transaction, dong nao thieu thi rollback toan bo, test thieu ton kiem tra reserved khong doi o CA hai dong.",
    "Idempotency ngoai transaction: withIdempotency cua GOAL-001 kiem tra key ngoai transaction — dung cho don se de lot thuc thi trung khi hai yeu cau cung key chay dong thoi; bat buoc dung withStockIdempotency voi ten mien order:create:<key> / order:<hanh dong>:<key>, test idempotency dong thoi cung key chung minh chi 1 lan thuc thi.",
    "Ma don trung khi dong thoi: so thu tu NNNN phai tinh trong cung transaction tao don (dem don trong ngay cua org roi +1, trong BEGIN IMMEDIATE), khong tinh ngoai transaction roi moi insert.",
    "Gia snapshot sai kenh/chi nhanh: gia hieu dung phu thuoc ca kenh lan chi nhanh cua don — tao don kenh web chi nhanh A phai snapshot dung gia web cua A; test co case gia rieng theo kenh (seed da co gia web 160000 cho SP-SEED-01) va doi gia sau khi dat don khong doi gia don.",
    "Test race dong thoi tren mot process Node + SQLite dong bo chi chung minh bat bien (tong giu <= available, ton khong am), khong chung minh chong race da process — ghi ro trong DECISIONS.md D19, khong claim qua.",
    "125 test GOAL-001..004 da khoa — khong sua; brief-005.md + goal-005.json DA commit rieng tren main (2c8fa20) — KHONG dua 2 file nay vao commit package (gate do APOS-SCOPE, bai hoc GOAL-004); check.sh/demo.sh phai tu npm ci (go symlink node_modules truoc, D12) trong worktree gate sach.",
    "Khong can dependency moi nen khong co exception needs-human cho package.json nhu GOAL-003."
  ],
  "baseCommit": "773ab2f67073f0deb5c56a5e03cf5cbf42a7dd16",
  "sourceSha256": "ccff49ea7ca44745b64f787300f1b7bdd497ccc77471225c20dc352a1251f098",
  "rationale": "Goal lien mach mot mien don hang: migration + service don/state machine + endpoints don + ma tran quyen don chia se cung DB/app va cung audit log; tach WP se chi them chi phi tich hop va rui ro criterion thuoc 2 package, trong khi Solo da chung minh hieu qua o GOAL-001/002/003/004 (dac biet GOAL-004 Solo 4 AC, 36 test).",
  "sharedPaths": [],
  "paths": [
    "src/**",
    "tests/**",
    "scripts/**",
    "views/**",
    "public/**",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vitest.config.*",
    "README.md",
    "docs/**",
    ".gitignore"
  ],
  "stubPaths": [
    "src/orders.ts",
    "src/app.ts",
    "src/auth.ts",
    "src/db.ts",
    "src/rbac.ts",
    "src/seed.ts",
    "src/tenant.ts",
    "src/idempotency.ts",
    "src/products.ts",
    "src/stock.ts"
  ],
  "entries": [
    "POST /api/orders",
    "GET /api/orders",
    "GET /api/orders/:id",
    "POST /api/orders/:id/confirm",
    "POST /api/orders/:id/process",
    "POST /api/orders/:id/complete",
    "POST /api/orders/:id/cancel",
    "src/rbac.ts: can()",
    "src/orders.ts: canTransition(), formatOrderCode()"
  ],
  "acceptanceMapping": [
    {
      "acceptanceId": "AC-1",
      "verification": "WP-MAIN: migration 010 tao orders (org/branch/warehouse bat buoc, code DH-YYYYMMDD-NNNN UNIQUE trong org, channel counter/web/api, status state machine, total nguyen dong), order_items (snapshot sku/name/unit_price/price_source, qty > 0, line_total = unit_price * qty, UNIQUE don/bien the), order_events append-only (from_status NULL khi tao don); API tao don 201 kem items da snapshot + total do server tinh, o draft, KHONG giu hang; API doc don + tim kiem/loc/phan trang (status/channel/code/customer_name/branch_id/warehouse_id, limit mac dinh 20 toi da 100, offset 0, kem tong so); khong co endpoint DELETE don; events tra theo thu tu thoi gian tang dan (cu nhat truoc)"
    },
    {
      "acceptanceId": "AC-2",
      "verification": "WP-MAIN: state machine draft -> confirmed -> processing -> completed / cancelled (chuyen sai -> 400, khong ghi event, khong dong kho); xac nhan giu hang nguyen tu moi dong trong 1 transaction (dong nao thieu ton -> 400 insufficient_stock, khong giu dong nao); huy tu draft chi doi trang thai, huy tu confirmed/processing giai phong dung so da giu (ca khi dang processing); hoan tat tu processing = release + out trong CUNG MOT transaction, KHONG them loai movement moi (reserved ve 0, on_hand tru dung); moi lan tao/chuyen ghi 1 order_event + 1 audit log; huy don co note thi event luu note"
    },
    {
      "acceptanceId": "AC-3",
      "verification": "WP-MAIN: idempotency key (header Idempotency-Key hoac body idempotency_key) cho tao don + moi chuyen trang thai qua withStockIdempotency voi ten mien order:create:<key> / order:<hanh dong>:<key> (gui lai -> replayed: true, tra dung response da luu ngay ca khi don da chuyen tiep, KHONG tao don moi, KHONG doi trang thai, KHONG dong kho); moi giu/xuat qua applyMovement trong BEGIN IMMEDIATE + CHECK o DB; test dong thoi chung minh tong giu <= available, ton khong am, reserved khong vuot on_hand; xac nhan cung don 2 lan dong thoi (khac key) chi 1 lan thanh cong"
    },
    {
      "acceptanceId": "AC-4",
      "verification": "WP-MAIN: can() mo rong 6 actions don (create-order, confirm-order, process-order, complete-order, cancel-order, view-orders) theo ma tran (vai sai -> 403, ngoai org -> 403, sai chi nhanh/kho -> 403); test 403 qua HTTP cho tung o cam (warehouse tao don, accountant xac nhan, sales xu ly, sales xac nhan don ngoai chi nhanh, warehouse hoan tat don kho ngoai pham vi, org A doc don org B); audit_log moi thao tac don (action create-order/confirm-order/process-order/complete-order/cancel-order, detail target_order_id/order_code/from_status/to_status/total), xem qua GET /api/audit-log theo luat GOAL-002; check.sh/demo.sh mo rong buoc don va giu cac buoc GOAL-001..004 xanh; docs RBAC/D19/D20; du lieu gia lap, khong CI/VPS"
    }
  ],
  "verificationStrategy": "Tester viet tests/orders-acceptance.test.ts (L2) goi entries da khai + stub src/orders.ts (canTransition, formatOrderCode) va stub routes 501 trong src/app.ts, tests submit khoa; Worker viet code tren commit da khoa test, chay ./scripts/check.sh va ./scripts/demo.sh local tu dau sach truoc khi submit; gate APOS (L0 tsc, L1 vitest, L2 acceptance) quyet dinh."
}
```
