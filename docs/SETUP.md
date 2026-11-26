# OmniFlow — Hướng dẫn cài đặt và vận hành (local)

Dự án chỉ làm **local**. Không có VPS, không deploy production trong phạm vi
này. Mọi dữ liệu là **giả lập**; không tiền thật, không tài khoản thanh toán
thật, không dịch vụ trả phí. Xem `docs/DECISIONS.md` (D7, D9).

## Yêu cầu

- Node.js 24+ (đã kiểm chứng trên Node v24.22.1), npm 10+
- `sqlite3` CLI (tùy chọn, dùng cho backup/restore trong demo; script tự
  fallback sang `cp` nếu thiếu)

## Cài đặt

```sh
npm install
```

## Chạy local

```sh
npm run seed   # tạo dữ liệu giả lập tối thiểu (1 org, 1 branch, owner + staff)
npm start      # chạy ở http://localhost:3000
```

Mở http://localhost:3000/health — phải trả `{"status":"ok"}`.

### Tài khoản seed (giả lập)

- Chủ doanh nghiệp: `owner@example.local` (vai `owner`)
- Nhân viên: `staff@example.local` (vai `sales` từ GOAL-002)

Mật khẩu **không commit trong repo**. Cách cấp mật khẩu seed:

```sh
OMNIFLOW_SEED_OWNER_PASSWORD=<mat-khau-owner> \
OMNIFLOW_SEED_STAFF_PASSWORD=<mat-khau-staff> \
npm run seed
```

Nếu không đặt biến môi trường, `npm run seed` (và `npm start` khi DB trống)
tự sinh mật khẩu ngẫu nhiên và in ra màn hình **một lần duy nhất** — ghi lại
ngay, vì không xem lại được. Biến môi trường khác:

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `OMNIFLOW_DB` | `data/omniflow.db` | Đường dẫn file SQLite |
| `PORT` | `3000` | Port server lắng nghe |

## Phân quyền (RBAC, GOAL-002)

5 vai: `owner` / `manager` / `sales` / `warehouse` / `accountant`. Ma trận
quyền đầy đủ: `docs/RBAC.md`. Endpoint chính: mời nhân viên
`POST /api/users/invite`, khóa/mở khóa/thu hồi
`POST /api/users/:id/lock|unlock|revoke`, đổi vai/phạm vi
`PATCH /api/users/:id/role|scope`, đổi mật khẩu
`POST /api/users/:id/change-password` (người khác) và
`POST /api/users/change-password` (của mình, cần mật khẩu hiện tại), danh
sách nhân viên `GET /api/users`, tạo chi nhánh `POST /api/branches`, nhật ký
`GET /api/audit-log` và trang `/audit-log`. Tài khoản bị khóa đăng nhập trả
403 (phân biệt với 401 sai mật khẩu); session cũ bị vô hiệu ngay khi khóa /
thu hồi.

## Chạy test

```sh
npm test            # Vitest: unit + acceptance + integration
npx tsc --noEmit    # typecheck
./scripts/check.sh  # CHK-1: build + test + secret-scan + smoke server
./scripts/demo.sh   # CHK-2: demo từng bước, in PASS/FAIL
```

`check.sh` và `demo.sh` tự chứa: tự `npm ci`, tự build/test, tự start/stop
server trên port riêng với DB tạm rồi dọn dẹp — không dựa vào server hay DB
chạy sẵn.

## Sao lưu / khôi phục

DB là một file SQLite duy nhất (`data/omniflow.db` mặc định).

```sh
./scripts/backup.sh data/omniflow.db /tmp/omniflow-backup.db   # tạo file backup
./scripts/restore.sh /tmp/omniflow-backup.db data/omniflow.db  # khôi phục từ file
```

Khôi phục đưa dữ liệu về đúng trạng thái lúc backup (đã có test chứng minh
trong `tests/integration.test.ts` và bước demo trong `scripts/demo.sh`).
Dừng server trước khi restore file DB đang chạy.

## Cấu trúc

- `src/server.ts` — điểm vào: mở DB, migration, seed nếu DB trống, chạy server
- `src/app.ts` — Express app: routes, auth, scope đa tenant
- `src/db.ts` — mở DB + migration tuần tự (7 bảng/migration, 007 là RBAC)
- `src/rbac.ts` — helper phân quyền `can()` + ma trận vai × thao tác × phạm vi
- `src/seed.ts` — seed giả lập tối thiểu
- `src/auth.ts` — bcrypt + session
- `src/tenant.ts` — middleware gắn org/branch của user vào request
- `src/idempotency.ts` — helper idempotency key
- `src/adapters/` — interface + bản fake (payment/shipping/email, ghi rõ giả lập)
- `views/`, `public/` — giao diện EJS server-rendered, tiếng Việt, mobile-first
