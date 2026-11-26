# GOAL-001 v2: solo-direct

Một package WP-MAIN duy nhất xây toàn bộ khung nền trong một lần: TypeScript + Express + node:sqlite, migration tuần tự 6 bảng, seed giả lập, auth session+bcrypt 2 vai, middleware scope org/branch, helper idempotency, adapter fake payment/shipping/email, docs SETUP + backup/restore, scripts check.sh/demo.sh tự chứa (npm ci, tsc, test, start/stop server port riêng). Tester viết acceptance test trước (nếu goal chuyển sang testing), Worker viết code, submit tới khi gate xanh.

```json
{
  "id": "GOAL-001",
  "version": 2,
  "goalId": "GOAL-001",
  "goalVersion": 2,
  "mode": "solo-direct",
  "approach": "Một package WP-MAIN duy nhất xây toàn bộ khung nền trong một lần: TypeScript + Express + node:sqlite, migration tuần tự 6 bảng, seed giả lập, auth session+bcrypt 2 vai, middleware scope org/branch, helper idempotency, adapter fake payment/shipping/email, docs SETUP + backup/restore, scripts check.sh/demo.sh tự chứa (npm ci, tsc, test, start/stop server port riêng). Tester viết acceptance test trước (nếu goal chuyển sang testing), Worker viết code, submit tới khi gate xanh.",
  "risks": [
    "Gate chạy mỗi check trong worktree mới sạch: check.sh/demo.sh phải tự npm ci + build + start/stop server, không dựa vào node_modules/server chạy sẵn.",
    "bcrypt là native module: npm ci trong worktree gate phải build được; đã kiểm chứng bcrypt load được trên máy này.",
    "L0 tsc --noEmit: cần tsconfig.json đúng và code typecheck sạch."
  ],
  "baseCommit": "472eff4abbecac29ac6fdb5f901e91625787d1ec",
  "sourceSha256": "9dac8187fa4b9104c132bfc757a9445438701b81232a182d1dde5b9ab7bb4860",
  "rationale": "Goal nhỏ, một khung nền liền mạch, mọi module chia sẻ cùng DB/app nên tách WP sẽ chỉ thêm chi phí tích hợp mà không tách được rủi ro.",
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
    "src/server.ts",
    "src/app.ts",
    "src/db.ts",
    "src/auth.ts",
    "src/tenant.ts",
    "src/idempotency.ts",
    "src/adapters/index.ts",
    "src/seed.ts"
  ],
  "entries": [
    "GET /health",
    "POST /login",
    "POST /logout",
    "GET /owner-only",
    "src/db.ts: migrate + openDb",
    "src/auth.ts: login/logout/session",
    "src/tenant.ts: tenantScope middleware",
    "src/idempotency.ts: withIdempotency",
    "src/adapters/: FakePaymentAdapter, FakeShippingAdapter, FakeEmailAdapter"
  ],
  "acceptanceMapping": [
    {
      "acceptanceId": "AC-1",
      "verification": "WP-MAIN: npm start + GET /health, migration 6 bảng, seed 1 org/1 branch/2 user"
    },
    {
      "acceptanceId": "AC-2",
      "verification": "WP-MAIN: auth session+bcrypt, login/logout, staff bị chặn route owner-only"
    },
    {
      "acceptanceId": "AC-3",
      "verification": "WP-MAIN: middleware scope org/branch, từ chối truy cập ngoài org, idempotency helper"
    },
    {
      "acceptanceId": "AC-4",
      "verification": "WP-MAIN: src/adapters/ interface + fake payment/shipping/email xác định"
    },
    {
      "acceptanceId": "AC-5",
      "verification": "WP-MAIN: README + docs/SETUP.md, backup/restore script, secret-scan trong check.sh"
    },
    {
      "acceptanceId": "AC-6",
      "verification": "WP-MAIN: apos init + setup v1 đã có, check.sh/demo.sh tự chạy xanh, ROADMAP/DECISIONS có mặt"
    }
  ],
  "verificationStrategy": "Tester viết tests/acceptance.test.ts (L2) + tests/integration.test.ts (L3) + unit test L1 qua supertest và DB in-memory; Worker chạy ./scripts/check.sh và ./scripts/demo.sh local từ đầu sạch trước khi submit; gate APOS (L0 tsc, L1 vitest, L2 acceptance) quyết định."
}
```
