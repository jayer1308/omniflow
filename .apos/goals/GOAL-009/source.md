# OmniFlow — brief GOAL-009: Khuyến mãi

## Bối cảnh (vấn đề)

OmniFlow là hệ thống vận hành thương mại đa kênh cho doanh nghiệp vừa (nhiều
doanh nghiệp, nhiều chi nhánh, nhiều kho, nhiều kênh bán), dự án dài hạn để kiểm
tra APOS ở quy mô lớn. Roadmap: `docs/ROADMAP.md` (12 Goal + GOAL-005A đã
đóng). Quyết định kiến trúc: `docs/DECISIONS.md` (D1–D26).

GOAL-009 xây nghiệp vụ khuyến mãi trên nền GOAL-001 (đã CLOSED) + GOAL-002
(RBAC, đã CLOSED) + GOAL-003 (sản phẩm/giá, đã CLOSED) + GOAL-004 (kho, đã
CLOSED) + GOAL-005 (đơn hàng, đã CLOSED) + GOAL-005A (adopt R-19, đã CLOSED)
+ GOAL-006 (thanh toán + hoàn tiền, đã CLOSED) + GOAL-007 (giao hàng + trả
hàng, đã CLOSED) + GOAL-008 (khách hàng + CRM, đã CLOSED): mã giảm giá +
chương trình theo điều kiện (tổng đơn tối thiểu, kênh bán, chi nhánh, thời
gian hiệu lực, giới hạn số lần dùng tổng + mỗi khách); loại giảm % theo tổng
đơn (có cap) và số tiền cố định; áp mã vào đơn nháp (tính lại tổng sau giảm,
ghi rõ mã + số tiền giảm trên đơn); luật chồng giảm với điểm GOAL-008 rõ
ràng, không cộng dồn vượt tổng đơn; hủy đơn có mã thì hoàn lượt dùng; lịch
sử dùng mã append-only. Phụ thuộc: GOAL-003 (giá) + GOAL-005 (đơn hàng).
Không làm báo cáo tổng hợp (GOAL-010), thông báo (GOAL-011), UI tổng quan
(GOAL-012) trong goal này. Dữ liệu GIẢ LẬP hoàn toàn; không tiền thật, không
tài khoản thanh toán thật, không dịch vụ trả phí.
Dự án chỉ làm LOCAL — không có VPS trong phạm vi (user xác nhận 26/11 21:49).

Đề xuất: size M, appetite 480 phút, 3 lần thử (Human delegate duyệt ở gate A;
đặt dư vì APOS tính wall-clock từ lúc select — bài học DRAK GOAL-002).
Solo WP-MAIN: quy mô M vừa, toàn bộ thay đổi nằm trong một gói duy nhất
(schema + service + routes + test + scripts + docs), không có ranh giới gói
độc lập để tách multi-WP; mỗi acceptance criterion thuộc đúng một package
(WP-MAIN).

Điểm xuất phát (GOAL-001..008, đã khóa — KHÔNG sửa):
`src/app.ts` (Express, EJS, session cookie, middleware `requireRole`/
`requireScope`, route người dùng/chi nhánh/audit log/sản phẩm/giá/CSV/kho/
đơn/thanh toán/giao-trả/khách/CRM), `src/rbac.ts` (helper `can()`, actions
hiện tại: 10 actions người dùng + 8 actions sản phẩm/giá/CSV + 1 action xem
giá riêng chi nhánh (`view-branch-price`) + 11 actions kho + 6 actions đơn +
3 actions thanh toán + 8 actions giao/trả + 9 actions khách/CRM),
`src/db.ts` (migration 001–013; chưa có bảng khuyến mãi nào), `src/seed.ts`
(1 org, 1 branch "Chi nhánh Chính", 2 user: owner + sales; 2 sản phẩm mẫu;
2 kho mẫu), `src/tenant.ts` (middleware scope org/branch),
`src/idempotency.ts` (helper `withIdempotency` — kiểm tra key ngoài
transaction), `src/orders.ts` (`createOrderTx`, `transitionOrderTx`, mã đơn
`DH-YYYYMMDD-NNNN`, state machine draft → confirmed → processing →
completed/cancelled, `customer_id` optional + `points_discount` trên đơn —
GOAL-008), `src/products.ts` (`effectivePrice()` fallback 8 bước +
`resolveEffectivePrice()`), `src/stock.ts` (`runStockTransaction`,
`applyMovement`, `withStockIdempotency` — kiểm tra key + thực thi + ghi key
trong CÙNG MỘT transaction), `src/payments.ts` (`computePaymentSummary` —
đối soát tính ở service từ bảng payments/refunds, không lưu cột tổng riêng;
lưu ý `partially_refunded` chỉ khi đơn có yêu cầu trả đã hoàn tiền, còn hoàn
trực tiếp một phần giữ `partially_paid` theo test khóa GOAL-006 — xem D25;
GOAL-008 mở rộng `outstanding = order_total − points_discount −
paid_total`, `payment_status` GIỮ NGUYÊN logic D22 — xem D26),
`src/customers.ts` (tích điểm 1 điểm/10.000đ khi đơn completed, đổi điểm
1 điểm = 100đ trừ tiền đơn mới — D26), `tests/acceptance.test.ts` +
`tests/rbac-acceptance.test.ts` + `tests/products-acceptance.test.ts` +
`tests/stock-acceptance.test.ts` + `tests/orders-acceptance.test.ts` +
`tests/orders-005a-acceptance.test.ts` + `tests/payments-acceptance.test.ts`
+ `tests/shipments-returns-acceptance.test.ts` +
`tests/customers-crm-acceptance.test.ts` — tổng 286 test vitest xanh trên
main khi đóng GOAL-008 (gate xanh, đã chạy thật 27/11), KHÔNG sửa test cũ,
`scripts/check.sh` (CHK-1) + `scripts/demo.sh` (CHK-2) — goal này MỞ RỘNG
2 script, giữ các bước GOAL-001..008 xanh.

## Loại trừ R-18 (GOAL-007) có lý do

`apos inbox` đang có 1 notice `orphan-requirement`: yêu cầu R-18 của GOAL-007
(source `brief-007.md`, sha256
`5586ce9122656edcbd73a2cf609470e1e354ef85fb39ffeb00c70cec04c7f906`) đã defer
từ GOAL-007 sang GOAL-008 nhưng GOAL-008 đóng mà không adopt (vì brief-008
có requirements RIÊNG R-1..R-15 cho CRM). Quyết định đã chốt (parent, 27/11):
**LOẠI TRỪ R-18 CÓ LÝ DO, KHÔNG adopt vào GOAL-009**.

R-18 nguyên văn (GOAL-007, `brief-007.md` dòng 483–486):

> Khách hàng + CRM (GOAL-008): không có bảng khách hàng, không lịch sử
> giao/trả theo khách; thông báo (GOAL-011): không gửi email khi giao
> hàng/trả hàng (chỉ audit log + lịch sử giao/trả); UI tổng quan (GOAL-012):
> không thêm màn hình giao/trả.

Lý do loại trừ: R-18 gộp 3 phạm vi — CRM đã xong ở GOAL-008 (requirements
riêng R-1..R-15), thông báo là yêu cầu riêng của GOAL-011, UI tổng quan là
yêu cầu riêng của GOAL-012; adopt cả R-18 vào GOAL-009 (khuyến mãi) sẽ nhận
sai phạm vi. Toàn bộ phạm vi mà R-18 nhắc tới đã hoặc sẽ được sở hữu bởi
requirements riêng của từng goal (008 đã xong, 011/012 sẽ có brief riêng);
không còn yêu cầu nào chưa được sở hữu.

Cơ chế APOS (đã chứng minh ở GOAL-007 cho R-20 và GOAL-008 cho R-16/R-17):
một requirement entry trong brief mới với `adopts` trỏ đúng yêu cầu gốc +
disposition `excluded` + `exclusion: {kind: "out-of-scope"}` sẽ đưa yêu cầu
đó về trạng thái out-of-scope có lý do, xóa notice mồ côi. `goal-009.json`
khai entry này với `id` `"R-20"` (không dùng `"R-18"` vì GOAL-009 đã có
requirement riêng mang id R-18 — báo cáo/đối soát defer sang GOAL-010;
key của entry adopt là `sourceSha256` brief-007 + id riêng, không đụng key
của R-18 gốc), `adopts` `{"sourceSha256":
"5586ce9122656edcbd73a2cf609470e1e354ef85fb39ffeb00c70cec04c7f906",
"requirementId": "R-18"}`, `disposition: "excluded"`, `exclusion:
{"kind": "out-of-scope"}`, `exclusionReason` như đoạn lý do ở trên, `text`
nguyên văn R-18, `sourceSpan` "dòng 483–486 (brief-007.md)". Entry này
KHÔNG nằm trong `acceptance[].requirementIds` của bất kỳ AC nào (nó là
excluded, không phải việc cần làm). Sau `goal create`, `apos plan` phải hiển
thị R-18 out-of-scope và `apos inbox` phải HẾT notice R-18 (ở GOAL-007,
notice R-20 sạch ngay từ lúc `goal create` — đó là hành vi đúng của cơ chế
loại trừ); nếu inbox vẫn còn notice R-18 thì đó là lỗi cần điều tra, không
được giấu.

## Phạm vi khuyến mãi được sở hữu bởi requirements riêng (không dùng lại id cũ)

Các goal trước còn defer những câu phủ định phạm vi khuyến mãi sang GOAL-009
này: R-16 của GOAL-007 (`brief-007.md` dòng 476–477: "Khuyến mãi (GOAL-009):
không mã giảm giá — số tiền hoàn chỉ đối soát với tổng đơn GOAL-005 đã
snapshot, không áp giảm giá khi trả hàng"), R-18 của GOAL-006
(`brief-006.md` dòng 329–330: "Khuyến mãi (GOAL-009): không mã giảm giá —
số tiền thu chỉ đối soát với tổng đơn GOAL-005 đã snapshot"), R-17 của
GOAL-008 (`brief-008.md` dòng 553–555: "Khuyến mãi (GOAL-009): không mã
giảm giá, không chương trình theo điều kiện — điểm đổi ở đây là điểm tích
lũy CRM, không phải mã giảm giá; giá đơn vẫn dùng giá hiệu dụng GOAL-003
đã snapshot"). Cả ba đều chỉ là câu phủ định phạm vi của goal cũ, không
phải yêu cầu dương cần implement — giống hệt pattern R-17 của GOAL-006 đã
loại trừ ở GOAL-008. Phạm vi khuyến mãi mà chúng nhắc tới được sở hữu đầy
đủ bởi requirements riêng R-1..R-15 của brief này (mã giảm giá, loại giảm,
điều kiện, giới hạn dùng, áp mã, chồng giảm, hoàn lượt dùng, lịch sử dùng).
Theo quyết định của parent (27/11): KHÔNG tự tạo goal phụ hay loại trừ
chúng trong goal này; nếu sau khi GOAL-009 đóng mà inbox sinh notice mồ
côi cho R-16/R-18/R-17 này thì ghi rõ vào báo cáo để parent quyết ở goal
sau.

## Kết quả mong muốn

- Mã giảm giá tạo/sửa/khóa được, mã duy nhất trong org, loại giảm % (có cap)
  hoặc số tiền cố định, điều kiện áp dụng rõ ràng (tổng tối thiểu, kênh,
  chi nhánh, thời gian hiệu lực, giới hạn dùng tổng + mỗi khách).
- Áp mã vào đơn nháp: tính lại tổng sau giảm, đơn ghi rõ mã + số tiền giảm;
  áp sai điều kiện → 400 với lý do rõ; áp 2 lần/áp mã đã khóa/hết hạn/hết
  lượt → 400.
- Chồng giảm với điểm GOAL-008 theo MỘT luật duy nhất, tổng giảm không vượt
  tổng đơn, kết quả cuối như nhau dù áp mã trước hay đổi điểm trước (test
  cả hai chiều).
- Hủy đơn có mã → hoàn lượt dùng (lượt dùng được giải phóng, khách dùng lại
  được); trả hàng/hoàn tiền KHÔNG hoàn lượt dùng (mã đã dùng thật).
- Đối soát trừ cả điểm lẫn mã: `outstanding = order_total −
  points_discount − promo_discount − paid_total`; `payment_status` giữ
  nguyên logic D22 (như GOAL-008 đã làm với điểm).
- Lịch sử dùng mã append-only: ai dùng, đơn nào, giảm bao nhiêu.
- RBAC theo ma trận khuyến mãi + audit log đầy đủ; idempotency cho tạo mã
  + áp mã; check.sh/demo.sh xanh kể cả bước khuyến mãi mới.

## Yêu cầu

### R-1 — Migration 014: bảng khuyến mãi + lịch sử dùng mã + mở rộng bảng đơn

Migration 014 tạo 2 bảng + mở rộng bảng đơn, chạy tuần tự sau 001–013, giữ
dữ liệu cũ, không vỡ 286 test đã khóa. `promotions` (org_id NOT NULL FK tới
orgs, code TEXT NOT NULL — chuẩn hóa UPPERCASE + trim khi tạo, UNIQUE theo
org `UNIQUE(org_id, code)`, type TEXT NOT NULL CHECK IN ('percent','fixed'),
value INTEGER NOT NULL CHECK > 0, cap INTEGER NULL CHECK > 0 — chỉ có ý
nghĩa với loại percent, min_order_total INTEGER NOT NULL DEFAULT 0 CHECK >=
0, channels TEXT NULL — JSON mảng kênh con của counter/web/api, NULL = mọi
kênh, branch_id INTEGER NULL FK tới branches — NULL = mọi chi nhánh,
valid_from/valid_to TEXT NULL ISO 8601 — NULL = không giới hạn, usage_limit
INTEGER NULL CHECK > 0 — NULL = không giới hạn tổng, per_customer_limit
INTEGER NULL CHECK > 0 — NULL = không giới hạn mỗi khách, status TEXT NOT
NULL DEFAULT 'active' CHECK IN ('active','locked'), created_at/updated_at).
`promotion_usages` append-only (promotion_id NOT NULL FK tới promotions,
order_id NOT NULL FK tới orders, customer_id INTEGER NULL FK tới customers
— NULL khi đơn không gắn khách, discount_amount INTEGER NOT NULL CHECK > 0,
status TEXT NOT NULL DEFAULT 'used' CHECK IN ('used','released'),
released_at TEXT NULL, release_reason TEXT NULL, created_at; chỉ INSERT +
chuyển trạng thái used → released khi hủy đơn — xem yêu cầu 7, KHÔNG có API
DELETE usage). Migration 014 (tiếp) ALTER TABLE orders ADD COLUMN
promotion_id INTEGER NULL REFERENCES promotions(id) + ALTER TABLE orders ADD
COLUMN promo_discount INTEGER NOT NULL DEFAULT 0 CHECK (promo_discount >=
0) — đơn cũ giữ NULL/0, hành vi đơn cũ không đổi; `orders.total` là tổng
snapshot gốc (GOAL-005), KHÔNG bị sửa khi áp mã (số tiền giảm nằm ở cột
riêng `promo_discount`).

### R-2 — API tạo/sửa/khóa/xem mã giảm giá

POST /api/promotions nhận {code, type, value, cap?, min_order_total?,
channels?, branch_id?, valid_from?, valid_to?, usage_limit?,
per_customer_limit?} — code trống/quá 50 ký tự → 400; code chuẩn hóa
UPPERCASE + trim, trùng mã trong org → 409; type ngoài percent/fixed →
400; percent thì value phải là số nguyên 1..100, fixed thì value nguyên >
0; cap chỉ đi với percent (cap <= 0 → 400; gửi cap với fixed → 400);
min_order_total < 0 → 400; channels rỗng hoặc có kênh lạ → 400;
branch_id không tồn tại → 404, ngoài org → 403; valid_from/valid_to sai
định dạng ISO hoặc valid_from >= valid_to → 400; usage_limit/
per_customer_limit <= 0 → 400; thành công → 201, trả mã đã tạo. PATCH
/api/promotions/:id nhận {value?, cap?, min_order_total?, channels?,
branch_id?, valid_from?, valid_to?, usage_limit?, per_customer_limit?,
status?} — mã không tồn tại → 404, ngoài org → 403; gửi `code` trong body
→ 400 (mã không đổi sau khi tạo — muốn mã khác thì tạo mã mới); mọi luật
validate như khi tạo; status chỉ nhận active/locked (khóa = đặt locked,
mở lại = đặt active); thành công → 200, trả mã đã cập nhật. GET
/api/promotions?name=&code=&status=&channel=&branch_id=&limit=&offset= trả
danh sách mã của org (mới nhất trước; code tìm theo chuỗi con; status lạ →
400; channel lạ → 400; branch_id không tồn tại → 404, ngoài org → 403;
limit mặc định 20 tối đa 100, offset mặc định 0, kèm tổng số). GET
/api/promotions/:id trả mã kèm tóm tắt dùng {used_count, usage_limit,
per_customer_limit} (used_count = số usage status 'used'). Mọi API đọc lọc
theo org + phạm vi vai; ngoài org → 403; mã không tồn tại → 404.

### R-3 — API áp mã vào đơn nháp + mọi điều kiện áp dụng

POST /api/orders/:id/promotion nhận {code, idempotency_key?} — đơn không
tồn tại → 404, ngoài org → 403; đơn không ở draft → 400 (đơn đã xác nhận
trở đi không áp mã được); đơn đã có mã (promotion_id khác NULL) → 400 (một
đơn chỉ áp một mã); mã không tồn tại trong org → 404; mã locked → 400; kênh
của đơn không nằm trong channels của mã (khi mã giới hạn kênh) → 400; chi
nhánh của đơn khác branch_id của mã (khi mã giới hạn chi nhánh) → 400;
ngoài thời gian hiệu lực (trước valid_from hoặc sau valid_to) → 400; tổng
đơn gốc < min_order_total → 400; tổng lượt đã dùng (status 'used') >=
usage_limit → 400; lượt đã dùng của khách trên đơn (đơn có customer_id)
>= per_customer_limit → 400; thành công → 201, trong CÙNG MỘT transaction
BEGIN IMMEDIATE: ghi 1 dòng promotion_usages (status 'used',
discount_amount = số tiền giảm đã tính — xem yêu cầu 4, customer_id =
customer_id của đơn, NULL khi đơn không gắn khách) + cập nhật
orders.promotion_id + orders.promo_discount + 1 audit log, trả đơn kèm
{promotion: {id, code, type, value}, promo_discount}. Mọi kiểm tra giới
hạn dùng + ghi usage + cập nhật đơn nằm trong cùng transaction (khe race:
hai yêu cầu áp cùng mã đồng thời không được cùng lọt qua giới hạn —
xem yêu cầu 6). Không có endpoint gỡ mã trong goal này (muốn đổi mã thì
hủy đơn rồi tạo đơn mới — ghi rõ trong phần loại trừ).

### R-4 — Tính số tiền giảm: % có cap, cố định, tổng tối thiểu

Số tiền giảm tính trên `orders.total` gốc (snapshot GOAL-005, CHƯA trừ
điểm): loại percent → floor(total × value / 100), rồi min với cap (khi
cap có giá trị) và min với phần còn lại sau điểm (total − points_discount
— xem yêu cầu 5); loại fixed → min(value, total − points_discount).
promo_discount luôn >= 0 và không bao giờ làm tổng sau giảm âm:
promo_discount + points_discount <= total (ép bằng min với phần còn lại).
Ví dụ: đơn 250.000đ, mã 10% cap 20.000đ → giảm 20.000đ (10% = 25.000đ,
cắt ở cap); đơn 50.000đ, mã fixed 100.000đ → giảm 50.000đ (cắt ở tổng
đơn); đơn 30.000đ, mã min_order_total 50.000đ → 400 (không đủ tổng tối
thiểu). Tính giảm là hàm thuần ở service (dùng lại cho cả apply và test),
không tin client gửi số tiền giảm.

### R-5 — Luật chồng giảm với điểm GOAL-008 (MỘT luật duy nhất, không phụ thuộc thứ tự)

Thứ tự áp không đổi kết quả cuối — luật chốt: % giảm giá tính trên tổng đơn
GỐC (không trừ điểm trước), rồi cắt ở cap và ở phần còn lại sau điểm;
đổi điểm cắt ở phần còn lại sau mã. Cụ thể: gọi C = số tiền giảm của mã
tính theo yêu cầu 4 TRƯỚC khi cắt ở phần còn lại (percent: min(floor(total
× value / 100), cap); fixed: value), P = số điểm muốn đổi × 100. Tổng giảm
cuối = min(C + P, total). Khi áp mã trước: promo_discount = min(C, total −
points_discount hiện tại), rồi đổi điểm sau đó bị cắt ở total −
promo_discount. Khi đổi điểm trước: points_discount = min(P, total), rồi áp
mã sau đó bị cắt ở total − points_discount. Hai chiều cho cùng tổng giảm
cuối min(C + P, total) — test khóa cả hai chiều trên cùng một bộ số liệu
(mã 20% không cap + 200 điểm trên đơn 100.000đ: mã trước → mã 20.000đ +
điểm 20.000đ; điểm trước → điểm 20.000đ + mã 20.000đ; tổng giảm 40.000đ cả
hai chiều; và trường hợp bão hòa: mã 50% + 900 điểm trên đơn 100.000đ →
tổng giảm 100.000đ cả hai chiều, outstanding 0). Đổi điểm trên đơn đã có mã
vẫn đi qua đúng luật cắt ở phần còn lại sau mã (sửa tối thiểu ở
`src/customers.ts` redeem: discount = min(points × 100, order_total −
promo_discount), không đổi hành vi khi đơn chưa có mã). Không được đổi luật
chồng giảm thành tính % trên tổng đã trừ điểm (đó là luật khác, phải sửa
test khóa nếu muốn đổi).

### R-6 — Giới hạn dùng tổng + mỗi khách + chống vượt giới hạn đồng thời

Tổng lượt dùng = số dòng promotion_usages status 'used' của mã đó (không
tính dòng 'released' — xem yêu cầu 7); lượt mỗi khách = số dòng 'used' của
mã đó với customer_id đó (đơn không gắn khách thì KHÔNG tính vào giới hạn
mỗi khách — chỉ tính vào giới hạn tổng). Áp mã khi đã đủ giới hạn → 400,
không ghi usage, không đổi đơn. Chống vượt giới hạn đồng thời: mọi kiểm tra
giới hạn + ghi usage + cập nhật đơn chạy trong CÙNG MỘT transaction BEGIN
IMMEDIATE (dùng `withStockIdempotency` — xem yêu cầu 11); test đồng thời
chứng minh bất biến (10 lần áp cùng mã giới hạn 5 lượt cùng lúc → đúng 5
thành công, 5 lần còn lại 400, tổng used_count = 5). App một tiến trình
(D1), bảo vệ race chỉ có ý nghĩa trong một process; đa process ngoài phạm
vi, ghi rõ trong DECISIONS.md.

### R-7 — Hủy đơn có mã thì hoàn lượt dùng; trả hàng/hoàn tiền thì KHÔNG

Hủy đơn (`transitionOrderTx` cancel — GOAL-005) mà đơn đang có mã: trong
CÙNG MỘT transaction với đổi trạng thái đơn, dòng promotion_usages của đơn
đó chuyển status 'used' → 'released' (released_at = thời điểm hủy,
release_reason = mã đơn đã hủy), đồng thời orders.promo_discount về 0 và
orders.promotion_id về NULL. Lượt dùng đã giải phóng không còn tính vào
giới hạn (khách dùng lại được mã đó, kể cả giới hạn mỗi khách). Hủy đơn
không có mã thì không động gì tới bảng usages. Trả hàng/hoàn tiền
(GOAL-007): usage GIỮ NGUYÊN 'used' — mã đã dùng thật khi đặt đơn, số tiền
hoàn tính theo snapshot giá (D25), không hoàn lượt dùng, không trừ lại
promo_discount. Hoàn tiền trực tiếp (GOAL-006) cũng không động tới usage.

### R-8 — Đối soát sau giảm + tích điểm tính trên tổng gốc

`computePaymentSummary` (`src/payments.ts`, D22) mở rộng: outstanding =
order_total − points_discount − promo_discount − paid_total (âm nghĩa là
thừa, như D22); `payment_status` GIỮ NGUYÊN logic D22 trên (paid_total,
refunded_total, order_total) — như GOAL-008 đã làm với points_discount:
đơn đổi điểm/mã hết tổng mà chưa trả đồng nào vẫn 'unpaid'; đơn đã trả đủ
phần còn phải trả sau giảm nhưng chưa bằng tổng gốc thì vẫn
'partially_paid' theo logic D22 (đây là hành vi đã khóa của GOAL-006/007/
008 — KHÔNG đổi trong goal này; GOAL-010 đối soát tổng hợp có thể xem lại
ngữ nghĩa payment_status với `tests revise` nếu cần). Tích điểm GOAL-008
tính trên `order_total` gốc, KHÔNG trừ promo_discount (như D26 đã chốt
không trừ points_discount): đơn 250.000đ áp mã 10% vẫn tích 25 điểm khi
completed (floor(250.000 / 10.000)), không phải 22 điểm.

### R-9 — RBAC khuyến mãi

Mở rộng helper can() ở src/rbac.ts thêm actions create-promotion,
update-promotion, apply-promotion, view-promotions theo đúng ma trận:
tạo/sửa/khóa mã: chỉ owner/manager (warehouse/sales/accountant → 403);
áp mã: owner/manager toàn org, sales chỉ đơn thuộc chi nhánh mình
(warehouse/accountant → 403); xem mã: owner/manager/accountant toàn org,
sales chỉ mã có branch_id NULL (mọi chi nhánh) hoặc đúng chi nhánh mình
(warehouse → 403); mọi endpoint khuyến mãi qua requireRole + can() (vai
sai → 403, ngoài org → 403, sai chi nhánh → 403). Test chứng minh từng ô
cấm trong ma trận (ít nhất: warehouse tạo mã → 403, sales sửa mã → 403,
accountant áp mã → 403, sales áp mã cho đơn ngoài chi nhánh → 403,
warehouse xem mã → 403, user org A đọc mã org B → 403, sales xem mã giới
hạn chi nhánh khác → 403).

### R-10 — Audit log cho khuyến mãi

Ghi vào audit_log đã có MỌI thao tác tạo/sửa/khóa mã + áp mã + hoàn lượt
dùng khi hủy đơn (hủy đơn đã ghi audit cancel-order ở GOAL-005 — audit
hoàn lượt dùng ghi kèm trong cùng detail đó hoặc 1 audit riêng
'promotion-usage-released', ghi rõ trong D27); mỗi bản ghi có user_id
người thực hiện, created_at, action + detail JSON (target_promotion_id,
promotion_code, target_order_id/order_code khi áp mã, discount khi áp mã,
KHÔNG chứa thông tin thẻ); xem log theo luật GOAL-002 (GET /api/audit-log:
owner toàn org, manager trong phạm vi, các vai khác → 403).
promotion_usages là lịch sử dùng mã chi tiết; audit_log là lớp ghi nhận
thao tác nhạy cảm theo chuẩn GOAL-002 — cả hai đều phải có, không thay
nhau. Lịch sử dùng mã: usages ghi đủ mọi lần áp mã thành công (kể cả gửi
lại cùng key thì KHÔNG ghi dòng mới — xem yêu cầu 11); test: tạo mã → áp
mã → hủy đơn → áp lại: usages đúng thứ tự thời gian, đủ các bước, dòng
cũ chuyển 'released', không có dòng thừa.

### R-11 — Idempotency + chống ghi nhận 2 lần cho tạo mã + áp mã

Tạo mã và áp mã đều nhận Idempotency-Key (header) hoặc idempotency_key
(body); server dùng withStockIdempotency (GOAL-004) với tên miền key
`promotion:create:<key>` / `promotion:apply:<key>`; gửi lại cùng key +
cùng loại + cùng org → trả đúng response đã lưu kèm replayed: true, KHÔNG
tạo mã mới, KHÔNG ghi usage mới, KHÔNG trừ lượt dùng lần nữa (promo_discount
của đơn không đổi — test chứng minh). Key khác nhau thì thực thi bình
thường (nhưng một đơn chỉ áp 1 mã — lần 2 khác key → 400). Thiếu key thì
vẫn thực thi (không bắt buộc) nhưng không có bảo vệ gửi lại. Mọi tạo/áp
trong BEGIN IMMEDIATE + UNIQUE(org_id, code) ở DB; test chứng minh áp mã
đồng thời → chỉ 1 lần thực thi (xem yêu cầu 6). App một tiến trình (D1),
bảo vệ race chỉ có ý nghĩa trong một process; đa process ngoài phạm vi,
ghi rõ trong DECISIONS.md.

### R-12 — Test mới (vitest + supertest, thêm vào file test mới — KHÔNG sửa 286 test đã khóa của GOAL-001..008)

Chứng minh tạo/sửa/khóa mã đúng luật (code trống → 400, trùng mã trong org
→ 409, percent value ngoài 1..100 → 400, cap với fixed → 400, valid_from
>= valid_to → 400, mã khóa không áp được → 400, sửa code → 400), áp mã
đúng điều kiện (đủ tổng tối thiểu, đúng kênh, đúng chi nhánh, trong thời
gian hiệu lực, còn lượt dùng) và sai điều kiện (mỗi điều kiện sai → 400
với lý do riêng; đơn không draft → 400; áp mã lần 2 → 400), tính giảm đúng
số (%, cap, cố định, cắt ở tổng đơn, cắt ở phần còn lại sau điểm), chồng
giảm đúng luật yêu cầu 5 (cả hai chiều áp mã/đổi điểm, cả trường hợp bão
hòa tổng giảm = tổng đơn), giới hạn dùng (hết lượt tổng → 400, hết lượt
mỗi khách → 400, đơn không gắn khách chỉ tính giới hạn tổng, áp đồng thời
→ đúng giới hạn), hủy đơn hoàn lượt dùng (usage chuyển 'released',
promo_discount về 0, dùng lại được; trả hàng/hoàn tiền không hoàn lượt),
đối soát (outstanding trừ cả điểm lẫn mã; payment_status giữ logic D22;
tích điểm tính trên tổng gốc), idempotency (gửi lại cùng key → replayed:
true, không ghi usage mới), RBAC 403 theo ma trận (yêu cầu 9). Test dùng
dữ liệu giả lập (2 org, 2 mã trở lên trong cùng org).

### R-13 — Dữ liệu GIẢ LẬP hoàn toàn; mật khẩu seed + secret qua biến môi trường

Như GOAL-001..008: không commit credential thật; check.sh vẫn quét secret
(grep như GOAL-001); seed KHÔNG cần thêm mã mẫu (demo tự tạo) — nhưng giữ
nguyên 2 user, 2 sản phẩm, 2 kho + mức tồn mẫu để test khóa vẫn xanh.

### R-14 — scripts/check.sh (CHK-1) và scripts/demo.sh (CHK-2) được MỞ RỘNG + docs

Thêm bước khuyến mãi vào smoke/demo (tạo mã 10% cap 20.000đ → trùng mã
409 → tạo mã fixed 50.000đ → tạo đơn 250.000đ → áp mã 10% (giảm 20.000đ
do cap) → áp lại 400 → áp mã hết hạn 400 → áp mã sai kênh 400 → đổi điểm
trừ tiền đơn đã có mã (tổng giảm = mã + điểm, không vượt tổng) → xác nhận
→ xử lý → hoàn tất → thu tiền (outstanding = tổng − điểm − mã − đã trả)
→ hủy đơn có mã khác (usage released, dùng lại được) → idempotency gửi
lại không ghi usage mới → RBAC 403: warehouse tạo mã, sales áp mã ngoài
chi nhánh, warehouse xem mã), giữ tất cả bước GOAL-001..008 xanh (health,
login, owner-only, idempotency, backup/restore, RBAC người dùng, sản phẩm/
giá/CSV, kho, đơn, thanh toán, giao/trả, khách/CRM). Cả 2 script tự chạy
được, tự dọn dẹp, in PASS/FAIL từng bước. Docs: docs/RBAC.md bổ sung ma
trận khuyến mãi (bảng ở trên); docs/DECISIONS.md thêm D27 (mô hình khuyến
mãi: mã + loại giảm + điều kiện + giới hạn dùng + luật chồng giảm không phụ
thuộc thứ tự + hủy đơn hoàn lượt dùng + outstanding trừ mã nhưng
payment_status giữ logic D22 + tích điểm trên tổng gốc); README.md/
docs/SETUP.md cập nhật endpoint khuyến mãi, khớp lệnh đã chạy thật. Không
có file .github/workflows/ trong repo (gh token thiếu scope workflow — CI
là follow-up sau khi user cấp scope). Không claim VPS, không claim deploy
production (local-only, D9).

### R-15 — Ranh giới: không gỡ mã, mã không đổi, giá snapshot không đổi

Không có endpoint gỡ mã khỏi đơn trong goal này (muốn đổi mã thì hủy đơn
rồi tạo đơn mới — ghi rõ trong docs); mã (code) không đổi sau khi tạo
(PATCH gửi code → 400); áp mã không đổi `orders.total` snapshot, không đổi
`order_items` (giá từng dòng giữ nguyên GOAL-005), không ghi lịch sử giá
mới (khuyến mãi không phải giá — D15); tích điểm tính trên tổng gốc
(yêu cầu 8). Không lưu thông tin thẻ ở bất kỳ đâu (DB, API, log,
audit_log, promotion_usages).

### R-16 — Báo cáo/đối soát tổng hợp (GOAL-010)

Không tổng hợp doanh thu theo thời gian, không đối soát lô (chỉ đối soát
từng đơn — yêu cầu 8, và lịch sử dùng mã từng lần — yêu cầu 10).

### R-17 — Thông báo (GOAL-011)

Không gửi email/SMS cho khách khi áp mã hay khi mã sắp hết hạn (chỉ audit
log + lịch sử dùng mã).

### R-18 — UI tổng quan (GOAL-012)

Không thêm màn hình khuyến mãi.

### R-19 — Ngoài phạm vi vĩnh viễn

Đơn vị vận chuyển thật / giao hàng thật, tài khoản hãng vận chuyển, cổng
thanh toán thật — ngoài phạm vi vĩnh viễn của dự án giả lập này; deploy
production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user cấp scope
workflow).

### R-20 — Loại trừ R-18 (GOAL-007) có lý do (xem mục riêng ở trên)

Yêu cầu R-18 của GOAL-007 (source `brief-007.md`, sha256
`5586ce9122656edcbd73a2cf609470e1e354ef85fb39ffeb00c70cec04c7f906`):
"Khách hàng + CRM (GOAL-008): không có bảng khách hàng, không lịch sử
giao/trả theo khách; thông báo (GOAL-011): không gửi email khi giao
hàng/trả hàng (chỉ audit log + lịch sử giao/trả); UI tổng quan (GOAL-012):
không thêm màn hình giao/trả." — loại trừ có lý do (out-of-scope), KHÔNG
adopt vào GOAL-009 vì R-18 gộp 3 phạm vi (CRM đã xong GOAL-008, thông báo
là GOAL-011, UI là GOAL-012).

## Checks

- CHK-1: `./scripts/check.sh` — pass.
- CHK-2: `./scripts/demo.sh` — pass.
