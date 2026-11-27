# OmniFlow — brief GOAL-011: Thông báo + công việc nền

## Bối cảnh (vấn đề)

OmniFlow là hệ thống vận hành thương mại đa kênh cho doanh nghiệp vừa (nhiều
doanh nghiệp, nhiều chi nhánh, nhiều kho, nhiều kênh bán), dự án dài hạn để kiểm
tra APOS ở quy mô lớn. Roadmap: `docs/ROADMAP.md` (12 Goal + GOAL-005A đã
đóng). Quyết định kiến trúc: `docs/DECISIONS.md` (D1–D28).

GOAL-011 xây nghiệp vụ thông báo + công việc nền trên nền GOAL-001 (đã CLOSED)
+ GOAL-002 (RBAC, đã CLOSED) + GOAL-003 (sản phẩm/giá, đã CLOSED) + GOAL-004
(kho, đã CLOSED) + GOAL-005 (đơn hàng, đã CLOSED) + GOAL-005A (adopt R-19,
đã CLOSED) + GOAL-006 (thanh toán + hoàn tiền, đã CLOSED) + GOAL-007 (giao
hàng + trả hàng, đã CLOSED) + GOAL-008 (khách hàng + CRM, đã CLOSED) +
GOAL-009 (khuyến mãi, đã CLOSED) + GOAL-010 (báo cáo + đối soát, đã CLOSED):
gửi thông báo khi đơn/thanh toán/giao hàng/trả hàng/tồn kho/khuyến mãi có sự
kiện (qua adapter email fake đã có, KHÔNG gửi email thật); log thông báo
append-only; hàng đợi công việc nền trong tiến trình (KHÔNG Redis/dịch vụ
ngoài) với retry có giới hạn + backoff; job lặp theo lịch đơn giản (quét tồn
thấp, quét mã sắp hết hạn); cài đặt nhận thông báo theo người dùng; không
gửi trùng cùng một sự kiện. Phụ thuộc: GOAL-005 (và qua đó GOAL-001..004,
GOAL-006, GOAL-007, GOAL-008, GOAL-009, GOAL-010). Không làm UI tổng quan
(GOAL-012) trong goal này. Dữ liệu GIẢ LẬP hoàn toàn; không tiền thật, không
tài khoản thanh toán thật, không dịch vụ trả phí.
Dự án chỉ làm LOCAL — không có VPS trong phạm vi (user xác nhận 26/11 21:49).

Đề xuất: size M, appetite 480 phút, 3 lần thử (Human delegate duyệt ở gate A;
đặt dư vì APOS tính wall-clock từ lúc select — bài học DRAK GOAL-002).
Solo WP-MAIN: quy mô M vừa, toàn bộ thay đổi nằm trong một gói duy nhất
(schema + service + routes + job runner + test + scripts + docs), không có
ranh giới gói độc lập để tách multi-WP; mỗi acceptance criterion thuộc đúng
một package (WP-MAIN).

Điểm xuất phát (GOAL-001..010, đã khóa — KHÔNG sửa):
`src/app.ts` (Express, EJS, session cookie, middleware `requireRole`/
`requireScope`, route người dùng/chi nhánh/audit log/sản phẩm/giá/CSV/kho/
đơn/thanh toán/giao-trả/khách/CRM/khuyến mãi/báo cáo), `src/rbac.ts` (helper
`can()`, actions hiện tại: 10 actions người dùng + 8 actions sản phẩm/giá/CSV
+ 1 action xem giá riêng chi nhánh (`view-branch-price`) + 11 actions kho +
6 actions đơn + 3 actions thanh toán + 8 actions giao/trả + 9 actions
khách/CRM + 4 actions khuyến mãi + 2 actions báo cáo (`view-reports`,
`export-reports`)), `src/db.ts` (migration 001–014; chưa có bảng thông báo
hay job nào), `src/seed.ts` (1 org, 1 branch "Chi nhánh Chính", 2 user:
owner + sales; 2 sản phẩm mẫu; 2 kho mẫu), `src/tenant.ts` (middleware
scope org/branch), `src/idempotency.ts` (helper `withIdempotency` — kiểm tra
key ngoài transaction), `src/adapters/index.ts` (`FakeEmailAdapter.send(to,
subject, body)` trả `{simulated: true, messageId: 'FAKE-MAIL-<sha256 12 ký
tự>', to}` deterministic — CHƯA có cơ chế giả lập lỗi gửi; `FakePaymentAdapter`
có `failNext()` static một lần, chỉ dùng trong test — xem D23),
`src/orders.ts` (`transitionOrderTx`, mã đơn `DH-YYYYMMDD-NNNN`, state machine
draft → confirmed → processing → completed/cancelled, `customer_id`
nullable), `src/payments.ts` (`computePaymentSummary` — đối soát tính ở
service từ bảng payments/refunds, không lưu cột tổng riêng; `partially_refunded`
chỉ khi đơn có yêu cầu trả đã hoàn tiền, còn hoàn trực tiếp một phần giữ
`partially_paid` theo test khóa GOAL-006 — xem D25; outstanding = total −
points_discount − promo_discount − paid_total, D27), `src/stock.ts`
(`runStockTransaction`, `applyMovement`, `withStockIdempotency` — kiểm tra
key + thực thi + ghi key trong CÙNG MỘT transaction; `low_stock` khi
available < `products.min_stock`, D17), `src/reports.ts` (báo cáo tính ở
service, không bảng tổng riêng, D28), `src/customers.ts` (điểm tích/đổi,
ledger append-only, D26), `src/promotions.ts` (mã + usages append-only,
D27), `tests/acceptance.test.ts` + `tests/rbac-acceptance.test.ts` +
`tests/products-acceptance.test.ts` + `tests/stock-acceptance.test.ts` +
`tests/orders-acceptance.test.ts` + `tests/orders-005a-acceptance.test.ts` +
`tests/payments-acceptance.test.ts` +
`tests/shipments-returns-acceptance.test.ts` +
`tests/customers-crm-acceptance.test.ts` +
`tests/promotions-acceptance.test.ts` + `tests/reports-acceptance.test.ts` —
tổng 370 test vitest xanh trên main khi đóng GOAL-010 (gate xanh, đã chạy
thật 27/11), KHÔNG sửa test cũ, `scripts/check.sh` (CHK-1) +
`scripts/demo.sh` (CHK-2) — goal này MỞ RỘNG 2 script, giữ các bước
GOAL-001..010 xanh. LƯU Ý: timeout mặc định của APOS cho một check chỉ 10
phút (600_000 ms) — GOAL-010 đã phải revise v2 chỉ để thêm `"timeoutMs":
1200000` (20 phút) cho CHK-2 vì demo.sh chạy riêng đã 6m43s và vượt 10 phút
trong gate worktree; GOAL-011 khai `"timeoutMs": 1200000` cho CHK-2 NGAY TỪ
v1 (xem goal-011.json + issue #89).

## Loại trừ 4 yêu cầu mồ côi báo cáo có lý do

`apos inbox` đang có 4 notice `orphan-requirement`: các yêu cầu R-19 của
GOAL-006, R-17 của GOAL-007, R-18 của GOAL-008 và R-16 của GOAL-009 đều là
câu phủ định phạm vi báo cáo, đã defer từ goal gốc sang GOAL-010 nhưng
GOAL-010 đóng mà không adopt (vì brief-010 có requirements RIÊNG R-1..R-13
sở hữu phạm vi báo cáo). Quyết định đã chốt (parent, 28/11): **LOẠI TRỪ CẢ
BỐN CÓ LÝ DO, KHÔNG adopt vào GOAL-011**.

R-19 nguyên văn (GOAL-006, `brief-006.md` dòng 331–332):

> Báo cáo/đối soát tổng hợp (GOAL-010): không tổng hợp doanh thu theo thời
> gian, không đối soát lô (chỉ đối soát từng đơn — yêu cầu 6).

R-17 nguyên văn (GOAL-007, `brief-007.md` dòng 479–480):

> Báo cáo/đối soát tổng hợp (GOAL-010): không tổng hợp doanh thu theo thời
> gian, không đối soát lô (chỉ đối chiếu từng đơn sau trả — yêu cầu 8).

R-18 nguyên văn (GOAL-008, `brief-008.md` dòng 589–590):

> Báo cáo/đối soát tổng hợp (GOAL-010): không tổng hợp doanh thu theo
> khách/thời gian, không đối soát lô (chỉ tóm tắt từng khách — yêu cầu 2,
> và đối soát từng đơn — D22).

R-16 nguyên văn (GOAL-009, `brief-009.md` dòng 409–412):

> Báo cáo/đối soát tổng hợp (GOAL-010): không tổng hợp doanh thu theo thời
> gian, không đối soát lô (chỉ đối soát từng đơn — yêu cầu 8, và lịch sử
> dùng mã từng lần — yêu cầu 10).

Lý do loại trừ (chung cho cả bốn): chúng chỉ là câu phủ định phạm vi của
goal gốc (nói goal đó không làm báo cáo tổng hợp), không phải yêu cầu dương
cần implement; toàn bộ phạm vi báo cáo đã được sở hữu bởi requirements riêng
R-1..R-13 của GOAL-010 (đã implement + kiểm chứng đầy đủ, gate xanh,
check/demo xanh). Adopt chúng vào GOAL-011 (thông báo) sẽ nhận sai phạm vi.

Cơ chế APOS (đã chứng minh ở GOAL-007 cho R-20, GOAL-008 cho R-16/R-17,
GOAL-009 cho R-18, GOAL-010 cho R-18/R-16/R-17): một requirement entry
trong goal JSON với `adopts` trỏ đúng yêu cầu gốc (`sourceSha256` +
`requirementId`) + disposition `excluded` + `exclusion: {kind:
"out-of-scope"}` + `exclusionReason` sẽ đưa yêu cầu đó về trạng thái
out-of-scope có lý do, xóa notice mồ côi. `goal-011.json` khai 4 entry này
với id `R-21` (R-19 GOAL-006), `R-22` (R-17 GOAL-007), `R-23` (R-18
GOAL-008), `R-24` (R-16 GOAL-009) — id riêng, không đụng requirements riêng
R-1..R-15 của GOAL-011 (xem cách GOAL-010 dùng R-21/R-22/R-23, GOAL-008
dùng R-22 cho entry loại trừ). Entry này KHÔNG nằm trong
`acceptance[].requirementIds` của bất kỳ AC nào (nó là excluded, không
phải việc cần làm). Sau `goal create`, `apos plan` phải hiển thị cả 4
out-of-scope và `apos inbox` phải HẾT 4 notice báo cáo (ở GOAL-007/008/009/
010, notice sạch ngay từ lúc `goal create` — đó là hành vi đúng của cơ chế
loại trừ); nếu inbox vẫn còn notice thì đó là lỗi cần điều tra, không được
giấu.

## Ghi chú kế thừa — các yêu cầu thông báo đã defer sang GOAL-011

Bốn yêu cầu sau đã được các goal trước ghi là defer sang GOAL-011 (không
phải mồ côi lúc này — chúng đang ở trạng thái deferred, chưa có notice):

- GOAL-006 R-20 (`brief-006.md` dòng 333–334): "Thông báo (GOAL-011):
  không gửi email khi nhận được tiền hay hoàn tiền (chỉ audit log + lịch
  sử giao dịch)."
- GOAL-008 R-19 (`brief-008.md` dòng 592–593): "Thông báo (GOAL-011):
  không gửi email/SMS cho khách khi tích/đổi điểm hay hợp nhất hồ sơ (chỉ
  audit log + ledger + ghi chú)."
- GOAL-009 R-17 (`brief-009.md` dòng 415–417): "Thông báo (GOAL-011):
  không gửi email/SMS cho khách khi áp mã hay khi mã sắp hết hạn (chỉ
  audit log + lịch sử dùng mã)."
- GOAL-010 R-14 (`brief-010.md` dòng 403–404): "Thông báo (GOAL-011):
  không gửi email/SMS khi có lệch đối soát hay khi doanh thu đạt ngưỡng
  (chỉ báo cáo + audit log); thông báo là yêu cầu riêng của GOAL-011."

Cả bốn đều là câu phủ định phạm vi của goal gốc; phạm vi thông báo mà
chúng nhắc tới được sở hữu bởi requirements riêng R-1..R-15 của GOAL-011
này (xem mục Kết quả mong muốn dưới đây). GOAL-011 KHÔNG khai entry loại
trừ cho bốn yêu cầu này — theo đúng pattern GOAL-009/010 (sở hữu phạm vi
bằng requirements riêng, chỉ loại trừ các notice mồ côi đã có trong inbox).
Nếu sau khi GOAL-011 đóng mà inbox sinh notice mồ côi cho một trong bốn
yêu cầu trên thì đó là sổ sách (không phải thiếu chức năng) — ghi rõ vào
báo cáo đóng goal để parent quyết loại trừ có lý do ở GOAL-012, KHÔNG tự
tạo goal phụ ngoài phạm vi GOAL-011.

Tương tự, GOAL-008 R-20 (UI tổng quan → GOAL-012) chờ goal sau, không làm
trong GOAL-011.

## Kết quả mong muốn

1. Danh mục sự kiện thông báo (R-1): các sự kiện sau PHẢI sinh thông báo
   (mỗi sự kiện có `event_type` cố định, ghi trong D29): đơn hàng —
   `order.confirmed`, `order.completed`, `order.cancelled`; thanh toán —
   `payment.paid`, `payment.failed`, `payment.refunded`; giao hàng —
   `shipment.shipped`, `shipment.delivered`, `shipment.failed`; trả hàng —
   `return.requested`, `return.approved`, `return.rejected`,
   `return.received`; tồn kho — `stock.low`; khuyến mãi —
   `promotion.expiring`. Người nhận mặc định theo từng loại (xem yêu cầu
   9): đơn/thanh toán/giao/trả → email khách (nếu đơn có `customer_id` và
   khách có email) + owner của org; thanh toán/hoàn tiền → thêm accountant;
   trả hàng → thêm sales của chi nhánh đơn; tồn thấp → user warehouse được
   gán kho đó + manager; mã sắp hết hạn → owner + manager. Người nhận là
   user thì kiểm tra cài đặt nhận (yêu cầu 3); người nhận là khách (email)
   thì luôn gửi nếu có email (khách không có cài đặt nhận).
2. Gửi qua FakeEmailAdapter + log append-only (R-2): bảng `notifications`
   (migration 015): `org_id`, `event_key` UNIQUE (chống gửi trùng, xem
   dưới), `event_type`, `channel` = 'email', `recipient_user_id` nullable,
   `recipient_email` (email đích tại thời điểm gửi — snapshot, không join
   lại), `subject`, `body`, `status` ∈ sent/failed, `error` nullable,
   `message_id` (từ adapter), `created_at`. Gửi = gọi
   `FakeEmailAdapter.send(to, subject, body)` (deterministic `messageId`,
   `simulated: true`), ghi log trong cùng transaction với cập nhật trạng
   thái job (xem yêu cầu 4). KHÔNG gửi email thật, KHÔNG kết nối dịch vụ
   email thật. `event_key` định dạng `${event_type}:${entity}:${detail}`,
   ví dụ `order.confirmed:DH-20261128-0001`,
   `payment.paid:DH-20261128-0001`,
   `shipment.delivered:DH-20261128-0001`,
   `stock.low:variant:12:warehouse:3:2026-11-28` (ngày theo
   Asia/Ho_Chi_Minh — tối đa 1 lần/ngày/cặp, không spam),
   `promotion.expiring:7:2026-11-30` (1 lần/mã/ngày hết hạn). Gửi lại cùng
   `event_key` → KHÔNG tạo bản ghi mới (trả về bản ghi đã có / no-op 200,
   ghi rõ trong API + test). Nội dung email (subject/body) theo mẫu cố
   định từng loại (ghi mẫu trong D29, gồm mã đơn / số tiền / tên sản phẩm /
   kho / mã khuyến mãi tùy loại — không chứa thông tin thẻ, không chứa
   PII thừa ngoài email đích đã snapshot).
3. Cài đặt nhận thông báo theo người dùng (R-3): bảng
   `notification_preferences` (migration 015): `user_id`, `event_type`,
   `enabled` (0/1), UNIQUE(`user_id`, `event_type`). Mặc định mọi loại
   đều BẬT (thiếu dòng = bật — không seed dòng mặc định). Tắt loại nào thì
   sự kiện loại đó KHÔNG gửi cho người đó (job vẫn ghi log? — chốt: job
   send-notification cho người đã tắt thì bỏ qua ngay, KHÔNG tạo
   notification, KHÔNG tính là failed; test chứng minh). API
   GET/PATCH `/api/notification-preferences` (xem chính mình; owner/
   manager sửa cho user trong org — xem yêu cầu 11). PATCH sai
   `event_type` → 400; user ngoài org → 403/404.
4. Hàng đợi job nền trong tiến trình (R-4): bảng `jobs` (migration 015):
   `id`, `type` ∈ send-notification/low-stock-scan/promo-expiry-scan,
   `payload` JSON (chuỗi JSON: với send-notification gồm `event_key`,
   `event_type`, `to_user_id`/`to_email`, `subject`, `body`; với scan gồm
   `period_key` — xem yêu cầu 6), `status` ∈ pending/running/done/failed,
   `attempts` (đã thử, mặc định 0), `max_attempts` (mặc định 3, xem yêu cầu
   5), `next_run_at` (ISO UTC, mặc định now), `last_error` nullable,
   `created_at`, `updated_at`. Runner: hàm `processDueJobs(db, now)` —
   lấy job pending có `next_run_at` <= now theo `created_at`, chạy TUẦN TỰ
   từng job (1 job tại 1 thời điểm trong cùng tiến trình — tránh race trên
   SQLite), mỗi job trong transaction riêng (đổi status running → done/
   failed/pending-lại + ghi log trong cùng transaction). Job được tạo khi:
   sự kiện xảy ra (send-notification — trong cùng transaction với cập nhật
   trạng thái gốc khi có thể, xem yêu cầu 9), scheduler tick (scan — xem
   yêu cầu 6), hoặc gọi tay API (xem yêu cầu 10). Khôi phục khi khởi động:
   server start đưa mọi job `running` về `pending` (tiến trình cũ đã chết
   — attempts giữ nguyên, `next_run_at` = now), test được bằng cách update
   trực tiếp DB rồi gọi hàm khởi động.
5. Retry có giới hạn + backoff (R-5): `max_attempts` = 3 (chốt, ghi trong
   D29). Job fail → `attempts` + 1, status về `pending` với `next_run_at`
   = now + backoff: lần thử 1 fail → +60s, lần 2 fail → +120s, lần 3 fail
   → status `failed` + `last_error` ghi rõ + audit log action
   `job-failed` (xem yêu cầu 12). Backoff tính bằng công thức
   `60 × 2^(attempts-1)` giây (attempts = số lần đã thử sau khi fail).
   Test KHÔNG chờ thật: test đặt `next_run_at` trực tiếp / gọi
   `processDueJobs` với `now` giả lập, assert `attempts`/`next_run_at`/
   status sau từng lần fail. Cơ chế giả lập lỗi gửi: mở rộng
   `FakeEmailAdapter` với `failNext()` static một lần như D23
   (`failNext()` của payment) — CHỈ dùng trong test, route production
   không bao giờ gọi; ghi rõ trong D29.
6. Job lặp theo lịch trong tiến trình (R-6): scheduler chạy bằng
   `setInterval` khi server chạy thật (60 phút/lần cho mỗi loại scan —
   chốt chu kỳ trong D29; KHÔNG chạy trong test trừ khi bật cờ tường minh).
   Scheduler tạo job scan theo khóa dedupe: mỗi loại scan có `period_key`
   = ngày hiện tại theo Asia/Ho_Chi_Minh (`YYYY-MM-DD`); đã có job scan
   cùng loại + cùng `period_key` ở trạng thái pending/running/done thì
   KHÔNG tạo thêm (kiểm tra trong transaction — tránh trùng khi tick lặp).
   Job scan khi chạy sẽ quét và tạo các job send-notification tương ứng
   (xem yêu cầu 7, 8). API `POST /api/jobs/run` chạy ngay mọi job due
   (cho test + vận hành tay — không chờ lịch), trả `{processed, done,
   failed}`; `POST /api/jobs/:id/retry` đưa job failed về pending
   (`attempts` reset về 0, `next_run_at` = now, `last_error` = NULL) +
   audit log action `job-retried` (xem yêu cầu 12); job chưa failed mà
   retry → 400.
7. Thông báo tồn thấp (R-7): job low-stock-scan quét mọi cặp (biến thể,
   kho) có `available` < `products.min_stock` (D17) → mỗi cặp sinh 1 job
   send-notification event_type `stock.low`, `event_key`
   `stock.low:variant:<id>:warehouse:<id>:<YYYY-MM-DD +07>` (tối đa 1
   lần/ngày/cặp — scan lại cùng ngày không tạo thêm nhờ event_key UNIQUE +
   dedupe scan theo period_key). Người nhận: user warehouse được gán kho
   đó (theo RBAC warehouse scope GOAL-002) + manager của org (theo
   preferences). Nội dung ghi rõ SKU, tên sản phẩm, tên kho, available,
   min_stock, shortage = min_stock − available. Cặp đã đủ tồn thì không
   sinh thông báo; cặp hết tồn thấp (đã nhập thêm) thì ngày sau không sinh
   nữa (không có trạng thái "đã hết thấp" cần xóa — mỗi ngày tính lại từ
   dữ liệu gốc).
8. Thông báo mã sắp hết hạn (R-8): job promo-expiry-scan quét promotions
   active có `valid_to` trong 3 ngày tới (từ now tới now + 3 ngày, theo
   Asia/Ho_Chi_Minh; mã đã hết hạn thì không nhắc) → mỗi mã sinh 1 job
   send-notification event_type `promotion.expiring`, `event_key`
   `promotion.expiring:<promotion_id>:<YYYY-MM-DD của valid_to>` (1
   lần/mã/ngày hết hạn). Người nhận: owner + manager (theo preferences).
   Nội dung: code, valid_to, used_count/usage_limit. Mã đã khóa/inactive
   thì không nhắc.
9. Hook sự kiện đơn/thanh toán/giao/trả (R-9): các điểm hook — (a)
   `transitionOrderTx` chuyển đơn sang confirmed/completed/cancelled →
   tạo job send-notification (`order.confirmed`/`order.completed`/
   `order.cancelled`) trong CÙNG transaction với cập nhật trạng thái đơn
   (sự kiện và job không lệch nhau); (b) webhook paid chốt / webhook
   failed (GOAL-006) → job `payment.paid`/`payment.failed`; (c) refund
   tạo (GOAL-006) → job `payment.refunded`; (d) shipment đổi trạng thái
   shipped/delivered/failed (GOAL-007) → job tương ứng; (e) return
   requested/approved/rejected/received (GOAL-007) → job tương ứng.
   Event_key theo yêu cầu 2 (mã đơn + trạng thái đích — gửi lại cùng trạng
   thái (no-op, D24) thì KHÔNG tạo job mới vì event_key đã có). Người nhận
   theo bảng yêu cầu 1; job chỉ tạo cho người nhận có preferences bật (kiểm
   tra lúc tạo job — người tắt thì không tạo job, xem yêu cầu 3). Hook
   KHÔNG đổi hành vi đã khóa của GOAL-005/006/007 (state machine, webhook
   chống trùng, hoàn tiền) — chỉ thêm tạo job.
10. API xem thông báo + job (R-10): `GET /api/notifications?event_type=&
    status=&from=&to=` (lọc theo org của user, phân trang `page`/`limit`
    như đơn GOAL-005; không có filter recipient tự do — sales chỉ thấy
    thông báo của chi nhánh mình, xem yêu cầu 11) + `GET
    /api/notifications/:id` (ngoài org → 403/404); `GET
    /api/jobs?status=&type=` + `GET /api/jobs/:id` (phân trang như trên);
    `POST /api/jobs/run` (xem yêu cầu 6); `POST /api/jobs/:id/retry`
    (xem yêu cầu 6). Response list kèm `total`/`page`/`limit` như các list
    đã có.
11. RBAC xem thông báo/job theo vai + scope (R-11): mở rộng helper
    `can()` ở `src/rbac.ts` thêm actions `view-notifications` (xem
    notification), `manage-notification-preferences` (sửa preferences),
    `view-jobs` (xem job), `run-jobs` (chạy job tay + retry) theo đúng ma
    trận: owner/manager toàn org (xem + chạy job + retry); sales chỉ xem
    thông báo thuộc chi nhánh mình (notification gắn với đơn/kho của chi
    nhánh mình — thông báo không gắn chi nhánh thì sales không thấy; xem
    job → 403); warehouse chỉ xem thông báo `stock.low` của kho được gán +
    job low-stock-scan (xem job khác → 403, chạy job → 403); accountant
    xem thông báo payment/refund toàn org (chỉ xem, không chạy job).
    Preferences: user tự xem/sửa của mình; owner/manager sửa cho user
    trong org; sales/warehouse/accountant sửa của người khác → 403. Mọi
    endpoint qua `requireRole` + `can()` (vai sai/sai chi nhánh/kho/ngoài
    org → 403). Test chứng minh từng ô cấm trong ma trận (ít nhất: sales
    xem thông báo chi nhánh khác → 403, sales xem job → 403, warehouse xem
    thông báo không phải tồn kho → 403, warehouse chạy job → 403,
    accountant chạy job → 403, user org A đọc thông báo org B → 403).
12. Audit log cho thất bại + retry tay (R-12): ghi vào `audit_log` đã có:
    (a) gửi thông báo thất bại cuối cùng (job send-notification hết 3 lần
    thử → action `notification-failed`, detail JSON {event_key,
    event_type, recipient_user_id (nếu có), error} — KHÔNG chứa nội dung
    email đầy đủ, KHÔNG chứa email khách (PII) — chỉ id + event_key +
    error); (b) job failed cuối (action `job-failed`, detail {job_id,
    job_type, last_error}); (c) retry tay (action `job-retried`, detail
    {job_id, job_type}). Gửi thành công KHÔNG ghi audit (tránh nhiễu log —
    lịch sử gửi đã có bảng `notifications`). Xem log theo luật GOAL-002
    (GET /api/audit-log). Test: job fail 3 lần → đúng 1 bản ghi
    `notification-failed` + 1 `job-failed`; gửi thành công → không tăng
    số bản ghi audit.
13. Test mới (vitest + supertest, thêm vào file test mới — KHÔNG sửa 370
    test đã khóa của GOAL-001..010): chứng minh danh mục sự kiện + hook
    (đơn xác nhận/hoàn tất/hủy, webhook paid/failed, refund, giao
    shipped/delivered/failed, trả duyệt/từ chối/nhận → job + notification
    đúng người nhận), không gửi trùng (cùng event_key 2 lần → 1 bản ghi),
    preferences tắt → không gửi, job retry/backoff (3 lần → failed +
    backoff 60s/120s đúng công thức, không chờ thật), scan tồn thấp + mã
    sắp hết hạn (dedupe theo ngày), khôi phục job running khi khởi động,
    RBAC 403 theo ma trận (yêu cầu 11), audit thất bại (yêu cầu 12).
    Test dùng dữ liệu giả lập (2 org, 2 chi nhánh, 2 kho, 2 kênh trở lên).
14. Dữ liệu GIẢ LẬP hoàn toàn; mật khẩu seed + secret qua biến môi trường
    (như GOAL-001..010: `OMNIFLOW_SEED_*_PASSWORD`), không commit
    credential thật; check.sh vẫn quét secret (grep như GOAL-001); seed
    KHÔNG thêm user/sản phẩm/kho mới (giữ nguyên 2 user, 2 sản phẩm, 2 kho
    + mức tồn mẫu để test khóa vẫn xanh); email chỉ qua FakeEmailAdapter
    (`simulated: true`), không gửi email thật.
15. scripts/check.sh (CHK-1) và scripts/demo.sh (CHK-2) được MỞ RỘNG trong
    goal này: thêm bước thông báo/job vào smoke/demo (tạo đơn 250.000đ kênh
    counter → xác nhận → hoàn tất → thu tiền 100.000đ → chạy job due →
    notification `order.completed` + `payment.paid` đã sent, gửi lại cùng
    event không trùng → tạo cặp tồn thấp (đặt min_stock cao / xuất kho cho
    available < min_stock) → chạy low-stock-scan → thông báo `stock.low`
    đúng kho → tạo mã sắp hết hạn trong 2 ngày → chạy promo-expiry-scan →
    thông báo `promotion.expiring` → job fail giả lập → retry tay →
    sent → RBAC 403: sales xem job, warehouse chạy job), giữ tất cả bước
    GOAL-001..010 xanh (health, login, owner-only, idempotency,
    backup/restore, RBAC người dùng, sản phẩm/giá/CSV, kho, đơn, thanh
    toán, giao/trả, khách/CRM, khuyến mãi, báo cáo). Cả 2 script tự chạy
    được, tự dọn dẹp, in PASS/FAIL từng bước. Docs: docs/RBAC.md bổ sung
    ma trận thông báo/job + docs/DECISIONS.md thêm D29 (danh mục sự kiện +
    event_key + mẫu nội dung + job queue + retry/backoff + scheduler +
    dedupe + khôi phục khi khởi động + audit chỉ thất bại); README.md/
    docs/SETUP.md cập nhật endpoint thông báo/job, khớp lệnh đã chạy thật.
    Không có file .github/workflows/ trong repo (gh token thiếu scope
    workflow — CI là follow-up sau khi user cấp scope). Không claim VPS,
    không claim deploy production (local-only, D9).

## Ngoài phạm vi (thuộc goal sau, không làm trong GOAL-011)

16. UI tổng quan (GOAL-012): không thêm màn hình thông báo/job (chỉ API +
    log) — thuộc GOAL-012, không làm trong GOAL-011.
17. SMS / push / email thật — ngoài phạm vi vĩnh viễn của dự án giả lập
    này (chỉ FakeEmailAdapter, `simulated: true`); không tài khoản dịch vụ
    email thật, không API key thật.
18. Redis / hàng đợi ngoài / cron hệ thống / worker process riêng — ngoài
    phạm vi vĩnh viễn (chỉ job queue trong tiến trình + setInterval, xem
    yêu cầu 4/6); không deploy thêm process.
19. Đơn vị vận chuyển thật / giao hàng thật, tài khoản hãng vận chuyển,
    cổng thanh toán thật — ngoài phạm vi vĩnh viễn của dự án giả lập này;
    deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ
    user cấp scope `workflow`).

## Rủi ro / phụ thuộc

- Job runner trong tiến trình: VM restart giữa lúc job đang chạy sẽ để job
  ở trạng thái running — đã có cơ chế khôi phục khi khởi động (yêu cầu 4);
  job scan theo lịch không chạy trong lúc server tắt (chấp nhận được — chạy
  bù ở lần tick sau nhờ period_key theo ngày, không tạo trùng).
- RAM thấp trên VM (free có lúc chỉ ~125–130MB, GOAL-009/010): gate chậm
  (52–64 phút) + vitest timeout flake lẻ — nếu gặp timeout lẻ, chạy lại
  riêng file đó trước khi kết luận (bài học GOAL-009/010); CHK-2 đã khai
  `"timeoutMs": 1200000` (20 phút) ngay từ v1 để tránh lỗi timeout 10
  phút mặc định của APOS (issue #89, bài học GOAL-010).
- Tiến trình sót sau VM restart giết script (bài học GOAL-005A): kiểm tra
  `ps aux | grep tsx` + `free -m`, dọn bằng `pkill -f "[t]sx
  src/server.ts"` trước khi kết luận test đỏ do code.
- Token tuần: lúc dispatch GOAL-011 là 82% (reset 30/11 05:28 +07); user đã
  chốt 28/11 01:13: cứ chạy tiếp, tự dừng ở 100% nếu chạm, resume sau
  reset, không động vào 2B token thêm — kiểm tra `subscription-status
  status` trước mỗi bước nặng; nếu chạm 100% thì dừng, giữ nguyên trạng
  thái, báo cáo rõ.
