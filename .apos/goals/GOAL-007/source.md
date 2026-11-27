# OmniFlow — brief GOAL-007: Giao hàng + trả hàng

## Bối cảnh (vấn đề)

OmniFlow là hệ thống vận hành thương mại đa kênh cho doanh nghiệp vừa (nhiều
doanh nghiệp, nhiều chi nhánh, nhiều kho, nhiều kênh bán), dự án dài hạn để kiểm
tra APOS ở quy mô lớn. Roadmap: `docs/ROADMAP.md` (12 Goal + GOAL-005A đã
đóng). Quyết định kiến trúc: `docs/DECISIONS.md` (D1–D23).

GOAL-007 xây nghiệp vụ giao hàng + trả hàng trên nền GOAL-001 (đã CLOSED) +
GOAL-002 (RBAC, đã CLOSED) + GOAL-003 (sản phẩm/giá, đã CLOSED) + GOAL-004
(kho, đã CLOSED) + GOAL-005 (đơn hàng, đã CLOSED) + GOAL-005A (adopt R-19,
đã CLOSED) + GOAL-006 (thanh toán + hoàn tiền, đã CLOSED): yêu cầu giao +
gán đơn vị vận chuyển (adapter fake đã có từ GOAL-001); cập nhật trạng thái
giao hàng lặp/sai thứ tự mà không ghi nhận sai; trả hàng duyệt/từ chối, nhận
hàng trả, hoàn tiền (dùng API hoàn tiền GOAL-006, không viết lại logic hoàn);
phân biệt hàng trả bán lại được (nhập lại kho) vs hàng hỏng (không nhập kho);
đối chiếu đơn/thanh toán/kho sau khi trả. Phụ thuộc: GOAL-005 + GOAL-006.
Không làm khuyến mãi (GOAL-009), báo cáo tổng hợp (GOAL-010), thông báo
(GOAL-011) trong goal này. Dữ liệu GIẢ LẬP hoàn toàn; không tiền thật, không
tài khoản thanh toán thật, không dịch vụ trả phí, KHÔNG lưu thông tin thẻ.
Dự án chỉ làm LOCAL — không có VPS trong phạm vi (user xác nhận 26/11 21:49).

Đề xuất: size M, appetite 480 phút, 3 lần thử (Human delegate duyệt ở gate A;
đặt dư vì APOS tính wall-clock từ lúc select — bài học DRAK GOAL-002).

Điểm xuất phát (GOAL-001..006, đã khóa — KHÔNG sửa):
`src/app.ts` (Express, EJS, session cookie, middleware `requireRole`/
`requireScope`, route người dùng/chi nhánh/audit log/sản phẩm/giá/CSV/kho/
đơn/thanh toán, hàm `createRefundTx` — logic hoàn tiền GOAL-006 ở dòng 435),
`src/rbac.ts` (helper `can()`, actions hiện tại: 10 actions người dùng +
8 actions sản phẩm/giá/CSV + 1 action xem giá riêng chi nhánh
(`view-branch-price`) + 11 actions kho + 6 actions đơn + 3 actions thanh
toán (`create-payment`/`refund-payment`/`view-payments`)), `src/db.ts`
(migration 001–011; chưa có bảng giao hàng/trả hàng nào), `src/seed.ts`
(1 org, 1 branch "Chi nhánh Chính", 2 user: owner + sales; 2 sản phẩm mẫu;
2 kho mẫu), `src/tenant.ts` (middleware scope org/branch), `src/idempotency.ts`
(helper `withIdempotency` — kiểm tra key ngoài transaction),
`src/orders.ts` (`transitionOrderTx`, mã đơn `DH-YYYYMMDD-NNNN`, state machine
draft → confirmed → processing → completed/cancelled),
`src/products.ts` (`effectivePrice()` fallback 8 bước),
`src/stock.ts` (`runStockTransaction`, `applyMovement`,
`withStockIdempotency` — kiểm tra key + thực thi + ghi key trong CÙNG MỘT
transaction), `src/payments.ts` (`computePaymentSummary` — đối soát tính ở
service từ bảng payments/refunds, không lưu cột tổng riêng),
`src/adapters/index.ts` (`FakePaymentAdapter` đã sửa D23;
`FakeShippingAdapter.quote(weightGrams, destination)` — deterministic,
`simulated: true`, phí `15000 + số chặng 500g × 5000`, ETA 1 ngày nếu đích
Hà Nội, 2 ngày còn lại, reference `FAKE-SHIP-<hash12>`; `FakeEmailAdapter`),
`tests/acceptance.test.ts` + `tests/rbac-acceptance.test.ts` +
`tests/products-acceptance.test.ts` + `tests/stock-acceptance.test.ts` +
`tests/orders-acceptance.test.ts` + `tests/orders-005a-acceptance.test.ts` +
`tests/payments-acceptance.test.ts` — tổng 208 test vitest xanh trên main
khi đóng GOAL-006 (gate xanh, đã chạy thật 27/11), KHÔNG sửa test cũ,
`scripts/check.sh` (CHK-1) + `scripts/demo.sh` (CHK-2) — goal này MỞ RỘNG
2 script, giữ các bước GOAL-001..006 xanh.

## Loại trừ R-20 (GOAL-004) có lý do

`apos inbox` đang có 1 notice `orphan-requirement`: yêu cầu R-20 của GOAL-004
(source `brief-004.md`, sha256
`a83e40111118d17ac74d1e1049134daca6958f7e46aa5126a7cf8b22f3884579`) đã defer
từ GOAL-004 sang GOAL-006 nhưng GOAL-006 đóng mà không adopt. Quyết định đã
chốt (parent, 27/11): **LOẠI TRỪ R-20 CÓ LÝ DO, KHÔNG adopt vào GOAL-007**.

R-20 nguyên văn (GOAL-004, `brief-004.md` dòng 333):

> Thanh toán/hoàn tiền (GOAL-006), giao hàng/trả hàng (GOAL-007), khuyến mãi
> (GOAL-009): không mã giảm giá, không đối soát kho–đơn–thanh toán, không trả
> hàng nhập lại kho.

Lý do loại trừ: R-20 gộp 3 phạm vi: thanh toán/hoàn tiền đã xong ở GOAL-006;
trả hàng nhập lại kho là yêu cầu riêng của GOAL-007 (requirement riêng trong
goal này); mã giảm giá là yêu cầu riêng của GOAL-009. Adopt cả R-20 vào
GOAL-007 sẽ nhận sai phạm vi (gồm khuyến mãi không thuộc goal này) nên loại
trừ có lý do.

Cơ chế APOS (đã xác minh từ source `src/domain/plan.ts` +
`plan.test.ts:215` "honours an explicit out-of-scope adoption in a new
brief"): một requirement entry trong brief mới với `adopts` trỏ đúng yêu cầu
gốc + disposition `excluded` + `exclusion: {kind: "out-of-scope"}` sẽ đưa
yêu cầu đó về trạng thái out-of-scope có lý do, xóa notice mồ côi.
`goal-007.json` khai entry này với `id` `"R-20"`, `adopts`
`{"sourceSha256":
"a83e40111118d17ac74d1e1049134daca6958f7e46aa5126a7cf8b22f3884579",
"requirementId": "R-20"}`, `disposition: "excluded"`, `exclusion:
{"kind": "out-of-scope"}`, `exclusionReason` như đoạn lý do ở trên,
`text` nguyên văn R-20, `sourceSpan` "dòng 333 (brief-004.md)". Entry này
KHÔNG nằm trong `acceptance[].requirementIds` của bất kỳ AC nào (nó là
excluded, không phải việc cần làm). Lưu ý như GOAL-005A: notice mồ côi chỉ
sạch sau khi goal adopt/loại trừ ĐÓNG — ngay sau `goal create`, `inbox` VẪN
còn notice, đó là trạng thái đúng, không phải lỗi.

## Kết quả mong muốn

Cuối goal, một nhân viên kho đăng nhập vào hệ thống có thể yêu cầu giao một
đơn đã hoàn tất cho đơn vị vận chuyển giả lập (có mã vận đơn, phí + ETA từ
adapter fake), cập nhật trạng thái giao lặp hay sai thứ tự mà không ghi nhận
sai (gửi lại cùng trạng thái không tạo thêm sự kiện, chuyển sai thứ tự bị
từ chối), một nhân viên bán hàng ghi nhận yêu cầu trả hàng của khách, quản
lý duyệt hoặc từ chối có lý do, kho nhận hàng trả và nhập lại kho đúng số
hàng bán lại được (hàng hỏng không nhập kho nhưng vẫn ghi nhận riêng), hoàn
tiền đúng số đã trả qua đúng đường hoàn tiền GOAL-006, đối soát sau trả
hiển thị đúng (paid_total đã trừ hoàn, tồn kho đã nhập lại), mọi thao tác
đều bị chặn đúng khi sai vai, sai chi nhánh/kho hoặc ngoài org, với audit
log + lịch sử giao/nhận đầy đủ để đối soát.

## Quyết định mô hình (Lead/Worker ghi vào DECISIONS.md làm D24, D25)

- **Giao hàng là dữ liệu cấp org, gắn với đơn.** Bảng `shipments` có
  `org_id`, `order_id` NOT NULL FK tới `orders`, `carrier` TEXT NOT NULL
  (tên đơn vị vận chuyển GIẢ LẬP do client gửi, ví dụ `"GHN-fake"` —
  không kết nối đơn vị thật, không tra cứu thật), `tracking_code` TEXT
  NOT NULL UNIQUE (mã vận đơn deterministic từ adapter, xem dưới),
  `destination` TEXT NOT NULL, `fee` INTEGER NOT NULL (đồng, từ adapter),
  `eta_days` INTEGER NOT NULL (từ adapter), `status` TEXT NOT NULL CHECK
  `IN ('requested','in_transit','delivered','failed')`, `created_at`/
  `updated_at`. Không có endpoint DELETE shipment.
- **Trạng thái giao hàng là state machine riêng, không động vào trạng thái
  đơn.** Chuyển cho phép: `requested → in_transit → delivered`;
  `requested`/`in_transit → failed` (thất bại là trạng thái cuối — muốn
  giao lại thì tạo shipment mới sau khi shipment cũ đã `failed` hoặc
  `delivered`). Mọi chuyển khác → 400, không đổi gì, không ghi event.
  Gửi lại cùng trạng thái hiện tại → 200, trả shipment hiện tại, KHÔNG
  tạo event mới, KHÔNG đổi gì (idempotent ở mức trạng thái). Chỉ đơn ở
  trạng thái `completed` mới được yêu cầu giao (hàng đã xuất kho ở
  GOAL-005 — đơn `draft`/`confirmed`/`processing`/`cancelled` → 400);
  mỗi đơn tối đa 1 shipment đang ở trạng thái chưa cuối (`requested`/
  `in_transit`) — yêu cầu thêm khi đã có shipment chưa cuối → 400.
  Giao hàng KHÔNG đổi trạng thái đơn GOAL-005 (đơn vẫn `completed`).
- **Lịch sử giao hàng append-only.** Bảng `shipment_events` chỉ INSERT,
  không có API UPDATE/DELETE: `shipment_id` FK tới `shipments`,
  `event_type` TEXT NOT NULL (`created`/`in_transit`/`delivered`/
  `failed`), `actor_id` FK tới `users`, `detail` TEXT NULL (JSON: carrier,
  tracking_code, fee, eta_days, lý do thất bại), `created_at`.
  `GET /api/orders/:id/shipments` trả shipments kèm `events` của từng
  shipment (shipments mới nhất trước; `events` theo thứ tự thời gian tăng
  dần — cũ nhất trước — như `order_events` ở D19; test theo đúng thứ tự
  đó).
- **Adapter fake: mã vận đơn deterministic + phí/ETA từ quote().**
  `FakeShippingAdapter.quote(weightGrams, destination)` đã có từ GOAL-001
  được dùng để lấy phí/ETA khi yêu cầu giao: khối lượng tính bằng tổng số
  lượng mặt hàng trong đơn × 500g mặc định (sản phẩm chưa có trường cân
  nặng — Lead ghi rõ lựa chọn này trong D24; không thêm trường cân nặng
  vào sản phẩm trong goal này). Lead mở rộng adapter thêm mã vận đơn
  deterministic (ví dụ phương thức `trackingRef(orderCode, carrier,
  shipmentId)` trả `FAKE-TRK-<hash12>`, cùng input → cùng mã), giữ
  `simulated: true`. Không kết nối đơn vị vận chuyển thật.
- **Trả hàng là dữ liệu cấp org, gắn với đơn.** Bảng `returns` có
  `org_id`, `order_id` NOT NULL FK tới `orders`, `code` TEXT NOT NULL
  UNIQUE trong org dạng `TH-YYYYMMDD-NNNN` (số thứ tự trong ngày theo từng
  org, tính trong cùng transaction tạo yêu cầu — như mã đơn `DH-...` ở
  D19), `reason` TEXT NOT NULL (lý do trả — bắt buộc), `status` TEXT NOT
  NULL CHECK `IN ('requested','approved','rejected','received',
  'refunded')`, `reviewed_by`/`received_by` FK tới `users` NULL cho tới
  khi tới bước đó, `review_reason` TEXT NULL (lý do duyệt/từ chối —
  từ chối bắt buộc có lý do), `created_at`/`updated_at`. Không có
  endpoint DELETE return.
- **Mặt hàng trả + tình trạng từng mặt hàng.** Bảng `return_items` có
  `return_id` NOT NULL FK tới `returns`, `variant_id` NOT NULL FK tới
  `product_variants`, `qty` INTEGER NOT NULL CHECK `> 0`,
  `condition` TEXT NOT NULL CHECK `IN ('resalable','damaged')` (bán lại
  được / hỏng), `unit_price` INTEGER NOT NULL (snapshot giá từ
  `order_items` tại thời điểm đặt — dùng để tính tiền hoàn, không tin
  client), `UNIQUE(return_id, variant_id)` — trùng biến thể trong cùng
  yêu cầu trả → 400, không gộp lặng lẽ. Chỉ đơn ở trạng thái `completed`
  mới được yêu cầu trả (đơn chưa hoàn tất/chưa giao → 400); biến thể phải
  thuộc đơn đó (không thuộc đơn → 400); tổng số lượng đã yêu cầu trả tích
  lũy của một biến thể (cộng mọi yêu cầu trả chưa bị từ chối của đơn đó)
  không được vượt số lượng đã đặt của biến thể đó (vượt → 400).
- **Vòng đời trả hàng.** `requested → approved → received → refunded`;
  `requested → rejected` (trạng thái cuối, bắt buộc có `review_reason`).
  Mọi chuyển khác → 400, không đổi gì, không ghi event. Duyệt/từ chối chỉ
  từ `requested`; nhận hàng chỉ từ `approved`; hoàn tiền chỉ từ
  `received`. Trả hàng KHÔNG đổi trạng thái đơn GOAL-005 (đơn vẫn
  `completed`).
- **Nhận hàng trả = nhập lại kho có chọn lọc, trong cùng transaction.**
  Khi chuyển `approved → received`: mặt hàng `resalable` được nhập lại
  kho của đơn bằng `applyMovement` loại `in` (`reference` = mã trả
  `TH-...`, `reason` ghi rõ nhập lại từ trả hàng), `on_hand` tăng đúng
  số đó, ghi 1 movement mỗi dòng bán lại được; mặt hàng `damaged` KHÔNG
  nhập kho, KHÔNG ghi movement — chỉ ghi nhận trong `return_items` +
  `return_events` (detail ghi rõ số lượng hỏng từng biến thể). Cả đổi
  trạng thái + nhập kho nằm trong CÙNG MỘT transaction `BEGIN IMMEDIATE`:
  bước nào lỗi thì rollback toàn bộ — không có trạng thái "đã nhận nhưng
  chưa nhập kho". Không thêm loại movement mới (dùng lại `in` của D17).
- **Hoàn tiền cho trả hàng dùng lại đường hoàn tiền GOAL-006, không viết
  lại logic hoàn.** Khi chuyển `received → refunded`: số tiền hoàn =
  tổng `unit_price × qty` trên mọi mặt hàng của yêu cầu trả (cả bán lại
  được lẫn hỏng — khách trả hàng thì được hoàn tiền bất kể tình trạng
  hàng), tính từ snapshot `order_items`, không tin client. Server hoàn
  tiền bằng đúng đường GOAL-006 (`createRefundTx` ở `src/app.ts` + bảng
  `refunds`, cùng các kiểm tra: tổng hoàn không vượt số đã trả — xem
  D22): hoàn vào các payment đã `paid` của đơn theo thứ tự cũ nhất trước
  cho tới đủ số tiền; mỗi lần hoàn là một bản ghi `refunds` riêng kèm
  `reason` là mã trả `TH-...`. Nếu số tiền hoàn vượt số còn hoàn được
  của đơn (đơn chưa trả đủ tiền, hoặc đã hoàn trước đó) → 400, không tạo
  refund nào, yêu cầu trả ở lại `received` (Lead ghi rõ trường hợp biên
  này trong D25). Thành công thì yêu cầu trả chuyển `refunded` trong cùng
  transaction với các refund. Hoàn tiền cho trả hàng KHÔNG đổi trạng thái
  đơn.
- **Lịch sử trả hàng append-only.** Bảng `return_events` chỉ INSERT,
  không có API UPDATE/DELETE: `return_id` FK tới `returns`, `event_type`
  TEXT NOT NULL (`created`/`approved`/`rejected`/`received`/`refunded`),
  `actor_id` FK tới `users`, `detail` TEXT NULL (JSON: lý do duyệt/từ
  chối, số lượng nhập lại kho từng biến thể, số lượng hỏng, số tiền hoàn,
  mã các refund đã tạo), `created_at`. `GET /api/orders/:id/returns` trả
  returns kèm `items` + `events` của từng yêu cầu trả (returns mới nhất
  trước; `events` theo thứ tự thời gian tăng dần — cũ nhất trước).
- **Đối chiếu đơn/thanh toán/kho sau khi trả.** Không thêm bảng tổng mới:
  đối soát dùng lại `computePaymentSummary` ở `src/payments.ts` (D22) —
  sau khi trả hàng + hoàn tiền, `GET /api/orders/:id/payments` phải hiển
  thị đúng: `paid_total` đã trừ tổng refund (gồm refund của trả hàng),
  `refunded_total` tăng đúng số tiền hoàn, `payment_status` chuyển đúng
  (ví dụ `paid → partially_refunded → refunded` khi hoàn đủ); tồn kho
  đọc qua `GET /api/stock/levels` phải hiển thị đúng: `on_hand` tăng
  đúng số hàng bán lại được đã nhập lại, hàng hỏng không làm tăng tồn.
  Test chứng minh cả 3 mặt (đơn–thanh toán–kho) khớp nhau sau một lượt
  trả đầy đủ.
- **Idempotency cho giao/trả, trong transaction.** Yêu cầu giao, cập nhật
  trạng thái giao, yêu cầu trả, duyệt/từ chối, nhận hàng, hoàn tiền trả
  hàng đều nhận `Idempotency-Key` (header) hoặc `idempotency_key` (body);
  server dùng `withStockIdempotency` (GOAL-004) — kiểm tra key + thực thi
  + ghi key trong CÙNG MỘT transaction `BEGIN IMMEDIATE` — vì các thao
  tác này động vào tồn kho/tổng đã trả nên KHÔNG dùng `withIdempotency`
  của GOAL-001 (kiểm tra ngoài transaction, có khe race — bài học
  GOAL-004/005/006). Tên miền key: `shipment:create:<key>`,
  `shipment:update:<key>`, `return:create:<key>`, `return:review:<key>`,
  `return:receive:<key>`, `return:refund:<key>`; gửi lại cùng key + cùng
  loại + cùng org → trả đúng response đã lưu kèm `replayed: true`, KHÔNG
  tạo shipment/return/movement/refund mới. Thiếu key thì vẫn thực thi
  (không bắt buộc) nhưng không có bảo vệ gửi lại.

## Ma trận quyền (giao hàng + trả hàng — bổ sung vào `docs/RBAC.md`)

Vai: `owner`, `manager`, `sales`, `warehouse`, `accountant` (GOAL-002).
Quy tắc chung (D4): mọi thao tác kiểm tra cả vai VÀ phạm vi; vai sai thao
tác → 403; đúng vai sai phạm vi → 403; ngoài org → 403. Helper `can()` mở
rộng thêm actions: `request-shipment`, `update-shipment`,
`view-shipments`, `request-return`, `review-return`, `receive-return`,
`refund-return`, `view-returns`. Phạm vi gate bằng `branchId` +
`warehouseId` của đơn (kiểu `Target` đã có).

| Thao tác | owner | manager | sales | warehouse | accountant |
|---|---|---|---|---|---|
| Yêu cầu giao (`POST /api/orders/:id/shipments`) | Được | Được | Không (403) | Được, chỉ đơn có `warehouse_id` trong phạm vi của mình | Không (403) |
| Cập nhật trạng thái giao (`POST /api/shipments/:id/status`) | Được | Được | Không (403) | Được, chỉ đơn có `warehouse_id` trong phạm vi của mình | Không (403) |
| Xem giao hàng (`GET /api/orders/:id/shipments`, `GET /api/shipments/:id`) | Được, toàn org | Được, toàn org | Được, chỉ đơn thuộc chi nhánh của mình | Được, chỉ đơn có `warehouse_id` trong phạm vi của mình | Được, toàn org (chỉ xem) |
| Yêu cầu trả (`POST /api/orders/:id/returns`) | Được | Được | Được (đơn thuộc chi nhánh của mình) | Không (403) | Không (403) |
| Duyệt/từ chối trả (`POST /api/returns/:id/approve`, `/reject`) | Được | Được | Không (403) | Không (403) | Không (403) |
| Nhận hàng trả (`POST /api/returns/:id/receive`) | Được | Được | Không (403) | Được, chỉ đơn có `warehouse_id` trong phạm vi của mình | Không (403) |
| Hoàn tiền trả hàng (`POST /api/returns/:id/refund`) | Được | Được | Không (403) | Không (403) | Được, toàn org |
| Xem trả hàng (`GET /api/orders/:id/returns`, `GET /api/returns/:id`) | Được, toàn org | Được, toàn org | Được, chỉ đơn thuộc chi nhánh của mình | Được, chỉ đơn có `warehouse_id` trong phạm vi của mình | Được, toàn org (chỉ xem) |

Ghi chú: `sales` xem shipment/return của đơn ngoài chi nhánh của mình →
403; `warehouse` không được yêu cầu trả hay hoàn tiền trả hàng dù đúng kho
→ 403; mọi vai xem shipment/return ngoài org → 403.

## Yêu cầu

1. Migration 012 tạo 5 bảng giao/trả (`shipments`, `shipment_events`,
   `returns`, `return_items`, `return_events`): `shipments` (`org_id` NOT
   NULL FK tới `orgs`, `order_id` NOT NULL FK tới `orders`, `carrier` TEXT
   NOT NULL, `tracking_code` TEXT NOT NULL UNIQUE, `destination` TEXT NOT
   NULL, `fee` INTEGER NOT NULL CHECK `>= 0` (đồng — D10), `eta_days`
   INTEGER NOT NULL CHECK `> 0`, `status` TEXT NOT NULL DEFAULT
   `'requested'` CHECK `IN ('requested','in_transit','delivered',
   'failed')`, `created_at`/`updated_at`); `shipment_events` append-only
   (`shipment_id` NOT NULL FK tới `shipments`, `event_type` TEXT NOT NULL,
   `actor_id` FK tới `users`, `detail` TEXT NULL, `created_at`);
   `returns` (`org_id` NOT NULL FK tới `orgs`, `order_id` NOT NULL FK tới
   `orders`, `code` TEXT NOT NULL UNIQUE trong org dạng `TH-YYYYMMDD-NNNN`,
   `reason` TEXT NOT NULL, `status` TEXT NOT NULL DEFAULT `'requested'`
   CHECK `IN ('requested','approved','rejected','received','refunded')`,
   `reviewed_by`/`received_by` FK tới `users` NULL cho tới khi tới bước đó,
   `review_reason` TEXT NULL, `created_at`/`updated_at`); `return_items`
   (`return_id` NOT NULL FK tới `returns`, `variant_id` NOT NULL FK tới
   `product_variants`, `qty` INTEGER NOT NULL CHECK `> 0`, `condition`
   TEXT NOT NULL CHECK `IN ('resalable','damaged')`, `unit_price` INTEGER
   NOT NULL CHECK `>= 0` — snapshot từ `order_items`, `UNIQUE(return_id,
   variant_id)`); `return_events` append-only (`return_id` NOT NULL FK tới
   `returns`, `event_type` TEXT NOT NULL, `actor_id` FK tới `users`,
   `detail` TEXT NULL, `created_at`). Lịch sử chỉ INSERT, không có API
   UPDATE/DELETE (gọi sửa/xóa → 404/405). Migration chạy tuần tự sau
   001–011, giữ dữ liệu cũ, không vỡ 208 test đã khóa. Không có endpoint
   DELETE shipment/return.

2. API yêu cầu giao hàng: `POST /api/orders/:id/shipments` nhận `{carrier,
   destination, idempotency_key?}` — `carrier`/`destination` trống → 400;
   đơn không tồn tại → 404, ngoài org → 403; đơn chưa `completed` → 400;
   đơn đã có shipment chưa cuối (`requested`/`in_transit`) → 400; thành
   công → 201, shipment `requested` với `fee`/`eta_days` từ
   `FakeShippingAdapter.quote()` (khối lượng = tổng số lượng mặt hàng ×
   500g) + `tracking_code` deterministic từ adapter đã mở rộng, ghi 1
   event `created` + 1 audit log, trả shipment kèm `events` (mới tạo).

3. API cập nhật trạng thái giao hàng: `POST /api/shipments/:id/status`
   nhận `{status: 'in_transit' | 'delivered' | 'failed', reason?,
   idempotency_key?}` — `status` lạ → 400; shipment không tồn tại → 404,
   ngoài org → 403; chuyển sai thứ tự (ví dụ `requested → delivered`,
   `delivered → in_transit`, bất kỳ chuyển nào từ `delivered`/`failed`)
   → 400, không đổi gì, không ghi event; gửi lại cùng trạng thái hiện
   tại → 200, trả shipment hiện tại, KHÔNG tạo event mới, KHÔNG đổi gì;
   thành công → 200, shipment đổi trạng thái + event tương ứng +
   audit log. `failed` bắt buộc có `reason` (lý do giao thất bại).

4. API yêu cầu trả hàng: `POST /api/orders/:id/returns` nhận `{items:
   [{variant_id, qty, condition: 'resalable' | 'damaged'}], reason,
   idempotency_key?}` — `reason` trống → 400; `items` rỗng → 400; đơn
   không tồn tại → 404, ngoài org → 403; đơn chưa `completed` → 400;
   biến thể không thuộc đơn → 400; `qty` không nguyên hoặc <= 0 → 400;
   `condition` lạ → 400; trùng biến thể trong cùng yêu cầu → 400; tổng
   số lượng đã yêu cầu trả tích lũy của một biến thể (cộng mọi yêu cầu
   trả chưa bị từ chối của đơn đó) vượt số lượng đã đặt → 400; thành
   công → 201, return `requested` với mã `TH-YYYYMMDD-NNNN`, `unit_price`
   snapshot từ `order_items` (không tin client), ghi 1 event `created` +
   1 audit log, trả return kèm `items` + `events` (mới tạo).

5. API duyệt/từ chối trả hàng: `POST /api/returns/:id/approve` và
   `POST /api/returns/:id/reject` nhận `{reason?, idempotency_key?}` —
   return không tồn tại → 404, ngoài org → 403; chỉ duyệt/từ chối từ
   `requested` (trạng thái khác → 400, không đổi gì); từ chối bắt buộc có
   `reason` (trống → 400); thành công → 200, return đổi `approved` hoặc
   `rejected` + ghi `reviewed_by`/`review_reason` + event tương ứng +
   audit log.

6. API nhận hàng trả + nhập lại kho: `POST /api/returns/:id/receive`
   nhận `{idempotency_key?}` — return không tồn tại → 404, ngoài org →
   403; chỉ nhận từ `approved` (trạng thái khác → 400); thành công →
   200, trong CÙNG MỘT transaction `BEGIN IMMEDIATE`: return đổi
   `received` + ghi `received_by` + event `received`, mặt hàng
   `resalable` nhập lại kho của đơn bằng `applyMovement` loại `in`
   (`reference` = mã trả `TH-...`, `reason` ghi rõ nhập lại từ trả
   hàng) — `on_hand` tăng đúng số đó, 1 movement mỗi dòng bán lại được;
   mặt hàng `damaged` KHÔNG nhập kho, KHÔNG ghi movement — chỉ ghi nhận
   trong `return_items` + event detail (số lượng hỏng từng biến thể).
   Bước nào lỗi thì rollback toàn bộ. Không thêm loại movement mới.

7. API hoàn tiền trả hàng: `POST /api/returns/:id/refund` nhận
   `{idempotency_key?}` — return không tồn tại → 404, ngoài org → 403;
   chỉ hoàn từ `received` (trạng thái khác → 400); số tiền hoàn = tổng
   `unit_price × qty` trên mọi mặt hàng của yêu cầu trả (cả bán lại được
   lẫn hỏng), tính từ snapshot `order_items`; server hoàn bằng đúng đường
   GOAL-006 (`createRefundTx` + bảng `refunds`, cùng kiểm tra tổng hoàn
   không vượt số đã trả): hoàn vào các payment đã `paid` của đơn theo
   thứ tự cũ nhất trước cho tới đủ số tiền, mỗi lần hoàn là một bản ghi
   `refunds` riêng với `reason` là mã trả `TH-...`; số tiền hoàn vượt số
   còn hoàn được của đơn → 400, không tạo refund nào, return ở lại
   `received`; thành công → 200, return đổi `refunded` trong cùng
   transaction với các refund, ghi event `refunded` (detail: số tiền
   hoàn, mã các refund đã tạo) + audit log, trả return kèm refunds đã
   tạo + `order_summary` đối soát.

8. API đọc + đối chiếu sau trả: `GET /api/orders/:id/shipments` trả danh
   sách shipment của đơn (mới nhất trước, kèm `events` từng shipment) +
   `GET /api/shipments/:id` trả 1 shipment kèm events;
   `GET /api/orders/:id/returns` trả danh sách return của đơn (mới nhất
   trước, kèm `items` + `events` từng return) + `GET /api/returns/:id`
   trả 1 return kèm items + events. Mọi API đọc lọc theo org + phạm vi
   vai (sales chỉ chi nhánh mình, warehouse chỉ kho được gán — xem ma
   trận); ngoài org → 403; đơn/shipment/return không tồn tại → 404.
   Đối chiếu: sau một lượt trả đầy đủ (nhận + hoàn), `GET
   /api/orders/:id/payments` (GOAL-006) phải hiển thị đúng
   `paid_total` đã trừ tổng refund gồm refund của trả hàng,
   `refunded_total` tăng đúng số tiền hoàn, `payment_status` chuyển
   đúng; `GET /api/stock/levels` phải hiển thị đúng `on_hand` tăng
   đúng số hàng bán lại được đã nhập lại, hàng hỏng không làm tăng tồn
   (test chứng minh cả 3 mặt đơn–thanh toán–kho khớp nhau).

9. Idempotency cho giao/trả: yêu cầu giao, cập nhật trạng thái giao, yêu
    cầu trả, duyệt/từ chối, nhận hàng, hoàn tiền trả hàng đều nhận
    `Idempotency-Key` (header) hoặc `idempotency_key` (body); server dùng
    `withStockIdempotency` (GOAL-004) với tên miền key
    `shipment:create:<key>` / `shipment:update:<key>` /
    `return:create:<key>` / `return:review:<key>` /
    `return:receive:<key>` / `return:refund:<key>`; gửi lại cùng key +
    cùng loại + cùng org → trả đúng response đã lưu kèm `replayed: true`,
    KHÔNG tạo shipment/return/movement/refund mới (số shipment, số
    return, tồn kho, tổng đã trả, tổng hoàn không đổi — test chứng minh).
    Key khác nhau thì thực thi bình thường. Thiếu key thì vẫn thực thi
    (không bắt buộc) nhưng không có bảo vệ gửi lại.

10. Chống ghi nhận 2 lần: mọi tạo shipment/return, mọi chuyển trạng thái
    giao/trả, mọi nhận hàng + hoàn tiền trả hàng đều trong `BEGIN
    IMMEDIATE` + `UNIQUE(tracking_code)` / `UNIQUE(code)` ở DB; test
    chứng minh: gửi đồng thời 2 yêu cầu giao cùng đơn → chỉ 1 shipment
    được tạo, lần còn lại 400; cập nhật trạng thái giao đồng thời
    (`in_transit` rồi `delivered`) không ghi nhận sai thứ tự; nhận hàng
    trả đồng thời 2 lần → chỉ 1 lần nhập kho, lần còn lại 400 hoặc
    `replayed: true`; hoàn tiền trả hàng đồng thời 2 lần → chỉ 1 lần
    tạo refund, lần còn lại 400 hoặc `replayed: true`. Lưu ý như
    GOAL-004/005/006: app một tiến trình (D1), bảo vệ race chỉ có ý nghĩa
    trong một process; đa process ngoài phạm vi, ghi rõ trong
    DECISIONS.md.

11. RBAC giao/trả: mở rộng helper `can()` ở `src/rbac.ts` thêm actions
    `request-shipment`, `update-shipment`, `view-shipments`,
    `request-return`, `review-return`, `receive-return`, `refund-return`,
    `view-returns` theo đúng ma trận ở trên; mọi endpoint giao/trả qua
    `requireRole` + `can()` (vai sai → 403, ngoài org → 403, sai chi
    nhánh/kho → 403). Test chứng minh từng ô cấm trong ma trận (ít nhất:
    sales yêu cầu giao → 403, accountant cập nhật trạng thái giao → 403,
    warehouse yêu cầu trả → 403, sales duyệt trả → 403, sales hoàn tiền
    trả hàng → 403, warehouse nhận hàng trả ngoài kho được gán → 403,
    sales xem shipment/return đơn ngoài chi nhánh → 403, user org A đọc
    shipment/return org B → 403).

12. Audit log cho giao/trả: ghi vào `audit_log` đã có MỌI thao tác yêu cầu
    giao, cập nhật trạng thái giao, yêu cầu trả, duyệt/từ chối, nhận
    hàng, hoàn tiền trả hàng; mỗi bản ghi có `user_id` người thực hiện,
    `created_at`, `action` + `detail` JSON (`target_order_id`,
    `order_code`, `target_shipment_id`/`target_return_id`, `tracking_code`/
    `return_code`, `from_status`/`to_status`, KHÔNG chứa dữ liệu nhạy
    cảm, KHÔNG chứa thông tin thẻ); xem log theo luật GOAL-002
    (`GET /api/audit-log`: `owner` toàn org, `manager` trong phạm vi,
    các vai khác → 403). `shipment_events`/`return_events` là lịch sử chi
    tiết; `audit_log` là lớp ghi nhận thao tác nhạy cảm theo chuẩn
    GOAL-002 — cả hai đều phải có, không thay nhau. Lịch sử giao/trả:
    `shipment_events`/`return_events` ghi đủ mọi lần tạo/chuyển trạng
    thái (kể cả lần gửi lại cùng trạng thái thì KHÔNG ghi event mới —
    xem yêu cầu 3); test: yêu cầu giao → in_transit → delivered +
    yêu cầu trả → duyệt → nhận → hoàn: events đúng thứ tự thời gian
    tăng dần (cũ nhất trước), đủ các bước, không có event thừa.

13. Test mới (vitest + supertest, thêm vào file test mới — KHÔNG sửa 208
    test đã khóa của GOAL-001..006): chứng minh yêu cầu giao chỉ cho đơn
    `completed` (đơn chưa hoàn tất → 400), phí/ETA từ adapter fake + mã
    vận đơn deterministic duy nhất, cập nhật trạng thái lặp cùng trạng
    thái không tạo event mới, cập nhật sai thứ tự → 400 không đổi gì,
    giao thất bại là trạng thái cuối, yêu cầu trả chỉ cho đơn `completed`
    + đúng biến thể trong đơn + không vượt số đã đặt tích lũy, duyệt/từ
    chối đúng luật (từ chối thiếu lý do → 400, duyệt từ trạng thái khác
    → 400), nhận hàng nhập lại kho đúng số bán lại được + hàng hỏng
    không nhập kho (tồn không đổi), hoàn tiền trả hàng đúng số từ
    snapshot giá + dùng đường GOAL-006 (hoàn vượt số còn hoàn được →
    400), đối chiếu sau trả đúng cả 3 mặt (paid_total/refunded_total/
    payment_status + on_hand), idempotency (gửi lại cùng key →
    `replayed: true`, không tạo mới), race (yêu cầu giao/nhận/hoàn đồng
    thời → chỉ 1 lần thực thi), RBAC 403 theo ma trận (yêu cầu 11).
    Test dùng dữ liệu giả lập (2 org, 2 đơn trở lên trong cùng org).

14. Dữ liệu GIẢ LẬP hoàn toàn; mật khẩu seed + secret qua biến môi trường
    (như GOAL-001..006: `OMNIFLOW_SEED_*_PASSWORD`), không commit
    credential thật; `check.sh` vẫn quét secret (grep như GOAL-001); seed
    KHÔNG cần thêm shipment/return mẫu (demo tự tạo) — nhưng giữ nguyên
    2 user, 2 sản phẩm, 2 kho + mức tồn mẫu để test khóa vẫn xanh.

15. `scripts/check.sh` (CHK-1) và `scripts/demo.sh` (CHK-2) được MỞ RỘNG
    trong goal này: thêm bước giao/trả vào smoke/demo (tạo đơn → xác
    nhận → xử lý → hoàn tất → thu tiền → yêu cầu giao → cập nhật
    in_transit → cập nhật lặp cùng trạng thái không tạo event → cập nhật
    sai thứ tự 400 → delivered → yêu cầu trả (1 bán lại được + 1 hỏng)
    → duyệt → nhận (tồn tăng đúng số bán lại được, hàng hỏng không nhập
    kho) → hoàn tiền → đối soát đúng số (paid_total trừ refund, tồn đã
    nhập lại) → idempotency gửi lại không tạo mới → RBAC 403: sales yêu
    cầu giao, warehouse yêu cầu trả, sales duyệt trả), giữ tất cả bước
    GOAL-001..006 xanh (health, login, owner-only, idempotency,
    backup/restore, RBAC người dùng, sản phẩm/giá/CSV, kho, đơn, thanh
    toán). Cả 2 script tự chạy được, tự dọn dẹp, in PASS/FAIL từng bước.
    Docs: `docs/RBAC.md` bổ sung ma trận giao hàng + trả hàng (bảng ở
    trên) + mô hình phạm vi (theo chi nhánh/kho của đơn);
    `docs/DECISIONS.md` thêm D24 (mô hình giao hàng: state machine
    shipment, adapter mở rộng mã vận đơn deterministic, khối lượng mặc
    định tổng số lượng × 500g, chỉ giao đơn completed, 1 shipment chưa
    cuối mỗi đơn) và D25 (mô hình trả hàng: vòng đời return, nhập lại kho
    có chọn lọc trong cùng transaction, hoàn tiền dùng lại đường GOAL-006
    + hoàn vào payment cũ nhất trước, trường hợp biên hoàn vượt số còn
    hoàn được → 400); `README.md`/`docs/SETUP.md` cập nhật endpoint
    giao/trả, khớp lệnh đã chạy thật. Không có file
    `.github/workflows/` trong repo (gh token thiếu scope `workflow` —
    CI là follow-up sau khi user cấp scope). Không claim VPS, không claim
    deploy production (local-only, D9).

## Ngoài phạm vi (thuộc goal sau, không làm trong GOAL-007)

16. Khuyến mãi (GOAL-009): không mã giảm giá — số tiền hoàn chỉ đối soát
    với tổng đơn GOAL-005 đã snapshot, không áp giảm giá khi trả hàng.

17. Báo cáo/đối soát tổng hợp (GOAL-010): không tổng hợp doanh thu theo
    thời gian, không đối soát lô (chỉ đối chiếu từng đơn sau trả — yêu
    cầu 8).

18. Khách hàng + CRM (GOAL-008): không có bảng khách hàng, không lịch sử
    giao/trả theo khách; thông báo (GOAL-011): không gửi email khi giao
    hàng/trả hàng (chỉ audit log + lịch sử giao/trả); UI tổng quan
    (GOAL-012): không thêm màn hình giao/trả.

19. Đơn vị vận chuyển thật / giao hàng thật, tài khoản hãng vận chuyển —
    ngoài phạm vi vĩnh viễn của dự án giả lập này; deploy production/VPS
    (ngoài phạm vi, local-only), CI workflow (chờ user cấp scope
    `workflow`).

## Rủi ro / phụ thuộc

- **Phụ thuộc GOAL-005 + GOAL-006:** cần đơn hàng + state machine +
  `transitionOrderTx` + mã đơn + RBAC đơn + `audit_log` (GOAL-005) và
  thanh toán + `createRefundTx` + `computePaymentSummary` + RBAC hoàn
  tiền (GOAL-006). Nếu GOAL-005/006 chưa close thì không select GOAL-007.
- **Rủi ro ghi nhận sai trạng thái giao (quan trọng nhất):** cập nhật giao
  hàng lặp/sai thứ tự là hành vi bình thường của hãng vận chuyển — chỉ
  chống bằng kiểm tra trạng thái hiện tại trong cùng transaction
  `BEGIN IMMEDIATE` + gửi lại cùng trạng thái là no-op không ghi event
  thì mới không ghi nhận sai. Test cập nhật lặp + sai thứ tự là bắt buộc,
  không được bỏ.
- **Rủi ro nhập lại kho 2 lần khi nhận hàng trả:** nhận hàng đồng thời 2
  lần sẽ nhập kho 2 lần nếu không khóa bằng trạng thái + idempotency
  trong transaction — bắt buộc kiểm tra `approved` + ghi key trong cùng
  `BEGIN IMMEDIATE` rồi mới nhập kho; test nhận đồng thời phải chứng minh
  chỉ 1 lần nhập kho.
- **Rủi ro hoàn tiền trả hàng viết lại logic hoàn:** đường hoàn GOAL-006
  đã khóa tổng hoàn không vượt số đã trả — viết lại sẽ lệch. Bắt buộc
  dùng lại `createRefundTx` + bảng `refunds`; test hoàn vượt số còn hoàn
  được → 400 phải chứng minh đường dùng lại vẫn giữ bất biến.
- **Rủi ro trả vượt số đã đặt:** tổng trả tích lũy theo biến thể phải
  tính cả mọi yêu cầu trả chưa bị từ chối (kể cả yêu cầu đang chờ duyệt),
  không chỉ yêu cầu đã nhận — nếu chỉ tính yêu cầu đã nhận thì 2 yêu cầu
  chờ duyệt cùng vượt số đặt sẽ cùng lọt. Test phải có case 2 yêu cầu trả
  gộp vượt số đặt → yêu cầu thứ hai 400.
- **Rủi ro đối soát sai sau trả:** `paid_total` phải trừ refund của trả
  hàng (đã có ở D22 — `computePaymentSummary` tính từ bảng
  payments/refunds nên refund của trả hàng tự vào đối soát nếu dùng đúng
  đường GOAL-006); test đối chiếu sau trả phải đọc cả payments summary
  lẫn stock levels, không chỉ đọc return.
- **Rủi ro race trong test:** test đồng thời chạy trên một process Node +
  SQLite đồng bộ — các yêu cầu được xếp hàng ở event loop nên "đồng thời"
  ở đây là đồng thời ở mức HTTP, không phải đa process; test chứng minh
  bất biến (chỉ 1 shipment/1 lần nhập kho/1 lần hoàn) chứ không chứng
  minh được khả năng chống race đa process (ngoài phạm vi, ghi rõ trong
  DECISIONS.md).
- **Rủi ro mã vận đơn trùng:** `tracking_code` phải deterministic nhưng
  duy nhất theo shipment (digest theo mã đơn + carrier + shipment id,
  không chỉ theo số tiền/đích như `FAKE-SHIP` cũ) — nếu Lead quên đưa
  shipment id vào digest thì 2 lần giao cùng đơn cùng carrier sẽ trùng
  mã và `UNIQUE(tracking_code)` chặn nhầm lần giao thứ hai sau khi
  shipment đầu đã `failed`/`delivered`.

## Ghi chú rà soát của PM (27/11/2026 — trước khi tạo Goal)

PM đã đối chiếu brief với code trên main @ be70eef (GOAL-001..006 đã đóng,
vitest chạy thật 208 test xanh) + `docs/ROADMAP.md` (dòng GOAL-007) +
`docs/DECISIONS.md` (D1–D23) + `src/adapters/index.ts`,
`src/orders.ts`, `src/stock.ts`, `src/payments.ts`, `src/rbac.ts`,
`src/app.ts` (dòng 435 `createRefundTx`), `src/db.ts` (migration 001–011),
`docs/RBAC.md`. Những điểm sau đã CHỐT trong brief (Lead ghi vào D24/D25,
không mở lại):

1. **Chỉ giao đơn `completed`:** hàng chỉ giao sau khi đã xuất kho ở
   GOAL-005; đơn chưa hoàn tất không giao được — tránh giao hàng chưa
   xuất kho.
2. **Trạng thái giao lặp là no-op, sai thứ tự là 400:** gửi lại cùng trạng
   thái → 200, không tạo event mới (khác webhook GOAL-006 ghi event cả
   bản trùng — ở đây shipment không có "bản trùng từ bên ngoài" mà là
   cập nhật lặp, nên no-op là đúng); chuyển sai thứ tự → 400, không đổi
   gì, không ghi event.
3. **Khối lượng giao mặc định:** tổng số lượng mặt hàng × 500g (sản phẩm
   chưa có trường cân nặng; không thêm trường cân nặng trong goal này).
4. **Hoàn tiền trả hàng tính cả hàng hỏng:** khách trả hàng thì được hoàn
   tiền bất kể tình trạng hàng (hỏng vẫn hoàn, chỉ khác ở chỗ không nhập
   kho) — tránh hiểu lầm "hàng hỏng thì không hoàn".
5. **Tổng trả tích lũy tính cả yêu cầu chờ duyệt:** mọi yêu cầu trả chưa
   bị từ chối đều tính vào tổng đã trả của biến thể — tránh 2 yêu cầu chờ
   duyệt cùng vượt số đặt.

Đã KIỂM CHỨNG đúng, không sửa: `FakeShippingAdapter.quote(weightGrams,
destination)` deterministic, phí/ETA theo công thức GOAL-001, chưa có mã
vận đơn riêng (Lead mở rộng); `createRefundTx` nằm ở `src/app.ts:435`
(logic hoàn GOAL-006 — đường dùng lại cho hoàn tiền trả hàng, không nằm
ở `src/payments.ts`); `computePaymentSummary` ở `src/payments.ts` tính
đối soát từ payments/refunds (refund của trả hàng tự vào đối soát nếu
dùng đúng đường GOAL-006); `transitionOrderTx` + state machine đơn
draft → confirmed → processing → completed/cancelled; `withStockIdempotency`
kiểm tra + thực thi + ghi key trong cùng transaction `BEGIN IMMEDIATE`;
seed 1 org, 1 chi nhánh, 2 user (owner + sales), 2 sản phẩm, 2 kho;
migration 001–011, chưa có bảng giao/trả nào; 208 test vitest xanh trên
main; inbox có notice orphan R-20 của GOAL-004 (đã xử lý loại trừ có lý
do trong mục riêng ở trên, `goal-007.json` khai entry R-20 excluded).
