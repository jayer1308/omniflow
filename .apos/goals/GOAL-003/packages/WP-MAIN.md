# WP-MAIN v1: OmniFlow san pham/gia/CSV: san pham + bien the (SKU duy nhat trong org, barcode duy nhat neu co) + danh muc/thuoc tinh/anh metadata; gia chuan + gia rieng theo kenh/chi nhanh voi fallback 8 buoc + lich su gia append-only; CSV preview bao loi tung dong + import atomic toan bo hoac khong + export dung du lieu org; RBAC san pham/gia/CSV theo ma tran + audit log; check/demo mo rong buoc san pham/gia/CSV van xanh

```json
{
  "id": "WP-MAIN",
  "goalId": "GOAL-003",
  "goalVersion": 1,
  "version": 1,
  "owner": "lead",
  "outcome": "OmniFlow san pham/gia/CSV: san pham + bien the (SKU duy nhat trong org, barcode duy nhat neu co) + danh muc/thuoc tinh/anh metadata; gia chuan + gia rieng theo kenh/chi nhanh voi fallback 8 buoc + lich su gia append-only; CSV preview bao loi tung dong + import atomic toan bo hoac khong + export dung du lieu org; RBAC san pham/gia/CSV theo ma tran + audit log; check/demo mo rong buoc san pham/gia/CSV van xanh",
  "scope": [
    "docs/",
    "src/",
    "scripts/",
    "tests/",
    "package.json",
    "package-lock.json",
    "README.md",
    "brief-003.md",
    "goal-003.json",
    ".gitignore"
  ],
  "exclusions": [
    "Nghiep vu kho da kho (GOAL-004): min_stock chi la truong nguong cho canh bao ton thap, khong co so luong ton/bang warehouses/nhap-xuat/kho",
    "Don hang (GOAL-005), thanh toan/hoan tien (GOAL-006), khuyen mai (GOAL-009) — gia rieng theo kenh/chi nhanh khong phai khuyen mai",
    "Upload anh that (luu file/resize/CDN), da chi nhanh cho 1 user (bang user_scopes), quen mat khau / dat lai mat khau qua email, bat buoc doi mat khau lan dau, SSO/OAuth",
    "Deploy production/VPS (ngoai pham vi, local-only), CI workflow (cho user cap scope workflow)"
  ],
  "dependencies": [],
  "interfaces": [
    "GOAL-003@v1"
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "San pham + bien the + danh muc (AC-1): migration 008 tao products (code/name/unit/gia chuan so nguyen dong/min_stock/status), product_variants (SKU duy nhat trong org, barcode duy nhat neu co, price_override), categories + product_attributes + product_images metadata; CRUD san pham/bien the/danh muc/thuoc tinh/anh, ngung kinh doanh giu lich su, khong xoa cung",
      "goalAcceptanceId": "AC-1",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-2",
      "text": "Gia theo kenh/chi nhanh + lich su gia (AC-2): bang product_prices (variant NULL = ap cho ca san pham, channel trong danh muc cho phep, branch NULL = moi chi nhanh), API dat/xem gia rieng, gia hieu dung theo fallback 8 buoc kem source, doi gia bat buoc reason, price_history append-only",
      "goalAcceptanceId": "AC-2",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-3",
      "text": "CSV preview/import/export (AC-3): preview dry-run bao loi tung dong (so dong + ly do), import atomic toan bo hoac khong (1 dong loi -> 422, 0 dong duoc ghi), export CSV dung du lieu hien tai cua org (loc theo org/status/category), round-trip export->preview khop",
      "goalAcceptanceId": "AC-3",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-4",
      "text": "RBAC + audit + checks mo rong xanh (AC-4): mo rong can() voi 8 actions moi theo ma tran san pham/gia/CSV (vai sai -> 403, ngoai org -> 403, sai chi nhanh gia rieng -> 403), audit_log tao/sua/doi gia/import CSV, test 403 theo ma tran, du lieu gia lap, check.sh/demo.sh mo rong buoc san pham/gia/CSV va giu cac buoc GOAL-001/GOAL-002 xanh, docs RBAC/PRICING/D15/D16, khong co workflow CI/VPS",
      "goalAcceptanceId": "AC-4",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    }
  ],
  "integration": "Solo: the package is the whole Goal",
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
  ]
}
```
