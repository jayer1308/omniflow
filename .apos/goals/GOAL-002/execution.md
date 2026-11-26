# GOAL-002 v1: solo-direct

Một package WP-MAIN duy nhất xây toàn bộ RBAC trong một lần: migration 007 (role 5 vai + remap staff->sales, status 3 giá trị, branch_id nullable, warehouse_id chuẩn bị) bằng rebuild bảng để giữ dữ liệu; src/rbac.ts helper can() + middleware requireRole/requireScope; endpoints mời/khóa/mở khóa/thu hồi/đổi vai/đổi phạm vi/đổi mật khẩu/danh sách nhân viên/tạo chi nhánh/audit log (API + trang EJS); lookupSession kiểm tra status; seed đổi staff thành sales giữ nguyên email + 2 user; docs/RBAC.md + D13/D14; mở rộng check.sh/demo.sh thêm bước RBAC, giữ các bước GOAL-001 xanh.

```json
{
  "id": "GOAL-002",
  "version": 1,
  "goalId": "GOAL-002",
  "goalVersion": 1,
  "mode": "solo-direct",
  "approach": "Một package WP-MAIN duy nhất xây toàn bộ RBAC trong một lần: migration 007 (role 5 vai + remap staff->sales, status 3 giá trị, branch_id nullable, warehouse_id chuẩn bị) bằng rebuild bảng để giữ dữ liệu; src/rbac.ts helper can() + middleware requireRole/requireScope; endpoints mời/khóa/mở khóa/thu hồi/đổi vai/đổi phạm vi/đổi mật khẩu/danh sách nhân viên/tạo chi nhánh/audit log (API + trang EJS); lookupSession kiểm tra status; seed đổi staff thành sales giữ nguyên email + 2 user; docs/RBAC.md + D13/D14; mở rộng check.sh/demo.sh thêm bước RBAC, giữ các bước GOAL-001 xanh.",
  "risks": [
    "Migration SQLite không sửa CHECK bằng ALTER đơn giản — rebuild bảng (tạo mới, copy, đổi tên), giữ dữ liệu cũ và FK audit_log/sessions.",
    "Gate chạy mỗi check trong worktree mới sạch: check.sh/demo.sh phải tự npm ci (gỡ symlink node_modules trước, D12), build, start/stop server port riêng.",
    "Khóa session ngay khi khóa/thu hồi: vừa xóa sessions vừa lookupSession kiểm tra status, kẻo session lọt qua vẫn dùng được.",
    "17 test GOAL-001 đã khóa — không sửa; seed phải giữ 2 user và email staff@example.local.",
    "Một criterion cần test chỉ thuộc đúng một package (Solo nên WP-MAIN giữ cả 4 AC, không tách)."
  ],
  "baseCommit": "d31c6cc30a965838c62e9d216a02112371d183fe",
  "sourceSha256": "80ffd1962165af883a9369d51284a397497cfb86d2d1341698d4171cd01fdeb8",
  "rationale": "Goal liền mạch một miền RBAC: migration + helper + endpoints + audit log + test chia sẻ cùng DB/app và cùng ma trận quyền; tách WP sẽ chỉ thêm chi phí tích hợp và rủi ro criterion thuộc 2 package, trong khi Solo đã chứng minh hiệu quả ở GOAL-001.",
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
    "src/rbac.ts",
    "src/app.ts",
    "src/db.ts",
    "src/auth.ts",
    "src/seed.ts",
    "src/tenant.ts"
  ],
  "entries": [
    "POST /api/users/invite",
    "POST /api/users/:id/lock",
    "POST /api/users/:id/unlock",
    "POST /api/users/:id/revoke",
    "PATCH /api/users/:id/role",
    "PATCH /api/users/:id/scope",
    "POST /api/users/:id/change-password",
    "POST /api/users/change-password",
    "GET /api/users",
    "POST /api/branches",
    "GET /api/audit-log",
    "GET /audit-log",
    "src/rbac.ts: can()"
  ],
  "acceptanceMapping": [
    {
      "acceptanceId": "AC-1",
      "verification": "WP-MAIN: migration 007 role CHECK 5 vai, staff cũ thành sales, status + branch_id nullable + warehouse_id, helper can() + middleware, docs/RBAC.md đầy đủ ma trận"
    },
    {
      "acceptanceId": "AC-2",
      "verification": "WP-MAIN: invite/lock/unlock/revoke/đổi vai/phạm vi/mật khẩu theo ma trận, khóa vô hiệu session ngay, login khóa 403 phân biệt 401, owner tạo branch, GET /api/users lọc theo phạm vi"
    },
    {
      "acceptanceId": "AC-3",
      "verification": "WP-MAIN: audit_log ghi mọi thao tác nhạy cảm với actor/created_at/action/detail before-after, GET /api/audit-log + trang xem log lọc theo org/phạm vi"
    },
    {
      "acceptanceId": "AC-4",
      "verification": "WP-MAIN: test 403 ngoài org/ngoài branch/sai vai qua HTTP + trực tiếp can(), dữ liệu giả lập, check.sh/demo.sh mở rộng bước RBAC và giữ các bước GOAL-001 xanh"
    }
  ],
  "verificationStrategy": "Tester viết tests/rbac-acceptance.test.ts (L2) gọi entries đã khai + stub src/rbac.ts, tests submit khóa; Worker viết code trên commit đã khóa test, chạy ./scripts/check.sh và ./scripts/demo.sh local từ đầu sạch trước khi submit; gate APOS (L0 tsc, L1 vitest, L2 acceptance) quyết định."
}
```
