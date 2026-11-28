# OmniFlow — brief GOAL-012: UI tổng quan + vận hành

## Bối cảnh (vấn đề)

OmniFlow là hệ thống vận hành thương mại đa kênh cho doanh nghiệp vừa (nhiều
doanh nghiệp, nhiều chi nhánh, nhiều kho, nhiều kênh bán), dự án dài hạn để kiểm
tra APOS ở quy mô lớn. Roadmap: `docs/ROADMAP.md` (12 Goal chính + GOAL-005A đã
đóng). Quyết định kiến trúc: `docs/DECISIONS.md` (D1–D29).

GOAL-012 là GOAL CUỐI của roadmap, xây màn hình tổng quan + vận hành trên nền
GOAL-001 (đã CLOSED) + GOAL-002 (RBAC, đã CLOSED) + GOAL-003 (sản phẩm/giá, đã
CLOSED) + GOAL-004 (kho, đã CLOSED) + GOAL-005 (đơn hàng, đã CLOSED) + GOAL-005A
(adopt R-19, đã CLOSED) + GOAL-006 (thanh toán + hoàn tiền, đã CLOSED) + GOAL-007
(giao hàng + trả hàng, đã CLOSED) + GOAL-008 (khách hàng + CRM, đã CLOSED) +
GOAL-009 (khuyến mãi, đã CLOSED) + GOAL-010 (báo cáo + đối soát, đã CLOSED) +
GOAL-011 (thông báo + công việc nền, đã CLOSED): màn hình tổng quan (dashboard),
màn hình giao/trả tổng quan, màn hình khách/điểm tổng quan, màn hình thông
báo/job tổng quan, health check mở rộng, trang sao lưu/khôi phục, trang nhật ký
audit có lọc/phân trang. Không thêm nghiệp vụ mới ngoài dashboard/vận hành.
Dữ liệu GIẢ LẬP hoàn toàn; không tiền thật, không tài khoản thanh toán thật,
không dịch vụ trả phí. Dự án chỉ làm LOCAL — không có VPS trong phạm vi (user
xác nhận 26/11 21:49).

Đề xuất: size M, appetite 480 phút, 3 lần thử (Human delegate duyệt ở gate A;
đặt dư vì APOS tính wall-clock từ lúc select — bài học DRAK GOAL-002).
Solo WP-MAIN: quy mô M vừa, toàn bộ thay đổi nằm trong một gói duy nhất
(views + routes + service dùng lại + test + scripts + docs), không có ranh giới
gói độc lập để tách multi-WP; mỗi acceptance criterion thuộc đúng một package
(WP-MAIN).

Điểm xuất phát (GOAL-001..011, đã khóa — KHÔNG sửa):
`src/app.ts` (Express, EJS, session cookie, middleware `requireRole`/
`requireScope`, route người dùng/chi nhánh/audit log/sản phẩm/giá/CSV/kho/
đơn/thanh toán/giao-trả/khách/CRM/khuyến mãi/báo cáo/thông báo/job),
`src/rbac.ts` (helper `can()`, actions hiện tại), `src/db.ts` (migration
001–015), `src/seed.ts` (1 org, 1 branch "Chi nhánh Chính", 2 user: owner +
sales; 2 sản phẩm mẫu; 2 kho mẫu), `src/reports.ts` (`computeRevenueReport`,
`computeStockReport`, `computeReconciliationReport` — dashboard PHẢI dùng
lại các hàm này, không tính lại bằng SQL riêng gây lệch), `src/orders.ts`,
`src/payments.ts` (`computePaymentSummary` — giữ nguyên luật
`partially_refunded` chỉ khi đơn có return đã hoàn tiền, xem D25),
`src/stock.ts`, `src/customers.ts`, `src/promotions.ts`, `src/notifications.ts`,
`src/jobs.ts`, `scripts/backup.sh` + `scripts/restore.sh` (sao lưu/khôi phục
file SQLite GOAL-001 — KHÔNG có API backup/restore; GOAL-012 chỉ được thêm
route API owner-only gọi đúng 2 script này nếu cần UI, không viết logic sao
lưu mới), `views/index.ejs` + `views/login.ejs` + `views/audit-log.ejs`
(trang `/audit-log` đã có, owner/manager only, dùng `visibleAuditRows` —
GOAL-012 MỞ RỘNG trang này thêm lọc/phân trang, giữ hành vi cũ),
`public/style.css`, `src/server.ts`, `GET /health` hiện chỉ trả
`{status: 'ok'}` (GOAL-012 mở rộng thêm DB/version/uptime, GIỮ `status`).
`tests/` — tổng 404 test vitest xanh trên main khi đóng GOAL-011 (gate xanh,
đã chạy thật 28/11), KHÔNG sửa test cũ, `scripts/check.sh` (CHK-1) +
`scripts/demo.sh` (CHK-2) — goal này MỞ RỘNG 2 script, giữ các bước
GOAL-001..011 xanh. CHK-2 khai `"timeoutMs": 1200000` (20 phút) ngay từ v1 —
bài học GOAL-010 (timeout mặc định APOS 10 phút, demo.sh chạy riêng đã 6m43s,
issue #89) và GOAL-011 đã chứng minh 20 phút đủ.

## Loại trừ 4 yêu cầu mồ côi thông báo có lý do (GOAL CUỐI — phải xử lý trong goal này)

`apos inbox` đang có 4 notice `orphan-requirement`, tất cả đều là câu phủ định
phạm vi thông báo, defer sang GOAL-011 nhưng GOAL-011 đóng mà không adopt (vì
brief-011 có requirements RIÊNG R-1..R-15 sở hữu phạm vi thông báo). Quyết định
đã chốt (parent, 28/11): **LOẠI TRỪ CẢ BỐN CÓ LÝ DO, KHÔNG adopt vào GOAL-012**.

1. R-20 của GOAL-006 (source `brief-006.md`, sha256
   `d3721a8812fccf7a526b1aebe77d2422a5001c1990065724601563c638fc6eb1`):
   > Thông báo (GOAL-011): không gửi email khi nhận được tiền hay hoàn tiền
   > (chỉ audit log + lịch sử giao dịch).
2. R-19 của GOAL-008 (source `brief-008.md`, sha256
   `1096245ab8319996180e7a82f65599d1190491a46acc89c3efdc211a5e96cb71`):
   > Thông báo (GOAL-011): không gửi email/SMS cho khách khi tích/đổi điểm
   > hay hợp nhất hồ sơ (chỉ audit log + ledger + ghi chú).
3. R-17 của GOAL-009 (source `brief-009.md`, sha256
   `53b60a14c7ebe698576b7162fbd1c6a420efea47cc1ef98d85af41a58aff4ed7`):
   > Thông báo (GOAL-011): không gửi email/SMS cho khách khi áp mã hay khi
   > mã sắp hết hạn (chỉ audit log + lịch sử dùng mã).
4. R-14 của GOAL-010 (source `brief-010.md`, sha256
   `75a653e0e8585ea8176c733d4ce2ccc9a4262627a88554779a4e234b00b62d7f`):
   > Thông báo (GOAL-011): không gửi email/SMS khi có lệch đối soát hay khi
   > doanh thu đạt ngưỡng (chỉ báo cáo + audit log); thông báo là yêu cầu
   > riêng của GOAL-011.

Lý do loại trừ (chung cho cả bốn): chúng chỉ là câu phủ định phạm vi của goal
gốc, không phải yêu cầu dương cần implement; toàn bộ phạm vi thông báo đã được
sở hữu bởi requirements riêng R-1..R-15 của GOAL-011 (đã implement + kiểm
chứng đầy đủ, gate xanh, check/demo xanh). Adopt vào GOAL-012 (UI/vận hành)
sẽ nhận sai phạm vi.

Cơ chế APOS (đã chứng minh ở GOAL-007 cho R-20, GOAL-008 cho R-16/R-17,
GOAL-009 cho R-18, GOAL-010 cho 3 entry, GOAL-011 cho 4 entry): một
requirement entry trong goal JSON với `adopts` trỏ đúng yêu cầu gốc +
disposition `excluded` + `exclusion: {kind: "out-of-scope"}` sẽ đưa yêu cầu
đó về trạng thái out-of-scope có lý do, xóa notice mồ côi. `goal-012.json`
khai 4 entry này với id `R-21` (R-20/006), `R-22` (R-19/008), `R-23`
(R-17/009), `R-24` (R-14/010) — id riêng không đụng requirements riêng
R-1..R-15 của GOAL-012. Entry này KHÔNG nằm trong
`acceptance[].requirementIds` của bất kỳ AC nào. Sau `goal create`, `apos
plan` phải hiển thị cả 4 out-of-scope và `apos inbox` phải HẾT 4 notice;
sau khi GOAL-012 đóng, inbox phải SẠCH HOÀN TOÀN — đây là goal cuối, không
còn goal sau để dọn.

## Loại trừ yêu cầu R-20 của GOAL-008 (UI) có lý do

R-20 của GOAL-008 (source `brief-008.md`, sha256
`1096245ab8319996180e7a82f65599d1190491a46acc89c3efdc211a5e96cb71`):

> UI tổng quan (GOAL-012): không thêm màn hình khách/CRM.

Đây cũng chỉ là câu phủ định phạm vi của GOAL-008 (nói GOAL-008 không làm
màn hình khách/CRM). Phạm vi màn hình khách/điểm tổng quan đã được sở hữu
bởi requirements riêng của GOAL-012 này (R-3 — màn hình khách/điểm tổng quan,
xem bên dưới). Quyết định (parent, 28/11): **LOẠI TRỪ CÓ LÝ DO trong
goal-012.json** với entry id `R-25`, `adopts` đúng sourceSha256 +
requirementId `R-20` của brief-008, disposition `excluded`, exclusion
out-of-scope + lý do như trên. Entry này cũng KHÔNG nằm trong bất kỳ AC nào.

## Kết quả mong muốn

1. **Dashboard tổng quan** (`GET /dashboard`, EJS): doanh thu hôm nay + tháng
   này, đơn chờ xử lý (draft/confirmed/processing), tồn thấp (số cặp
   variant/kho có available < min_stock), thông báo chưa đọc (notifications
   status sent chưa xem — chốt định nghĩa "chưa đọc" trong D30: notification
   mới tạo mà user chưa mở trang thông báo/job; không thêm cột DB mới nếu
   tránh được — dùng created_at + lần xem cuối nếu cần, ghi rõ trong D30).
   Số liệu lấy từ service đã có: doanh thu qua `computeRevenueReport`
   (GOAL-010), đơn qua truy vấn đơn theo trạng thái (GOAL-005), tồn thấp qua
   `GET /api/stock/low-stock` logic (GOAL-004), thông báo qua bảng
   notifications (GOAL-011). KHÔNG tính lại bằng SQL riêng lẻ gây lệch —
   test so sánh số dashboard với số API báo cáo GOAL-010 (phải khớp).
2. **Màn hình giao/trả tổng quan** (`GET /dashboard/shipments`, EJS): đơn
   đang giao (shipments status requested/shipped/in_transit), trả chờ duyệt
   (returns status requested), trả vừa nhận (received gần nhất) — dữ liệu
   GOAL-007, có link sang chi tiết đơn.
3. **Màn hình khách/điểm tổng quan** (`GET /dashboard/customers`, EJS):
   khách VIP (segment VIP theo luật GOAL-008), điểm đã đổi trong tháng
   (tổng redeemed × 100đ), khách mới trong tháng — dữ liệu GOAL-008.
4. **Màn hình thông báo/job tổng quan** (`GET /dashboard/notifications`,
   EJS): thông báo mới nhất (theo event_type/status), job failed cần chú ý
   (kèm link retry tay qua API GOAL-011) — dữ liệu GOAL-011. Đây là màn hình
   mà R-16 của GOAL-011 đã defer sang GOAL-012 ("không thêm màn hình thông
   báo/job (chỉ API + log)") — GOAL-012 sở hữu nó bằng requirements riêng
   (R-4), không loại trừ.
5. **Health check mở rộng** (`GET /health`): giữ `{status: 'ok'}` + thêm
   `db: 'ok'` (kiểm tra kết nối SQLite thật — query `SELECT 1`), `version`
   (lấy từ `package.json`, không hard-code), `uptime_seconds` (từ lúc
   process start). Lỗi DB → `status: 'error'` + 503.
6. **Trang sao lưu/khôi phục** (`GET /ops/backup`, EJS + API owner-only):
   hiển thị trạng thái sao lưu gần nhất (file backup gần nhất trong thư mục
   backup mặc định + thời gian + kích thước, nếu có) và nút tạo sao lưu /
   khôi phục — nút gọi đúng cơ chế GOAL-001 (`scripts/backup.sh` +
   `scripts/restore.sh`) qua route API mới `POST /api/ops/backup` và
   `POST /api/ops/restore` (chỉ owner; restore yêu cầu xác nhận
   `confirm: true`, thiếu/sai → 400; KHÔNG viết logic sao lưu mới, chỉ bọc
   2 script đã có). Test: tạo backup qua API → thay đổi dữ liệu → restore
   qua API → dữ liệu về đúng trạng thái trước backup.
7. **Trang nhật ký audit có lọc/phân trang** (mở rộng `GET /audit-log` đã
   có): thêm lọc theo người thực hiện (`actor=`), loại thao tác
   (`action=`), khoảng thời gian (`from=`/`to=`) + phân trang
   (`page`/`limit` như các list đã có); giữ hành vi cũ (owner/manager only,
   ngoài vai → 403; nội dung log không đổi). Lọc sai giá trị → 400.
8. **EJS tiếng Việt, mobile-first, đồng nhất** với màn hình đã có
   (`views/index.ejs`, `views/login.ejs`, `views/audit-log.ejs` dùng chung
   `public/style.css`): không đổi màn hình cũ trừ khi cần để gắn link
   dashboard; màn hình hẹp (viewport 360px) không vỡ layout (test kiểm tra
   HTML chứa đúng số liệu + link điều hướng + không có style inline phá
   layout); luồng chính (xem dashboard → xem chi tiết → quay lại) dùng
   được bằng bàn phím (link/button focus được, không chỉ onclick).
9. **Trạng thái tải/rỗng/lỗi**: dashboard khi chưa có dữ liệu (DB seed tối
   thiểu) hiển thị 0/empty đúng nghĩa, không crash; lỗi service (ví dụ DB
   lỗi) hiển thị trang lỗi 500 đúng định dạng, không lộ stack trace.
10. **RBAC + scope** cho mọi màn hình/API mới theo ma trận yêu cầu 10
    (xem bên dưới); sai vai/ngoài org/sai chi nhánh/kho → 403.
11. **Docs + hoàn tất roadmap**: `docs/RBAC.md` bổ sung ma trận
    dashboard/vận hành + `docs/DECISIONS.md` thêm D30 (nguồn số liệu
    dashboard + định nghĩa "chưa đọc" + health/backup/audit mở rộng) +
    `README.md`/`docs/SETUP.md` cập nhật màn hình/endpoint mới, khớp lệnh
    đã chạy thật + `docs/ROADMAP.md` đánh dấu 12 goal chính + GOAL-005A đã
    đóng (roadmap hoàn tất).
12. **Không làm trong goal này**: nghiệp vụ mới ngoài dashboard/vận hành
    (không thêm loại đơn/thanh toán/khuyến mãi/khách mới); không đổi logic
    tính đã khóa (computePaymentSummary, state machine đơn, giá hiệu dụng,
    luật điểm/mã); không kết nối dịch vụ thật; không file `.github/workflows/`
    (CI chờ user cấp scope workflow); không claim VPS/deploy production
    (local-only, D9).

## Yêu cầu chi tiết (R-1..R-15)

1. **R-1 — Dashboard tổng quan**: `GET /dashboard` (EJS, requireAuth)
   hiển thị: doanh thu hôm nay, doanh thu tháng này, số đơn chờ xử lý theo
   từng trạng thái (draft/confirmed/processing), số cặp tồn thấp, số thông
   báo chưa đọc. Doanh thu lấy qua `computeRevenueReport` (GOAL-010) với
   khoảng hôm nay/tháng này theo Asia/Ho_Chi_Minh, chỉ đơn completed.
   Đơn chờ xử lý đếm từ bảng orders theo trạng thái. Tồn thấp đếm từ logic
   low-stock GOAL-004 (available < min_stock). Thông báo chưa đọc theo
   định nghĩa D30. Số liệu hiển thị đúng định dạng tiền Việt (vd 250.000đ).
2. **R-2 — Màn hình giao/trả tổng quan**: `GET /dashboard/shipments`
   (EJS) hiển thị: danh sách đơn đang giao (shipments status
   requested/shipped/in_transit kèm mã vận đơn + carrier + trạng thái),
   trả chờ duyệt (returns status requested kèm mã đơn + lý do), trả vừa
   nhận gần nhất (5 bản ghi). Có link sang chi tiết đơn. Dữ liệu GOAL-007.
3. **R-3 — Màn hình khách/điểm tổng quan**: `GET /dashboard/customers`
   (EJS) hiển thị: danh sách khách VIP (segment VIP theo luật GOAL-008),
   tổng điểm đã đổi trong tháng (redeemed × 100đ), khách mới trong tháng.
   Dữ liệu GOAL-008.
4. **R-4 — Màn hình thông báo/job tổng quan**: `GET /dashboard/notifications`
   (EJS) hiển thị: thông báo mới nhất (10 bản ghi, theo event_type/status),
   job failed cần chú ý (kèm link retry tay qua API GOAL-011). Dữ liệu
   GOAL-011.
5. **R-5 — Health check mở rộng**: `GET /health` trả
   `{status, db, version, uptime_seconds}`; DB ok → `db: 'ok'`,
   `status: 'ok'`; DB lỗi → `status: 'error'` + 503. `version` đọc từ
   `package.json` (không hard-code). `uptime_seconds` tính từ lúc process
   start (số nguyên ≥ 0).
6. **R-6 — Sao lưu/khôi phục qua UI**: `GET /ops/backup` (EJS, owner-only)
   hiển thị trạng thái sao lưu gần nhất (tên file + thời gian + kích thước,
   hoặc "chưa có sao lưu" nếu không có); `POST /api/ops/backup` (owner-only)
   tạo file backup bằng `scripts/backup.sh`, trả `{file, size, created_at}`;
   `POST /api/ops/restore` (owner-only, body `{file, confirm: true}`)
   khôi phục bằng `scripts/restore.sh` (thiếu/sai confirm → 400, file
   không tồn tại → 404, file ngoài thư mục backup → 400). KHÔNG viết logic
   sao lưu mới.
7. **R-7 — Nhật ký audit có lọc/phân trang**: mở rộng `GET /audit-log`
   (EJS, đã có): query `actor=`, `action=`, `from=`, `to=`, `page`,
   `limit` (mặc định page 1, limit 20 tối đa 100); lọc sai giá trị → 400;
   phân trang đúng (total/page/limit); giữ hành vi cũ (owner/manager only,
   ngoài vai → 403). API `GET /api/audit-log` đã có giữ nguyên.
8. **R-8 — EJS + trạng thái tải/rỗng/lỗi**: các màn hình mới dùng chung
   `public/style.css`, tiếng Việt, mobile-first; màn hình hẹp 360px không
   vỡ layout; luồng chính dùng được bằng bàn phím (link/button focus được);
   khi chưa có dữ liệu hiển thị 0/empty đúng nghĩa, không crash; lỗi
   service hiển thị trang lỗi 500 không lộ stack trace.
9. **R-9 — Số dashboard khớp API báo cáo**: số doanh thu trên dashboard
   (hôm nay/tháng này) PHẢI khớp số từ `GET /api/reports/revenue` cùng
   khoảng (test so sánh trực tiếp); số tồn thấp khớp
   `GET /api/stock/low-stock`; số đơn chờ xử lý khớp `GET /api/orders`
   lọc theo trạng thái.
10. **R-10 — RBAC màn hình/vận hành**: mở rộng `can()` thêm actions
    `view-dashboard` / `view-ops` / `run-backup` theo ma trận: owner/manager
    toàn org (xem dashboard + vận hành + chạy backup/restore); sales chỉ
    xem dashboard thuộc chi nhánh mình (doanh thu/đơn/tồn của chi nhánh
    mình; xem dashboard toàn org → 403; xem vận hành → 403); warehouse chỉ
    xem phần tồn kho/giao hàng thuộc kho được gán (xem dashboard doanh thu
    → 403; xem vận hành → 403); accountant xem dashboard doanh thu/báo cáo
    toàn org (chỉ xem, chạy backup/restore → 403). Mọi endpoint qua
    `requireAuth` + `can()` (vai sai/sai chi nhánh/kho/ngoài org → 403).
    Test chứng minh từng ô cấm (ít nhất: sales xem dashboard toàn org →
    403, sales xem vận hành → 403, warehouse xem doanh thu → 403,
    accountant chạy backup → 403, user org A xem dashboard org B → 403).
11. **R-11 — Test mới**: vitest + supertest, thêm vào file test mới —
    KHÔNG sửa 404 test đã khóa của GOAL-001..011; chứng minh dashboard
    hiển thị đúng số (so với API), màn hình giao/trả/khách/thông báo có
    đúng dữ liệu, health mở rộng, backup/restore qua API (tạo → đổi dữ
    liệu → restore → đúng trạng thái), audit lọc/phân trang, RBAC 403 theo
    ma trận, trạng thái rỗng/lỗi. Dữ liệu test giả lập (2 org, 2 chi nhánh,
    2 kho, 2 kênh trở lên).
12. **R-12 — Dữ liệu GIẢ LẬP + không secret**: mật khẩu seed + secret qua
    biến môi trường (như GOAL-001..011), không commit credential thật;
    check.sh vẫn quét secret; seed KHÔNG thêm user/sản phẩm/kho mới (giữ
    nguyên 2 user, 2 sản phẩm, 2 kho + mức tồn mẫu để test khóa vẫn xanh);
    không lưu thông tin thẻ ở bất kỳ đâu (DB, API, log, audit_log).
13. **R-13 — Scripts mở rộng**: `scripts/check.sh` (CHK-1) và
    `scripts/demo.sh` (CHK-2) được MỞ RỘNG trong goal này: thêm bước
    dashboard/vận hành (mở dashboard → doanh thu hôm nay/tháng này khớp API
    báo cáo → đơn chờ xử lý đúng số → tồn thấp đúng số → thông báo chưa đọc
    → màn hình giao/trả có đơn đang giao → màn hình khách có VIP → màn hình
    thông báo có job failed + retry → health trả đủ field → backup qua API
    → đổi dữ liệu → restore qua API → dữ liệu về đúng → audit lọc theo
    actor/action + phân trang → RBAC 403: sales xem dashboard toàn org,
    warehouse xem doanh thu, accountant chạy backup), giữ tất cả bước
    GOAL-001..011 xanh. Cả 2 script tự chạy được, tự dọn dẹp, in PASS/FAIL
    từng bước. CHK-2 khai `"timeoutMs": 1200000` (20 phút) ngay từ v1.
14. **R-14 — Docs + roadmap hoàn tất**: `docs/RBAC.md` bổ sung ma trận
    dashboard/vận hành; `docs/DECISIONS.md` thêm D30 (nguồn số liệu
    dashboard + định nghĩa "chưa đọc" + health/backup/audit mở rộng);
    `README.md`/`docs/SETUP.md` cập nhật màn hình/endpoint mới, khớp lệnh
    đã chạy thật; `docs/ROADMAP.md` đánh dấu 12 goal chính + GOAL-005A đã
    đóng (roadmap hoàn tất). Không có file `.github/workflows/` trong repo.
15. **R-15 — Phạm vi**: không thêm nghiệp vụ mới ngoài dashboard/vận hành;
    không đổi logic tính đã khóa (computePaymentSummary, state machine đơn,
    giá hiệu dụng, luật điểm/mã); không kết nối dịch vụ thật; không claim
    VPS, không claim deploy production (local-only, D9).

## Rủi ro / phụ thuộc

- Token tuần: lúc dispatch ~89%, còn ~11% cho goal cuối (các goal trước tốn
  ~4–6%/goal). Nếu chạm 100% thì DỪNG NGAY, giữ nguyên trạng thái (không
  đóng dở goal), báo cáo rõ để resume sau reset 30/11 05:28 +07. Không động
  vào 2B token thêm.
- Máy tải nặng (RAM free có lúc chỉ ~125–161MB, nhưng MemAvailable
  ~570–600MB + load thấp vẫn đủ): gate chậm (~52–64 phút), vitest timeout
  flake lẻ — gặp timeout lẻ thì chạy lại riêng file đó trước khi kết luận
  (bài học GOAL-009/010/011).
- Gate đỏ ở `npm ci` do tải binary bcrypt qua egress proxy (bài học
  GOAL-011, issue #92): nếu gặp, chạy close với
  `npm_config_build_from_source=true` (cache headers node-gyp đã seed sẵn
  `~/.cache/node-gyp/24.22.1/` với `--no-same-owner` + `installVersion` =
  `11`); kiểm tra cache còn không trước khi dùng, mất thì seed lại.
- VM restart có thể giết gate/close giữa chừng (bài học GOAL-003/005/008/010/
  011): nếu close bị giết, kiểm tra event log APOS xem đã có event
  merge-authorized chưa — chưa có thì retry với `--merge-to` an toàn, đã có
  thì chạy close trơn không `--merge-to` (issue #79).
- `goal revise` xóa proposal cũ — phải `lead propose` lại với `goalVersion`
  mới + tăng trường `version` của proposal (bài học GOAL-005A/008/010).
- Sau khi GOAL-012 đóng, inbox PHẢI sạch hoàn toàn (không còn notice mồ côi
  nào) — đây là goal cuối, không còn goal sau để dọn. Nếu inbox còn notice
  thì đó là lỗi cần báo rõ cho parent, không được giấu.
