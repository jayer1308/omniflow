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
./scripts/check.sh  # CHK-1: build + test + kiểm tra (kèm bước RBAC, sản phẩm/giá/CSV, kho/tồn)
./scripts/demo.sh   # CHK-2: demo từng bước (kèm bước RBAC, sản phẩm/giá/CSV, kho/tồn)
```

## Kho đa kho + tồn giữ/có thể bán (GOAL-004)

Nhiều kho trong một doanh nghiệp (chỉ owner tạo/sửa, không có DELETE kho);
tồn theo biến thể với 3 con số tồn thực tế / tồn giữ / tồn có thể bán
(`available = on_hand - reserved`, không cho xuất quá `available`);
nhập/xuất/điều chỉnh/kiểm kê/chuyển kho nguyên tử (2 movement)/giữ/giải
phóng; lịch sử biến động append-only; cảnh báo tồn thấp theo
`products.min_stock`; idempotency (`stock:<loại>:<key>`, gửi lại trả
`replayed: true`) + chống race trong transaction `BEGIN IMMEDIATE`;
RBAC kho theo vai + phạm vi kho (`users.warehouse_id`). Xem `docs/RBAC.md`
(ma trận kho) và `docs/DECISIONS.md` (D17, D18). Endpoint chính:
`POST/GET/PATCH /api/warehouses`, `POST /api/stock/in|out|adjust|count|
transfer|reserve|release`, `GET /api/stock/levels|movements|low-stock`.
Seed tạo sẵn 2 kho mẫu (`Kho Chính`, `Kho Phụ`) + mức tồn mẫu cho biến thể
`SKU-SEED-01-M` (Kho Chính chỉ có 3, dưới `min_stock` 5 → tồn thấp).

## Sản phẩm, giá, CSV (GOAL-003)

Sản phẩm + biến thể (SKU duy nhất trong org) + danh mục/thuộc tính/ảnh
metadata; giá chuẩn + giá riêng theo kênh (`counter`/`web`/`api`) và chi
nhánh với fallback 8 bước + lịch sử giá append-only; import/export CSV
(xem trước, báo lỗi từng dòng, import atomic). Xem `docs/PRICING.md` và
`docs/RBAC.md` (ma trận sản phẩm/giá/CSV). Endpoint chính:
`POST/GET/PATCH /api/products`, `PATCH /api/products/:id/status`,
`POST/GET/PATCH /api/products/:id/variants`,
`POST/GET/PATCH /api/categories`,
`POST/DELETE /api/products/:id/attributes|images`,
`POST/GET /api/products/:id/prices`, `GET /api/products/:id/price`,
`GET /api/products/:id/price-history`,
`POST /api/products/import/preview`, `POST /api/products/import`,
`GET /api/products/export`.

## Stack

TypeScript + Node 24 + Express + SQLite (`node:sqlite`) + EJS server-rendered,
giao diện tiếng Việt, mobile-first. Xem `docs/DECISIONS.md`.
