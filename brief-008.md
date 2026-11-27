# OmniFlow — brief GOAL-008: Khách hàng + CRM

## Bối cảnh (vấn đề)

OmniFlow là hệ thống vận hành thương mại đa kênh cho doanh nghiệp vừa (nhiều
doanh nghiệp, nhiều chi nhánh, nhiều kho, nhiều kênh bán), dự án dài hạn để kiểm
tra APOS ở quy mô lớn. Roadmap: `docs/ROADMAP.md` (12 Goal + GOAL-005A đã
đóng). Quyết định kiến trúc: `docs/DECISIONS.md` (D1–D25).

GOAL-008 xây nghiệp vụ khách hàng + CRM trên nền GOAL-001 (đã CLOSED) +
GOAL-002 (RBAC, đã CLOSED) + GOAL-003 (sản phẩm/giá, đã CLOSED) + GOAL-004
(kho, đã CLOSED) + GOAL-005 (đơn hàng, đã CLOSED) + GOAL-005A (adopt R-19,
đã CLOSED) + GOAL-006 (thanh toán + hoàn tiền, đã CLOSED) + GOAL-007 (giao
hàng + trả hàng, đã CLOSED): hồ sơ khách hàng + địa chỉ + lịch sử mua hàng;
điểm tích lũy chỉ khi đơn hoàn tất và đổi điểm trừ tiền đơn mới; ghi chú chăm
sóc; phân khúc khách tính ở service; tìm kiếm/lọc khách; hợp nhất hồ sơ trùng
có xác nhận; chính sách truy cập/xuất/xóa dữ liệu cá nhân (không đưa PII nhạy
cảm vào log). Phụ thuộc: GOAL-005 (và qua đó GOAL-001..GOAL-004). Không làm
khuyến mãi (GOAL-009), báo cáo tổng hợp (GOAL-010), thông báo (GOAL-011), UI
tổng quan (GOAL-012) trong goal này. Dữ liệu GIẢ LẬP hoàn toàn; không tiền
thật, không tài khoản thanh toán thật, không dịch vụ trả phí.
Dự án chỉ làm LOCAL — không có VPS trong phạm vi (user xác nhận 26/11 21:49).

Đề xuất: size M, appetite 480 phút, 3 lần thử (Human delegate duyệt ở gate A;
đặt dư vì APOS tính wall-clock từ lúc select — bài học DRAK GOAL-002).
Solo WP-MAIN: quy mô M vừa, toàn bộ thay đổi nằm trong một gói duy nhất
(schema + service + routes + test + scripts + docs), không có ranh giới gói
độc lập để tách multi-WP; mỗi acceptance criterion thuộc đúng một package
(WP-MAIN).

Điểm xuất phát (GOAL-001..007, đã khóa — KHÔNG sửa):
`src/app.ts` (Express, EJS, session cookie, middleware `requireRole`/
`requireScope`, route người dùng/chi nhánh/audit log/sản phẩm/giá/CSV/kho/
đơn/thanh toán/giao-trả), `src/rbac.ts` (helper `can()`, actions hiện tại:
10 actions người dùng + 8 actions sản phẩm/giá/CSV + 1 action xem giá riêng
chi nhánh (`view-branch-price`) + 11 actions kho + 6 actions đơn + 3 actions
thanh toán + 8 actions giao/trả), `src/db.ts` (migration 001–012; chưa có
bảng khách hàng nào), `src/seed.ts` (1 org, 1 branch "Chi nhánh Chính",
2 user: owner + sales; 2 sản phẩm mẫu; 2 kho mẫu), `src/tenant.ts`
(middleware scope org/branch), `src/idempotency.ts` (helper
`withIdempotency` — kiểm tra key ngoài transaction), `src/orders.ts`
(`transitionOrderTx`, mã đơn `DH-YYYYMMDD-NNNN`, state machine
draft → confirmed → processing → completed/cancelled, `customer_name`
chuỗi tự do — CHƯA có `customer_id`), `src/products.ts`
(`effectivePrice()` fallback 8 bước), `src/stock.ts`
(`runStockTransaction`, `applyMovement`, `withStockIdempotency` — kiểm tra
key + thực thi + ghi key trong CÙNG MỘT transaction), `src/payments.ts`
(`computePaymentSummary` — đối soát tính ở service từ bảng
payments/refunds, không lưu cột tổng riêng; lưu ý `partially_refunded`
chỉ khi đơn có yêu cầu trả đã hoàn tiền, còn hoàn trực tiếp một phần giữ
`partially_paid` theo test khóa GOAL-006 — xem D25),
`tests/acceptance.test.ts` + `tests/rbac-acceptance.test.ts` +
`tests/products-acceptance.test.ts` + `tests/stock-acceptance.test.ts` +
`tests/orders-acceptance.test.ts` + `tests/orders-005a-acceptance.test.ts` +
`tests/payments-acceptance.test.ts` +
`tests/shipments-returns-acceptance.test.ts` — tổng 244 test vitest xanh
trên main khi đóng GOAL-007 (gate xanh, đã chạy thật 27/11), KHÔNG sửa
test cũ, `scripts/check.sh` (CHK-1) + `scripts/demo.sh` (CHK-2) — goal này
MỞ RỘNG 2 script, giữ các bước GOAL-001..007 xanh.

## Loại trừ R-16 (GOAL-006) có lý do

`apos inbox` đang có 1 notice `orphan-requirement`: yêu cầu R-16 của GOAL-006
(source `brief-006.md`, sha256
`d3721a8812fccf7a526b1aebe77d2422a5001c1990065724601563c638fc6eb1`) đã defer
từ GOAL-006 sang GOAL-007 nhưng GOAL-007 đóng mà không adopt. Quyết định đã
chốt (parent, 27/11): **LOẠI TRỪ R-16 CÓ LÝ DO, KHÔNG adopt vào GOAL-008**.

R-16 nguyên văn (GOAL-006, `brief-006.md` dòng 324–326):

> Giao hàng/trả hàng (GOAL-007): không yêu cầu giao, không gán đơn vị vận
> chuyển, không trả hàng nhập lại kho — hoàn tiền ở đây chỉ là trả lại tiền,
> chưa phải xử lý hàng trả.

Lý do loại trừ: toàn bộ phạm vi giao/trả của R-16 đã được sở hữu bởi
requirements riêng R-1..R-15 của GOAL-007 (đã implement + kiểm chứng đầy đủ,
gate xanh, check/demo xanh); deferral gộp này giờ là thừa, không còn yêu cầu
nào chưa được sở hữu. Adopt R-16 vào GOAL-008 sẽ nhận sai phạm vi (GOAL-008
là khách hàng + CRM, không phải giao/trả) nên loại trừ có lý do.

Cơ chế APOS (đã chứng minh ở GOAL-007 cho R-20): một requirement entry
trong brief mới với `adopts` trỏ đúng yêu cầu gốc + disposition `excluded`
+ `exclusion: {kind: "out-of-scope"}` sẽ đưa yêu cầu đó về trạng thái
out-of-scope có lý do, xóa notice mồ côi. `goal-008.json` khai entry này
với `id` `"R-16"`, `adopts` `{"sourceSha256":
"d3721a8812fccf7a526b1aebe77d2422a5001c1990065724601563c638fc6eb1",
"requirementId": "R-16"}`, `disposition: "excluded"`, `exclusion:
{"kind": "out-of-scope"}`, `exclusionReason` như đoạn lý do ở trên,
`text` nguyên văn R-16. Entry này KHÔNG nằm trong
`acceptance[].requirementIds` của bất kỳ AC nào (nó là excluded, không
phải việc cần làm). Sau `goal create`, `apos plan` phải hiển thị R-16
out-of-scope và `apos inbox` phải HẾT notice R-16 (ở GOAL-007, notice
R-20 sạch ngay từ lúc `goal create` — đó là hành vi đúng của cơ chế loại
trừ); nếu inbox vẫn còn notice R-16 thì đó là lỗi cần điều tra, không
được giấu.

## Loại trừ R-17 (GOAL-006) có lý do

Khi rà soát `apos plan`, phát hiện thêm yêu cầu R-17 của GOAL-006 (source
`brief-006.md`, sha256
`d3721a8812fccf7a526b1aebe77d2422a5001c1990065724601563c638fc6eb1`) đang ở
trạng thái `deferred` sang GOAL-008. Nếu GOAL-008 đóng mà không adopt hay
loại trừ nó, R-17 sẽ thành notice mồ côi ở inbox giống hệt R-16/R-20
trước đây. Quyết định (coordinator, 27/11, theo đúng pattern R-16/R-20):
**LOẠI TRỪ R-17 CÓ LÝ DO, KHÔNG adopt vào GOAL-008**.

R-17 nguyên văn (GOAL-006, `brief-006.md` dòng 327–328):

> Khách hàng + CRM (GOAL-008): không có bảng khách hàng, không lưu phương
> thức thanh toán của khách, không lịch sử thanh toán theo khách.

Lý do loại trừ: R-17 chỉ là câu phủ định phạm vi của GOAL-006 (nói GOAL-006
không làm CRM), không phải một yêu cầu dương cần implement. Toàn bộ phạm vi
CRM mà nó nhắc tới đã được sở hữu bởi requirements riêng R-1..R-15 của
GOAL-008 (hồ sơ khách, lịch sử mua, điểm, ghi chú, phân khúc); không còn
yêu cầu nào chưa được sở hữu. Adopt R-17 vào GOAL-008 sẽ nhận sai phạm vi
(nhận một câu phủ định làm tiêu chí) nên loại trừ có lý do.

Cơ chế APOS như R-16 ở trên. `goal-008.json` khai entry này với `id`
`"R-22"` (không dùng `"R-17"` vì GOAL-008 đã có requirement riêng mang id
R-17 — khuyến mãi defer sang GOAL-009; key của entry adopt là
`sourceSha256` brief-008 + id riêng, không đụng key của R-17 gốc), `adopts`
`{"sourceSha256": "d3721a8812fccf7a526b1aebe77d2422a5001c1990065724601563c638fc6eb1",
"requirementId": "R-17"}`, `disposition: "excluded"`, `exclusion:
{"kind": "out-of-scope"}`, `exclusionReason` như đoạn lý do ở trên, `text`
nguyên văn R-17. Entry này KHÔNG nằm trong `acceptance[].requirementIds`
của bất kỳ AC nào. Sau `goal revise`, `apos plan` phải hiển thị R-17 của
brief-006 out-of-scope GOAL-008 và `apos inbox` phải sạch.

## Kết quả mong muốn

Cuối goal, một nhân viên bán hàng đăng nhập vào hệ thống có thể tạo hồ sơ
khách hàng (tên bắt buộc, điện thoại duy nhất trong org), xem lịch sử mua
hàng của khách kèm tổng chi tiêu + lần mua cuối + số đơn, tích điểm cho khách
chỉ khi đơn đã hoàn tất (1 điểm / 10.000đ) và đổi điểm trừ tiền đơn mới
(1 điểm = 100đ) mà không bao giờ làm điểm âm hay cộng điểm 2 lần khi gửi
lại, ghi chú chăm sóc khách, xem phân khúc khách (mới / thường xuyên / VIP /
ngủ quên) tính đúng ngưỡng đã chốt, tìm/lọc khách theo tên, điện thoại, phân
khúc, chi nhánh, hợp nhất 2 hồ sơ trùng có xác nhận mà không mất điểm hay
lịch sử, xuất dữ liệu khách và xóa/anonymize khách chưa có đơn — mọi thao
tác đều bị chặn đúng khi sai vai, sai chi nhánh hoặc ngoài org, điện thoại/
email không bao giờ xuất hiện trong audit log hay log server, với audit log
đầy đủ để đối soát.

## Quyết định mô hình (Lead/Worker ghi vào DECISIONS.md làm D26)

- **Khách hàng là dữ liệu cấp org, có chi nhánh chính.** Bảng `customers`
  có `org_id` NOT NULL FK tới `orgs`, `branch_id` NULL FK tới `branches`
  (chi nhánh chính của khách — NULL nghĩa là chưa gán chi nhánh; khách
  mua ở nhiều chi nhánh vẫn chỉ có MỘT chi nhánh chính, lịch sử mua tính
  theo org, không theo chi nhánh), `name` TEXT NOT NULL (tên bắt buộc),
  `phone` TEXT NULL (điện thoại duy nhất trong org khi có giá trị —
  `UNIQUE(org_id, phone)`, SQLite cho nhiều NULL, đúng ý; trùng điện
  thoại với khách đang `active` → 409), `email` TEXT NULL, `address` TEXT
  NULL (địa chỉ), `status` TEXT NOT NULL DEFAULT `'active'` CHECK
  `IN ('active','merged')` (xem hợp nhất ở dưới), `merged_into_id`
  INTEGER NULL FK tới `customers` (chỉ có giá trị khi `status =
  'merged'`), `created_at`/`updated_at`. Không có endpoint DELETE vĩnh
  viễn cho khách CÓ đơn (xem yêu cầu 8 — chỉ xóa được khách chưa có đơn).
- **Đơn gắn với khách bằng `customer_id`, không thay hành vi đơn cũ.**
  Migration 013 thêm `orders.customer_id` INTEGER NULL FK tới
  `customers` (đơn cũ giữ NULL — đơn không gắn khách vẫn hợp lệ) và
  `orders.points_discount` INTEGER NOT NULL DEFAULT 0 CHECK `>= 0`
  (tổng tiền đã trừ bằng điểm đổi, xem tích/đổi điểm ở dưới).
  `POST /api/orders` nhận thêm `customer_id` optional: có gửi thì khách
  phải tồn tại trong org (không tồn tại → 404, ngoài org → 403, khách
  `merged` → 400); không gửi thì đơn không gắn khách như trước. Hành vi
  đơn còn lại giữ nguyên (state machine, snapshot giá, giữ/xuất kho —
  D19); test khóa GOAL-005 không gửi `customer_id` nên vẫn xanh.
- **Lịch sử mua + tóm tắt tính ở service từ bảng orders, đúng org scope.**
  `GET /api/customers/:id` trả khách kèm `purchase_summary`
  (`total_spent`, `order_count`, `last_order_at`) và `points_balance`
  và `segment` (xem dưới); `GET /api/customers/:id/orders` trả các đơn
  của khách (mới nhất trước, kèm `items`, phân trang như GOAL-005).
  Chỉ tính đơn thuộc org của khách (đơn ngoài org không bao giờ lọt —
  `orders.customer_id` + `org_id` cùng kiểm tra). `total_spent` = tổng
  `total` của các đơn `completed` của khách (CHƯA trừ hoàn tiền — ghi rõ
  lựa chọn đơn giản này; hoàn tiền đã có trong đối soát thanh toán D22).
  `order_count` = số đơn `completed` của khách. `last_order_at` =
  `created_at` của đơn `completed` mới nhất (NULL khi chưa có đơn
  hoàn tất). Đơn `draft`/`confirmed`/`processing`/`cancelled` KHÔNG
  tính vào tóm tắt mua hàng (chỉ đơn hoàn tất mới là "đã mua").
- **Điểm tích lũy: chỉ khi đơn `completed`, tỉ lệ chốt 1 điểm /
  10.000đ, không hết hạn.** Bảng `customer_points` (ledger append-only)
  có `customer_id` NOT NULL FK tới `customers`, `org_id` NOT NULL FK
  tới `orgs`, `type` TEXT NOT NULL CHECK `IN ('earn','redeem')`,
  `points` INTEGER NOT NULL CHECK `> 0` (số điểm của dòng ledger — luôn
  dương, chiều do `type` quyết định), `reason` TEXT NOT NULL (lý do:
  mã đơn khi tích điểm, mã đơn khi đổi điểm), `order_id` NULL FK tới
  `orders` (đơn liên quan), `created_by` FK tới `users`,
  `created_at`. Số dư điểm tính ở service = tổng `earn` − tổng
  `redeem`, KHÔNG lưu cột số dư riêng (tránh lệch — như đối soát D22).
  Tích điểm: `POST /api/customers/:id/points/earn` nhận `{order_id,
  idempotency_key?}` — đơn phải `completed` (chưa hoàn tất → 400), phải
  thuộc khách này (`orders.customer_id` = khách, sai → 400); số điểm =
  floor((`order_total` − tổng hoàn `completed` của đơn tại thời điểm
  tích điểm) / 10000) — "tổng đơn sau hoàn tiền"; đơn có tổng sau hoàn
  < 10.000đ thì tích 0 điểm → 400 (không ghi ledger 0 điểm); mỗi đơn
  chỉ tích điểm 1 lần (tích lần 2 cùng đơn, khác key → 400, không cộng
  thêm). Điểm đã tích KHÔNG bị thu hồi khi đơn bị hoàn tiền sau đó
  (không có cơ chế clawback trong goal này — ghi rõ; GOAL-010 có thể
  xem lại). Điểm KHÔNG hết hạn (quyết định đơn giản — không có cột
  `expires_at`, không có job hết hạn).
- **Đổi điểm trừ tiền đơn mới: 1 điểm = 100đ, không vượt tổng đơn,
  điểm không âm.** `POST /api/customers/:id/points/redeem` nhận
  `{order_id, points, idempotency_key?}` — đơn phải là đơn MỚI ở trạng
  thái `draft` (đơn đã qua `draft` → 400), phải thuộc khách này;
  `points` nguyên > 0 và <= số dư điểm (vượt số dư → 400, điểm không
  bao giờ âm); số tiền trừ = min(`points` × 100, `order_total`) — không
  vượt tổng đơn (điểm thừa quá tổng đơn thì chỉ trừ tới tổng đơn, số
  điểm trừ vẫn là số điểm đã gửi — ghi rõ, không tự giảm số điểm);
  một đơn chỉ đổi điểm 1 lần (đổi lần 2 → 400); thành công ghi 1 dòng
  ledger `redeem` (số điểm, lý do = mã đơn) + cập nhật
  `orders.points_discount` = số tiền trừ, trong CÙNG MỘT transaction
  `BEGIN IMMEDIATE`. Đối soát thanh toán dùng lại `computePaymentSummary`
  (`src/payments.ts`, D22) với tổng ròng: `outstanding` =
  `order_total` − `points_discount` − `paid_total` (khi `points_discount`
  = 0 thì số cũ không đổi — test khóa GOAL-006/007 vẫn xanh);
  `payment_status` tính trên tổng ròng thay cho `order_total` (đơn được
  đổi điểm hết tổng thì `outstanding` = 0 và trạng thái là `paid` khi
  chưa trả gì? — KHÔNG: trạng thái `paid` chỉ khi đã trả đủ bằng tiền;
  đơn đổi điểm hết tổng mà chưa trả đồng nào thì `outstanding` = 0
  nhưng `payment_status` vẫn là `unpaid` cho tới khi có payment, hoặc
  `refunded` khi đã từng trả rồi hoàn hết — Lead ghi rõ quy tắc này
  trong D26: `payment_status` giữ nguyên logic D22 trên
  (`paid_total`, `refunded_total`, `order_total`) KHÔNG đổi, chỉ
  `outstanding` trừ thêm `points_discount`; test khóa không bị ảnh
  hưởng vì `points_discount` mặc định 0).
- **Ghi chú chăm sóc append-only.** Bảng `customer_notes` có
  `customer_id` NOT NULL FK tới `customers`, `org_id` NOT NULL FK tới
  `orgs`, `author_id` NOT NULL FK tới `users` (người viết ghi chú),
  `content` TEXT NOT NULL (nội dung — trống → 400), `created_at`.
  Chỉ INSERT, không có API UPDATE/DELETE ghi chú (gọi sửa/xóa →
  404/405). `GET /api/customers/:id/notes` trả ghi chú mới nhất trước.
  Ghi chú KHÔNG chứa PII nhạy cảm ngoài nội dung do người viết tự nhập
  (nội dung là văn bản chăm sóc; không có kiểm duyệt tự động trong goal
  này — ghi rõ).
- **Phân khúc khách tính ở service, KHÔNG lưu cột segment riêng.**
  `segment` ∈ `new` (mới) / `frequent` (thường xuyên) / `vip` / `dormant`
  (ngủ quên), tính từ các đơn `completed` của khách + `total_spent` +
  `last_order_at` (xem yêu cầu 2). Ngưỡng chốt:
  VIP khi `total_spent` ≥ 5.000.000đ HOẶC `order_count` ≥ 10 đơn;
  ngủ quên khi đã có ít nhất 1 đơn hoàn tất VÀ lần mua cuối > 90 ngày
  (so với thời điểm tính); thường xuyên khi `order_count` ≥ 3 đơn;
  còn lại là mới (chưa có đơn hoàn tất, hoặc đơn hoàn tất đầu tiên
  < 30 ngày — thực tế "còn lại" đã bao hàm: khách có 1–2 đơn gần đây
  thì rơi vào mới). Thứ tự ưu tiên khi thỏa nhiều nhóm (chốt):
  VIP → ngủ quên → thường xuyên → mới. Ví dụ: khách VIP mà 100 ngày
  chưa mua vẫn là VIP (không rớt xuống ngủ quên); khách 5 đơn, lần mua
  cuối 100 ngày trước → ngủ quên (không phải thường xuyên); khách 2
  đơn, lần mua cuối 10 ngày trước → mới.
- **Tìm kiếm/lọc khách tính ở service, phân trang như GOAL-005.**
  `GET /api/customers?name=&phone=&segment=&branch_id=&limit=&offset=`
  trả danh sách khách của org (mới nhất trước; `name`/`phone` tìm theo
  chuỗi con, không phân biệt hoa thường; `segment` lọc theo phân khúc
  đã tính — tính ở service bằng truy vấn tổng hợp trên orders, không
  lọc bằng cột lưu sẵn; `branch_id` lọc theo chi nhánh chính;
  `limit` mặc định 20, tối đa 100; `offset` mặc định 0; kèm tổng số để
  phân trang). Khách `merged` KHÔNG xuất hiện trong danh sách mặc định
  (chỉ còn hồ sơ giữ lại; xem hợp nhất ở dưới).
- **Hợp nhất hồ sơ trùng có xác nhận, không mất điểm/lịch sử.**
  `POST /api/customers/:id/merge` nhận `{source_customer_id, confirm,
  idempotency_key?}` — `:id` là hồ sơ GIỮ LẠI, `source_customer_id` là
  hồ sơ bị hợp nhất vào. `confirm` phải là `true` (thiếu hoặc `false`
  → 400, không làm gì — đây là lớp xác nhận bắt buộc); hợp nhất khách
  với chính mình → 400; khách nguồn/khách giữ không tồn tại → 404,
  ngoài org → 403; khách nguồn đã `merged` → 400; khách giữ đã
  `merged` → 400. Thành công trong CÙNG MỘT transaction `BEGIN
  IMMEDIATE`: mọi đơn (`orders.customer_id`), mọi dòng ledger
  (`customer_points.customer_id`), mọi ghi chú
  (`customer_notes.customer_id`) của khách nguồn chuyển sang khách giữ
  lại; số dư điểm của khách giữ lại = tổng ledger sau chuyển (tính ở
  service, không lưu cột riêng nên không cần cộng tay); khách nguồn
  chuyển `status` = `'merged'`, `merged_into_id` = id khách giữ lại,
  `phone`/`email` về NULL (ẩn danh liên hệ để giải phóng điện thoại cho
  dùng sau — ghi rõ); ghi 1 audit log (chỉ id, KHÔNG chứa phone/email);
  trả khách giữ lại kèm `purchase_summary` + `points_balance` +
  `segment` sau hợp nhất. Điểm/lịch sử KHÔNG mất: tổng điểm sau hợp
  nhất = tổng điểm 2 hồ sơ trước hợp nhất; tổng đơn/tổng chi sau hợp
  nhất = tổng 2 hồ sơ; ghi chú của cả 2 hồ sơ đều còn (thuộc khách giữ
  lại). Khách `merged` không tạo đơn mới, không tích/đổi điểm, không
  ghi chú, không hợp nhất tiếp (mọi thao tác lên khách `merged` →
  400, trừ xem/export).
- **Chính sách dữ liệu cá nhân: export + không PII trong log + xóa có
  điều kiện.** Export: `GET /api/customers/:id/export` trả JSON
  `{customer, orders (kèm items), points: {balance, ledger}, notes}` —
  toàn bộ dữ liệu của khách trong org, để bàn giao/xuất cho khách khi
  có yêu cầu; export cũng ghi audit log (đọc PII là thao tác nhạy cảm).
  KHÔNG đưa PII nhạy cảm vào log: `audit_log.detail` của mọi thao tác
  khách KHÔNG chứa `phone`/`email`/`address` (chỉ id + tên thao tác +
  các số liệu không nhạy cảm như `target_customer_id`, `points`,
  `order_id`); log server (console) cũng không in phone/email; test
  quét chứng minh (audit detail của các thao tác CRM không chứa chuỗi
  điện thoại/email đã tạo trong test). Xóa khách: `DELETE
  /api/customers/:id` — chỉ cho xóa khi khách CHƯA CÓ đơn nào
  (`orders.customer_id` = khách, mọi trạng thái — có đơn → 400, ghi
  rõ); xóa thành công thì xóa luôn ghi chú + ledger của khách đó trong
  cùng transaction (không còn lịch sử nào để giữ — vì chưa có đơn nên
  không có lịch sử mua; ghi chú/điểm của khách chưa mua được coi là
  nháp, xóa cùng hồ sơ); khách đã `merged` thì không xóa lại (→ 400).
  Đây là xóa cứng (hard delete) cho khách chưa có đơn — không có cột
  `deleted_at`, không có thùng rác trong goal này (ghi rõ).
- **Idempotency cho tích/đổi điểm + hợp nhất, trong transaction.**
  Tích điểm, đổi điểm, hợp nhất đều nhận `Idempotency-Key` (header)
  hoặc `idempotency_key` (body); server dùng `withStockIdempotency`
  (GOAL-004) — kiểm tra key + thực thi + ghi key trong CÙNG MỘT
  transaction `BEGIN IMMEDIATE` — vì các thao tác này động vào số dư
  điểm/tổng tiền đơn nên KHÔNG dùng `withIdempotency` của GOAL-001
  (kiểm tra ngoài transaction, có khe race — bài học GOAL-004/005/006/
  007). Tên miền key: `customer:points-earn:<key>` /
  `customer:points-redeem:<key>` / `customer:merge:<key>`; gửi lại cùng
  key + cùng loại + cùng org → trả đúng response đã lưu kèm `replayed:
  true`, KHÔNG cộng/trừ điểm lần nữa, KHÔNG chuyển hồ sơ lần nữa.
  Thiếu key thì vẫn thực thi (không bắt buộc) nhưng không có bảo vệ gửi
  lại.
- **Chống ghi nhận 2 lần.** Mọi tích/đổi điểm, mọi hợp nhất đều trong
  `BEGIN IMMEDIATE` + `UNIQUE(org_id, phone)` ở DB (trừ NULL) +
  kiểm tra "một đơn chỉ tích 1 lần / một đơn chỉ đổi 1 lần" trong cùng
  transaction; test chứng minh: tích điểm đồng thời 2 lần cùng đơn →
  chỉ 1 lần thành công, lần còn lại 400 hoặc `replayed: true`; đổi điểm
  đồng thời 2 lần cùng đơn → chỉ 1 lần thành công; hợp nhất đồng thời 2
  lần → chỉ 1 lần thành công. App một tiến trình (D1), bảo vệ race chỉ
  có ý nghĩa trong một process; đa process ngoài phạm vi, ghi rõ trong
  DECISIONS.md.

## Ma trận quyền (khách hàng + CRM — bổ sung vào `docs/RBAC.md`)

Vai: `owner`, `manager`, `sales`, `warehouse`, `accountant` (GOAL-002).
Quy tắc chung (D4): mọi thao tác kiểm tra cả vai VÀ phạm vi; vai sai thao
tác → 403; đúng vai sai phạm vi → 403; ngoài org → 403. Helper `can()` mở
rộng thêm actions: `create-customer`, `update-customer`, `view-customers`,
`earn-points`, `redeem-points`, `add-note`, `merge-customers`,
`export-customer`. Phạm vi gate bằng `branchId` của khách (chi nhánh
chính — `branch_id` NULL nghĩa là chưa gán: `sales` chỉ thấy khách có
`branch_id` đúng chi nhánh mình, không thấy khách chưa gán; `owner`/
`manager`/`accountant` thấy mọi khách; xem yêu cầu 9). Kiểu `Target` dùng
`branchId` đã có.

| Thao tác | owner | manager | sales | warehouse | accountant |
|---|---|---|---|---|---|
| Tạo khách (`POST /api/customers`) | Được | Được | Được (khách mới thuộc chi nhánh của mình; gửi `branch_id` khác → 403; không gửi `branch_id` thì khách thuộc chi nhánh mình) | Không (403) | Không (403) |
| Sửa khách (`PATCH /api/customers/:id`) | Được | Được | Được (khách thuộc chi nhánh của mình) | Không (403) | Không (403) |
| Xem/tìm khách (`GET /api/customers...`, `GET /api/customers/:id`, `GET /api/customers/:id/orders`) | Được, toàn org | Được, toàn org | Được, chỉ khách thuộc chi nhánh của mình | Được, toàn org (chỉ xem, để tra khách khi giao/nhận hàng) | Được, toàn org (chỉ xem) |
| Tích điểm (`POST /api/customers/:id/points/earn`) | Được | Được | Được (khách thuộc chi nhánh của mình) | Không (403) | Không (403) |
| Đổi điểm (`POST /api/customers/:id/points/redeem`) | Được | Được | Được (khách thuộc chi nhánh của mình) | Không (403) | Không (403) |
| Ghi chú (`POST /api/customers/:id/notes`, `GET /api/customers/:id/notes`) | Được (ghi + xem) | Được (ghi + xem) | Được (khách thuộc chi nhánh của mình) | Không ghi (403); xem được toàn org (chỉ xem) | Không ghi (403); xem được toàn org (chỉ xem) |
| Hợp nhất (`POST /api/customers/:id/merge`) | Được | Được | Không (403) | Không (403) | Không (403) |
| Xuất dữ liệu (`GET /api/customers/:id/export`) | Được, toàn org | Được, toàn org | Được, chỉ khách thuộc chi nhánh của mình | Không (403) | Được, toàn org |
| Xóa khách (`DELETE /api/customers/:id`) | Được (chỉ khách chưa có đơn) | Được (chỉ khách chưa có đơn) | Không (403) | Không (403) | Không (403) |

Ghi chú: `sales` xem/tích/đổi/ghi chú khách ngoài chi nhánh của mình →
403; khách chưa gán chi nhánh (`branch_id` NULL) thì `sales` không thấy
(403 khi gọi trực tiếp, bị lọc khỏi danh sách); mọi vai xem khách ngoài
org → 403. Xem lịch sử điểm (`GET /api/customers/:id/points`) theo luật
xem khách (cùng action `view-customers`).

## Yêu cầu

1. Migration 013 tạo 3 bảng khách/điểm/ghi chú + mở rộng bảng đơn
   (`customers`, `customer_points`, `customer_notes`): `customers`
   (`org_id` NOT NULL FK tới `orgs`, `branch_id` NULL FK tới `branches`,
   `name` TEXT NOT NULL, `phone` TEXT NULL, `email` TEXT NULL, `address`
   TEXT NULL, `status` TEXT NOT NULL DEFAULT `'active'` CHECK
   `IN ('active','merged')`, `merged_into_id` INTEGER NULL FK tới
   `customers`, `created_at`/`updated_at`): `UNIQUE(org_id, phone)` —
   SQLite cho nhiều NULL; migration chạy tuần tự sau 001–012, giữ dữ
   liệu cũ, không vỡ 244 test đã khóa. `customer_points` ledger
   append-only (`customer_id` NOT NULL FK tới `customers`, `org_id` NOT
   NULL FK tới `orgs`, `type` TEXT NOT NULL CHECK `IN ('earn',
   'redeem')`, `points` INTEGER NOT NULL CHECK `> 0`, `reason` TEXT NOT
   NULL, `order_id` NULL FK tới `orders`, `created_by` NOT NULL FK tới
   `users`, `created_at`): chỉ INSERT, không có API UPDATE/DELETE ledger
   (gọi sửa/xóa → 404/405). `customer_notes` append-only (`customer_id`
   NOT NULL FK tới `customers`, `org_id` NOT NULL FK tới `orgs`,
   `author_id` NOT NULL FK tới `users`, `content` TEXT NOT NULL,
   `created_at`): chỉ INSERT, không có API UPDATE/DELETE ghi chú (gọi
   sửa/xóa → 404/405). Migration 013 (tiếp) `ALTER TABLE orders ADD
   COLUMN customer_id INTEGER NULL REFERENCES customers(id)` +
   `ALTER TABLE orders ADD COLUMN points_discount INTEGER NOT NULL
   DEFAULT 0 CHECK (points_discount >= 0)` — đơn cũ giữ `customer_id`
   NULL + `points_discount` 0, hành vi đơn cũ không đổi.
2. API tạo/sửa/xem khách: `POST /api/customers` nhận `{name, phone?,
   email?, address?, branch_id?}` — `name` trống → 400; `phone` trùng
   khách `active` trong org → 409; `branch_id` không tồn tại → 404,
   ngoài org → 403; `sales` tạo khách: `branch_id` gửi khác chi nhánh
   mình → 403, không gửi thì khách thuộc chi nhánh mình; thành công →
   201, trả khách (kèm `purchase_summary` rỗng + `points_balance` 0 +
   `segment` `'new'`). `PATCH /api/customers/:id` nhận `{name?, phone?,
   email?, address?, branch_id?}` — khách không tồn tại → 404, ngoài
   org → 403; `name` trống → 400; `phone` đổi trùng khách `active`
   khác trong org → 409; khách `merged` → 400; thành công → 200, trả
   khách đã cập nhật. `GET /api/customers/:id` trả khách kèm
   `purchase_summary` (`total_spent`, `order_count`, `last_order_at`)
   + `points_balance` + `segment`; `GET /api/customers/:id/orders` trả
   các đơn của khách (mới nhất trước, kèm `items`, phân trang
   `limit`/`offset` như GOAL-005). Mọi API đọc lọc theo org + phạm vi
   vai (xem ma trận); ngoài org → 403; khách không tồn tại → 404.
3. API tích/đổi điểm + ledger: `POST /api/customers/:id/points/earn`
   nhận `{order_id, idempotency_key?}` — khách không tồn tại → 404,
   ngoài org → 403; khách `merged` → 400; đơn không tồn tại → 404,
   ngoài org → 403; đơn không thuộc khách → 400; đơn chưa `completed`
   → 400; đơn đã tích điểm rồi → 400; tổng sau hoàn < 10.000đ → 400
   (không ghi ledger 0 điểm); thành công → 201, ghi 1 dòng ledger
   `earn` (`points` = floor((`order_total` − tổng hoàn `completed` của
   đơn) / 10000), `reason` = mã đơn, `order_id` = đơn đó) + 1 audit log,
   trả `{customer_id, points_earned, points_balance, order_id}`.
   `POST /api/customers/:id/points/redeem` nhận `{order_id, points,
   idempotency_key?}` — khách không tồn tại → 404, ngoài org → 403;
   khách `merged` → 400; đơn không tồn tại → 404, ngoài org → 403;
   đơn không thuộc khách → 400; đơn không ở `draft` → 400; đơn đã đổi
   điểm rồi → 400; `points` không nguyên hoặc <= 0 → 400; `points` >
   số dư → 400; thành công → 201, trong CÙNG MỘT transaction: ghi 1
   dòng ledger `redeem` + cập nhật `orders.points_discount` =
   min(`points` × 100, `order_total`) + 1 audit log, trả
   `{customer_id, points_redeemed, discount, points_balance, order_id,
   order_points_discount}`. `GET /api/customers/:id/points` trả
   `{balance, ledger}` (ledger mới nhất trước, kèm `reason` + `order_id`
   + `created_by` + `created_at`).
4. API ghi chú chăm sóc: `POST /api/customers/:id/notes` nhận
   `{content, idempotency_key?}` — khách không tồn tại → 404, ngoài
   org → 403; khách `merged` → 400; `content` trống → 400; thành công
   → 201, ghi 1 ghi chú (`author_id` = người thực hiện) + 1 audit log,
   trả ghi chú. `GET /api/customers/:id/notes` trả ghi chú mới nhất
   trước (phân trang `limit`/`offset` như GOAL-005). Không có API sửa/
   xóa ghi chú.
5. Phân khúc tính ở service: `GET /api/customers/:id` và danh sách khách
   trả `segment` tính theo ngưỡng đã chốt (VIP: `total_spent` ≥
   5.000.000đ hoặc `order_count` ≥ 10; ngủ quên: có ≥ 1 đơn hoàn tất và
   lần mua cuối > 90 ngày; thường xuyên: `order_count` ≥ 3; còn lại:
   mới), thứ tự ưu tiên VIP → ngủ quên → thường xuyên → mới; KHÔNG lưu
   cột `segment` riêng trong DB (test quét schema chứng minh không có
   cột `segment` trên bảng `customers`); segment đổi ngay khi dữ liệu
   đơn đổi (tích thêm đơn hoàn tất có thể đổi mới → thường xuyên →
   VIP; khách 90 ngày không mua đổi → ngủ quên trừ khi VIP).
6. API tìm kiếm/lọc khách: `GET /api/customers?name=&phone=&segment=
   &branch_id=&limit=&offset=` trả danh sách khách của org (mới nhất
   trước; `name`/`phone` tìm theo chuỗi con, không phân biệt hoa
   thường; `segment` lọc theo phân khúc đã tính ở service — `segment`
   lạ → 400; `branch_id` lọc theo chi nhánh chính, không tồn tại →
   404, ngoài org → 403; `limit` mặc định 20, tối đa 100; `offset`
   mặc định 0; kèm tổng số để phân trang). Khách `merged` không xuất
   hiện trong danh sách mặc định. Mọi API đọc lọc theo org + phạm vi
   vai (`sales` chỉ thấy khách thuộc chi nhánh mình — khách chưa gán
   chi nhánh bị lọc khỏi danh sách của `sales`; ngoài org → 403).
7. API hợp nhất hồ sơ trùng: `POST /api/customers/:id/merge` nhận
   `{source_customer_id, confirm, idempotency_key?}` — `:id` là hồ sơ
   GIỮ LẠI; khách giữ/khách nguồn không tồn tại → 404, ngoài org →
   403; `confirm` không phải `true` → 400, không làm gì; hợp nhất
   khách với chính mình → 400; khách nguồn hoặc khách giữ đã `merged`
   → 400; thành công → 200, trong CÙNG MỘT transaction `BEGIN
   IMMEDIATE`: mọi đơn + ledger + ghi chú của khách nguồn chuyển sang
   khách giữ lại; khách nguồn chuyển `status` `'merged'`,
   `merged_into_id` = id khách giữ lại, `phone`/`email` về NULL; ghi 1
   audit log (chỉ id, KHÔNG chứa phone/email); trả khách giữ lại kèm
   `purchase_summary` + `points_balance` + `segment` sau hợp nhất
   (tổng điểm = tổng 2 hồ sơ; tổng đơn/tổng chi = tổng 2 hồ sơ; ghi
   chú cả 2 hồ sơ đều còn).
8. API xuất + xóa dữ liệu cá nhân: `GET /api/customers/:id/export` trả
   JSON `{customer, orders (kèm items), points: {balance, ledger},
   notes}` — toàn bộ dữ liệu của khách trong org; khách không tồn tại
   → 404, ngoài org → 403; khách `merged` vẫn export được (dữ liệu đã
   chuyển đi thì export của khách nguồn trả rỗng ở orders/points/notes
   kèm `merged_into_id` — ghi rõ); export ghi 1 audit log. KHÔNG đưa
   PII nhạy cảm vào log: `audit_log.detail` của MỌI thao tác khách
   (tạo/sửa/tích/đổi/ghi chú/hợp nhất/xuất/xóa) KHÔNG chứa `phone`/
   `email`/`address` — test tạo khách với phone/email riêng rồi đọc
   audit log và quét chuỗi phone/email đó, phải không thấy; log server
   cũng không in phone/email. `DELETE /api/customers/:id` — khách không
   tồn tại → 404, ngoài org → 403; khách CÓ đơn nào (mọi trạng thái)
   → 400, không xóa; khách đã `merged` → 400; khách chưa có đơn → 200,
   xóa cứng hồ sơ + ghi chú + ledger của khách đó trong cùng
   transaction + 1 audit log (chỉ id); xóa xong `GET` lại → 404.
9. RBAC khách hàng + CRM: mở rộng helper `can()` ở `src/rbac.ts` thêm
   actions `create-customer`, `update-customer`, `view-customers`,
   `earn-points`, `redeem-points`, `add-note`, `merge-customers`,
   `export-customer` theo đúng ma trận ở trên; mọi endpoint khách qua
   `requireRole` + `can()` (vai sai → 403, ngoài org → 403, sai chi
   nhánh → 403). Xóa khách chỉ `owner`/`manager` (qua `can()` với
   action `update-customer`? — KHÔNG: thêm action riêng `delete-customer`
   chỉ `owner`/`manager`, ghi rõ trong D26). Test chứng minh từng ô cấm
   trong ma trận (ít nhất: warehouse tạo khách → 403, accountant sửa
   khách → 403, sales tích điểm khách ngoài chi nhánh → 403, sales hợp
   nhất → 403, warehouse xuất dữ liệu → 403, sales xóa khách → 403,
   sales xem khách chưa gán chi nhánh → 403, user org A đọc khách org B
   → 403, warehouse ghi chú → 403).
10. Audit log cho khách hàng + CRM: ghi vào `audit_log` đã có MỌI thao
    tác tạo/sửa khách, tích/đổi điểm, ghi chú, hợp nhất, xuất dữ liệu,
    xóa khách; mỗi bản ghi có `user_id` người thực hiện, `created_at`,
    `action` + `detail` JSON (`target_customer_id`, `target_order_id`
    khi có, `points` khi tích/đổi, `source_customer_id` khi hợp nhất,
    KHÔNG chứa `phone`/`email`/`address`, KHÔNG chứa thông tin thẻ);
    xem log theo luật GOAL-002 (`GET /api/audit-log`: `owner` toàn org,
    `manager` trong phạm vi, các vai khác → 403). `customer_points`/
    `customer_notes` là lịch sử chi tiết; `audit_log` là lớp ghi nhận
    thao tác nhạy cảm theo chuẩn GOAL-002 — cả hai đều phải có, không
    thay nhau. Lịch sử điểm/ghi chú: ledger + notes ghi đủ mọi lần
    tích/đổi/ghi chú (kể cả gửi lại cùng key thì KHÔNG ghi dòng mới —
    xem yêu cầu 11); test: tạo khách → tích điểm → đổi điểm → ghi chú
    → hợp nhất: ledger + notes đúng thứ tự thời gian, đủ các bước,
    không có dòng thừa.
11. Idempotency + chống ghi nhận 2 lần cho điểm/hợp nhất: tích điểm,
    đổi điểm, hợp nhất đều nhận `Idempotency-Key` (header) hoặc
    `idempotency_key` (body); server dùng `withStockIdempotency`
    (GOAL-004) với tên miền key `customer:points-earn:<key>` /
    `customer:points-redeem:<key>` / `customer:merge:<key>`; gửi lại
    cùng key + cùng loại + cùng org → trả đúng response đã lưu kèm
    `replayed: true`, KHÔNG cộng/trừ điểm lần nữa, KHÔNG chuyển hồ sơ
    lần nữa (số dư điểm, `points_discount`, số đơn của khách giữ lại
    không đổi — test chứng minh). Key khác nhau thì thực thi bình
    thường (nhưng một đơn chỉ tích 1 lần / chỉ đổi 1 lần — lần 2 khác
    key → 400). Thiếu key thì vẫn thực thi (không bắt buộc) nhưng không
    có bảo vệ gửi lại. Mọi tích/đổi/hợp nhất trong `BEGIN IMMEDIATE` +
    `UNIQUE(org_id, phone)` ở DB; test chứng minh tích/đổi/hợp nhất
    đồng thời → chỉ 1 lần thành công. App một tiến trình (D1), bảo vệ
    race chỉ có ý nghĩa trong một process; đa process ngoài phạm vi,
    ghi rõ trong DECISIONS.md.
12. Test mới (vitest + supertest, thêm vào file test mới — KHÔNG sửa 244
    test đã khóa của GOAL-001..007): chứng minh tạo/sửa khách đúng luật
    (tên bắt buộc 400, trùng điện thoại 409, khách `merged` không sửa
    được 400), lịch sử mua + tóm tắt đúng số (chỉ đơn `completed` được
    tính; đơn `draft` không tính), tích điểm chỉ khi đơn `completed`
    (đơn chưa hoàn tất → 400; tích 2 lần cùng đơn → 400; tỉ lệ
    1 điểm / 10.000đ làm tròn xuống; đơn < 10.000đ sau hoàn → 400),
    đổi điểm đúng số (1 điểm = 100đ; vượt số dư → 400; vượt tổng đơn
    thì chỉ trừ tới tổng đơn; đổi 2 lần cùng đơn → 400; điểm không âm;
    `outstanding` trừ `points_discount`), điểm không hết hạn (không có
    cột `expires_at` — test quét schema), phân khúc đúng ngưỡng + thứ
    tự ưu tiên (VIP ≥ 5.000.000đ hoặc ≥ 10 đơn; VIP 100 ngày không mua
    vẫn VIP; 5 đơn + lần mua cuối 100 ngày → ngủ quên; ≥ 3 đơn → thường
    xuyên; còn lại mới; không có cột `segment`), tìm kiếm/lọc/phân
    trang (theo tên/điện thoại/phân khúc/chi nhánh, limit/offset + tổng
    số), hợp nhất có xác nhận (thiếu `confirm` → 400; hợp nhất xong
    điểm/lịch sử cộng dồn đủ, khách nguồn `merged` + phone/email NULL,
    không tạo đơn/tích điểm được nữa), xuất dữ liệu đủ 4 phần
    (hồ sơ + đơn + điểm + ghi chú), không PII trong audit log (quét
    chuỗi phone/email trong audit detail), xóa khách (chưa có đơn xóa
    được → `GET` lại 404; có đơn → 400), idempotency (gửi lại cùng key
    → `replayed: true`, không cộng/trừ lần 2), race (tích/đổi/hợp nhất
    đồng thời → chỉ 1 lần thực thi), RBAC 403 theo ma trận (yêu cầu 9).
    Test dùng dữ liệu giả lập (2 org, 2 khách trở lên trong cùng org).
13. Dữ liệu GIẢ LẬP hoàn toàn; mật khẩu seed + secret qua biến môi trường
    (như GOAL-001..007: `OMNIFLOW_SEED_*_PASSWORD`), không commit
    credential thật; `check.sh` vẫn quét secret (grep như GOAL-001);
    seed KHÔNG cần thêm khách mẫu (demo tự tạo) — nhưng giữ nguyên 2
    user, 2 sản phẩm, 2 kho + mức tồn mẫu để test khóa vẫn xanh.
14. `scripts/check.sh` (CHK-1) và `scripts/demo.sh` (CHK-2) được MỞ RỘNG
    trong goal này: thêm bước khách/CRM vào smoke/demo (tạo khách → trùng
    điện thoại 409 → tạo đơn gắn khách → xác nhận → xử lý → hoàn tất →
    thu tiền → tích điểm đúng tỉ lệ (đơn 250.000đ → 25 điểm) → tích lại
    cùng đơn 400 → đổi điểm trừ tiền đơn mới (10 điểm → trừ 1.000đ,
    `outstanding` giảm đúng) → đổi vượt số dư 400 → ghi chú → phân khúc
    đổi theo ngưỡng (tạo đủ đơn để thành thường xuyên/VIP — hoặc kiểm
    tra segment `new` → `frequent` trên dữ liệu demo) → tìm/lọc theo tên
    + phân khúc → tạo khách trùng → hợp nhất không `confirm` 400 → hợp
    nhất có `confirm` (điểm/lịch sử cộng dồn, khách nguồn `merged`) →
    xuất dữ liệu đủ 4 phần → audit log không chứa phone/email → xóa
    khách chưa có đơn được, khách có đơn 400 → idempotency gửi lại
    không cộng điểm lần 2 → RBAC 403: warehouse tạo khách, sales hợp
    nhất, sales xóa khách, sales xem khách ngoài chi nhánh), giữ tất cả
    bước GOAL-001..007 xanh (health, login, owner-only, idempotency,
    backup/restore, RBAC người dùng, sản phẩm/giá/CSV, kho, đơn, thanh
    toán, giao/trả). Cả 2 script tự chạy được, tự dọn dẹp, in PASS/FAIL
    từng bước. Docs: `docs/RBAC.md` bổ sung ma trận khách/CRM (bảng ở
    trên) + mô hình phạm vi (chi nhánh chính, khách chưa gán chi nhánh
    `sales` không thấy); `docs/DECISIONS.md` thêm D26 (mô hình khách
    hàng + CRM: chi nhánh chính, `customer_id` trên đơn, tỉ lệ tích/đổi
    điểm, điểm không hết hạn, không thu hồi điểm khi hoàn tiền sau,
    phân khúc + thứ tự ưu tiên, hợp nhất có xác nhận, export/xóa/PII,
    `outstanding` trừ `points_discount` nhưng `payment_status` giữ
    logic D22, action `delete-customer` riêng); `README.md`/
    `docs/SETUP.md` cập nhật endpoint khách/CRM, khớp lệnh đã chạy
    thật. Không có file `.github/workflows/` trong repo (gh token thiếu
    scope `workflow` — CI là follow-up sau khi user cấp scope). Không
    claim VPS, không claim deploy production (local-only, D9).
15. Đổi điểm không làm đổi trạng thái đơn, không đổi trạng thái thanh
    toán của payment đã có: `redeem` chỉ cập nhật `orders.points_discount`
    + ledger; `payment_status` giữ nguyên logic D22 (xem yêu cầu 3);
    đơn đã đổi điểm vẫn đi tiếp vòng đời đơn bình thường (xác nhận →
    xử lý → hoàn tất) và chỉ được tích điểm khi đã `completed` (điểm
    tích tính trên tổng sau hoàn, chưa trừ `points_discount` — ghi rõ:
    tích điểm tính trên `order_total`, không trừ điểm đã đổi của chính
    đơn đó).

## Ngoài phạm vi (thuộc goal sau, không làm trong GOAL-008)

16. Khuyến mãi (GOAL-009): không mã giảm giá, không chương trình theo
    điều kiện — điểm đổi ở đây là điểm tích lũy CRM, không phải mã giảm
    giá; giá đơn vẫn dùng giá hiệu dụng GOAL-003 đã snapshot.
17. Báo cáo/đối soát tổng hợp (GOAL-010): không tổng hợp doanh thu theo
    khách/thời gian, không đối soát lô (chỉ tóm tắt từng khách — yêu cầu
    2, và đối soát từng đơn — D22).
18. Thông báo (GOAL-011): không gửi email/SMS cho khách khi tích/đổi
    điểm hay hợp nhất hồ sơ (chỉ audit log + ledger + ghi chú).
19. UI tổng quan (GOAL-012): không thêm màn hình khách/CRM.
20. Đơn vị vận chuyển thật / giao hàng thật, tài khoản hãng vận chuyển —
    ngoài phạm vi vĩnh viễn của dự án giả lập này; deploy production/VPS
    (ngoài phạm vi, local-only), CI workflow (chờ user cấp scope
    `workflow`).

## Rủi ro / phụ thuộc

- **Phụ thuộc GOAL-005:** cần đơn hàng + state machine +
  `transitionOrderTx` + mã đơn + RBAC đơn + `audit_log`, và
  `computePaymentSummary` của GOAL-006 để trừ `points_discount` vào
  `outstanding`. Nếu GOAL-005 chưa close thì không select GOAL-008.
- **Rủi ro tích điểm 2 lần (quan trọng nhất):** tích điểm là cộng số dư
  — gửi lại không có idempotency trong transaction sẽ cộng 2 lần. Bắt
  buộc kiểm tra "một đơn chỉ tích 1 lần" + `withStockIdempotency` trong
  cùng `BEGIN IMMEDIATE`; test tích đồng thời là bắt buộc, không được bỏ.
- **Rủi ro đổi điểm vượt số dư / vượt tổng đơn:** số dư điểm tính từ
  ledger, không lưu cột riêng — đổi điểm phải đọc số dư + ghi ledger +
  cập nhật `points_discount` trong CÙNG MỘT transaction, nếu không 2
  lần đổi đồng thời cùng vượt số dư sẽ cùng lọt. Test đổi đồng thời phải
  chứng minh chỉ 1 lần thành công và điểm không âm.
- **Rủi ro hợp nhất mất lịch sử:** hợp nhất mà xóa khách nguồn trước khi
  chuyển FK sẽ mất đơn/điểm/ghi chú (FK lỗi hoặc mồ côi). Bắt buộc chuyển
  mọi FK trong CÙNG MỘT transaction rồi mới đánh dấu nguồn `merged`
  (không xóa row nguồn — giữ lại để audit còn trỏ được); test hợp nhất
  phải kiểm tra tổng điểm/tổng đơn/ghi chú sau hợp nhất bằng đúng tổng
  2 hồ sơ trước hợp nhất.
- **Rủi ro PII lọt vào log:** audit detail hay log server vô tình in
  phone/email sẽ rò rỉ dữ liệu cá nhân. Bắt buộc audit detail chỉ chứa
  id + số liệu, không chứa phone/email/address; test quét chuỗi PII
  trong audit log là bắt buộc.
- **Rủi ro phân khúc lưu cột riêng rồi lệch:** segment lưu cột sẽ lệch
  khi đơn mới hoàn tất mà không cập nhật cột. Bắt buộc tính ở service
  mỗi lần đọc, không lưu cột `segment`; test quét schema chứng minh
  không có cột đó.
- **Rủi ro `points_discount` làm lệch đối soát thanh toán:** nếu
  `computePaymentSummary` trừ discount sai chỗ thì test khóa GOAL-006/
  007 (discount = 0) vẫn xanh nhưng đơn có discount sẽ sai
  `outstanding`. Test đổi điểm phải kiểm tra `outstanding` =
  `order_total` − `points_discount` − `paid_total` và `payment_status`
  giữ logic D22 (đơn đổi điểm hết tổng mà chưa trả đồng nào vẫn
  `unpaid`).
- **Rủi ro race trong test:** test đồng thời chạy trên một process Node +
  SQLite đồng bộ — các yêu cầu được xếp hàng ở event loop nên "đồng
  thời" ở đây là đồng thời ở mức HTTP, không phải đa process; test chứng
  minh bất biến (chỉ 1 lần tích/đổi/hợp nhất, điểm không âm) chứ không
  chứng minh được khả năng chống race đa process (ngoài phạm vi, ghi rõ
  trong DECISIONS.md).
- **Rủi ro mã đơn trùng khi đồng thời:** không liên quan trực tiếp goal
  này (mã đơn đã có từ D19), nhưng hợp nhất chuyển đơn giữa 2 khách
  không được đổi mã đơn — mã đơn giữ nguyên sau hợp nhất (test kiểm
  tra).

## Ghi chú rà soát của PM (27/11/2026 — trước khi tạo Goal)

PM đã đối chiếu brief với code trên main @ 81fe81e (GOAL-001..007 đã đóng,
vitest 244 test — đếm `test(` ở đầu dòng trong `tests/*.ts`: 15 + 2 + 10 +
38 + 35 + 45 + 21 + 36 + 36 + 6) + `docs/ROADMAP.md` (dòng GOAL-008) +
`docs/DECISIONS.md` (D1–D25) + `src/orders.ts`, `src/payments.ts`,
`src/stock.ts`, `src/rbac.ts`, `src/app.ts` (routes tới
`/api/returns/:id`, chưa có route khách nào), `src/db.ts` (migration
001–012), `docs/RBAC.md`, `scripts/check.sh` + `scripts/demo.sh` (demo
đã có bước giao/trả + kiểm tra D24/D25 trong `docs_present`).
Những điểm sau đã CHỐT trong brief (Lead ghi vào D26, không mở lại):

1. **Tỉ lệ điểm (PM chốt):** tích 1 điểm / 10.000đ tổng đơn sau hoàn tiền
   (làm tròn xuống), đổi 1 điểm = 100đ, điểm KHÔNG hết hạn, điểm đã tích
   không bị thu hồi khi hoàn tiền sau đó.
2. **Ngưỡng phân khúc (PM chốt):** VIP tổng chi ≥ 5.000.000đ hoặc ≥ 10
   đơn hoàn tất; ngủ quên lần mua cuối > 90 ngày; thường xuyên ≥ 3 đơn;
   thứ tự ưu tiên VIP → ngủ quên → thường xuyên → mới.
3. **Mô hình chi nhánh chính:** `branch_id` nullable trên khách là chi
   nhánh chính; khách mua ở nhiều chi nhánh vẫn chỉ có một chi nhánh
   chính, lịch sử mua tính theo org.
4. **Hợp nhất có xác nhận:** body bắt buộc `confirm: true`, thiếu/sai
   → 400; nguồn chuyển `merged` (không xóa row), phone/email về NULL.
5. **Xóa khách:** chỉ khi chưa có đơn (mọi trạng thái) → xóa cứng kèm
   ghi chú + ledger; có đơn → 400.
6. **PII:** phone/email/address không bao giờ vào audit detail hay log
   server; export ghi audit log.
7. **Đổi điểm và đối soát:** `outstanding` trừ `points_discount`,
   `payment_status` giữ nguyên logic D22; một đơn chỉ đổi điểm 1 lần.
8. **Solo WP-MAIN:** quy mô M vừa, một gói duy nhất; mỗi AC thuộc đúng
   một package.

Đã KIỂM CHỨNG đúng, không sửa: `orders.customer_name` là chuỗi tự do,
chưa có `customer_id` (migration 013 thêm); `computePaymentSummary` ở
`src/payments.ts` tính đối soát từ payments/refunds (D22) và
`partially_refunded` chỉ khi có return đã hoàn tiền (D25) — GOAL-008
không đổi 2 luật này; `withStockIdempotency` kiểm tra + thực thi + ghi
key trong cùng transaction `BEGIN IMMEDIATE`; `transitionOrderTx` +
state machine đơn draft → confirmed → processing → completed/cancelled;
seed 1 org, 1 chi nhánh, 2 user (owner + sales), 2 sản phẩm, 2 kho;
migration 001–012, chưa có bảng khách hàng nào; 244 test vitest (đếm
trực tiếp từ file test); inbox có notice orphan R-16 của GOAL-006 (đã
xử lý loại trừ có lý do trong mục riêng ở trên, `goal-008.json` khai
entry R-16 excluded — theo đúng cơ chế đã chứng minh ở GOAL-007 cho
R-20).
