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
./scripts/check.sh  # CHK-1: build + test + kiểm tra (kèm bước RBAC, sản phẩm/giá/CSV, kho/tồn, đơn hàng, thanh toán/hoàn tiền, giao hàng/trả hàng, khách hàng/CRM)
./scripts/demo.sh   # CHK-2: demo từng bước (kèm bước RBAC, sản phẩm/giá/CSV, kho/tồn, đơn hàng, thanh toán/hoàn tiền, giao hàng/trả hàng, khách hàng/CRM)
```

## Giao hàng + trả hàng (GOAL-007)

Chỉ đơn `completed` mới được giao/trả. Yêu cầu giao qua adapter fake
(`FakeShippingAdapter.quote()` lấy phí/ETA theo khối lượng mặc định tổng
số lượng × 500g; mã vận đơn deterministic `FAKE-TRK-<hash12>` theo
`${orderCode}:${carrier}:${shipmentId}`, cùng shipment cùng mã, khác
shipment khác mã); state machine giao riêng `requested → in_transit →
delivered`, `requested`/`in_transit → failed` (thất bại là trạng thái
cuối, muốn giao lại thì tạo shipment mới; mỗi đơn tối đa 1 shipment chưa
cuối); gửi lại cùng trạng thái là no-op (200, không tạo event mới, không
ghi audit mới), chuyển sai thứ tự → 400. Trả hàng `requested → approved
→ received → refunded` / `requested → rejected` (từ chối bắt buộc có lý
do); mã trả `TH-YYYYMMDD-NNNN`; tổng trả tích lũy mỗi biến thể tính cả
yêu cầu đang chờ duyệt, không vượt số đã đặt; `unit_price` snapshot từ
`order_items`. Nhận hàng nhập lại kho có chọn lọc trong cùng transaction
(`resalable` nhập lại bằng movement `in`, `damaged` không nhập kho,
không ghi movement). Hoàn tiền trả hàng dùng lại đúng đường GOAL-006
(`createRefundTx` + bảng `refunds`, `reason` = mã trả, hoàn vào payment
đã `paid` cũ nhất trước; vượt số còn hoàn được → 400, yêu cầu trả ở lại
`received`); đối soát sau trả tính lại bằng `computePaymentSummary`
(`paid_total` đã trừ refund, `payment_status` là `partially_refunded`
khi đơn có yêu cầu trả đã hoàn tiền mà vẫn còn tiền ròng đã trả). Lịch
sử giao/trả append-only (`shipment_events`/`return_events`, cũ nhất
trước); RBAC giao/trả theo vai + phạm vi chi nhánh/kho của đơn; audit
log mọi thao tác. KHÔNG lưu thông tin thẻ. Xem `docs/RBAC.md` (ma trận
giao/trả) và `docs/DECISIONS.md` (D24, D25). Endpoint chính:
`POST /api/orders/:id/shipments`, `POST /api/shipments/:id/status`,
`GET /api/orders/:id/shipments`, `GET /api/shipments/:id`,
`POST /api/orders/:id/returns`, `POST /api/returns/:id/approve|reject|
receive|refund`, `GET /api/orders/:id/returns`, `GET /api/returns/:id`
(không có DELETE shipment/return, không có API sửa/xóa lịch sử).
Idempotency: header `Idempotency-Key` hoặc `idempotency_key` trong body,
tên miền `shipment:create:<key>` / `shipment:update:<key>` /
`return:create:<key>` / `return:review:<key>` / `return:receive:<key>` /
`return:refund:<key>`, gửi lại trả `replayed: true`.

## Thanh toán + hoàn tiền (GOAL-006)

Thu tiền mặt/chuyển khoản → `paid` ngay; thu qua cổng fake → `requested`
+ `gateway_reference` duy nhất theo giao dịch (`FAKE-PAY-<hash>`, gọi
`FakePaymentAdapter.charge` với mã `${orderCode}:${paymentId}`), webhook
giả lập chốt `paid`/`failed` đúng một lần dù gửi lặp/trễ/sai thứ tự;
hoàn tiền là bản ghi riêng (`refunds`), tổng hoàn không bao giờ vượt số
đã trả (kiểm tra trong `BEGIN IMMEDIATE`); đối soát từng đơn tính ở
service (`order_total`/`paid_total`/`refunded_total`/`outstanding`/
`payment_status`: `unpaid`/`partially_paid`/`paid`/`overpaid`/`refunded`);
lịch sử giao dịch append-only (`payment_events`, cũ nhất trước); RBAC
thanh toán theo vai + phạm vi chi nhánh/kho; audit log mọi thao tác
(webhook có `user_id` NULL). KHÔNG lưu thông tin thẻ. Xem `docs/RBAC.md`
(ma trận thanh toán) và `docs/DECISIONS.md` (D22, D23). Endpoint chính:
`POST /api/orders/:id/payments`, `GET /api/orders/:id/payments`,
`GET /api/payments/:id`, `POST /api/payments/:id/refunds`,
`POST /api/payments/webhook` (không qua session — xác thực bằng header
`X-Fake-Signature` = sha256 của
`` `${gateway_reference}:${status}:${amount}:${secret}` ``, secret qua
biến môi trường `OMNIFLOW_WEBHOOK_SECRET`; sai/thiếu chữ ký → 401, thiếu
secret → 503). Idempotency: header `Idempotency-Key` hoặc
`idempotency_key` trong body, tên miền `payment:create:<key>` /
`payment:refund:<key>`, gửi lại trả `replayed: true`. Không có DELETE
payment, không có API sửa/xóa lịch sử giao dịch.

## Đơn hàng đa kênh + vòng đời (GOAL-005)

Tạo đơn tại quầy + qua API (kênh `counter`/`web`/`api`), mỗi dòng snapshot
giá bán tại thời điểm đặt (không đổi khi giá đổi sau đó); vòng đời
`draft → confirmed → processing → completed / cancelled` (chuyển sai → 400);
xác nhận giữ hàng nguyên tử, hủy giải phóng đúng số đã giữ, hoàn tất =
giải phóng giữ + xuất kho trong cùng một transaction (release + out, không
thêm loại movement mới); mã đơn `DH-YYYYMMDD-NNNN` duy nhất trong org;
idempotency (`order:create:<key>` / `order:<hành động>:<key>`, gửi lại trả
`replayed: true`) + chống bán quá tồn trong transaction `BEGIN IMMEDIATE`;
tìm kiếm/lọc/phân trang + lịch sử đơn append-only (`order_events`, cũ nhất
trước); RBAC đơn theo vai + phạm vi chi nhánh/kho; audit log mọi thao tác.
Xem `docs/RBAC.md` (ma trận đơn) và `docs/DECISIONS.md` (D19, D20).
Endpoint chính: `POST /api/orders`, `GET /api/orders`, `GET /api/orders/:id`,
`POST /api/orders/:id/confirm|process|complete|cancel` (không có DELETE đơn,
không có API sửa/xóa lịch sử đơn).

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

## Khách hàng + CRM (GOAL-008)

Hồ sơ khách hàng cấp org, chi nhánh chính (`branch_id` NULL = chưa gán),
điện thoại duy nhất trong org (trùng khách `active` → 409); lịch sử mua
chỉ tính đơn `completed` (`total_spent` CHƯA trừ hoàn tiền). Tích điểm
1 điểm / 10.000đ trên tổng đơn sau hoàn (làm tròn xuống, chỉ đơn
`completed`, mỗi đơn 1 lần, điểm KHÔNG hết hạn, không thu hồi khi hoàn
tiền sau); đổi điểm 1 điểm = 100đ trừ tiền đơn `draft` mới (discount =
min(`points` × 100, `order_total`), một đơn chỉ đổi 1 lần, điểm không
âm; `outstanding` trừ `points_discount` nhưng `payment_status` giữ
nguyên logic D22). Ghi chú chăm sóc append-only; phân khúc tính ở
service, KHÔNG lưu cột riêng (VIP ≥ 5.000.000đ hoặc ≥ 10 đơn; ngủ quên
khi lần mua cuối > 90 ngày; thường xuyên ≥ 3 đơn; còn lại mới; ưu tiên
VIP → ngủ quên → thường xuyên → mới). Tìm/lọc theo tên/điện thoại/phân
khúc/chi nhánh. Hợp nhất hồ sơ trùng bắt buộc `confirm: true` (chuyển
mọi đơn + điểm + ghi chú trong cùng transaction, nguồn chuyển `merged`,
`phone`/`email` về NULL, row nguồn giữ lại). Xuất dữ liệu đủ 4 phần
(hồ sơ + đơn + điểm + ghi chú); xóa cứng chỉ khi khách chưa có đơn;
`audit_log.detail` KHÔNG chứa `phone`/`email`/`address`. Idempotency
(`customer:points-earn:<key>` / `customer:points-redeem:<key>` /
`customer:merge:<key>`, gửi lại trả `replayed: true`) + chống race
trong transaction `BEGIN IMMEDIATE`; RBAC khách/CRM theo vai + phạm vi
chi nhánh chính (xóa chỉ owner/manager, action `delete-customer`
riêng). Xem `docs/RBAC.md` (ma trận khách/CRM) và `docs/DECISIONS.md`
(D26). Endpoint chính: `POST/PATCH/GET /api/customers`,
`GET /api/customers/:id/orders|points|notes|export`,
`POST /api/customers/:id/points/earn|redeem`,
`POST /api/customers/:id/notes|merge`,
`DELETE /api/customers/:id`; `POST /api/orders` nhận thêm
`customer_id` optional.

## Khuyến mãi (GOAL-009)

Mã giảm giá cấp org, `code` chuẩn hóa UPPERCASE + trim, duy nhất trong
org (trùng → 409), `code` không đổi sau khi tạo (PATCH gửi `code` →
400). Loại giảm: `%` (`value` 1..100, có `cap`) hoặc số tiền cố định
(`value` > 0); điều kiện áp: tổng đơn tối thiểu, kênh bán, chi nhánh,
thời gian hiệu lực, giới hạn dùng tổng + mỗi khách (NULL = không giới
hạn). Áp mã vào đơn `draft` (một đơn một mã, trong cùng transaction
`BEGIN IMMEDIATE`: ghi `promotion_usages` + cập nhật
`orders.promotion_id`/`promo_discount` + audit log); số tiền giảm tính
trên tổng đơn gốc bằng hàm thuần `calculateDiscount` (%, cap, cố định,
cắt ở tổng đơn và ở phần còn lại sau điểm). Luật chồng giảm với điểm
GOAL-008 theo MỘT luật duy nhất, không phụ thuộc thứ tự áp (tổng giảm =
min(C + P, `total`)); đổi điểm trên đơn đã có mã bị cắt ở
`total − promo_discount`. Hủy đơn có mã thì hoàn lượt dùng trong cùng
transaction (usage `used` → `released`, `promo_discount` về 0,
`promotion_id` về NULL, kèm audit riêng
`promotion-usage-released`); trả hàng/hoàn tiền KHÔNG hoàn lượt dùng.
Đối soát trừ cả điểm lẫn mã (`outstanding` = `order_total` −
`points_discount` − `promo_discount` − `paid_total`,
`payment_status` giữ nguyên logic D22); tích điểm tính trên tổng gốc,
KHÔNG trừ mã. Lịch sử dùng mã append-only (`promotion_usages`). Không
có endpoint gỡ mã khỏi đơn (muốn đổi mã thì hủy đơn rồi tạo đơn mới);
không lưu thông tin thẻ. Idempotency (`promotion:create:<key>` /
`promotion:apply:<key>`, gửi lại trả `replayed: true`) + chống race
trong transaction `BEGIN IMMEDIATE`; RBAC khuyến mãi theo ma trận
(tạo/sửa/khóa: chỉ owner/manager; áp mã: owner/manager toàn org, sales
chỉ đơn thuộc chi nhánh mình; xem: owner/manager/accountant toàn org,
sales chỉ mã mọi chi nhánh hoặc đúng chi nhánh mình, warehouse 403).
Xem `docs/RBAC.md` (ma trận khuyến mãi) và `docs/DECISIONS.md` (D27).
Endpoint chính: `POST/PATCH/GET /api/promotions`,
`GET /api/promotions/:id` (kèm `used_count`, `usage_limit`,
`per_customer_limit`), `POST /api/orders/:id/promotion`.

## Stack

TypeScript + Node 24 + Express + SQLite (`node:sqlite`) + EJS server-rendered,
giao diện tiếng Việt, mobile-first. Xem `docs/DECISIONS.md`.
