# WP-MAIN v1: OmniFlow don hang da kenh + vong doi: tao don tai quay + API (kenh counter/web/api) voi snapshot gia tai thoi diem dat; state machine draft -> confirmed -> processing -> completed / cancelled (chuyen sai -> 400); xac nhan giu hang nguyen tu, huy giai phong dung so da giu, hoan tat release + out trong 1 transaction; idempotency + chong ban qua ton trong transaction; tim kiem/loc/phang trang + lich su don; RBAC don theo vai + pham vi chi nhanh/kho + audit log; check/demo mo rong buoc don van xanh

```json
{
  "id": "WP-MAIN",
  "goalId": "GOAL-005",
  "goalVersion": 1,
  "version": 1,
  "owner": "lead",
  "outcome": "OmniFlow don hang da kenh + vong doi: tao don tai quay + API (kenh counter/web/api) voi snapshot gia tai thoi diem dat; state machine draft -> confirmed -> processing -> completed / cancelled (chuyen sai -> 400); xac nhan giu hang nguyen tu, huy giai phong dung so da giu, hoan tat release + out trong 1 transaction; idempotency + chong ban qua ton trong transaction; tim kiem/loc/phang trang + lich su don; RBAC don theo vai + pham vi chi nhanh/kho + audit log; check/demo mo rong buoc don van xanh",
  "scope": [
    "docs/",
    "src/",
    "scripts/",
    "tests/",
    "package.json",
    "package-lock.json",
    "README.md",
    "brief-005.md",
    "goal-005.json",
    ".gitignore"
  ],
  "exclusions": [
    "Thanh toán/hoàn tiền (GOAL-006): không thu tiền, không trạng thái thanh toán trên đơn, không webhook, không đối soát đơn–thanh toán.",
    "Giao hàng/trả hàng (GOAL-007): không yêu cầu giao, không gán đơn vị vận chuyển, không trả hàng nhập lại kho — 'hoàn tất' ở đây chỉ là xuất kho xong, chưa phải giao tới khách.",
    "Khách hàng + CRM (GOAL-008): customer_name chỉ là chuỗi tự do trên đơn, không có bảng khách hàng, không hợp nhất hồ sơ trùng, không lịch sử chăm sóc.",
    "Khuyến mãi (GOAL-009): không mã giảm giá, không chương trình theo điều kiện — giá đơn chỉ dùng giá hiệu dụng GOAL-003 đã snapshot.",
    "Báo cáo/đối soát (GOAL-010), thông báo (GOAL-011): không tổng hợp doanh thu theo đơn, không thông báo đơn mới (chỉ audit log + lịch sử đơn).",
    "Đa chi nhánh cho 1 user (bảng user_scopes), quên mật khẩu / đặt lại mật khẩu qua email, SSO/OAuth, upload ảnh thật — là follow-up, không làm trong goal này.",
    "Deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user cấp scope workflow)."
  ],
  "dependencies": [],
  "interfaces": [
    "GOAL-005@v1"
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Don + luoc do don + snapshot gia (AC-1): migration 010 tao orders (org/branch/warehouse, code DH-YYYYMMDD-NNNN duy nhat trong org, channel counter/web/api, customer_name tu do, status state machine, total nguyen dong), order_items (snapshot sku/name/unit_price/price_source, qty > 0, line_total, UNIQUE don/bien the), order_events append-only; API tao don (201, tra don kem items + total, o draft, khong giu hang), API doc don + tim kiem/loc/phang trang",
      "goalAcceptanceId": "AC-1",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-2",
      "text": "Vong doi don + giu/giai phong/xuat kho (AC-2): state machine draft -> confirmed -> processing -> completed / cancelled (chuyen sai -> 400, khong ghi event, khong dong kho); xac nhan giu hang nguyen tu moi dong (thieu ton -> 400, khong giu dong nao); huy giai phong dung so da giu; hoan tat release + out trong 1 transaction; lich su don order_events append-only cho moi lan tao/chuyen trang thai",
      "goalAcceptanceId": "AC-2",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-3",
      "text": "Idempotency + chong ban qua ton (AC-3): idempotency key cho tao don + moi chuyen trang thai qua withStockIdempotency (ten mien order:create:<key> / order:<hanh dong>:<key>, replay tra response cu kem replayed: true, kiem tra + thuc thi + ghi key trong 1 transaction BEGIN IMMEDIATE), moi giu/xuat qua applyMovement trong BEGIN IMMEDIATE + CHECK o DB, test dong thoi chung minh tong giu <= available va ton khong am",
      "goalAcceptanceId": "AC-3",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-4",
      "text": "RBAC + audit + checks mo rong xanh (AC-4): mo rong can() voi 6 actions don theo ma tran (vai sai -> 403, ngoai org -> 403, sai chi nhanh/kho -> 403), audit_log moi thao tac don, test 403 theo ma tran, du lieu gia lap, check.sh/demo.sh mo rong buoc don va giu cac buoc GOAL-001..004 xanh, docs RBAC/D19/D20, khong co workflow CI/VPS",
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
  ]
}
```
