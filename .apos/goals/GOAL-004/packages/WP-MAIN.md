# WP-MAIN v1: OmniFlow kho da kho + ton giu/co the ban: nhieu kho trong org (CRUD, khong xoa cung); nhap/xuat/dieu chinh/kiem ke/chuyen kho nguyen tu; ton thuc te / ton giu / ton co the ban (available = on-hand - reserved); lich su bien dong append-only; canh bao ton thap theo min_stock; idempotency + chong race trong transaction; chinh sach khong ton am; RBAC kho theo vai + pham vi kho + audit log; check/demo mo rong buoc kho van xanh

```json
{
  "id": "WP-MAIN",
  "goalId": "GOAL-004",
  "goalVersion": 1,
  "version": 1,
  "owner": "lead",
  "outcome": "OmniFlow kho da kho + ton giu/co the ban: nhieu kho trong org (CRUD, khong xoa cung); nhap/xuat/dieu chinh/kiem ke/chuyen kho nguyen tu; ton thuc te / ton giu / ton co the ban (available = on-hand - reserved); lich su bien dong append-only; canh bao ton thap theo min_stock; idempotency + chong race trong transaction; chinh sach khong ton am; RBAC kho theo vai + pham vi kho + audit log; check/demo mo rong buoc kho van xanh",
  "scope": [
    "docs/",
    "src/",
    "scripts/",
    "tests/",
    "package.json",
    "package-lock.json",
    "README.md",
    "brief-004.md",
    "goal-004.json",
    ".gitignore"
  ],
  "exclusions": [
    "Don hang (GOAL-005): khong co luong giu hang tu dong khi tao don, khong co commit giu hang -> xuat kho khi giao hang, khong co giai phong giu hang tu dong khi huy don — API reserve/release o goal nay la thao tac truc tiep, GOAL-005 se goi chung",
    "Thanh toan/hoan tien (GOAL-006), giao hang/tra hang (GOAL-007), khuyen mai (GOAL-009) — khong doi soat kho–don–thanh toan, khong tra hang nhap lai kho",
    "Da chi nhanh cho 1 user (bang user_scopes), nguong ton thap rieng theo kho, canh bao qua email/thong bao (GOAL-011), upload anh that, quen mat khau / dat lai mat khau qua email, SSO/OAuth",
    "Deploy production/VPS (ngoai pham vi, local-only), CI workflow (cho user cap scope workflow)"
  ],
  "dependencies": [],
  "interfaces": [
    "GOAL-004@v1"
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Kho + luoc do ton (AC-1): migration 009 tao warehouses (org_id, ten bat buoc, branch_id optional chi de hien thi, status active/inactive), stock_levels (ton theo bien the, UNIQUE org/warehouse/variant, CHECK reserved <= on_hand, available tinh duoc), stock_movements append-only (type in/out/adjust/count/transfer_in/transfer_out/reserve/release, qty_change + reserved_change, on_hand_after/reserved_after, reason bat buoc, reference, actor); CRUD kho, khong xoa cung",
      "goalAcceptanceId": "AC-1",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-2",
      "text": "Nhap/xuat/dieu chinh/kiem ke/chuyen/giu/giai phong + doc ton (AC-2): API nhap/xuat (qty nguyen > 0, reason bat buoc, xuat <= available), dieu chinh theo delta, kiem ke dat tuyet doi, chuyen kho nguyen tu 1 transaction (2 movement transfer_out/transfer_in), giu/giai phong chi doi reserved, API doc levels/movements/low-stock kem co low_stock",
      "goalAcceptanceId": "AC-2",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-3",
      "text": "Idempotency + chong race + ton thap (AC-3): idempotency key cho moi thao tac ton (ten mien stock:<loai>:<key>, replay tra response cu kem replayed: true, kiem tra + thuc thi + ghi key trong 1 transaction BEGIN IMMEDIATE), moi bien dong trong BEGIN IMMEDIATE + CHECK o DB, test dong thoi chung minh tong xuat <= available va ton khong am, canh bao ton thap theo products.min_stock theo cap (bien the, kho)",
      "goalAcceptanceId": "AC-3",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-4",
      "text": "RBAC + audit + checks mo rong xanh (AC-4): mo rong can() voi 11 actions kho theo ma tran (vai sai -> 403, ngoai org -> 403, sai kho duoc gan -> 403, chuyen kho khi 1 trong 2 kho ngoai pham vi -> 403), kiem tra users.warehouse_id ton tai khi gan qua PATCH scope, audit_log moi thao tac kho, test 403 theo ma tran, du lieu gia lap, check.sh/demo.sh mo rong buoc kho va giu cac buoc GOAL-001/002/003 xanh, docs RBAC/D17/D18, khong co workflow CI/VPS",
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
    "src/stock.ts",
    "src/app.ts",
    "src/auth.ts",
    "src/db.ts",
    "src/rbac.ts",
    "src/seed.ts",
    "src/tenant.ts",
    "src/idempotency.ts"
  ]
}
```
