# GOAL-004 v1: solo-direct

Một package WP-MAIN duy nhất xây toàn bộ kho đa kho trong một lần: migration 009 tạo warehouses/stock_levels/stock_movements (UNIQUE org-scoped, CHECK on_hand/reserved >= 0 và reserved <= on_hand); module mới src/stock.ts (số học tồn, helper giao dịch BEGIN IMMEDIATE + idempotency trong transaction); mở rộng src/rbac.ts thêm 11 actions kho + Target.warehouseId; routes /api/warehouses và /api/stock/* (in/out/adjust/count/transfer/reserve/release/levels/movements/low-stock); chuyển kho nguyên tử 1 transaction (2 movement); ngưỡng tồn thấp = products.min_stock; audit log mọi thao tác kho; seed mở rộng 2 kho + mức tồn mẫu (giữ 2 user, ít nhất 1 cặp tồn thấp); docs/RBAC.md + D17/D18; mở rộng check.sh/demo.sh thêm bước kho, giữ các bước GOAL-001/002/003 xanh.

```json
{
  "id": "GOAL-004",
  "version": 1,
  "goalId": "GOAL-004",
  "goalVersion": 1,
  "mode": "solo-direct",
  "approach": "Một package WP-MAIN duy nhất xây toàn bộ kho đa kho trong một lần: migration 009 tạo warehouses/stock_levels/stock_movements (UNIQUE org-scoped, CHECK on_hand/reserved >= 0 và reserved <= on_hand); module mới src/stock.ts (số học tồn, helper giao dịch BEGIN IMMEDIATE + idempotency trong transaction); mở rộng src/rbac.ts thêm 11 actions kho + Target.warehouseId; routes /api/warehouses và /api/stock/* (in/out/adjust/count/transfer/reserve/release/levels/movements/low-stock); chuyển kho nguyên tử 1 transaction (2 movement); ngưỡng tồn thấp = products.min_stock; audit log mọi thao tác kho; seed mở rộng 2 kho + mức tồn mẫu (giữ 2 user, ít nhất 1 cặp tồn thấp); docs/RBAC.md + D17/D18; mở rộng check.sh/demo.sh thêm bước kho, giữ các bước GOAL-001/002/003 xanh.",
  "risks": [
    "withIdempotency hiện tại kiểm tra key ngoài transaction — dùng ngây thơ cho kho sẽ để lọt thực thi trùng khi hai yêu cầu cùng key chạy đồng thời; viết helper giao dịch riêng cho kho (kiểm tra key + thực thi + ghi key trong 1 BEGIN IMMEDIATE), test idempotency đồng thời chứng minh chỉ 1 lần thực thi.",
    "UNIQUE + NULL trên SQLite: stock_levels không có NULL trong UNIQUE nên chặn trùng tốt, nhưng nếu thêm cột NULL vào UNIQUE sau này thì nhớ bài học D15 — kiểm tra trùng ở tầng service trong transaction.",
    "Test race đồng thời trên một process Node + SQLite đồng bộ chỉ chứng minh bất biến (tổng xuất <= available, tồn không âm), không chứng minh chống race đa process — ghi rõ trong DECISIONS.md D17, không claim quá.",
    "users.warehouse_id là trường chuẩn bị từ GOAL-002 (D13) — lần đầu có ý nghĩa thật; dễ quên kiểm tra ở một endpoint (nhất là transfer có HAI kho và low-stock/movements có lọc theo kho); test RBAC phải có case warehouse chỉ xem/thao tác đúng kho được gán ở mọi endpoint kho.",
    "reserved kẹt: giữ hàng rồi không giải phóng sẽ làm available thấp mãi — hành vi đúng trong goal này (GOAL-005 mới có luồng giải phóng khi hủy đơn); ghi rõ trong docs để không ai sửa thành tự giải phóng.",
    "83 test GOAL-001/002/003 đã khóa — không sửa; seed phải giữ 2 user và email staff@example.local; check.sh/demo.sh phải tự npm ci (gỡ symlink node_modules trước, D12) trong worktree gate sạch.",
    "Không cần dependency mới (không CSV, không multipart) nên không có exception needs-human cho package.json như GOAL-003."
  ],
  "baseCommit": "59cf9a4ac6310078254899b46cd9addf7b59bfa2",
  "sourceSha256": "a83e40111118d17ac74d1e1049134daca6958f7e46aa5126a7cf8b22f3884579",
  "rationale": "Goal liền mạch một miền kho: migration + helper giao dịch/idempotency + endpoints tồn + ma trận quyền kho chia sẻ cùng DB/app và cùng audit log; tách WP sẽ chỉ thêm chi phí tích hợp và rủi ro criterion thuộc 2 package, trong khi Solo đã chứng minh hiệu quả ở GOAL-001/002/003 (đặc biệt GOAL-003 M solo 4 AC, 45 test).",
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
    "src/stock.ts",
    "src/app.ts",
    "src/auth.ts",
    "src/db.ts",
    "src/rbac.ts",
    "src/seed.ts",
    "src/tenant.ts",
    "src/idempotency.ts"
  ],
  "entries": [
    "POST /api/warehouses",
    "GET /api/warehouses",
    "GET /api/warehouses/:id",
    "PATCH /api/warehouses/:id",
    "POST /api/stock/in",
    "POST /api/stock/out",
    "POST /api/stock/adjust",
    "POST /api/stock/count",
    "POST /api/stock/transfer",
    "POST /api/stock/reserve",
    "POST /api/stock/release",
    "GET /api/stock/levels",
    "GET /api/stock/movements",
    "GET /api/stock/low-stock",
    "src/rbac.ts: can()",
    "src/stock.ts: stockLevel(), applyMovement(), withStockIdempotency()"
  ],
  "acceptanceMapping": [
    {
      "acceptanceId": "AC-1",
      "verification": "WP-MAIN: migration 009 tao warehouses (org_id, ten bat buoc, branch_id optional chi hien thi, status active/inactive), stock_levels (ton theo bien the, UNIQUE org/warehouse/variant, CHECK reserved <= on_hand, available tinh duoc), stock_movements append-only (type in/out/adjust/count/transfer_in/transfer_out/reserve/release, qty_change + reserved_change, on_hand_after/reserved_after, reason bat buoc, reference, actor); CRUD kho (chi owner tao/sua, khong DELETE kho), kho inactive chan thao tac ton moi, nhap kho san pham chua co bien the -> 400"
    },
    {
      "acceptanceId": "AC-2",
      "verification": "WP-MAIN: POST /api/stock/in/out (qty nguyen > 0, reason bat buoc, xuat <= available neu khong -> 400 insufficient_stock, khong ghi movement), adjust theo delta, count dat tuyet doi, transfer nguyen tu 1 transaction (2 movement transfer_out/transfer_in, nguon khong du -> dich khong doi), reserve/release chi doi reserved (xuat khong tru reserved), GET levels/movements/low-stock kem co low_stock"
    },
    {
      "acceptanceId": "AC-3",
      "verification": "WP-MAIN: idempotency key cho moi thao tac ton (ten mien stock:<loai>:<key>, gui lai -> replayed: true, ton + movement khong doi, kiem tra + thuc thi + ghi key trong 1 transaction BEGIN IMMEDIATE), moi bien dong trong BEGIN IMMEDIATE + CHECK o DB, test dong thoi chung minh tong xuat <= available va ton khong am, ton thap theo products.min_stock theo cap (bien the, kho)"
    },
    {
      "acceptanceId": "AC-4",
      "verification": "WP-MAIN: can() mo rong 11 actions kho theo ma tran (Target them warehouseId), test 403 qua HTTP (sales nhap kho, accountant xuat kho, warehouse nhap kho ngoai kho duoc gan, manager tao kho, sales xem movements, org A tren org B, chuyen kho 1 trong 2 kho ngoai pham vi), kiem tra users.warehouse_id ton tai khi gan qua PATCH scope, audit log moi thao tac kho, check.sh/demo.sh mo rong buoc kho va giu cac buoc GOAL-001/002/003 xanh, docs RBAC/D17/D18"
    }
  ],
  "verificationStrategy": "Tester viết tests/stock-acceptance.test.ts (L2) gọi entries đã khai + stub src/stock.ts, tests submit khóa; Worker viết code trên commit đã khóa test, chạy ./scripts/check.sh và ./scripts/demo.sh local từ đầu sạch trước khi submit; gate APOS (L0 tsc, L1 vitest, L2 acceptance) quyết định."
}
```
