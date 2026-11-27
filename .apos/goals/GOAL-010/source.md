# OmniFlow — brief GOAL-010: Báo cáo + đối soát

## Bối cảnh (vấn đề)

OmniFlow là hệ thống vận hành thương mại đa kênh cho doanh nghiệp vừa (nhiều
doanh nghiệp, nhiều chi nhánh, nhiều kho, nhiều kênh bán), dự án dài hạn để kiểm
tra APOS ở quy mô lớn. Roadmap: `docs/ROADMAP.md` (12 Goal + GOAL-005A đã
đóng). Quyết định kiến trúc: `docs/DECISIONS.md` (D1–D27).

GOAL-010 xây nghiệp vụ báo cáo + đối soát trên nền GOAL-001 (đã CLOSED) +
GOAL-002 (RBAC, đã CLOSED) + GOAL-003 (sản phẩm/giá, đã CLOSED) + GOAL-004
(kho, đã CLOSED) + GOAL-005 (đơn hàng, đã CLOSED) + GOAL-005A (adopt R-19, đã
CLOSED) + GOAL-006 (thanh toán + hoàn tiền, đã CLOSED) + GOAL-007 (giao hàng +
trả hàng, đã CLOSED) + GOAL-008 (khách hàng + CRM, đã CLOSED) + GOAL-009
(khuyến mãi, đã CLOSED): báo cáo doanh thu theo kênh bán / chi nhánh / sản
phẩm / danh mục / khoảng thời gian; báo cáo tồn kho + biến động + cảnh báo tồn
thấp; đối soát 3 mặt kho–đơn–thanh toán (lệch thì báo cáo chỉ rõ lệch ở đâu,
số nào); báo cáo khuyến mãi đã dùng + điểm đã đổi; xuất CSV cho mỗi báo cáo
(số liệu khớp với API JSON); phân quyền xem báo cáo theo vai + scope chi
nhánh; số liệu chỉ tính đơn completed / đã thu đúng trạng thái. Phụ thuộc:
GOAL-005 (đơn hàng) + GOAL-006 (thanh toán) + GOAL-007 (giao/trả) theo
ROADMAP; đồng thời đọc dữ liệu đã có của GOAL-008 (điểm) và GOAL-009 (mã
giảm giá). Không làm thông báo (GOAL-011) hay UI tổng quan (GOAL-012) trong
goal này. Dữ liệu GIẢ LẬP hoàn toàn; không tiền thật, không tài khoản thanh
toán thật, không dịch vụ trả phí.
Dự án chỉ làm LOCAL — không có VPS trong phạm vi (user xác nhận 26/11 21:49).

Đề xuất: size M, appetite 480 phút, 3 lần thử (Human delegate duyệt ở gate A;
đặt dư vì APOS tính wall-clock từ lúc select — bài học DRAK GOAL-002).
Solo WP-MAIN: quy mô M vừa, toàn bộ thay đổi nằm trong một gói duy nhất
(service + routes + test + scripts + docs), không có ranh giới gói độc lập
để tách multi-WP; mỗi acceptance criterion thuộc đúng một package (WP-MAIN).

Điểm xuất phát (GOAL-001..009, đã khóa — KHÔNG sửa):
`src/app.ts` (Express, EJS, session cookie, middleware `requireRole`/
`requireScope`, route người dùng/chi nhánh/audit log/sản phẩm/giá/CSV/kho/
đơn/thanh toán/giao-trả/khách/CRM/khuyến mãi), `src/rbac.ts` (helper `can()`,
actions hiện tại: 10 actions người dùng + 8 actions sản phẩm/giá/CSV + 1
action xem giá riêng chi nhánh (`view-branch-price`) + 11 actions kho + 6
actions đơn + 3 actions thanh toán + 8 actions giao/trả + 9 actions
khách/CRM + 4 actions khuyến mãi), `src/db.ts` (migration 001–014; chưa có
bảng tổng hợp báo cáo nào — và goal này KHÔNG tạo bảng tổng hợp mới, xem yêu
cầu 10), `src/seed.ts` (1 org, 1 branch "Chi nhánh Chính", 2 user: owner +
sales; 2 sản phẩm mẫu; 2 kho mẫu), `src/tenant.ts` (middleware scope
org/branch), `src/idempotency.ts` (helper `withIdempotency` — kiểm tra key
ngoài transaction), `src/orders.ts` (`createOrderTx`, `transitionOrderTx`,
mã đơn `DH-YYYYMMDD-NNNN`, state machine draft → confirmed → processing →
completed/cancelled, `customer_id` optional + `points_discount` +
`promotion_id`/`promo_discount` trên đơn — GOAL-008/009; KHÔNG có cột
`completed_at` — thời điểm hoàn tất suy từ `order_events`
`to_status = 'completed'`, xem yêu cầu 1), `src/products.ts`
(`effectivePrice()` fallback 8 bước + `resolveEffectivePrice()`),
`src/stock.ts` (`runStockTransaction`, `applyMovement`,
`withStockIdempotency` — kiểm tra key + thực thi + ghi key trong CÙNG MỘT
transaction; `stock_movements` append-only có `on_hand_after`/
`reserved_after` + `reference`, `stock_levels` có `on_hand`/`reserved`,
`available = on_hand − reserved`), `src/payments.ts`
(`computePaymentSummary` — đối soát tính ở service từ bảng
payments/refunds, không lưu cột tổng riêng; `outstanding = order_total −
points_discount − promo_discount − paid_total`, `payment_status` giữ logic
D22 — lưu ý `partially_refunded` chỉ khi đơn có yêu cầu trả đã hoàn tiền,
còn hoàn trực tiếp một phần giữ `partially_paid` theo test khóa GOAL-006 —
xem D25; GOAL-010 KHÔNG đổi ngữ nghĩa `payment_status`, xem yêu cầu 5),
`src/customers.ts` (tích điểm 1 điểm/10.000đ khi đơn completed, đổi điểm
1 điểm = 100đ — D26; ledger `customer_points` append-only `earn`/`redeem`),
`src/promotions.ts` (`calculateDiscount`, `promotion_usages` append-only
`used`/`released` — D27), `tests/acceptance.test.ts` +
`tests/rbac-acceptance.test.ts` + `tests/products-acceptance.test.ts` +
`tests/stock-acceptance.test.ts` + `tests/orders-acceptance.test.ts` +
`tests/orders-005a-acceptance.test.ts` + `tests/payments-acceptance.test.ts`
+ `tests/shipments-returns-acceptance.test.ts` +
`tests/customers-crm-acceptance.test.ts` +
`tests/promotions-acceptance.test.ts` — tổng 333 test vitest xanh trên main
khi đóng GOAL-009 (gate xanh, đã chạy thật 27/11), KHÔNG sửa test cũ,
`scripts/check.sh` (CHK-1) + `scripts/demo.sh` (CHK-2) — goal này MỞ RỘNG
2 script, giữ các bước GOAL-001..009 xanh.

## Loại trừ 3 yêu cầu mồ côi khuyến mãi có lý do

`apos inbox` đang có 3 notice `orphan-requirement`, cả ba đều là câu phủ định
phạm vi khuyến mãi từ các goal trước, defer sang GOAL-009 nhưng GOAL-009 đóng
mà không adopt (vì brief-009 có requirements RIÊNG R-1..R-15 sở hữu đúng phạm
vi khuyến mãi). Quyết định đã chốt (parent, 27/11): **LOẠI TRỪ CẢ BA CÓ LÝ
DO, KHÔNG adopt vào GOAL-010**.

1. R-18 của GOAL-006 (source `brief-006.md`, sha256
   `d3721a8812fccf7a526b1aebe77d2422a5001c1990065724601563c638fc6eb1`), dòng
   329–330:

   > Khuyến mãi (GOAL-009): không mã giảm giá — số tiền thu chỉ đối soát
   > với tổng đơn GOAL-005 đã snapshot.

2. R-16 của GOAL-007 (source `brief-007.md`, sha256
   `5586ce9122656edcbd73a2cf609470e1e354ef85fb39ffeb00c70cec04c7f906`), dòng
   476–477:

   > Khuyến mãi (GOAL-009): không mã giảm giá — số tiền hoàn chỉ đối soát
   > với tổng đơn GOAL-005 đã snapshot, không áp giảm giá khi trả hàng.

3. R-17 của GOAL-008 (source `brief-008.md`, sha256
   `1096245ab8319996180e7a82f65599d1190491a46acc89c3efdc211a5e96cb71`), dòng
   553–555:

   > Khuyến mãi (GOAL-009): không mã giảm giá, không chương trình theo điều
   > kiện — điểm đổi ở đây là điểm tích lũy CRM, không phải mã giảm giá;
   > giá đơn vẫn dùng giá hiệu dụng GOAL-003 đã snapshot.

Lý do loại trừ (chung cho cả ba): chúng chỉ là câu phủ định phạm vi của goal
gốc (nói goal đó không làm khuyến mãi), không phải yêu cầu dương cần
implement; toàn bộ phạm vi khuyến mãi đã được sở hữu bởi requirements riêng
R-1..R-15 của GOAL-009 (đã implement + kiểm chứng đầy đủ, gate xanh,
check/demo xanh). Adopt chúng vào GOAL-010 (báo cáo) sẽ nhận sai phạm vi.

Cơ chế APOS (đã chứng minh ở GOAL-007 cho R-20, GOAL-008 cho R-16/R-17,
GOAL-009 cho R-20): mỗi requirement entry trong brief mới với `adopts` trỏ
đúng yêu cầu gốc + disposition `excluded` + `exclusion: {kind:
"out-of-scope"}` sẽ đưa yêu cầu đó về trạng thái out-of-scope có lý do, xóa
notice mồ côi. `goal-010.json` khai 3 entry này với id `R-21` (cho R-18 của
GOAL-006), `R-22` (cho R-16 của GOAL-007), `R-23` (cho R-17 của GOAL-008) —
không dùng lại id gốc vì GOAL-010 đã có requirements riêng R-1..R-15 (theo
pattern GOAL-008 dùng id `R-22` cho entry loại trừ R-17 vì id R-17 đã có
requirement riêng; GOAL-009 dùng id `R-20` cho entry loại trừ R-18 của
GOAL-007). Mỗi entry có `adopts` `{"sourceSha256": <sha256 brief gốc>,
"requirementId": <id gốc>}`, `disposition: "excluded"`, `exclusion:
{"kind": "out-of-scope"}`, `exclusionReason` như đoạn lý do ở trên, `text`
nguyên văn, `sourceSpan` dòng tương ứng trong brief gốc. Các entry này KHÔNG
nằm trong `acceptance[].requirementIds` của bất kỳ AC nào (chúng là excluded,
không phải việc cần làm). Sau `goal create`, `apos plan` phải hiển thị cả 3
req out-of-scope GOAL-010 và `apos inbox` phải HẾT cả 3 notice; nếu còn
notice nào thì điều tra, không giấu.

## Phạm vi báo cáo được sở hữu bởi requirements riêng (không adopt/exclude R-17 GOAL-007 + R-18 GOAL-008 lúc này)

Các goal trước còn defer những câu phủ định phạm vi báo cáo sang GOAL-010
này: R-17 của GOAL-007 (`brief-007.md` dòng 479–481: "Báo cáo/đối soát tổng
hợp (GOAL-010): không tổng hợp doanh thu theo thời gian, không đối soát lô
(chỉ đối chiếu từng đơn sau trả — yêu cầu 8)"), R-18 của GOAL-008
(`brief-008.md` dòng 556–558: "Báo cáo/đối soát tổng hợp (GOAL-010): không
tổng hợp doanh thu theo khách/thời gian, không đối soát lô (chỉ tóm tắt từng
khách — yêu cầu 2, và đối soát từng đơn — D22)"). Cả hai đều chỉ là câu phủ
định phạm vi của goal cũ, không phải yêu cầu dương cần implement — giống hệt
pattern các câu phủ định khuyến mãi đã loại trừ ở trên. Phạm vi báo cáo mà
chúng nhắc tới được sở hữu đầy đủ bởi requirements riêng R-1..R-15 của brief
này. Theo quyết định của parent (27/11): KHÔNG adopt/exclude chúng trong
goal này, KHÔNG tạo goal phụ; nếu sau khi GOAL-010 đóng mà inbox sinh notice
mồ côi cho R-17/R-18 này thì đó là việc của goal sau (ghi chú để coordinator
quyết).

## Kết quả mong muốn

- Báo cáo doanh thu theo kênh bán (counter/web/api), theo chi nhánh, theo
  sản phẩm/danh mục, theo khoảng thời gian (từ–đến, mặc định tháng hiện
  tại); chỉ tính đơn completed — đơn draft/confirmed/processing/cancelled
  không vào doanh thu (chốt luật + test).
- Đối soát 3 mặt kho–đơn–thanh toán: tồn kho theo movements GOAL-004 vs đơn
  completed vs tiền đã thu/hoàn GOAL-006 — lệch thì báo cáo liệt kê từng
  dòng lệch (mặt nào, mã nào, số kỳ vọng vs số thực tế, chênh bao nhiêu);
  dữ liệu mẫu đã biết cho 0 lệch, dữ liệu chèn lệch cố ý thì bị phát hiện
  đúng dòng.
- Báo cáo khuyến mãi đã dùng (số mã, tổng giảm theo mã GOAL-009) + điểm đã
  đổi (GOAL-008); xuất CSV cho mỗi báo cáo, số liệu khớp đúng với API JSON.
- Phân quyền xem báo cáo theo vai + scope chi nhánh: accountant xem toàn
  org, sales chỉ chi nhánh mình (hỏi ngoài phạm vi → 403), warehouse chỉ
  xem báo cáo tồn theo kho được gán.
- Audit log cho xuất báo cáo (ai xuất, báo cáo nào, khoảng thời gian,
  filter); báo cáo tính ở service từ dữ liệu thật đã có, không lưu bảng
  tổng riêng; múi giờ hiển thị Asia/Ho_Chi_Minh, lưu UTC (D10); tiền số
  nguyên đồng.
- RBAC + audit + checks/docs đầy đủ; check.sh/demo.sh xanh kể cả bước báo
  cáo mới.

## Yêu cầu

### R-1 — Định nghĩa chỉ số + luật chỉ tính đơn completed

Doanh thu chỉ tính đơn có `status = 'completed'` tại thời điểm báo cáo.
Thời gian của một đơn trong báo cáo là thời điểm hoàn tất — `created_at`
của `order_events` có `to_status = 'completed'` (lưu UTC trong DB, xem D10;
không có cột `completed_at` riêng, không thêm cột mới cho việc này). Đơn
`draft`/`confirmed`/`processing`/`cancelled` KHÔNG vào doanh thu, kể cả
đơn đã thu tiền đặt cọc (tiền thu của đơn chưa completed vẫn hiện ở mục tiền
thu / đối soát từng đơn, không cộng vào doanh thu). Đơn completed rồi bị trả
hàng (GOAL-007) vẫn tính doanh thu gộp — tiền hoàn trừ riêng ở cột hoàn
tiền, không sửa lại doanh thu. Các chỉ số (tiền số nguyên đồng, D10):
doanh thu gộp = Σ `orders.total` (snapshot GOAL-005) của đơn completed
trong kỳ; doanh thu thuần = Σ (`total` − `points_discount` −
`promo_discount`); số đơn = số đơn completed trong kỳ; tiền đã thu = Σ
`paid_total` (theo `computePaymentSummary`, D22/D27) của các đơn completed
trong kỳ — tính theo đơn, không theo ngày thu; tiền hoàn = Σ
`refunded_total` của các đơn completed trong kỳ; tiền còn phải thu = Σ
`outstanding` của các đơn completed trong kỳ (âm nghĩa là thừa, như D22,
hiện rõ không giấu). Khoảng thời gian `from`/`to` là ngày theo
Asia/Ho_Chi_Minh (`YYYY-MM-DD`), chuyển sang UTC để lọc (`from` 00:00 +07
= hôm trước 17:00 UTC); mặc định là tháng hiện tại (từ ngày 1 tới hôm nay,
theo Asia/Ho_Chi_Minh); `from` > `to` → 400; định dạng ngày sai → 400.
Mọi số tiền trong báo cáo là số nguyên đồng, không float.

### R-2 — API báo cáo doanh thu theo kênh / chi nhánh / sản phẩm / thời gian

`GET /api/reports/revenue?from=&to=&channel=&branch_id=&group_by=` trả
doanh thu trong kỳ, lọc theo kênh (`counter`/`web`/`api`, kênh lạ → 400)
và chi nhánh (không tồn tại → 404, ngoài org → 403), nhóm theo
`group_by` ∈ `day`/`month`/`channel`/`branch`/`product`/`category`
(mặc định `day`; giá trị lạ → 400). Response JSON: `{from, to, timezone:
'Asia/Ho_Chi_Minh', totals: {gross_revenue, net_revenue, order_count,
paid_total, refunded_total, outstanding_total, points_discount_total,
promo_discount_total}, rows: [{key, label, gross_revenue, net_revenue,
order_count, paid_total, refunded_total, points_discount_total,
promo_discount_total}]}` — `totals` bằng tổng các `rows` (test khớp số);
nhóm theo `product` dùng `order_items` (mỗi dòng tính theo `line_total`
snapshot, trừ điểm/mã phân bổ theo tỉ lệ `line_total`/`total` của đơn —
ghi rõ công thức phân bổ trong D28, tổng các dòng sản phẩm khớp
`net_revenue`); nhóm theo `category` gom các sản phẩm cùng danh mục
(sản phẩm chưa có danh mục gom vào nhóm `Chưa phân loại`); nhóm theo
`day`/`month` dùng ngày hoàn tất theo Asia/Ho_Chi_Minh. Kỳ không có đơn
nào → `totals` toàn 0, `rows` rỗng (200, không 404). Mọi API báo cáo lọc
theo org của user đang đăng nhập (xem yêu cầu 8).

### R-3 — API báo cáo tồn kho + biến động + cảnh báo tồn thấp

`GET /api/reports/stock?warehouse_id=&variant_id=&from=&to=` trả tồn kho
tại thời điểm gọi + biến động trong kỳ: `levels` theo từng cặp (biến thể,
kho) `{variant_id, sku, product_name, warehouse_id, warehouse_name,
on_hand, reserved, available}` (available = on_hand − reserved, D17);
`movements` tóm tắt theo loại `{type, count, qty_total}` trong kỳ (lọc
theo `created_at` UTC, `from`/`to` theo Asia/Ho_Chi_Minh như yêu cầu 1);
`low_stock` = các cặp có `available < products.min_stock` (D17) kèm
`min_stock` và `shortage = min_stock − available`. Lọc theo kho không tồn
tại → 404, ngoài org → 403; biến thể không tồn tại → 404. Kho `inactive`
vẫn hiện trong báo cáo (chỉ đọc, không thao tác mới — D17). Số liệu lấy từ
`stock_levels` + `stock_movements` đã có (GOAL-004), không bảng mới.

### R-4 — Đối soát 3 mặt kho–đơn–thanh toán (liệt kê từng dòng lệch)

`GET /api/reports/reconciliation?from=&to=&branch_id=` đối soát trong kỳ
theo 3 mặt, trả `{from, to, timezone, summary: {checked_orders,
checked_stock_pairs, mismatch_count}, mismatches: [...]}`. Ba mặt kiểm tra:
(a) kho — với mỗi cặp (biến thể, kho) có `stock_levels` hoặc có movement:
tồn kỳ vọng = Σ `qty_change` của MỌI movement của cặp đó từ đầu (không chỉ
trong kỳ) so với `stock_levels.on_hand` hiện tại; giữ kỳ vọng = Σ
`reserved_change` so với `stock_levels.reserved`; lệch → 1 dòng mismatch
`kind: 'stock-level'` kèm `variant_id`, `warehouse_id`, `expected`,
`actual`, `difference`;
(b) đơn–kho — với mỗi đơn completed trong kỳ: mỗi dòng `order_items`
phải có movement `out` với `reference` = mã đơn và `qty_change` = −số
lượng dòng, kèm movement `release` tương ứng (D19: hoàn tất = release +
out trong cùng transaction); thiếu/thừa/sai số → 1 dòng mismatch `kind:
'order-stock'` kèm `order_code`, `variant_id`, `expected_qty`,
`actual_qty`;
(c) đơn–tiền — với mỗi đơn completed trong kỳ, dùng lại
`computePaymentSummary` (D22/D27): đơn có `outstanding > 0` → 1 dòng
`kind: 'order-payment'` trạng thái `chưa thu đủ` (đây là trạng thái, không
phải lỗi dữ liệu — phân biệt bằng trường `severity: 'info'`); đơn có
`outstanding < 0` → 1 dòng `kind: 'order-payment'` trạng thái `thu thừa`
(`severity: 'info'`); đơn có `payment_status = 'refunded'` mà
`refunded_total` ≠ tổng refund `completed` → dòng `severity: 'error'`.
`mismatch_count` = số dòng trong `mismatches`; dữ liệu mẫu đã biết (luồng
chuẩn GOAL-004/005/006/007) cho `mismatch_count` = 0 ở các dòng `error`
(không có dòng `stock-level` hay `order-stock` nào). Không sửa dữ liệu khi
đối soát (chỉ đọc).

### R-5 — Đối soát từng đơn dùng lại computePaymentSummary, KHÔNG đổi ngữ nghĩa payment_status

Đối soát từng đơn trong báo cáo dùng lại `computePaymentSummary`
(`src/payments.ts`, D22/D27): `outstanding = order_total −
points_discount − promo_discount − paid_total`; `payment_status` GIỮ
NGUYÊN logic D22 (như GOAL-008/009 đã làm: đơn đổi điểm/mã hết tổng mà
chưa trả đồng nào vẫn `unpaid`; hoàn trực tiếp một phần giữ
`partially_paid`, hoàn qua trả hàng giữ `partially_refunded` — xem D25).
GOAL-010 KHÔNG đổi ngữ nghĩa `payment_status` (đây là hành vi đã khóa của
GOAL-006/007/008/009 — muốn đổi thì làm `tests revise` ở goal sau, ghi rõ
trong D28 nếu phát hiện ngữ nghĩa gây nhầm trong báo cáo). Báo cáo hiển thị
cả `outstanding` lẫn `payment_status` để người đọc tự thấy sự khác biệt
(ví dụ đơn trả đủ phần còn phải trả sau giảm nhưng chưa bằng tổng gốc vẫn
`partially_paid`).

### R-6 — Báo cáo khuyến mãi đã dùng + điểm đã đổi

`GET /api/reports/promotions?from=&to=&code=` trả theo từng mã: `{code,
promotion_id, used_count, released_count, total_discount, order_count}`
— `used_count` = số usage status `'used'`, `released_count` = số usage
`'released'` (hủy đơn hoàn lượt, D27), `total_discount` = Σ
`discount_amount` của usage `'used'` tạo trong kỳ (theo `created_at` của
usage), `order_count` = số đơn khác nhau có usage trong kỳ; lọc `code`
theo chuỗi con (như `GET /api/promotions`); mã chưa từng dùng trong kỳ
vẫn hiện với các số 0 (để thấy mã ế). `GET /api/reports/points?from=&to=`
trả `{totals: {earned_total, redeemed_total, redeemed_amount},
rows: [{customer_id, customer_name, earned, redeemed,
redeemed_amount}]}` — `earned_total` = Σ điểm `earn` trong kỳ,
`redeemed_total` = Σ điểm `redeem` trong kỳ, `redeemed_amount` =
`redeemed_total` × 100đ (D26: 1 điểm = 100đ); điểm tích tính trên tổng gốc
(D27: không trừ promo_discount). Cả hai báo cáo lọc theo org + phạm vi vai
(xem yêu cầu 8); kỳ không có dữ liệu → totals 0, rows rỗng (200).

### R-7 — Xuất CSV cho mỗi báo cáo (số liệu khớp API JSON)

Mọi endpoint báo cáo (yêu cầu 2, 3, 4, 6) nhận thêm `?format=csv` trả
`Content-Type: text/csv; charset=utf-8`, cùng dữ liệu với bản JSON (cùng
`from`/`to`/filter, cùng kỳ): mỗi báo cáo có đúng các cột đã định nghĩa
(doanh thu: `key,label,gross_revenue,net_revenue,order_count,paid_total,
refunded_total,points_discount_total,promo_discount_total`; tồn kho:
`variant_id,sku,product_name,warehouse_id,warehouse_name,on_hand,reserved,
available,min_stock,shortage`; đối soát: `kind,severity,order_code,
variant_id,warehouse_id,expected,actual,difference,note`; khuyến mãi:
`code,used_count,released_count,total_discount,order_count`; điểm:
`customer_id,customer_name,earned,redeemed,redeemed_amount`); dòng tổng
`TOTAL` cuối file cho báo cáo doanh thu/khuyến mãi/điểm (khớp `totals`
của JSON); số liệu CSV khớp đúng từng số với response JSON cùng filter
(test so sánh trực tiếp); dùng `csv-stringify` như GOAL-003 (xử lý BOM,
dấu phẩy trong tên); `format` lạ → 400. Xuất CSV ghi audit log (xem yêu
cầu 9); xem JSON không ghi audit (tránh nhiễu log — ghi rõ trong D28).

### R-8 — RBAC xem báo cáo theo vai + scope chi nhánh

Mở rộng helper can() ở src/rbac.ts thêm actions `view-reports` (xem báo
cáo JSON) và `export-reports` (xuất CSV) theo đúng ma trận: xem doanh
thu/đối soát/khuyến mãi/điểm + xuất CSV các báo cáo đó: owner/manager toàn
org, accountant toàn org (chỉ xem, không sửa gì — báo cáo chỉ đọc);
sales chỉ chi nhánh mình — gọi không có `branch_id` thì mặc định lọc chi
nhánh mình, gọi `branch_id` khác → 403, gọi báo cáo tồn kho → 403;
warehouse chỉ xem báo cáo tồn kho (`GET /api/reports/stock`, chỉ kho được
gán — `warehouse_id` NULL = mọi kho; hỏi kho ngoài phạm vi → 403), các
báo cáo khác → 403; mọi endpoint báo cáo qua requireRole + can() (vai sai
→ 403, ngoài org → 403, sai chi nhánh/kho → 403). Test chứng minh từng ô
cấm trong ma trận (ít nhất: sales xem doanh thu chi nhánh khác → 403,
sales xem báo cáo tồn → 403, warehouse xem doanh thu → 403, warehouse
xem tồn kho ngoài phạm vi → 403, user org A đọc báo cáo org B → 403,
accountant xem toàn org → 200 nhưng chỉ đọc).

### R-9 — Audit log cho xuất báo cáo

Ghi vào audit_log đã có MỖI lần xuất CSV báo cáo (action
`export-report`): mỗi bản ghi có user_id người thực hiện, created_at,
action + detail JSON (`report` ∈ `revenue`/`stock`/`reconciliation`/
`promotions`/`points`, `from`, `to`, `format: 'csv'`, các filter đã dùng
`channel`/`branch_id`/`warehouse_id`/`code`/`group_by` khi có, KHÔNG chứa
thông tin thẻ, KHÔNG chứa PII khách — chỉ id + số liệu); xem log theo
luật GOAL-002 (GET /api/audit-log: owner toàn org, manager trong phạm
vi, các vai khác → 403). Xem báo cáo JSON không ghi audit (xem yêu cầu 7).
Test: xuất CSV → audit log có đúng 1 bản ghi khớp filter đã xuất; xem JSON
→ không tăng số bản ghi audit.

### R-10 — Báo cáo tính ở service từ dữ liệu thật đã có, không lưu bảng tổng riêng

Mọi số liệu báo cáo tính ở service (hàm thuần trong `src/reports.ts` mới
hoặc mở rộng service hiện có — Lead chốt vị trí) từ các bảng đã có
(`orders`/`order_items`/`order_events`, `payments`/`refunds`,
`stock_levels`/`stock_movements`, `promotion_usages`, `customer_points`,
`products`/`product_variants`/`categories`); KHÔNG tạo bảng tổng hợp
mới, KHÔNG lưu cột tổng riêng, KHÔNG migration 015 trừ khi Lead chứng
minh cần index cho truy vấn báo cáo (khi đó migration 015 chỉ thêm index,
ghi rõ trong D28). Không cache kết quả báo cáo trong DB hay file (mỗi lần
gọi tính lại từ dữ liệu gốc — tránh lệch như D22/D26/D27 đã chốt cho đối
soát/điểm/khuyến mãi).

### R-11 — Test mới (vitest + supertest, thêm vào file test mới — KHÔNG sửa 333 test đã khóa của GOAL-001..009)

Chứng minh luật chỉ tính completed (đơn draft đã thu tiền không vào doanh
thu; đơn cancelled không vào doanh thu; đơn completed bị trả hàng vẫn tính
doanh thu gộp, tiền hoàn ở cột riêng), nhóm theo kênh/chi nhánh/sản phẩm/
danh mục/ngày (tổng các dòng khớp totals; nhóm sản phẩm phân bổ điểm/mã
theo tỉ lệ line_total/total), mặc định tháng hiện tại + biên múi giờ
(đơn hoàn tất 00:30 +07 ngày 1 vẫn thuộc ngày 1, không rơi sang hôm trước
theo UTC), báo cáo tồn (available = on_hand − reserved; tồn thấp đúng
ngưỡng min_stock), đối soát 3 mặt (dữ liệu mẫu đã biết cho 0 dòng error;
chèn lệch trực tiếp ở tầng DB — sửa stock_levels / thiếu movement out —
rồi gọi API thấy đúng dòng lệch `stock-level`/`order-stock` kèm số kỳ
vọng vs thực tế), báo cáo khuyến mãi + điểm (số mã, tổng giảm theo mã,
điểm đổi × 100đ), CSV khớp JSON từng số (so sánh trực tiếp cùng filter),
RBAC 403 theo ma trận (yêu cầu 8), audit xuất CSV (yêu cầu 9). Test dùng
dữ liệu giả lập (2 org, 2 chi nhánh, 2 kho, 2 kênh trở lên).

### R-12 — Dữ liệu GIẢ LẬP hoàn toàn; mật khẩu seed + secret qua biến môi trường

Như GOAL-001..009: không commit credential thật; check.sh vẫn quét secret
(grep như GOAL-001); seed giữ nguyên 2 user, 2 sản phẩm, 2 kho + mức tồn
mẫu để test khóa vẫn xanh (demo tự tạo đơn/thanh toán/khuyến mãi để có số
liệu báo cáo).

### R-13 — scripts/check.sh (CHK-1) và scripts/demo.sh (CHK-2) được MỞ RỘNG + docs

Thêm bước báo cáo vào smoke/demo (tạo đơn 250.000đ kênh counter → xác nhận
→ xử lý → hoàn tất → thu tiền 100.000đ → tạo đơn draft 50.000đ + thu đặt
cọc 20.000đ → tạo đơn khác rồi hủy → gọi báo cáo doanh thu tháng hiện tại:
doanh thu gộp 250.000đ, số đơn 1, tiền đã thu 100.000đ, outstanding
150.000đ (đơn draft/hủy không vào) → gọi báo cáo theo kênh counter khớp
số trên → gọi đối soát 3 mặt: mismatch error 0 → gọi báo cáo khuyến mãi +
điểm → xuất CSV doanh thu khớp JSON → RBAC 403: sales xem doanh thu chi
nhánh khác, warehouse xem doanh thu, sales xem báo cáo tồn), giữ tất cả
bước GOAL-001..009 xanh (health, login, owner-only, idempotency,
backup/restore, RBAC người dùng, sản phẩm/giá/CSV, kho, đơn, thanh toán,
giao/trả, khách/CRM, khuyến mãi). Cả 2 script tự chạy được, tự dọn dẹp,
in PASS/FAIL từng bước. Docs: docs/RBAC.md bổ sung ma trận báo cáo (bảng
ở trên); docs/DECISIONS.md thêm D28 (định nghĩa chỉ số + luật chỉ tính
completed + thời điểm hoàn tất từ order_events + công thức phân bổ
điểm/mã theo dòng sản phẩm + đối soát 3 mặt + CSV khớp JSON + audit chỉ
cho xuất CSV + không bảng tổng riêng); README.md/docs/SETUP.md cập nhật
endpoint báo cáo, khớp lệnh đã chạy thật. Không có file
.github/workflows/ trong repo (gh token thiếu scope workflow — CI là
follow-up sau khi user cấp scope). Không claim VPS, không claim deploy
production (local-only, D9).

### R-14 — Thông báo (GOAL-011)

Không gửi email/SMS khi có lệch đối soát hay khi doanh thu đạt ngưỡng (chỉ
báo cáo + audit log); thông báo là yêu cầu riêng của GOAL-011.

### R-15 — UI tổng quan (GOAL-012)

Không thêm màn hình báo cáo (chỉ API JSON + CSV); màn hình tổng quan/báo
cáo là yêu cầu riêng của GOAL-012.

### R-21 — Loại trừ R-18 (GOAL-006) có lý do (xem mục riêng ở trên)

Yêu cầu R-18 của GOAL-006 (source `brief-006.md`, sha256
`d3721a8812fccf7a526b1aebe77d2422a5001c1990065724601563c638fc6eb1`):
"Khuyến mãi (GOAL-009): không mã giảm giá — số tiền thu chỉ đối soát với
tổng đơn GOAL-005 đã snapshot." — loại trừ có lý do (out-of-scope), KHÔNG
adopt vào GOAL-010 vì đây chỉ là câu phủ định phạm vi của GOAL-006, không
phải yêu cầu dương cần implement; toàn bộ phạm vi khuyến mãi đã được sở hữu
bởi requirements riêng R-1..R-15 của GOAL-009 (đã implement + kiểm chứng
đầy đủ). Adopt vào GOAL-010 (báo cáo) sẽ nhận sai phạm vi.

### R-22 — Loại trừ R-16 (GOAL-007) có lý do (xem mục riêng ở trên)

Yêu cầu R-16 của GOAL-007 (source `brief-007.md`, sha256
`5586ce9122656edcbd73a2cf609470e1e354ef85fb39ffeb00c70cec04c7f906`):
"Khuyến mãi (GOAL-009): không mã giảm giá — số tiền hoàn chỉ đối soát với
tổng đơn GOAL-005 đã snapshot, không áp giảm giá khi trả hàng." — loại trừ
có lý do (out-of-scope), KHÔNG adopt vào GOAL-010 vì đây chỉ là câu phủ
định phạm vi của GOAL-007, không phải yêu cầu dương cần implement; toàn bộ
phạm vi khuyến mãi đã được sở hữu bởi requirements riêng R-1..R-15 của
GOAL-009 (đã implement + kiểm chứng đầy đủ). Adopt vào GOAL-010 (báo cáo)
sẽ nhận sai phạm vi.

### R-23 — Loại trừ R-17 (GOAL-008) có lý do (xem mục riêng ở trên)

Yêu cầu R-17 của GOAL-008 (source `brief-008.md`, sha256
`1096245ab8319996180e7a82f65599d1190491a46acc89c3efdc211a5e96cb71`):
"Khuyến mãi (GOAL-009): không mã giảm giá, không chương trình theo điều
kiện — điểm đổi ở đây là điểm tích lũy CRM, không phải mã giảm giá; giá đơn
vẫn dùng giá hiệu dụng GOAL-003 đã snapshot." — loại trừ có lý do
(out-of-scope), KHÔNG adopt vào GOAL-010 vì đây chỉ là câu phủ định phạm vi
của GOAL-008, không phải yêu cầu dương cần implement; toàn bộ phạm vi
khuyến mãi đã được sở hữu bởi requirements riêng R-1..R-15 của GOAL-009 (đã
implement + kiểm chứng đầy đủ). Adopt vào GOAL-010 (báo cáo) sẽ nhận sai
phạm vi.

## Ngoài phạm vi (thuộc goal sau / vĩnh viễn, không làm trong GOAL-010)

- Thông báo (GOAL-011): không gửi email/SMS khi có lệch đối soát hay khi
  doanh thu đạt ngưỡng (R-14, deferred sang GOAL-011).
- UI tổng quan (GOAL-012): không thêm màn hình báo cáo (R-15, deferred
  sang GOAL-012).
- Đơn vị vận chuyển thật / giao hàng thật, tài khoản hãng vận chuyển, cổng
  thanh toán thật — ngoài phạm vi vĩnh viễn của dự án giả lập này; deploy
  production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user cấp
  scope workflow).

## Rủi ro / phụ thuộc

- Phụ thuộc GOAL-005 (đơn + order_events làm mốc thời gian hoàn tất),
  GOAL-006 (thanh toán/hoàn + computePaymentSummary), GOAL-007 (giao/trả
  — đơn completed bị trả hàng vẫn tính doanh thu, tiền hoàn trừ riêng);
  đọc thêm dữ liệu GOAL-008 (điểm) và GOAL-009 (mã giảm giá) — cả hai đã
  CLOSED.
- Rủi ro lớn nhất: định nghĩa doanh thu mơ hồ (tính theo ngày tạo đơn hay
  ngày hoàn tất? tiền thu tính theo đơn hay theo ngày thu?) — brief này
  chốt cứng: theo ngày hoàn tất (order_events) và theo đơn, test khóa biên
  múi giờ; Lead không được đổi luật mà không qua `goal revise`.
- Rủi ro thứ hai: đối soát 3 mặt tính sai kỳ vọng tồn kho (movement
  `count` đặt lại tuyệt đối, `transfer` có 2 phía) — brief chốt kỳ vọng
  bằng Σ `qty_change`/`reserved_change` từ đầu; Lead kiểm chứng bằng dữ
  liệu mẫu đã biết trước khi viết test lệch.
- Ngữ nghĩa `payment_status` D22 có thể gây nhầm trong báo cáo (đơn trả đủ
  phần còn phải trả sau giảm nhưng chưa bằng tổng gốc vẫn
  `partially_paid`) — goal này KHÔNG đổi ngữ nghĩa, chỉ hiển thị cả
  `outstanding` lẫn `payment_status`; nếu cần đổi thì `tests revise` ở
  goal sau.

## Checks

- CHK-1: `./scripts/check.sh` — pass.
- CHK-2: `./scripts/demo.sh` — pass.

## Revise v2 — tăng timeout CHK-2 lên 20 phút (27/11/2026, sau khi goal v1 đã verified + merge)

Lý do duy nhất của revise này: post-merge gate của close v1 TIMED OUT ở CHK-2 hai lần giống hệt nhau (CHK-1 pass cả hai lần; CHK-2 `delivery timed out`, exitCode null, log chỉ có header + `[apos] check timed out; process tree killed`). Nguyên nhân đã kiểm chứng trực tiếp: timeout mặc định của APOS cho một check là 600.000 ms (10 phút, `src/domain/contracts.ts` — `timeoutMs` default 600_000, max 3_600_000). `demo.sh` chạy standalone đã mất 6m43s khi máy yên; trong gate worktree (npm ci lạnh + CHK-1 vừa chạy trước + RAM free có lúc chỉ ~130MB, load cao) nó vượt 10 phút. Code không sai — close-stage layers L0–L3 đều xanh, kiểm chứng độc lập của coordinator (check.sh PASS + demo.sh PASS trên commit verified a1f46b7) cũng xanh.

Thay đổi duy nhất ở v2: `checks` CHK-2 thêm `"timeoutMs": 1200000` (20 phút). CHK-1 giữ mặc định (đã pass 2 lần ở ~7 phút). Không đổi code, không đổi test, không đổi acceptance criteria, không đổi phạm vi. Goal version 1 → 2. Sau revise: Lead propose lại (goalVersion 2, proposal version 2), Tester/Worker submit lại đúng commit đã khóa/đã verified (test 2fc3aab, package a1f46b7), gate chạy lại với timeout mới rồi close.
