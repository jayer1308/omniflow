# WP-MAIN v1: OmniFlow nền tảng: repo + APOS setup approved; khung Express+SQLite chạy được (health, migration, seed giả lập); auth session + bcrypt với 2 vai nền; đa tenant + idempotency ở mức khung; adapter fake payment/shipping/email; docs vận hành + backup/restore; check/demo xanh

```json
{
  "id": "WP-MAIN",
  "goalId": "GOAL-001",
  "goalVersion": 2,
  "version": 1,
  "owner": "lead",
  "outcome": "OmniFlow nền tảng: repo + APOS setup approved; khung Express+SQLite chạy được (health, migration, seed giả lập); auth session + bcrypt với 2 vai nền; đa tenant + idempotency ở mức khung; adapter fake payment/shipping/email; docs vận hành + backup/restore; check/demo xanh",
  "scope": [
    "docs/",
    "src/",
    "scripts/",
    "tests/",
    "package.json",
    "package-lock.json",
    "README.md",
    "brief-001.md",
    "goal-001.json",
    ".gitignore"
  ],
  "exclusions": [
    "Nghiệp vụ sản phẩm/giá/CSV (GOAL-003), kho (GOAL-004), đơn hàng (GOAL-005)",
    "RBAC đầy đủ 5 vai, mời/khóa/thu hồi nhân viên (GOAL-002)",
    "Tích hợp cổng thanh toán/vận chuyển/email thật — chỉ fake",
    "Deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user cấp scope workflow)"
  ],
  "dependencies": [],
  "interfaces": [
    "GOAL-001@v2"
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Khung app chạy được (AC-1): npm start khởi động server, GET /health trả ok, migration tạo đủ bảng, seed giả lập tối thiểu chạy được",
      "goalAcceptanceId": "AC-1",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-2",
      "text": "Auth + 2 vai nền (AC-2): session + bcrypt, đăng nhập/đăng xuất đúng, staff bị chặn ở route owner-only",
      "goalAcceptanceId": "AC-2",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-3",
      "text": "Đa tenant + idempotency ở mức khung (AC-3): middleware scope org/branch, truy cập ngoài org bị từ chối, gửi lại cùng key không thực thi lại",
      "goalAcceptanceId": "AC-3",
      "checkIds": [
        "CHK-1"
      ]
    },
    {
      "id": "AC-4",
      "text": "Adapter fake (AC-4): interface payment/shipping/email + bản fake xác định chạy local",
      "goalAcceptanceId": "AC-4",
      "checkIds": [
        "CHK-1"
      ]
    },
    {
      "id": "AC-5",
      "text": "Docs + sao lưu/khôi phục + không lộ bí mật (AC-5): README + SETUP.md đúng lệnh thật, backup/restore chạy được, không commit credential",
      "goalAcceptanceId": "AC-5",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-6",
      "text": "APOS setup + scripts + docs (AC-6): apos init + setup probe pass + approved, check.sh/demo.sh tự chạy xanh, ROADMAP/DECISIONS có mặt",
      "goalAcceptanceId": "AC-6",
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
    "src/server.ts",
    "src/app.ts",
    "src/db.ts",
    "src/auth.ts",
    "src/tenant.ts",
    "src/idempotency.ts",
    "src/adapters/index.ts",
    "src/seed.ts"
  ]
}
```
