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
| `OMNIFLOW_WEBHOOK_SECRET` | (không có) | Secret giả lập ký webhook thanh toán (`X-Fake-Signature`); thiếu thì endpoint webhook trả 503, server vẫn chạy các route khác (D22) |

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

## Sản phẩm, giá, CSV (GOAL-003)

Sản phẩm là dữ liệu cấp org (không gắn chi nhánh); phạm vi chi nhánh chỉ
gate giá riêng theo chi nhánh. Quy tắc giá đầy đủ: `docs/PRICING.md`
(fallback 8 bước + trường `source`, đổi giá bắt buộc `reason`, giá trùng →
400, lịch sử giá append-only). Ma trận quyền sản phẩm/giá/CSV:
`docs/RBAC.md`. Endpoint chính: `POST/GET/PATCH /api/products`,
`PATCH /api/products/:id/status` (ngừng kinh doanh/mở bán lại, không có
DELETE), `POST/GET/PATCH /api/products/:id/variants`,
`POST/GET/PATCH /api/categories`,
`POST/DELETE /api/products/:id/attributes|images` (ảnh chỉ metadata),
`POST/GET /api/products/:id/prices`, `GET /api/products/:id/price`,
`GET /api/products/:id/price-history`,
`POST /api/products/import/preview`, `POST /api/products/import` (atomic,
tối đa 1000 dòng), `GET /api/products/export`. Seed tạo sẵn 2 sản phẩm mẫu
(`SP-SEED-01`, `SP-SEED-02`) + 1 biến thể + 1 giá riêng kênh `web`.

## Đơn hàng đa kênh + vòng đời (GOAL-005)

Đơn là dữ liệu cấp org, có chi nhánh + kho xuất hàng bắt buộc; mã đơn
`DH-YYYYMMDD-NNNN` duy nhất trong org; giá dòng snapshot tại thời điểm đặt
bằng giá hiệu dụng GOAL-003 (fallback 8 bước, hàm dùng chung
`resolveEffectivePrice()` — D20); vòng đời `draft → confirmed → processing
→ completed / cancelled`, chuyển sai → 400; xác nhận giữ hàng nguyên tử,
hủy giải phóng đúng số đã giữ, hoàn tất = release + out trong cùng một
transaction (D19); lịch sử đơn append-only (`order_events`, cũ nhất trước).
Ma trận quyền đơn đầy đủ: `docs/RBAC.md`; quyết định mô hình:
`docs/DECISIONS.md` (D19, D20). Endpoint chính:
`POST /api/orders` (201, trả đơn kèm `items` đã snapshot + `total` do server
tính), `GET /api/orders` (`status`/`channel`/`code`/`customer_name`/
`branch_id`/`warehouse_id`, `limit` mặc định 20 tối đa 100, `offset` mặc
định 0, kèm `total`), `GET /api/orders/:id` (kèm `items` + `events`),
`POST /api/orders/:id/confirm|process|complete|cancel` (nhận `{note?,
idempotency_key?}`; không có DELETE đơn, không có API sửa/xóa lịch sử).
Idempotency: header `Idempotency-Key` hoặc `idempotency_key` trong body,
tên miền `order:create:<key>` / `order:<hành động>:<key>`, gửi lại trả
`replayed: true`.

## Thanh toán + hoàn tiền (GOAL-006)

Thanh toán là dữ liệu cấp org, gắn với đơn; `branch_id` của payment lấy
theo chi nhánh của đơn. Thu tiền mặt/chuyển khoản → `paid` ngay trong
cùng transaction (đơn `draft` vẫn thu được, đơn `cancelled` → 400); thu
qua cổng fake → `requested` + `gateway_reference` duy nhất theo giao dịch
(`FakePaymentAdapter.charge` với mã `${orderCode}:${paymentId}`), webhook
giả lập `POST /api/payments/webhook` chốt `paid`/`failed` đúng một lần
(xác thực bằng header `X-Fake-Signature` = sha256 hex của
`` `${gateway_reference}:${status}:${amount}:${secret}` ``, secret qua
biến môi trường `OMNIFLOW_WEBHOOK_SECRET`; sai/thiếu chữ ký → 401, thiếu
secret → 503, reference không tồn tại → 404, amount khác → 400; `paid`
lần 2 → 200 kèm `duplicate: true`; `failed` sau `paid` bị bỏ qua).
Hoàn tiền (`POST /api/payments/:id/refunds`, `{amount, reason}`) là bản
ghi riêng, `completed` ngay qua adapter fake; tổng hoàn không bao giờ
vượt số đã trả (kiểm tra trong `BEGIN IMMEDIATE`); hoàn đủ → payment
`refunded`, hoàn một phần → `partially_refunded`; hoàn tiền không đổi
trạng thái đơn. Đối soát (`GET /api/orders/:id/payments`,
`GET /api/payments/:id`) tính ở service: `order_total`/`paid_total`/
`refunded_total`/`outstanding`/`payment_status`
(`unpaid`/`partially_paid`/`paid`/`overpaid`/`refunded`); payments mới
nhất trước, `events` cũ nhất trước. Idempotency: header
`Idempotency-Key` hoặc `idempotency_key` trong body, tên miền
`payment:create:<key>` / `payment:refund:<key>`, gửi lại trả
`replayed: true`. Ma trận quyền thanh toán đầy đủ: `docs/RBAC.md`;
quyết định mô hình: `docs/DECISIONS.md` (D22, D23). KHÔNG lưu thông tin
thẻ; không có DELETE payment, không có API sửa/xóa lịch sử giao dịch.

## Giao hàng + trả hàng (GOAL-007)

Giao hàng/trả hàng là dữ liệu cấp org, gắn với đơn; chỉ đơn `completed`
mới được giao/trả (hàng đã xuất kho ở GOAL-005). Yêu cầu giao
(`POST /api/orders/:id/shipments`, `{carrier, destination,
idempotency_key?}`) trả 201 shipment `requested` với phí/ETA từ
`FakeShippingAdapter.quote()` (khối lượng = tổng số lượng × 500g) +
`tracking_code` deterministic `FAKE-TRK-<hash12>` theo
`${orderCode}:${carrier}:${shipmentId}`; mỗi đơn tối đa 1 shipment chưa
cuối (`requested`/`in_transit`). Cập nhật trạng thái
(`POST /api/shipments/:id/status`, `{status: in_transit | delivered |
failed, reason?, idempotency_key?}`): chỉ `requested → in_transit →
delivered` và `requested`/`in_transit → failed` (thất bại là trạng thái
cuối, bắt buộc có `reason`); gửi lại cùng trạng thái → 200 no-op, KHÔNG
tạo event mới; chuyển sai thứ tự → 400. Yêu cầu trả
(`POST /api/orders/:id/returns`, `{items: [{variant_id, qty, condition:
resalable | damaged}], reason, idempotency_key?}`) trả 201 return
`requested` mã `TH-YYYYMMDD-NNNN`, `unit_price` snapshot từ
`order_items`; biến thể phải thuộc đơn, tổng trả tích lũy (cả yêu cầu
đang chờ duyệt) không vượt số đã đặt. Duyệt/từ chối
(`POST /api/returns/:id/approve|reject`, chỉ từ `requested`, từ chối bắt
buộc có `reason`); nhận hàng (`POST /api/returns/:id/receive`, chỉ từ
`approved`) nhập lại kho có chọn lọc trong cùng transaction: `resalable`
nhập lại kho của đơn bằng movement `in` (`reference` = mã trả),
`damaged` không nhập kho, không ghi movement; hoàn tiền
(`POST /api/returns/:id/refund`, chỉ từ `received`) dùng lại đúng đường
GOAL-006 (`createRefundTx` + bảng `refunds`, `reason` = mã trả, hoàn vào
payment `paid` cũ nhất trước; vượt số còn hoàn được → 400, return ở lại
`received`). Đọc (`GET /api/orders/:id/shipments`,
`GET /api/shipments/:id`, `GET /api/orders/:id/returns`,
`GET /api/returns/:id`) kèm `events`/`items` (mới nhất trước, `events`
cũ nhất trước). Đối chiếu sau trả: `GET /api/orders/:id/payments` hiển
thị đúng `paid_total` đã trừ refund (`payment_status`
`partially_refunded` khi đơn có yêu cầu trả đã hoàn tiền mà vẫn còn tiền
ròng đã trả — xem D25), `GET /api/stock/levels` hiển thị `on_hand` tăng
đúng số bán lại được. Idempotency: header `Idempotency-Key` hoặc
`idempotency_key` trong body, tên miền `shipment:create:<key>` /
`shipment:update:<key>` / `return:create:<key>` /
`return:review:<key>` / `return:receive:<key>` /
`return:refund:<key>`, gửi lại trả `replayed: true`. Ma trận quyền
giao/trả đầy đủ: `docs/RBAC.md`; quyết định mô hình:
`docs/DECISIONS.md` (D24, D25). KHÔNG lưu thông tin thẻ; không có
DELETE shipment/return, không có API sửa/xóa lịch sử giao/trả.

## Khách hàng + CRM (GOAL-008)

Hồ sơ khách hàng cấp org, chi nhánh chính `branch_id` NULL = chưa gán;
điện thoại duy nhất trong org khi có giá trị (`UNIQUE(org_id, phone)`,
trùng khách `active` → 409). Tạo khách (`POST /api/customers`,
`{name, phone?, email?, address?, branch_id?}`, `name` trống → 400,
`branch_id` không tồn tại → 404, ngoài org → 403; sales không gửi
`branch_id` thì khách thuộc chi nhánh mình) trả 201 kèm
`purchase_summary` rỗng + `points_balance` 0 + `segment` `'new'`; sửa
(`PATCH /api/customers/:id`, khách `merged` → 400, đổi phone trùng →
409). `POST /api/orders` nhận thêm `customer_id` optional (không tồn
tại → 404, ngoài org → 403, khách `merged` → 400; không gửi thì như
trước). Xem khách (`GET /api/customers/:id`) kèm `purchase_summary`
(`total_spent` = tổng `total` các đơn `completed`, CHƯA trừ hoàn tiền;
`order_count` = số đơn `completed`; `last_order_at` = đơn `completed`
mới nhất, NULL khi chưa có) + `points_balance` + `segment`; lịch sử mua
(`GET /api/customers/:id/orders`, mới nhất trước, kèm `items`, phân
trang `limit`/`offset`); tìm/lọc (`GET /api/customers?name=&phone=
&segment=&branch_id=&limit=&offset=`, `segment` lạ → 400, kèm `total`;
khách `merged` không xuất hiện trong danh sách mặc định). Tích điểm
(`POST /api/customers/:id/points/earn`, `{order_id, idempotency_key?}`):
chỉ đơn `completed` của khách, 1 điểm / 10.000đ trên tổng sau hoàn
(`order_total` − tổng hoàn `completed`), làm tròn xuống, tổng sau hoàn
< 10.000đ → 400, mỗi đơn tích 1 lần; điểm KHÔNG hết hạn, không thu hồi
khi hoàn tiền sau. Đổi điểm (`POST
/api/customers/:id/points/redeem`, `{order_id, points,
idempotency_key?}`): chỉ đơn `draft` của khách, 1 điểm = 100đ, discount
= min(`points` × 100, `order_total`), một đơn chỉ đổi 1 lần, điểm không
âm; `outstanding` = `order_total` − `points_discount` − `paid_total`,
`payment_status` giữ nguyên logic D22 (đơn đổi hết tổng mà chưa trả
đồng nào vẫn `unpaid`). Xem điểm (`GET /api/customers/:id/points` trả
`{balance, ledger}` mới nhất trước). Ghi chú (`POST
/api/customers/:id/notes`, `{content, idempotency_key?}`, trống → 400;
`GET /api/customers/:id/notes` mới nhất trước, phân trang); ghi chú +
ledger append-only, không có API sửa/xóa (gọi → 404). Phân khúc tính ở
service mỗi lần đọc, KHÔNG lưu cột `segment`: VIP khi `total_spent` ≥
5.000.000đ hoặc `order_count` ≥ 10; ngủ quên khi có ≥ 1 đơn hoàn tất và
lần mua cuối > 90 ngày; thường xuyên khi `order_count` ≥ 3; còn lại mới;
ưu tiên VIP → ngủ quên → thường xuyên → mới. Hợp nhất
(`POST /api/customers/:id/merge`, `{source_customer_id, confirm,
idempotency_key?}`, `confirm` phải là `true`, thiếu/sai → 400): chuyển
mọi đơn + ledger + ghi chú của nguồn sang hồ sơ giữ trong cùng
transaction, nguồn chuyển `merged` + `merged_into_id` + `phone`/`email`
về NULL, row nguồn giữ lại. Xuất dữ liệu (`GET
/api/customers/:id/export` trả `{customer, orders, points: {balance,
ledger}, notes}` + 1 audit log; khách `merged` vẫn export được,
orders/points/notes rỗng kèm `merged_into_id`). Xóa
(`DELETE /api/customers/:id`) chỉ khi khách CHƯA CÓ đơn nào (có đơn →
400; đã `merged` → 400), xóa cứng kèm ghi chú + ledger + 1 audit log.
`audit_log.detail` của MỌI thao tác khách KHÔNG chứa `phone`/`email`/
`address`. Idempotency: header `Idempotency-Key` hoặc `idempotency_key`
trong body, tên miền `customer:points-earn:<key>` /
`customer:points-redeem:<key>` / `customer:merge:<key>`, gửi lại trả
`replayed: true`. Ma trận quyền khách/CRM đầy đủ: `docs/RBAC.md`;
quyết định mô hình: `docs/DECISIONS.md` (D26). KHÔNG lưu thông tin thẻ;
không thêm màn hình khách/CRM (GOAL-012).

## Kho đa kho + tồn (GOAL-004)

Kho là dữ liệu cấp org (không gắn bắt buộc vào chi nhánh); tồn theo biến
thể, `available = on_hand - reserved`, không cho xuất quá `available`
(→ 400 `insufficient_stock`); xuất kho không trừ `reserved`. Ma trận quyền
kho đầy đủ: `docs/RBAC.md`; quyết định mô hình: `docs/DECISIONS.md`
(D17, D18). Endpoint chính: `POST/GET/PATCH /api/warehouses` (tạo/sửa:
chỉ owner; không có DELETE kho), `POST /api/stock/in|out|adjust|count|
transfer|reserve|release` (owner/manager mọi kho, warehouse chỉ kho được
gán, sales/accountant → 403; `qty` nguyên > 0, `reason` bắt buộc, hỗ trợ
`Idempotency-Key` hoặc `idempotency_key` trong body),
`GET /api/stock/levels|movements|low-stock` (sales xem movements/low-stock
→ 403). Seed tạo sẵn 2 kho mẫu (`Kho Chính`, `Kho Phụ`) + mức tồn mẫu cho
biến thể `SKU-SEED-01-M` (Kho Chính chỉ có 3, dưới `min_stock` 5 → tồn thấp
để demo thấy được).

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
- `src/db.ts` — mở DB + migration tuần tự (11 migration, 008 là sản phẩm/giá/CSV, 009 là kho/tồn, 010 là đơn hàng, 011 là thanh toán/hoàn tiền/lịch sử giao dịch)
- `src/orders.ts` — đơn hàng: state machine, mã đơn, service tạo/chuyển
  trạng thái (giữ/giải phóng/xuất kho qua `applyMovement`, idempotency
  trong transaction)
- `src/rbac.ts` — helper phân quyền `can()` + ma trận vai × thao tác × phạm vi
- `src/products.ts` — giá hiệu dụng fallback 8 bước + parse CSV (GOAL-003)
- `src/seed.ts` — seed giả lập tối thiểu
- `src/auth.ts` — bcrypt + session
- `src/tenant.ts` — middleware gắn org/branch của user vào request
- `src/idempotency.ts` — helper idempotency key
- `src/adapters/` — interface + bản fake (payment/shipping/email, ghi rõ giả lập)
- `views/`, `public/` — giao diện EJS server-rendered, tiếng Việt, mobile-first
