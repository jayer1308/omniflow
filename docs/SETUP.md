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

## Khuyến mãi (GOAL-009)

Mã giảm giá cấp org (`promotions`, migration 014): `code` chuẩn hóa
UPPERCASE + trim, duy nhất trong org (trùng → 409); loại `percent`
(`value` nguyên 1..100, `cap` nguyên > 0, chỉ percent) hoặc `fixed`
(`value` nguyên > 0); điều kiện áp: `min_order_total` (mặc định 0),
`channels` JSON (NULL = mọi kênh), `branch_id` (NULL = mọi chi nhánh),
`valid_from`/`valid_to` ISO 8601 (NULL = không giới hạn),
`usage_limit`/`per_customer_limit` (NULL = không giới hạn);
`status` `active`/`locked`. Tạo mã (`POST /api/promotions`,
`{code, type, value, cap?, min_order_total?, channels?, branch_id?,
valid_from?, valid_to?, usage_limit?, per_customer_limit?}`) → 201,
trả mã đã tạo; trùng mã → 409, sai validate → 400, `branch_id` không
tồn tại → 404, ngoài org → 403. Sửa/khóa mã
(`PATCH /api/promotions/:id`, nhận `value?`, `cap?`,
`min_order_total?`, `channels?`, `branch_id?`, `valid_from?`,
`valid_to?`, `usage_limit?`, `per_customer_limit?`, `status?`) → 200;
gửi `code` → 400 (mã không đổi sau khi tạo); `status` chỉ
`active`/`locked`; mã không tồn tại → 404, ngoài org → 403. Xem mã
(`GET /api/promotions`, lọc `name`/`code` (chuỗi con), `status`,
`channel`, `branch_id` khớp chính xác — mã `branch_id` NULL không xuất
hiện khi lọc theo một chi nhánh cụ thể; `limit` mặc định 20 tối đa 100,
`offset` mặc định 0, kèm `total`, mới nhất trước;
`GET /api/promotions/:id` kèm `{used_count, usage_limit,
per_customer_limit}`, `used_count` = số usage status `used`).
Áp mã (`POST /api/orders/:id/promotion`, `{code, idempotency_key?}`)
→ 201: chỉ đơn `draft`, một đơn một mã, mã phải `active`, đúng kênh/
chi nhánh, trong thời gian hiệu lực, tổng đơn ≥ `min_order_total`,
còn lượt tổng + lượt mỗi khách; sai điều kiện → 400, mã không tồn tại
trong org → 404, đơn không tồn tại → 404, ngoài org → 403. Số tiền
giảm tính trên tổng đơn gốc bằng hàm thuần `calculateDiscount`
(percent → `floor(total × value / 100)` rồi min với `cap` và phần còn
lại sau điểm; fixed → `min(value, total − points_discount)`), ghi vào
`orders.promo_discount` (cột riêng, `orders.total` snapshot gốc KHÔNG
đổi); trả đơn kèm `{promotion: {id, code, type, value},
promo_discount}`. Luật chồng giảm với điểm GOAL-008 theo MỘT luật duy
nhất: tổng giảm cuối = `min(C + P, total)` (C = số giảm của mã trước
khi cắt ở phần còn lại, P = điểm đổi × 100), không phụ thuộc thứ tự áp;
đổi điểm trên đơn đã có mã bị cắt ở `total − promo_discount`. Hủy đơn
có mã thì hoàn lượt dùng trong cùng transaction (usage `used` →
`released`, `released_at` + `release_reason` = mã đơn đã hủy,
`promo_discount` về 0, `promotion_id` về NULL, kèm audit riêng
`promotion-usage-released`); trả hàng/hoàn tiền KHÔNG hoàn lượt dùng.
Đối soát (`GET /api/orders/:id/payments`): `outstanding` =
`order_total` − `points_discount` − `promo_discount` − `paid_total`,
`payment_status` giữ nguyên logic D22; tích điểm tính trên tổng gốc,
KHÔNG trừ mã. Lịch sử dùng mã (`promotion_usages`) append-only: chỉ
INSERT + chuyển `used` → `released` khi hủy đơn, không có API DELETE
usage; không có endpoint gỡ mã khỏi đơn (muốn đổi mã thì hủy đơn rồi
tạo đơn mới). Idempotency: header `Idempotency-Key` hoặc
`idempotency_key` trong body, tên miền `promotion:create:<key>` /
`promotion:apply:<key>`, gửi lại trả `replayed: true`. Ma trận quyền
khuyến mãi đầy đủ: `docs/RBAC.md`; quyết định mô hình:
`docs/DECISIONS.md` (D27). KHÔNG lưu thông tin thẻ; không thêm màn hình
khuyến mãi (GOAL-012).

## Báo cáo + đối soát (GOAL-010)

Báo cáo chỉ đọc, tính ở service (`src/reports.ts`, hàm thuần) từ các
bảng đã có — KHÔNG tạo bảng tổng hợp mới, KHÔNG lưu cột tổng riêng,
KHÔNG migration 015, KHÔNG cache (mỗi lần gọi tính lại từ dữ liệu
gốc). Doanh thu chỉ tính đơn `completed`: thời gian đơn là `created_at`
của `order_events` có `to_status = 'completed'` (lưu UTC, không có cột
`completed_at` riêng); `from`/`to` là ngày theo Asia/Ho_Chi_Minh
(`YYYY-MM-DD`), chuyển sang UTC để lọc (`from` 00:00 +07 = hôm trước
17:00 UTC), mặc định tháng hiện tại; `from` > `to` → 400, định dạng
ngày sai → 400. Chỉ số: doanh thu gộp = Σ `orders.total`, doanh thu
thuần = Σ (`total` − `points_discount` − `promo_discount`), số đơn =
số đơn completed trong kỳ; tiền đã thu = Σ `paid_total`, tiền hoàn = Σ
`refunded_total`, còn phải thu = Σ `outstanding` — cả ba theo
`computePaymentSummary` của từng đơn completed trong kỳ (tính theo
đơn, không theo ngày thu); đơn draft đã thu đặt cọc và đơn đã hủy
KHÔNG vào doanh thu; đơn completed bị trả hàng vẫn tính doanh thu gộp,
tiền hoàn ở cột riêng. `GET /api/reports/revenue?from=&to=&channel=
&branch_id=&group_by=` (`channel` ∈ `counter`/`web`/`api`, lạ → 400;
`group_by` ∈ `day`/`month`/`channel`/`branch`/`product`/`category`,
mặc định `day`, lạ → 400; chi nhánh không tồn tại → 404, ngoài org →
403; kỳ rỗng → totals 0, rows rỗng, 200) trả `{from, to, timezone:
'Asia/Ho_Chi_Minh', totals: {gross_revenue, net_revenue, order_count,
paid_total, refunded_total, outstanding_total, points_discount_total,
promo_discount_total}, rows: [...]}` — totals bằng tổng các rows (riêng
`order_count` ở nhóm `product`/`category` là số đơn khác nhau mỗi
dòng). Nhóm `product` dùng `order_items` (`line_total` snapshot,
điểm/mã/đã thu/hoàn phân bổ theo tỉ lệ `line_total`/`total`: làm tròn
xuống từng dòng rồi chia phần dư cho dòng có phần lẻ lớn nhất, tổng các
dòng khớp totals); nhóm `category` gom sản phẩm chưa có danh mục vào
`Chưa phân loại`; nhóm `day`/`month` dùng ngày hoàn tất theo
Asia/Ho_Chi_Minh. Báo cáo tồn (`GET /api/reports/stock?warehouse_id=
&variant_id=&from=&to=`) trả `levels` theo từng cặp (biến thể, kho)
`{variant_id, sku, product_name, warehouse_id, warehouse_name,
on_hand, reserved, available}` (`available = on_hand − reserved`),
`movements` tóm tắt theo loại `{type, count, qty_total}` trong kỳ,
`low_stock` = các cặp `available < products.min_stock` kèm `min_stock`
và `shortage`; kho `inactive` vẫn hiện; lọc kho/biến thể không tồn tại
→ 404, ngoài org → 403. Đối soát (`GET /api/reports/reconciliation?
from=&to=&branch_id=`) trả `{from, to, timezone, summary:
{checked_orders, checked_stock_pairs, mismatch_count}, mismatches:
[...]}` theo 3 mặt, chỉ đọc: (a) kho — tồn kỳ vọng = Σ `qty_change` /
Σ `reserved_change` của MỌI movement của cặp từ đầu so với
`stock_levels` hiện tại (cặp seed chỉ có `stock_levels` mà không có
movement nào KHÔNG tính là lệch); lệch → `kind: 'stock-level'`,
`severity: 'error'`; (b) đơn–kho — mỗi dòng `order_items` của đơn
completed trong kỳ phải có movement `out` (`reference` = mã đơn,
`qty_change` = −số lượng) kèm `release` tương ứng; thiếu/thừa/sai số →
`kind: 'order-stock'`, `severity: 'error'`; (c) đơn–tiền — dùng lại
`computePaymentSummary`: `outstanding > 0` → `kind: 'order-payment'`,
`severity: 'info'`, `note` chứa `chưa thu đủ`; `outstanding < 0` →
`note` chứa `thu thừa`; `payment_status = 'refunded'` mà
`refunded_total` lệch tổng refund `completed` → `severity: 'error'`.
`payment_status` GIỮ NGUYÊN logic D22 (đơn đổi điểm/mã hết tổng mà chưa
trả đồng nào vẫn `unpaid`; hoàn trực tiếp một phần giữ
`partially_paid`, hoàn qua trả hàng giữ `partially_refunded` — D25);
báo cáo hiển thị cả `outstanding` lẫn `payment_status` trong `note`
của dòng đối soát. Báo cáo khuyến mãi (`GET /api/reports/promotions?
from=&to=&code=`) trả theo từng mã `{code, promotion_id, used_count,
released_count, total_discount, order_count}` (`used`/`released` đếm
theo trạng thái hiện tại của usage tạo trong kỳ; `total_discount` = Σ
`discount_amount` của usage `used` tạo trong kỳ; `order_count` = số đơn
khác nhau có usage trong kỳ; lọc `code` theo chuỗi con; mã chưa dùng
trong kỳ vẫn hiện với các số 0). Báo cáo điểm (`GET /api/reports/points?
from=&to=`) trả `{totals: {earned_total, redeemed_total,
redeemed_amount}, rows: [{customer_id, customer_name, earned, redeemed,
redeemed_amount}]}` (`redeemed_amount` = điểm đổi × 100đ, D26; điểm
tích tính trên tổng gốc, D27). Xuất CSV: mọi endpoint báo cáo nhận thêm
`?format=csv` (trả `Content-Type: text/csv; charset=utf-8`, BOM đầu
file, `csv-stringify` tự quote trường chứa dấu phẩy; `format` lạ →
400), cùng dữ liệu với bản JSON cùng filter; cột đúng như brief R-7;
dòng `TOTAL` cuối file cho doanh thu/khuyến mãi/điểm (khớp `totals`
JSON); tồn kho và đối soát không có dòng `TOTAL`. Audit log: CHỈ xuất
CSV mới ghi `audit_log` (action `export-report`, `detail` JSON
`{report, from, to, format: 'csv', filter đã dùng}` — KHÔNG chứa thông
tin thẻ, KHÔNG chứa PII khách); xem JSON không ghi audit. RBAC báo cáo
đầy đủ: `docs/RBAC.md`; quyết định mô hình: `docs/DECISIONS.md` (D28).
KHÔNG lưu thông tin thẻ; không thêm màn hình báo cáo (GOAL-012).

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
- `src/db.ts` — mở DB + migration tuần tự (14 migration: 008 là sản phẩm/giá/CSV, 009 là kho/tồn, 010 là đơn hàng, 011 là thanh toán/hoàn tiền/lịch sử giao dịch, 012 là giao/trả, 013 là khách/CRM, 014 là khuyến mãi)
- `src/orders.ts` — đơn hàng: state machine, mã đơn, service tạo/chuyển
  trạng thái (giữ/giải phóng/xuất kho qua `applyMovement`, idempotency
  trong transaction)
- `src/rbac.ts` — helper phân quyền `can()` + ma trận vai × thao tác × phạm vi
- `src/reports.ts` — báo cáo + đối soát (GOAL-010, D28): hàm thuần tính từ bảng đã có, không bảng tổng riêng
- `src/products.ts` — giá hiệu dụng fallback 8 bước + parse CSV (GOAL-003)
- `src/seed.ts` — seed giả lập tối thiểu
- `src/auth.ts` — bcrypt + session
- `src/tenant.ts` — middleware gắn org/branch của user vào request
- `src/idempotency.ts` — helper idempotency key
- `src/adapters/` — interface + bản fake (payment/shipping/email, ghi rõ giả lập)
- `views/`, `public/` — giao diện EJS server-rendered, tiếng Việt, mobile-first
