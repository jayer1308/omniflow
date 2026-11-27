# OmniFlow — brief GOAL-006: Thanh toán + hoàn tiền

## Bối cảnh (vấn đề)

OmniFlow là hệ thống vận hành thương mại đa kênh cho doanh nghiệp vừa (nhiều
doanh nghiệp, nhiều chi nhánh, nhiều kho, nhiều kênh bán), dự án dài hạn để kiểm
tra APOS ở quy mô lớn. Roadmap: `docs/ROADMAP.md` (12 Goal + GOAL-005A đã
đóng). Quyết định kiến trúc: `docs/DECISIONS.md` (D1–D21).

GOAL-006 xây nghiệp vụ thanh toán + hoàn tiền trên nền GOAL-001 (đã CLOSED) +
GOAL-002 (RBAC, đã CLOSED) + GOAL-003 (sản phẩm/giá, đã CLOSED) + GOAL-004
(kho, đã CLOSED) + GOAL-005 (đơn hàng, đã CLOSED) + GOAL-005A (adopt R-19,
đã CLOSED): thu tiền mặt + chuyển khoản + qua cổng thanh toán (adapter fake
local đã có từ GOAL-001); trạng thái yêu cầu/đã trả/thất bại/hoàn tiền;
webhook giả lập trễ/lặp/sai thứ tự mà không ghi nhận 2 lần; đối soát đơn–
thanh toán + lịch sử giao dịch. Phụ thuộc: GOAL-005 (và qua đó GOAL-001..
GOAL-004). Không làm giao hàng (GOAL-007), khách hàng CRM (GOAL-008),
khuyến mãi (GOAL-009), báo cáo (GOAL-010), thông báo (GOAL-011) trong goal
này. Dữ liệu GIẢ LẬP hoàn toàn; không tiền thật, không tài khoản thanh toán
thật, không dịch vụ trả phí, KHÔNG lưu thông tin thẻ.
Dự án chỉ làm LOCAL — không có VPS trong phạm vi (user xác nhận 26/11 21:49).

Đề xuất: size M, appetite 480 phút, 3 lần thử (Human delegate duyệt ở gate A;
đặt dư vì APOS tính wall-clock từ lúc select — bài học DRAK GOAL-002).

Điểm xuất phát (GOAL-001..005A, đã khóa — KHÔNG sửa):
`src/app.ts` (Express, EJS, session cookie, middleware `requireRole`/
`requireScope`, route người dùng/chi nhánh/audit log/sản phẩm/giá/CSV/kho/
đơn), `src/rbac.ts` (helper `can()`, actions hiện tại: 10 actions người dùng
(invite/lock/unlock/revoke/change-role/change-scope/change-password-other/
list-users/view-audit-log/create-branch) + 8 actions sản phẩm/giá/CSV +
1 action xem giá riêng chi nhánh (`view-branch-price`) + 11 actions kho +
6 actions đơn), `src/db.ts` (migration
001–010; chưa có bảng thanh toán nào), `src/seed.ts` (1 org, 1 branch
"Chi nhánh Chính", 2 user: owner + sales; 2 sản phẩm mẫu; 2 kho mẫu),
`src/tenant.ts` (middleware scope org/branch), `src/idempotency.ts` (helper
`withIdempotency` — kiểm tra key ngoài transaction), `src/orders.ts`
(`transitionOrderTx`, mã đơn `DH-YYYYMMDD-NNNN`, state machine
draft → confirmed → processing → completed/cancelled),
`src/products.ts` (`effectivePrice()` fallback 8 bước),
`src/stock.ts` (`runStockTransaction`, `applyMovement`,
`withStockIdempotency` — kiểm tra key + thực thi + ghi key trong CÙNG MỘT
transaction), `src/adapters/index.ts` (`FakePaymentAdapter.charge(amount,
currency)` — deterministic, `simulated: true`, `status: 'success'`,
reference `FAKE-PAY-<hash12>`; `FakeShippingAdapter`, `FakeEmailAdapter`),
`tests/acceptance.test.ts` + `tests/rbac-acceptance.test.ts` +
`tests/products-acceptance.test.ts` + `tests/stock-acceptance.test.ts` +
`tests/orders-acceptance.test.ts` + `tests/orders-005a-acceptance.test.ts` —
tổng 173 test vitest xanh trên main khi đóng GOAL-005A (gate xanh),
KHÔNG sửa test cũ, `scripts/check.sh` (CHK-1) + `scripts/demo.sh` (CHK-2)
— goal này MỞ RỘNG 2 script, giữ các bước GOAL-001..005A xanh.

## Kết quả mong muốn

Cuối goal, một nhân viên bán hàng / kế toán đăng nhập vào hệ thống có thể ghi
nhận tiền khách trả cho một đơn (tiền mặt, chuyển khoản, hoặc qua cổng fake),
xem được đơn còn thiếu bao nhiêu, yêu cầu thu qua cổng thì nhận đúng một lần
dù webhook giả lập gửi trễ, gửi lặp hay tới sai thứ tự, hoàn tiền đúng số đã
trả và không bao giờ hoàn vượt, gửi lại cùng một yêu cầu không bao giờ tạo 2
giao dịch thu/hoàn, mọi thao tác đều bị chặn đúng khi sai vai, sai chi nhánh
hoặc ngoài org, với audit log + lịch sử giao dịch đầy đủ để đối soát.

## Quyết định mô hình (Lead/Worker ghi vào DECISIONS.md làm D22, D23)

- **Thanh toán là dữ liệu cấp org, gắn với đơn.** Bảng `payments` có
  `org_id`, `branch_id` NOT NULL (chi nhánh thu tiền — lấy theo luật chi
  nhánh của đơn, xem dưới), `order_id` NOT NULL FK tới `orders`, `method`
  TEXT NOT NULL CHECK `IN ('cash','bank_transfer','gateway')`, `amount`
  INTEGER NOT NULL CHECK `> 0` (tiền nguyên đồng — D10), `currency` TEXT
  NOT NULL DEFAULT `'VND'` (chỉ VND trong goal này), `status` TEXT NOT
  NULL CHECK `IN ('requested','paid','failed','refunded','partially_refunded')`,
  `gateway_reference` TEXT NULL `UNIQUE` khi có giá trị (mã tham chiếu cổng
  — dùng chống ghi nhận trùng từ webhook), `received_by` FK tới `users`,
  `received_at`/`created_at`/`updated_at`. Không có endpoint DELETE payment
  (chỉ hoàn tiền bằng bản ghi refund, giữ lịch sử). Trả thừa (tổng paid >
  tổng đơn) được phép ghi nhận nhưng phải hiện rõ là thừa trong đối soát
  (xem yêu cầu 6) — không tự động chặn, Lead ghi rõ lựa chọn này.
- **Hoàn tiền là bản ghi riêng, không sửa payment gốc.** Bảng `refunds` có
  `payment_id` NOT NULL FK tới `payments`, `amount` INTEGER NOT NULL CHECK
  `> 0`, `reason` TEXT NOT NULL (lý do hoàn — bắt buộc, khác với ghi chú
  hủy đơn), `status` TEXT NOT NULL CHECK `IN ('requested','completed',
  'failed')` (fake adapter hoàn luôn thành công nên `requested` chuyển
  ngay sang `completed` trong cùng transaction, trừ khi test giả lập lỗi),
  `created_by` FK tới `users`, `created_at`. Tổng hoàn của một payment
  không bao giờ vượt số đã trả của payment đó (CHECK ở service + test —
  DB CHECK tổng tích lũy không làm được bằng CHECK đơn giản nên bắt buộc
  kiểm tra trong transaction `BEGIN IMMEDIATE`). Hoàn tiền KHÔNG đổi trạng
  thái đơn GOAL-005 (state machine đơn giữ nguyên — trả hàng/nhập lại kho
  là GOAL-007); chỉ cập nhật `status` của payment: hoàn đủ → `refunded`,
  hoàn một phần → `partially_refunded`.
- **Lịch sử giao dịch append-only.** Bảng `payment_events` chỉ INSERT,
  không có API UPDATE/DELETE: `payment_id` FK tới `payments`, `event_type`
  TEXT NOT NULL (`created`/`paid`/`failed`/`refund_requested`/
  `refund_completed`/`webhook_received`/`webhook_duplicate_ignored`),
  `actor_id` FK tới `users` NULL khi là webhook, `detail` TEXT NULL
  (JSON: số tiền, method, gateway_reference, lý do), `created_at`.
  `GET /api/orders/:id/payments` trả payments kèm `events` của từng payment
  (payments mới nhất trước; `events` theo thứ tự thời gian tăng dần — cũ
  nhất trước — như `order_events` ở D19; test theo đúng thứ tự đó).
- **Thu tiền mặt/chuyển khoản = ghi nhận trực tiếp, đã trả ngay.**
  `POST /api/orders/:id/payments` nhận `{method: 'cash' |
  'bank_transfer', amount, idempotency_key?}` — tạo payment với `status`
  `'paid'` ngay trong cùng transaction (không qua `requested`), ghi 1 event
  `paid` + 1 audit log. `amount` <= 0 → 400; đơn ở trạng thái `cancelled`
  → 400 (không thu tiền đơn đã hủy); đơn `draft` vẫn thu được (đặt cọc
  trước khi xác nhận — Lead ghi rõ lựa chọn này, GOAL-007/010 dùng tiếp).
  `branch_id` của payment = `branch_id` của đơn (không lấy từ body — tránh
  lệch chi nhánh giữa đơn và tiền).
- **Thu qua cổng = yêu cầu rồi webhook chốt, đúng một lần.**
  `POST /api/orders/:id/payments` với `{method: 'gateway', amount,
  idempotency_key?}` tạo payment `status` `'requested'` + gọi
  `FakePaymentAdapter` để lấy `gateway_reference` (xem quyết định adapter
  ở dưới), ghi event `created`. Webhook giả lập `POST
  /api/payments/webhook` nhận `{gateway_reference, status: 'paid' |
  'failed', amount}` — endpoint KHÔNG yêu cầu session đăng nhập (webhook
  từ cổng gọi tới) nhưng phải kiểm tra chữ ký giả lập: header
  `X-Fake-Signature` = sha256(`gateway_reference:status:amount` + secret
  từ biến môi trường `OMNIFLOW_WEBHOOK_SECRET`, sai → 401; thiếu secret
  ở môi trường thì endpoint webhook trả 503 (không bao giờ chấp nhận
  webhook không chữ ký) và server vẫn chạy các route khác — test đặt
  secret giả; Lead ghi rõ lựa chọn này trong D22).
  404; payment đã `paid` mà webhook `paid` tới lần nữa → 200 kèm
  `duplicate: true`, ghi event `webhook_duplicate_ignored`, KHÔNG tạo
  payment mới, KHÔNG đổi gì; webhook `failed` tới sau khi đã `paid` →
  200, bỏ qua, ghi event, KHÔNG đổi `paid` thành `failed` (tiền đã về thì
  failed muộn không có hiệu lực); webhook tới sai thứ tự (`failed` trước
  rồi `paid` sau) → `paid` sau vẫn chốt bình thường. Mọi webhook đều ghi
  event (kể cả bản trùng) để đối soát thấy được.
- **Adapter fake: reference phải duy nhất theo giao dịch, không theo số
  tiền.** `FakePaymentAdapter.charge` hiện tại digest chỉ theo
  `amount:currency` nên 2 lần thu cùng số tiền cho 2 đơn khác nhau sẽ trùng
  `gateway_reference` — ĐÂY LÀ ĐIỂM PHẢI SỬA trong goal này: Lead mở rộng
  adapter nhận thêm mã định danh giao dịch (mã đơn + payment id) để
  reference duy nhất mà vẫn deterministic (cùng input → cùng output),
  giữ `simulated: true`. Thêm `refund(payment, amount)` vào adapter (trả
  về reference hoàn `FAKE-REF-<hash>` deterministic) và `failNext()`/cơ
  chế giả lập lỗi có chủ đích cho test (chỉ dùng trong test, không lọt ra
  production path — ghi rõ trong DECISIONS). Không kết nối cổng thật, không
  lưu thông tin thẻ (không có field nào chứa số thẻ/CVV trong DB, API hay
  log — test quét chứng minh).
- **Idempotency cho tạo payment + hoàn tiền, trong transaction.**
  Tạo payment và hoàn tiền đều nhận `Idempotency-Key` (header) hoặc
  `idempotency_key` (body); server dùng `withStockIdempotency` (GOAL-004)
  — kiểm tra key + thực thi + ghi key trong CÙNG MỘT transaction
  `BEGIN IMMEDIATE` — vì tạo payment/hoàn tiền động vào tổng đã trả nên
  KHÔNG dùng `withIdempotency` của GOAL-001 (kiểm tra ngoài transaction,
  có khe race — bài học GOAL-004/005). Tên miền key:
  `payment:create:<key>` cho tạo payment, `payment:refund:<key>` cho hoàn
  tiền; gửi lại cùng key + cùng loại + cùng org → trả đúng response đã
  lưu kèm `replayed: true`, KHÔNG tạo payment/refund mới. Webhook KHÔNG
  dùng idempotency key của client — chống trùng của webhook bằng
  `gateway_reference` UNIQUE (xem trên). Thiếu key thì vẫn thực thi
  (không bắt buộc) nhưng không có bảo vệ gửi lại.
- **Đối soát đơn–thanh toán.** `GET /api/orders/:id/payments` trả kèm tóm
  tắt đối soát: `order_total` (tổng đơn GOAL-005), `paid_total` (tổng
  payment `paid` trừ tổng refund `completed`), `refunded_total`,
  `outstanding` (`order_total - paid_total`, âm nghĩa là thừa — hiện rõ,
  không giấu), `payment_status` suy ra: `unpaid` / `partially_paid` /
  `paid` / `overpaid` / `refunded` (khi `paid_total` về 0 sau khi đã từng
  trả). Tóm tắt tính ở service từ bảng payments/refunds, không lưu cột
  tổng riêng (tránh lệch — Lead ghi rõ nếu chọn khác). Đơn `cancelled`
  vẫn xem được lịch sử thanh toán/hoàn của nó (đối soát sau hủy).

## Ma trận quyền (thanh toán — bổ sung vào `docs/RBAC.md`)

Vai: `owner`, `manager`, `sales`, `warehouse`, `accountant` (GOAL-002).
Quy tắc chung (D4): mọi thao tác kiểm tra cả vai VÀ phạm vi; vai sai thao
tác → 403; đúng vai sai phạm vi → 403; ngoài org → 403. Helper `can()` mở
rộng thêm actions: `create-payment`, `refund-payment`, `view-payments`.
Kiểu `Target` dùng `branchId` đã có cho phạm vi chi nhánh (payment theo
chi nhánh của đơn).

| Thao tác | owner | manager | sales | warehouse | accountant |
|---|---|---|---|---|---|
| Ghi nhận thu tiền (`POST /api/orders/:id/payments`) | Được | Được | Được (đơn thuộc chi nhánh của mình) | Không (403) | Được, toàn org |
| Hoàn tiền (`POST /api/payments/:id/refunds`) | Được | Được | Không (403) | Không (403) | Được, toàn org |
| Xem thanh toán/đối soát (`GET /api/orders/:id/payments`, `GET /api/payments/:id`) | Được, toàn org | Được, toàn org | Được, chỉ đơn thuộc chi nhánh của mình | Được, chỉ xem (không tạo/hoàn) đơn có `warehouse_id` trong phạm vi của mình | Được, toàn org (chỉ xem + hoàn) |

Ghi chú: `sales` xem payment của đơn ngoài chi nhánh của mình → 403;
`warehouse` không được tạo payment hay hoàn tiền dù đúng kho → 403; mọi
vai xem payment ngoài org → 403. Webhook không qua ma trận này (xác thực
bằng chữ ký giả lập, xem quyết định mô hình).

## Yêu cầu

1. Migration 011 tạo bảng `payments` (`org_id` NOT NULL FK tới `orgs`,
   `branch_id` NOT NULL FK tới `branches`, `order_id` NOT NULL FK tới
   `orders`, `method` TEXT NOT NULL CHECK `IN ('cash','bank_transfer',
   'gateway')`, `amount` INTEGER NOT NULL CHECK `> 0`, `currency` TEXT
   NOT NULL DEFAULT `'VND'`, `status` TEXT NOT NULL DEFAULT `'requested'`
   CHECK `IN ('requested','paid','failed','refunded',
   'partially_refunded')`, `gateway_reference` TEXT NULL UNIQUE khi có
   giá trị, `received_by` NOT NULL FK tới `users`, `received_at` /
   `created_at` / `updated_at`): migration chạy tuần tự sau 001–010, giữ
   dữ liệu cũ, không vỡ 173 test đã khóa. Không có endpoint DELETE payment.
2. Migration 011 (tiếp) tạo bảng `refunds` (`payment_id` NOT NULL FK tới
   `payments`, `amount` INTEGER NOT NULL CHECK `> 0`, `reason` TEXT NOT
   NULL, `status` TEXT NOT NULL CHECK `IN ('requested','completed',
   'failed')`, `created_by` NOT NULL FK tới `users`, `created_at`) và
   bảng `payment_events` append-only (`payment_id` NOT NULL FK tới
   `payments`, `event_type` TEXT NOT NULL, `actor_id` FK tới `users`
   NULL khi là webhook, `detail` TEXT NULL, `created_at`): chỉ INSERT,
   không có API UPDATE/DELETE lịch sử (gọi sửa/xóa → 404/405).
3. API tạo payment: `POST /api/orders/:id/payments` nhận `{method,
   amount, idempotency_key?}` — `method` lạ → 400; `amount` không nguyên
   hoặc <= 0 → 400; đơn không tồn tại → 404, ngoài org → 403; đơn
   `cancelled` → 400; `cash`/`bank_transfer` → 201 với payment `paid`
   ngay; `gateway` → 201 với payment `requested` + `gateway_reference`
   từ adapter đã sửa (duy nhất theo giao dịch); thành công trả payment
   kèm `events` (mới tạo) + `order_summary` đối soát (xem yêu cầu 6).
4. API webhook giả lập: `POST /api/payments/webhook` nhận
   `{gateway_reference, status: 'paid' | 'failed', amount}` + header
   `X-Fake-Signature` — sai/thiếu chữ ký → 401; reference không tồn tại
   → 404; `amount` webhook khác `amount` payment → 400 (không chốt sai
   số); `paid` lần 2 → 200 + `duplicate: true`, không đổi gì, ghi event
   `webhook_duplicate_ignored`; `failed` sau `paid` → 200, bỏ qua, không
   đổi `paid`; `failed` rồi `paid` → `paid` chốt bình thường; webhook
   `paid` cho payment `requested` → `paid` + event `paid` + audit log.
   Secret webhook qua biến môi trường `OMNIFLOW_WEBHOOK_SECRET`, không
   commit secret thật; `check.sh` vẫn quét secret (grep như GOAL-001).
5. API hoàn tiền: `POST /api/payments/:id/refunds` nhận `{amount, reason,
   idempotency_key?}` — `reason` trống → 400; `amount` <= 0 → 400; payment
   không tồn tại → 404, ngoài org → 403; payment chưa `paid` (còn
   `requested`/`failed`) → 400; tổng hoàn vượt số đã trả → 400, không tạo
   refund nào; thành công → 201, refund `completed` ngay (adapter fake),
   payment cập nhật `refunded` (hoàn đủ) hoặc `partially_refunded` (hoàn
   một phần), ghi event `refund_completed` + audit log, trả refund kèm
   payment đã cập nhật + `order_summary`.
6. API đọc + đối soát: `GET /api/orders/:id/payments` trả danh sách payment
   của đơn (mới nhất trước, kèm `refunds` + `events` từng payment) + tóm
   tắt `order_total`/`paid_total`/`refunded_total`/`outstanding`/
   `payment_status` (`unpaid`/`partially_paid`/`paid`/`overpaid`/
   `refunded`); `GET /api/payments/:id` trả 1 payment kèm refunds +
   events. Mọi API đọc lọc theo org + phạm vi vai (sales chỉ chi nhánh
   mình, warehouse chỉ kho được gán — xem ma trận); ngoài org → 403; đơn/
   payment không tồn tại → 404.
7. Idempotency cho payment: tạo payment + hoàn tiền đều nhận
   `Idempotency-Key` (header) hoặc `idempotency_key` (body); server dùng
   `withStockIdempotency` (GOAL-004) với tên miền key
   `payment:create:<key>` / `payment:refund:<key>`; gửi lại cùng key +
   cùng loại + cùng org → trả đúng response đã lưu kèm `replayed: true`,
   KHÔNG tạo payment/refund mới (số payment, tổng đã trả, tổng hoàn không
   đổi — test chứng minh). Key khác nhau thì thực thi bình thường. Thiếu
   key thì vẫn thực thi (không bắt buộc) nhưng không có bảo vệ gửi lại.
   Webhook chống trùng bằng `gateway_reference` UNIQUE, không dùng key
   client (xem yêu cầu 4).
8. Chống ghi nhận 2 lần: mọi tạo payment/hoàn tiền/webhook chốt đều trong
   `BEGIN IMMEDIATE` + `UNIQUE(gateway_reference)` ở DB; test chứng minh:
   gửi đồng thời 2 webhook `paid` cùng reference → chỉ 1 lần chốt, lần
   còn lại `duplicate: true`, tổng đã trả chỉ tính 1 lần; tạo payment
   đồng thời cùng idempotency key → chỉ 1 payment; hoàn tiền đồng thời 2
   lần vượt số đã trả → chỉ 1 lần thành công, lần còn lại 400. Lưu ý như
   GOAL-004/005: app một tiến trình (D1), bảo vệ race chỉ có ý nghĩa
   trong một process; đa process ngoài phạm vi, ghi rõ trong DECISIONS.md.
9. Lịch sử giao dịch: `payment_events` ghi đủ mọi lần tạo/chốt/thất bại/
   hoàn/webhook (kể cả webhook trùng — event `webhook_duplicate_ignored`);
   `GET /api/orders/:id/payments` trả `events` theo đúng thứ tự đã chốt
   (ghi rõ trong docs); test: thu tiền mặt → webhook paid → hoàn một phần
   → hoàn nốt → `payment_status` chuyển `paid` → `partially_refunded` →
   `refunded`, `paid_total` về 0, `outstanding` về bằng `order_total`.
   `events` trả theo thứ tự thời gian tăng dần (cũ nhất trước, như
   `order_events` ở D19).
10. RBAC thanh toán: mở rộng helper `can()` ở `src/rbac.ts` thêm actions
    `create-payment`, `refund-payment`, `view-payments` theo đúng ma trận
    ở trên; mọi endpoint payment qua `requireRole` + `can()` (vai sai →
    403, ngoài org → 403, sai chi nhánh → 403) — webhook là ngoại lệ duy
    nhất, xác thực bằng chữ ký. Test chứng minh từng ô cấm trong ma trận
    (ít nhất: warehouse tạo payment → 403, sales hoàn tiền → 403, sales
    xem payment đơn ngoài chi nhánh → 403, user org A đọc payment org B
    → 403, webhook sai chữ ký → 401).
11. Audit log cho thanh toán: ghi vào `audit_log` đã có MỌI thao tác tạo
    payment, webhook chốt/thất bại, hoàn tiền; mỗi bản ghi có `user_id`
    người thực hiện (NULL + ghi rõ `webhook` khi là webhook), `created_at`,
    `action` + `detail` JSON (`target_payment_id`, `order_id`,
    `order_code`, `method`, `amount`, `gateway_reference`, KHÔNG chứa dữ
    liệu nhạy cảm, KHÔNG chứa thông tin thẻ); xem log theo luật GOAL-002
    (`GET /api/audit-log`: `owner` toàn org, `manager` trong phạm vi, các
    vai khác → 403). `payment_events` là lịch sử giao dịch chi tiết;
    `audit_log` là lớp ghi nhận thao tác nhạy cảm theo chuẩn GOAL-002 —
    cả hai đều phải có, không thay nhau.
12. Test mới (vitest + supertest, thêm vào file test mới —
    KHÔNG sửa 173 test đã khóa của GOAL-001..005A): chứng minh thu tiền
    mặt/chuyển khoản thành `paid` ngay, thu qua cổng tạo `requested` +
    reference duy nhất (2 đơn cùng số tiền không trùng reference), webhook
    paid chốt 1 lần + gửi lặp `duplicate: true` không đổi tổng, webhook
    failed sau paid bị bỏ qua, webhook sai thứ tự vẫn chốt khi paid tới,
    webhook sai chữ ký → 401, webhook sai số tiền → 400, hoàn tiền đúng
    số + hoàn vượt → 400 + hoàn một phần/hoàn đủ đổi status đúng, đơn đã
    hủy không thu tiền được → 400, idempotency (tạo lại cùng key → cùng
    payment, không tạo mới; hoàn lại cùng key → `replayed: true`), race
    (webhook đồng thời cùng reference → chỉ 1 lần chốt; hoàn đồng thời
    vượt số đã trả → chỉ 1 thành công), đối soát (paid/refund/outstanding/
    overpaid/refunded đúng số học), RBAC 403 theo ma trận (yêu cầu 10),
    không có field thẻ/CVV trong DB/API/log (test quét chứng minh). Test
    dùng dữ liệu giả lập (2 org, 2 đơn trở lên trong cùng org).
13. Dữ liệu GIẢ LẬP hoàn toàn; mật khẩu seed + secret webhook qua biến môi
    trường (như GOAL-001..005: `OMNIFLOW_SEED_*_PASSWORD`,
    `OMNIFLOW_WEBHOOK_SECRET`), không commit credential thật; `check.sh`
    vẫn quét secret (grep như GOAL-001); seed KHÔNG cần thêm payment mẫu
    (demo tự tạo payment) — nhưng giữ nguyên 2 user, 2 sản phẩm, 2 kho +
    mức tồn mẫu để test khóa vẫn xanh.
14. `scripts/check.sh` (CHK-1) và `scripts/demo.sh` (CHK-2) được MỞ RỘNG
    trong goal này: thêm bước thanh toán vào smoke/demo (tạo đơn → thu
    tiền mặt một phần → thu qua cổng → webhook paid chốt → webhook lặp bị
    bỏ qua → hoàn một phần → đối soát đúng số → idempotency gửi lại
    không tạo payment mới → RBAC 403: warehouse tạo payment, sales hoàn
    tiền, webhook sai chữ ký 401), giữ tất cả bước GOAL-001..005A xanh
    (health, login, owner-only, idempotency, backup/restore, RBAC người
    dùng, sản phẩm/giá/CSV, kho, đơn + adopt R-19).
    Cả 2 script tự chạy được, tự dọn dẹp, in PASS/FAIL từng bước.
15. Docs: `docs/RBAC.md` bổ sung ma trận thanh toán (bảng ở trên) + mô hình
    phạm vi payment (theo chi nhánh của đơn); `docs/DECISIONS.md` thêm D22
    (mô hình payment/refund: trạng thái, hoàn tiền riêng bảng, webhook
    chống trùng bằng reference UNIQUE, idempotency trong transaction, đối
    soát tính ở service) và D23 nếu có quyết định sửa adapter reference
    duy nhất theo giao dịch + cơ chế giả lập lỗi (Lead ghi);
    `README.md`/`docs/SETUP.md` cập nhật endpoint payment/webhook, khớp
    lệnh đã chạy thật. Không có file `.github/workflows/` trong repo (gh
    token thiếu scope `workflow` — CI là follow-up sau khi user cấp scope).
    Không claim VPS, không claim deploy production (local-only, D9).

## Ngoài phạm vi (thuộc goal sau, không làm trong GOAL-006)

16. Giao hàng/trả hàng (GOAL-007): không yêu cầu giao, không gán đơn vị vận
    chuyển, không trả hàng nhập lại kho — hoàn tiền ở đây chỉ là trả lại
    tiền, chưa phải xử lý hàng trả.
17. Khách hàng + CRM (GOAL-008): không có bảng khách hàng, không lưu
    phương thức thanh toán của khách, không lịch sử thanh toán theo khách.
18. Khuyến mãi (GOAL-009): không mã giảm giá — số tiền thu chỉ đối soát
    với tổng đơn GOAL-005 đã snapshot.
19. Báo cáo/đối soát tổng hợp (GOAL-010): không tổng hợp doanh thu theo
    thời gian, không đối soát lô (chỉ đối soát từng đơn — yêu cầu 6).
20. Thông báo (GOAL-011): không gửi email khi nhận được tiền hay hoàn tiền
    (chỉ audit log + lịch sử giao dịch).
21. Cổng thanh toán thật, tài khoản merchant, lưu thông tin thẻ, PCI —
    ngoài phạm vi vĩnh viễn của dự án giả lập này.
22. Deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user
    cấp scope `workflow`).

## Rủi ro / phụ thuộc

- **Phụ thuộc GOAL-005:** cần đơn hàng + state machine + `transitionOrderTx`
  + mã đơn + RBAC đơn + `audit_log`. Nếu GOAL-005/005A chưa close thì không
  select GOAL-006.
- **Rủi ro ghi nhận 2 lần qua webhook (quan trọng nhất):** webhook gửi lặp
  là hành vi bình thường của cổng thật — chỉ chống bằng `UNIQUE
  (gateway_reference)` + kiểm tra trạng thái trong cùng transaction thì
  mới không tính tiền 2 lần. Test webhook đồng thời là bắt buộc, không
  được bỏ.
- **Rủi ro reference trùng vì digest theo số tiền:** `FakePaymentAdapter`
  hiện tại cho 2 lần thu cùng số tiền cùng reference — nếu Lead quên sửa
  thì `UNIQUE(gateway_reference)` sẽ chặn nhầm lần thu thứ hai. Bắt buộc
  sửa adapter nhận mã giao dịch trước khi viết test webhook.
- **Rủi ro hoàn vượt số đã trả:** tổng hoàn tích lũy không CHECK được bằng
  DB CHECK đơn giản — bắt buộc tính tổng hoàn hiện tại + amount mới trong
  cùng `BEGIN IMMEDIATE` rồi mới insert; test hoàn đồng thời phải chứng
  minh chỉ 1 lần thành công.
- **Rủi ro webhook sai thứ tự làm mất tiền đã về:** webhook `failed` tới
  sau `paid` không được lật trạng thái — luật "tiền đã về thì failed muộn
  vô hiệu" phải có test riêng; ngược lại `failed` trước rồi `paid` sau
  vẫn chốt bình thường.
- **Rủi ro idempotency ngoài transaction:** `withIdempotency` của GOAL-001
  kiểm tra key ngoài transaction — dùng cho tạo payment/hoàn tiền sẽ để
  lọt thực thi trùng khi hai yêu cầu cùng key chạy đồng thời (bài học
  GOAL-004/005); bắt buộc dùng `withStockIdempotency` (kiểm tra + thực
  thi + ghi key trong một transaction).
- **Rủi ro race trong test:** test đồng thời chạy trên một process Node +
  SQLite đồng bộ — các yêu cầu được xếp hàng ở event loop nên "đồng thời"
  ở đây là đồng thời ở mức HTTP, không phải đa process; test chứng minh
  bất biến (tổng đã trả chỉ tính 1 lần, tổng hoàn không vượt số đã trả)
  chứ không chứng minh được khả năng chống race đa process (ngoài phạm vi,
  ghi rõ trong DECISIONS.md).
- **Rủi ro đối soát sai khi thừa/thiếu:** `paid_total` phải trừ refund
  đã hoàn; `outstanding` âm nghĩa là thừa — test phải có case trả thừa
  và hoàn đủ để `payment_status` chuyển đúng, không được giấu số thừa.

## Ghi chú rà soát của PM (27/11/2026 — trước khi tạo Goal)

PM đã đối chiếu brief với code trên main @ 722d647 (GOAL-001..005A đã
đóng, vitest chạy thật 173 test xanh) + `docs/ROADMAP.md` + `docs/DECISIONS.md`
(D1–D21) + `src/adapters/index.ts`, `src/orders.ts`, `src/stock.ts`,
`src/rbac.ts`, `src/idempotency.ts`, `src/db.ts` (migration 001–010),
`src/seed.ts`, `docs/RBAC.md`. Những điểm sau đã SỬA trong brief so với
bản gốc (nội dung còn lại giữ nguyên):

1. **Số actions RBAC ở "Điểm xuất phát":** bản gốc ghi "8 actions sản
   phẩm/giá/CSV" — thiếu `view-branch-price` (xem giá riêng chi nhánh,
   GOAL-003). Đã sửa thành 8 actions sản phẩm/giá/CSV + 1 action
   `view-branch-price` + 10 actions người dùng (liệt kê tên) + 11 actions
   kho + 6 actions đơn, khớp `src/rbac.ts` hiện tại.
2. **Thứ tự `events` (quyết định mô hình + yêu cầu 9):** bản gốc để Lead
   chốt thứ tự events. Đã chốt luôn trong brief: payments mới nhất trước;
   `events` theo thứ tự thời gian tăng dần (cũ nhất trước), như
   `order_events` ở D19 — tránh một điểm mở không cần thiết, test theo
   đúng thứ tự đó.
3. **Thiếu secret webhook (quyết định mô hình):** bản gốc "server từ chối
   khởi động webhook" mơ hồ (không rõ cấm cả server hay chỉ webhook). Đã
   làm rõ: thiếu `OMNIFLOW_WEBHOOK_SECRET` thì endpoint webhook trả 503
   (không bao giờ chấp nhận webhook không chữ ký), server vẫn chạy các
   route khác; Lead ghi rõ lựa chọn này trong D22.

Đã KIỂM CHỨNG đúng, không sửa: `FakePaymentAdapter.charge(amount,
currency)` digest chỉ theo `amount:currency` (điểm phải sửa — 2 lần thu
cùng số tiền trùng `gateway_reference`, xem rủi ro); `withIdempotency`
kiểm tra key ngoài transaction (không dùng cho payment/refund);
`withStockIdempotency` kiểm tra + thực thi + ghi key trong cùng
transaction `BEGIN IMMEDIATE`; `transitionOrderTx` + state machine đơn
draft → confirmed → processing → completed/cancelled; seed 1 org, 1 chi
nhánh, 2 user (owner + sales), 2 sản phẩm, 2 kho; migration 001–010, chưa
có bảng thanh toán nào; 173 test vitest xanh trên main.
