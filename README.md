# OmniFlow

Hệ thống vận hành thương mại đa kênh cho doanh nghiệp vừa: nhiều doanh nghiệp,
nhiều chi nhánh, nhiều kho, bán hàng qua nhiều kênh.

Luồng xuyên suốt: Kênh bán → Đơn hàng → Thanh toán → Kho → Giao hàng → Trả hàng
→ Báo cáo → Chăm sóc khách hàng.

Dự án dài hạn, xây dựng bằng APOS (xem `docs/ROADMAP.md` cho các giai đoạn và
`docs/DECISIONS.md` cho các quyết định kiến trúc). Dữ liệu GIẢ LẬP hoàn toàn;
không tiền thật, không tài khoản thanh toán thật, không dịch vụ trả phí.
Dự án chỉ làm local.

## Chạy local

```sh
npm install
npm run seed   # dữ liệu giả lập tối thiểu
npm start      # http://localhost:3000
```

Chi tiết: `docs/SETUP.md`.

## Test

```sh
npm test            # Vitest
./scripts/check.sh  # CHK-1: build + test + kiểm tra (kèm bước RBAC)
./scripts/demo.sh   # CHK-2: demo từng bước (kèm bước RBAC)
```

## Stack

TypeScript + Node 24 + Express + SQLite (`node:sqlite`) + EJS server-rendered,
giao diện tiếng Việt, mobile-first. Xem `docs/DECISIONS.md`.
