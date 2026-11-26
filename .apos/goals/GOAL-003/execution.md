# GOAL-003 v1: solo-direct

Một package WP-MAIN duy nhất xây toàn bộ sản phẩm/giá/CSV trong một lần: migration 008 tạo products/product_variants/categories/product_attributes/product_images/product_prices/price_history (UNIQUE org-scoped, CHECK giá nguyên đồng >= 0); mở rộng src/rbac.ts thêm 8 actions theo ma trận brief; routes /api/products, /api/categories, CSV preview/import/export (multipart, csv-parse/csv-stringify, atomic transaction, giới hạn 1000 dòng); fallback giá 8 bước + docs/PRICING.md kèm trường source; giá trùng -> 400; lịch sử giá append-only; audit log mọi thao tác; seed mở rộng giữ 2 user; docs/RBAC.md + D15/D16; mở rộng check.sh/demo.sh thêm bước sản phẩm/giá/CSV, giữ các bước GOAL-001/GOAL-002 xanh.

```json
{
  "id": "GOAL-003",
  "version": 1,
  "goalId": "GOAL-003",
  "goalVersion": 1,
  "mode": "solo-direct",
  "approach": "Một package WP-MAIN duy nhất xây toàn bộ sản phẩm/giá/CSV trong một lần: migration 008 tạo products/product_variants/categories/product_attributes/product_images/product_prices/price_history (UNIQUE org-scoped, CHECK giá nguyên đồng >= 0); mở rộng src/rbac.ts thêm 8 actions theo ma trận brief; routes /api/products, /api/categories, CSV preview/import/export (multipart, csv-parse/csv-stringify, atomic transaction, giới hạn 1000 dòng); fallback giá 8 bước + docs/PRICING.md kèm trường source; giá trùng -> 400; lịch sử giá append-only; audit log mọi thao tác; seed mở rộng giữ 2 user; docs/RBAC.md + D15/D16; mở rộng check.sh/demo.sh thêm bước sản phẩm/giá/CSV, giữ các bước GOAL-001/GOAL-002 xanh.",
  "risks": [
    "UNIQUE + NULL trên SQLite không chặn trùng product_prices (variant_id/branch_id NULL) — kiểm tra trùng ở tầng service trong cùng transaction, test trùng giá riêng chứng minh không tạo được 2 dòng cùng tổ hợp.",
    "CSV parsing: dấu phẩy trong tên, dòng trống, BOM UTF-8 — dùng thư viện csv-parse/csv-stringify (thêm dependency qua npm install, commit cả package.json + package-lock.json; package.json là needsHuman nên submit có thể ra exit 3, xử lý bằng exception approve --kind needs-human rồi submit lại cùng commit).",
    "Kênh cho phép chốt counter/web/api (ghi vào PRICING.md); kênh lạ -> 400. Đổi giá trùng giá hiện tại -> 400 (theo yêu cầu R-7).",
    "Gate chạy mỗi check trong worktree mới sạch: check.sh/demo.sh phải tự npm ci (gỡ symlink node_modules trước, D12), build, start/stop server port riêng.",
    "38 test GOAL-001/GOAL-002 đã khóa — không sửa; seed phải giữ 2 user và email staff@example.local.",
    "Một criterion cần test chỉ thuộc đúng một package (Solo nên WP-MAIN giữ cả 4 AC, không tách)."
  ],
  "baseCommit": "98b2d3e29ff9fa91b337a1cc17fcd3c31b394450",
  "sourceSha256": "10fec14e3d59239f7649fdf2b46cc84f894042c46d11e7b3fa07ba65a91a357d",
  "rationale": "Goal liền mạch một miền sản phẩm/giá/CSV: migration + helper can() + endpoints + CSV + audit log + docs chia sẻ cùng DB/app và cùng ma trận quyền; tách WP sẽ chỉ thêm chi phí tích hợp và rủi ro criterion thuộc 2 package, trong khi Solo đã chứng minh hiệu quả ở GOAL-001/GOAL-002.",
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
    "src/products.ts"
  ],
  "entries": [
    "POST /api/products",
    "GET /api/products",
    "GET /api/products/:id",
    "PATCH /api/products/:id",
    "PATCH /api/products/:id/status",
    "POST /api/products/:id/variants",
    "GET /api/products/:id/variants",
    "PATCH /api/products/:id/variants/:variantId",
    "POST /api/categories",
    "GET /api/categories",
    "PATCH /api/categories/:id",
    "POST /api/products/:id/attributes",
    "DELETE /api/products/:id/attributes/:attrId",
    "POST /api/products/:id/images",
    "DELETE /api/products/:id/images/:imageId",
    "POST /api/products/:id/prices",
    "GET /api/products/:id/prices",
    "GET /api/products/:id/price",
    "GET /api/products/:id/price-history",
    "POST /api/products/import/preview",
    "POST /api/products/import",
    "GET /api/products/export",
    "src/rbac.ts: can()",
    "src/products.ts: effectivePrice(), parseProductCsv()"
  ],
  "acceptanceMapping": [
    {
      "acceptanceId": "AC-1",
      "verification": "WP-MAIN: migration 008 tạo products/product_variants/categories/product_attributes/product_images với UNIQUE org-scoped (code/SKU/barcode), CRUD sản phẩm/biến thể/danh mục/thuộc tính/ảnh, ngừng kinh doanh giữ row + lịch sử, không DELETE sản phẩm/biến thể, không upload file thật"
    },
    {
      "acceptanceId": "AC-2",
      "verification": "WP-MAIN: product_prices + fallback 8 bước kèm source (docs/PRICING.md), đổi giá bắt buộc reason + trùng giá -> 400, price_history append-only (không API sửa/xóa), kênh lạ -> 400"
    },
    {
      "acceptanceId": "AC-3",
      "verification": "WP-MAIN: CSV preview dry-run báo lỗi từng dòng (số dòng + lý do, trùng mã trong file báo cả hai dòng), import atomic 422 khi 1 dòng lỗi (0 dòng ghi), import sạch 201 {imported: n}, export đúng org + round-trip preview báo trùng mã DB"
    },
    {
      "acceptanceId": "AC-4",
      "verification": "WP-MAIN: can() mở rộng 8 actions theo ma trận, test 403 qua HTTP (sales đổi giá, warehouse tạo sản phẩm, sales ngừng kinh doanh, warehouse xem lịch sử giá, sales import CSV, org A trên org B, sai chi nhánh giá riêng), audit log đầy đủ, check.sh/demo.sh mở rộng bước sản phẩm/giá/CSV và giữ các bước GOAL-001/GOAL-002 xanh, docs RBAC/PRICING/D15/D16"
    }
  ],
  "verificationStrategy": "Tester viết tests/products-acceptance.test.ts (L2) gọi entries đã khai + stub src/products.ts, tests submit khóa; Worker viết code trên commit đã khóa test, chạy ./scripts/check.sh và ./scripts/demo.sh local từ đầu sạch trước khi submit; gate APOS (L0 tsc, L1 vitest, L2 acceptance) quyết định."
}
```
