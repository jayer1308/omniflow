# OmniFlow — brief GOAL-005: Đơn hàng đa kênh + vòng đời

## Bối cảnh (vấn đề)

OmniFlow là hệ thống vận hành thương mại đa kênh cho doanh nghiệp vừa (nhiều
doanh nghiệp, nhiều chi nhánh, nhiều kho, nhiều kênh bán), dự án dài hạn để kiểm
tra APOS ở quy mô lớn. Roadmap: `docs/ROADMAP.md` (12 Goal). Quyết định kiến
trúc: `docs/DECISIONS.md` (D1–D18).

GOAL-005 xây nghiệp vụ đơn hàng trên nền GOAL-001 (đã CLOSED) + GOAL-002 (RBAC,
đã CLOSED) + GOAL-003 (sản phẩm/giá/CSV, đã CLOSED) + GOAL-004 (kho đa kho,
đã CLOSED): tạo đơn tại quầy + qua API; vòng đời nháp → xác nhận → xử lý →
hoàn tất / hủy; giữ hàng khi xác nhận + giải phóng khi hủy + xuất kho khi hoàn
tất (dùng `reserve`/`release`/`out` của GOAL-004); chống xử lý lặp; tìm kiếm/
lọc/phân trang + lịch sử đơn; test đồng thời + hủy khi đang xử lý. Phụ thuộc:
GOAL-003, GOAL-004 (và qua đó GOAL-001, GOAL-002). Không làm thanh toán
(GOAL-006), giao hàng (GOAL-007), khách hàng CRM (GOAL-008) trong goal này.
Dữ liệu GIẢ LẬP hoàn toàn; không tiền thật, không dịch vụ trả phí.
Dự án chỉ làm LOCAL — không có VPS trong phạm vi (user xác nhận 26/11 21:49).

Đề xuất: size L, appetite 480 phút, 3 lần thử (Human delegate duyệt ở gate A;
đặt dư vì APOS tính wall-clock từ lúc select — bài học DRAK GOAL-002).

Điểm xuất phát (GOAL-001..004, đã khóa — KHÔNG sửa):
`src/app.ts` (Express, EJS, session cookie, middleware `requireRole`/
`requireScope`, route người dùng/chi nhánh/audit log/sản phẩm/giá/CSV/kho),
`src/rbac.ts` (helper `can()`, actions hiện tại: người dùng + 8 actions sản
phẩm/giá/CSV + 11 actions kho), `src/db.ts` (migration 001–009; chưa có bảng
đơn nào), `src/seed.ts` (1 org, 1 branch "Chi nhánh Chính", 2 user: owner +
sales; 2 sản phẩm mẫu: SP-SEED-01 Áo thun 150000 + biến thể SKU-SEED-01-M
giá web riêng 160000, SP-SEED-02 không biến thể; 2 kho mẫu: Kho Chính tồn 3
— dưới min_stock 5, Kho Phụ tồn 20), `src/tenant.ts` (middleware scope
org/branch), `src/idempotency.ts` (helper `withIdempotency` — kiểm tra key
ngoài transaction), `src/products.ts` (`effectivePrice()` fallback 8 bước,
kênh cho phép `counter`/`web`/`api`), `src/stock.ts`
(`runStockTransaction` BEGIN IMMEDIATE lồng nhau an toàn,
`applyMovement` với các loại `in`/`out`/`adjust`/`count`/`transfer_in`/
`transfer_out`/`reserve`/`release`, `withStockIdempotency` — kiểm tra key +
thực thi + ghi key trong CÙNG MỘT transaction), `tests/acceptance.test.ts`
(17 test đã khóa) + `tests/rbac-acceptance.test.ts` (21) +
`tests/products-acceptance.test.ts` (45) + `tests/stock-acceptance.test.ts`
(36) — tổng 125 test đã khóa, KHÔNG sửa test cũ, `scripts/check.sh` (CHK-1)
+ `scripts/demo.sh` (CHK-2) — goal này MỞ RỘNG 2 script, giữ các bước
GOAL-001..004 xanh.

## Kết quả mong muốn

Cuối goal, một nhân viên bán hàng đăng nhập vào hệ thống có thể tạo đơn tại
quầy hoặc qua API (kênh `counter`/`web`/`api`), mỗi dòng đơn ghi đúng giá bán
tại thời điểm đặt (snapshot, không đổi khi giá đổi sau đó), xác nhận đơn thì
hàng được giữ trong kho đã chọn, hủy đơn thì hàng được giải phóng đúng số,
hoàn tất đơn thì hàng được xuất kho đúng số — tất cả trong transaction, không
bao giờ bán quá tồn có thể bán dù nhiều yêu cầu chạy đồng thời, gửi lại cùng
một yêu cầu không bao giờ tạo 2 đơn hay trừ kho 2 lần; mọi chuyển trạng thái
sai đều bị chặn (400) và ghi lịch sử (ai, lúc nào, từ trạng thái nào sang
trạng thái nào, ghi chú); tìm kiếm/lọc/phân trang đơn hoạt động; và mọi thao
tác đều bị chặn đúng khi sai vai, sai chi nhánh, sai kho, hoặc ngoài org,
với audit log đầy đủ.

## Quyết định mô hình (Lead/Worker ghi vào DECISIONS.md làm D19, D20)

- **Đơn là dữ liệu cấp org, có chi nhánh + kho xuất hàng.** Bảng `orders` có
  `org_id`, `branch_id` NOT NULL (chi nhánh tạo đơn), `warehouse_id` NOT
  NULL (kho xuất hàng cho đơn này — client chọn lúc tạo đơn; không có kho
  mặc định ngầm), `code` TEXT NOT NULL `UNIQUE(org_id, code)` — mã đơn đọc
  được dạng `DH-YYYYMMDD-NNNN` (số thứ tự trong ngày theo từng org, tính
  trong cùng transaction tạo đơn), `channel` TEXT NOT NULL CHECK
  `IN ('counter','web','api')`, `customer_name` TEXT NULL (tên khách tự do,
  chưa có bảng khách hàng — GOAL-008; chỉ lưu, không kiểm tra), `status`
  TEXT NOT NULL, `total` INTEGER NOT NULL DEFAULT 0 CHECK `>= 0` (tổng đơn
  tính từ các dòng, tiền nguyên đồng — D10), `created_by` FK tới `users`,
  `created_at`/`updated_at`. Không có endpoint DELETE đơn (chỉ hủy bằng
  trạng thái, giữ lịch sử).
- **Trạng thái đơn là state machine, không phải chuỗi tự do.**
  `status` CHECK `IN ('draft','confirmed','processing','completed',
  'cancelled')`. Chuyển đổi hợp lệ duy nhất:
  `draft → confirmed`, `confirmed → processing`, `processing → completed`,
  `draft → cancelled`, `confirmed → cancelled`, `processing → cancelled`.
  Mọi chuyển khác (ví dụ `draft → completed`, `completed → cancelled`,
  `cancelled → confirmed`, xác nhận đơn đã xác nhận) → 400, không đổi gì.
  Mỗi chuyển trạng thái ghi 1 dòng `order_events` (xem dưới) + 1 bản ghi
  `audit_log` (xem yêu cầu 13).
- **Dòng đơn snapshot giá tại thời điểm đặt.** Bảng `order_items` có
  `order_id` FK tới `orders`, `variant_id` FK tới `product_variants`,
  `product_id` FK tới `products` (lưu sẵn để khỏi join), `sku` TEXT NOT NULL
  (snapshot), `name` TEXT NOT NULL (snapshot tên biến thể), `unit_price`
  INTEGER NOT NULL CHECK `>= 0` (giá hiệu dụng tại thời điểm đặt — resolve
  bằng `effectivePrice()` với kênh + chi nhánh của đơn, xem quyết định giá
  ở dưới), `price_source` TEXT NOT NULL (nguồn fallback đã áp dụng:
  `variant_channel_branch`/.../`base`), `qty` INTEGER NOT NULL CHECK
  `> 0`, `line_total` INTEGER NOT NULL (`unit_price * qty`). `total` của
  đơn = tổng `line_total` (tính ở service, không tin client gửi tổng lên).
  Tạo đơn với 0 dòng → 400; trùng biến thể trong cùng một đơn → 400
  (không gộp lặng lẽ); `qty` không nguyên hoặc <= 0 → 400.
- **Giá tại thời điểm đặt = giá hiệu dụng GOAL-003, snapshot vào đơn.**
  Lúc tạo đơn, với mỗi dòng, server tự resolve giá bằng `effectivePrice()`
  (fallback 8 bước, D15, `docs/PRICING.md`) theo `channel` + `branch_id`
  của đơn — Lead tách hàm resolve dùng chung (hiện logic resolve nằm trong
  route `GET /api/products/:id/price`; tách ra để route đơn và route giá
  cùng dùng, không viết lại 2 lần). Giá đổi sau khi đặt đơn KHÔNG làm đổi
  giá dòng đã snapshot (bằng chứng giá tại thời điểm đặt — GOAL-009 sẽ dùng
  tiếp). Tạo đơn cho biến thể của sản phẩm đã ngừng kinh doanh → 400
  (không bán hàng đã ngừng bán); biến thể không tồn tại hoặc ngoài org →
  404/403.
- **Xác nhận đơn = giữ hàng nguyên tử cho mọi dòng.** `confirmed` chỉ xảy
  ra khi giữ hàng thành công cho TẤT CẢ các dòng trong CÙNG MỘT transaction
  `BEGIN IMMEDIATE` (dùng `applyMovement` loại `reserve` cho từng dòng, với
  `reference` = mã đơn, `reason` = "giữ hàng cho đơn <mã>"). Dòng nào
  `qty > available` trong kho của đơn → 400 `insufficient_stock`, KHÔNG
  giữ dòng nào, đơn ở lại `draft`, không ghi movement nào. Kho của đơn
  `inactive` lúc xác nhận → 400.
- **Hủy đơn = giải phóng đúng số đã giữ.** Hủy từ `confirmed` hoặc
  `processing`: với mỗi dòng, `applyMovement` loại `release` đúng số lượng
  đã giữ (cùng transaction với đổi trạng thái, `reference` = mã đơn,
  `reason` = "giải phóng hàng đơn <mã> đã hủy"). Hủy từ `draft`: không có
  hàng giữ nên chỉ đổi trạng thái + ghi lịch sử. Hủy từ `completed` hoặc
  đơn đã `cancelled` → 400 (chuyển trạng thái không hợp lệ).
- **Hoàn tất đơn = giải phóng giữ + xuất kho trong CÙNG MỘT transaction
  (commit giữ hàng → xuất).** Đây là điểm dễ sai nhất của goal — ghi rõ:
  `applyMovement` loại `out` yêu cầu `qty <= available` và KHÔNG trừ
  `reserved` (D17). Khi đơn đang giữ hàng, `available = on_hand -
  reserved` nên xuất trực tiếp sẽ sai số học (reserved còn treo mãi sau khi
  hàng đã đi). Cách đúng: với mỗi dòng, trong CÙNG MỘT transaction
  `BEGIN IMMEDIATE`: (1) `release` đúng số lượng đã giữ (trả `reserved` về
  0 cho dòng đó), rồi (2) `out` đúng số lượng đó (trừ `on_hand`). Cả hai
  movement cùng `reference` = mã đơn, `reason` = "xuất kho cho đơn <mã>
  hoàn tất". Bước nào lỗi thì cả transaction rollback — không được để lại
  trạng thái "đã giải phóng nhưng chưa xuất" hay ngược lại. KHÔNG thêm loại
  movement mới `fulfill` — dùng đúng 2 movement `release` + `out` đã có.
- **Lịch sử đơn append-only.** Bảng `order_events` chỉ INSERT, không có API
  UPDATE/DELETE: `order_id` FK tới `orders`, `from_status` TEXT NULL
  (NULL khi tạo đơn), `to_status` TEXT NOT NULL, `actor_id` FK tới `users`,
  `note` TEXT NULL (ghi chú khi chuyển trạng thái — hủy đơn nên có lý do,
  xem yêu cầu 5), `created_at`. Tạo đơn ghi 1 event
  (`from_status NULL → draft`); mỗi chuyển trạng thái ghi 1 event.
  `GET /api/orders/:id` trả đơn kèm `items` + `events` (mới nhất sau cùng
  hay trước — Lead chọn một thứ tự và ghi rõ; test theo đúng thứ tự đó).
- **Idempotency cho tạo đơn + chuyển trạng thái, trong transaction.**
  Tạo đơn và mọi chuyển trạng thái đều nhận `Idempotency-Key` (header)
  hoặc `idempotency_key` (body); server dùng `withStockIdempotency`
  (GOAL-004) — kiểm tra key + thực thi + ghi key trong CÙNG MỘT
  transaction `BEGIN IMMEDIATE` — vì chuyển trạng thái động vào kho nên
  KHÔNG dùng `withIdempotency` của GOAL-001 (nó kiểm tra key ngoài
  transaction, có khe race). Tên miền key: `order:create:<key>` cho tạo
  đơn, `order:<hành động>:<key>` cho chuyển trạng thái (`confirm`/
  `process`/`complete`/`cancel`); gửi lại cùng key + cùng loại + cùng org
  → trả đúng response đã lưu kèm `replayed: true`, KHÔNG tạo đơn mới,
  KHÔNG đổi trạng thái lần nữa, KHÔNG động vào kho. Key khác nhau thì thực
  thi bình thường. Thiếu key thì vẫn thực thi (không bắt buộc) nhưng không
  có bảo vệ gửi lại. Lưu ý: replay của một chuyển trạng thái trả đúng
  response đã lưu NGAY CẢ KHI đơn đã chuyển tiếp sang trạng thái khác sau
  đó (đó là ngữ nghĩa đúng của idempotency — key trỏ về lần thực thi đầu).
- **Chống bán quá tồn khi đồng thời.** Mọi giữ/xuất đều qua `applyMovement`
  trong `BEGIN IMMEDIATE` + `CHECK` ở DB (D17) nên tổng số lượng giữ/xuất
  thành công không bao giờ vượt `available` tại thời điểm đó; test chứng
  minh: tạo N đơn nháp cùng biến thể rồi xác nhận đồng thời — tổng giữ
  thành công <= `available`, các đơn vượt nhận 400 `insufficient_stock`,
  tồn cuối không âm, `reserved` không vượt `on_hand`. Lưu ý như GOAL-004:
  app một tiến trình (D1), bảo vệ race chỉ có ý nghĩa trong một process;
  đa process ngoài phạm vi, ghi rõ trong DECISIONS.md.
- **Chi nhánh của đơn.** `orders.branch_id` lấy từ người tạo: nếu
  `actor.branchId` có giá trị thì đơn thuộc chi nhánh đó (body có gửi
  `branch_id` khác → 403); nếu actor là user toàn org (`branchId` NULL,
  chỉ owner/manager) thì body PHẢI có `branch_id` thuộc org (thiếu hoặc
  ngoài org → 400/403). Đơn là dữ liệu cấp org nhưng lọc/xem theo chi
  nhánh theo ma trận quyền (xem dưới).

## Ma trận quyền (đơn hàng — bổ sung vào `docs/RBAC.md`)

Vai: `owner`, `manager`, `sales`, `warehouse`, `accountant` (GOAL-002).
Quy tắc chung (D4): mọi thao tác kiểm tra cả vai VÀ phạm vi; vai sai thao
tác → 403; đúng vai sai phạm vi → 403; ngoài org → 403. Helper `can()` mở
rộng thêm actions: `create-order`, `confirm-order`, `process-order`,
`complete-order`, `cancel-order`, `view-orders`. Kiểu `Target` mở rộng thêm
`warehouseId` (đã có từ GOAL-004) + dùng `branchId` đã có cho phạm vi chi
nhánh của đơn.

| Thao tác | owner | manager | sales | warehouse | accountant |
|---|---|---|---|---|---|
| Tạo đơn (`POST /api/orders`) | Được | Được | Được (đúng chi nhánh của mình) | Không (403) | Không (403) |
| Xác nhận đơn (`POST /api/orders/:id/confirm`) | Được | Được | Được (đơn thuộc chi nhánh của mình) | Không (403) | Không (403) |
| Xử lý đơn (`POST /api/orders/:id/process`) | Được | Được | Không (403) | Được, chỉ đơn có `warehouse_id` trong phạm vi của mình (`warehouse_id` NULL = mọi kho) | Không (403) |
| Hoàn tất đơn (`POST /api/orders/:id/complete`) | Được | Được | Không (403) | Được, chỉ đơn có `warehouse_id` trong phạm vi của mình | Không (403) |
| Hủy đơn (`POST /api/orders/:id/cancel`) | Được | Được | Được (đơn thuộc chi nhánh của mình) | Không (403) | Không (403) |
| Xem danh sách/chi tiết đơn (`GET /api/orders...`) | Được, toàn org | Được, toàn org | Được, chỉ đơn thuộc chi nhánh của mình | Được, chỉ đơn có `warehouse_id` trong phạm vi của mình | Được, toàn org (chỉ xem) |

Ghi chú: `sales` xem đơn ngoài chi nhánh của mình → 403; `warehouse` xem
đơn có kho ngoài phạm vi → 403; mọi vai xem đơn ngoài org → 403.

## Yêu cầu

1. Migration 010 tạo bảng `orders` (`org_id` NOT NULL FK tới `orgs`,
   `branch_id` NOT NULL FK tới `branches`, `warehouse_id` NOT NULL FK tới
   `warehouses`, `code` TEXT NOT NULL, `channel` TEXT NOT NULL CHECK
   `IN ('counter','web','api')`, `customer_name` TEXT NULL, `status` TEXT
   NOT NULL DEFAULT `'draft'` CHECK `IN ('draft','confirmed','processing',
   'completed','cancelled')`, `total` INTEGER NOT NULL DEFAULT 0 CHECK
   `>= 0`, `created_by` NOT NULL FK tới `users`, `created_at` /
   `updated_at`): `UNIQUE(org_id, code)`; migration chạy tuần tự sau
   001–009, giữ dữ liệu cũ, không vỡ 125 test đã khóa. Không có endpoint
   DELETE đơn.
2. Migration 010 (tiếp) tạo bảng `order_items` (`order_id` NOT NULL FK
   tới `orders`, `variant_id` NOT NULL FK tới `product_variants`,
   `product_id` NOT NULL FK tới `products`, `sku` TEXT NOT NULL,
   `name` TEXT NOT NULL, `unit_price` INTEGER NOT NULL CHECK `>= 0`,
   `price_source` TEXT NOT NULL, `qty` INTEGER NOT NULL CHECK `> 0`,
   `line_total` INTEGER NOT NULL CHECK `>= 0`): một đơn không có 2 dòng
   cùng biến thể (`UNIQUE(order_id, variant_id)`); `line_total =
   unit_price * qty`.
3. Migration 010 (tiếp) tạo bảng `order_events` append-only (`order_id`
   NOT NULL FK tới `orders`, `from_status` TEXT NULL, `to_status` TEXT
   NOT NULL, `actor_id` NOT NULL FK tới `users`, `note` TEXT NULL,
   `created_at`): chỉ INSERT, không có API UPDATE/DELETE lịch sử (gọi
   sửa/xóa → 404/405).
4. API tạo đơn: `POST /api/orders` nhận `{branch_id?, warehouse_id,
   channel, customer_name?, items: [{variant_id, qty}], idempotency_key?}`
   — `channel` phải thuộc `counter`/`web`/`api` (lạ → 400); `items` là
   mảng không rỗng (rỗng → 400); mỗi dòng `qty` nguyên > 0, biến thể tồn
   tại trong org (không tồn tại/ngoài org → 404/403), không trùng biến
   thể trong cùng đơn (→ 400), biến thể của sản phẩm đã ngừng kinh doanh
   → 400; `warehouse_id` phải là kho trong org và `active` (không tồn
   tại/ngoài org → 404/403, kho `inactive` → 400); `branch_id` theo luật
   ở quyết định mô hình; thành công → 201, trả đơn đã tạo kèm `items`
   (mỗi dòng có `unit_price` + `price_source` đã snapshot) và `total`
   (tổng các `line_total`, tính ở server). Tạo đơn KHÔNG giữ hàng, KHÔNG
   trừ kho — đơn mới ở `draft`, tồn không đổi (test chứng minh). Mã đơn
   `DH-YYYYMMDD-NNNN` duy nhất trong org.
5. API chuyển trạng thái: `POST /api/orders/:id/confirm`,
   `/process`, `/complete`, `/cancel` (nhận `{note?, idempotency_key?}`
   — hủy đơn nên có `note` là lý do hủy; thiếu lý do vẫn cho hủy nhưng
   ghi `note` NULL — không bắt buộc để demo gọn; Lead có thể bắt buộc và
   ghi rõ nếu chọn vậy). Chuyển sai → 400, không đổi gì, không ghi
   event, không động kho. Xác nhận: giữ hàng nguyên tử mọi dòng (dòng
   nào thiếu tồn → 400 `insufficient_stock`, không giữ dòng nào). Hủy từ
   `confirmed`/`processing`: giải phóng đúng số đã giữ. Hoàn tất từ
   `processing`: mỗi dòng release + out trong cùng transaction (xem quyết
   định mô hình — KHÔNG thêm loại movement mới). Mọi chuyển thành công ghi
   1 event + 1 audit log, trả đơn kèm `items` + `events`.
6. API đọc đơn: `GET /api/orders?status=&channel=&code=&customer_name=
   &branch_id=&warehouse_id=&limit=&offset=` trả danh sách đơn của org
   (mới nhất trước; `code`/`customer_name` tìm theo chuỗi con, không phân
   biệt hoa thường; `limit` mặc định 20, tối đa 100; `offset` mặc định 0;
   kèm tổng số để phân trang); `GET /api/orders/:id` trả đơn kèm `items`
   + `events`. Mọi API đọc lọc theo org + phạm vi vai (sales chỉ chi
   nhánh mình, warehouse chỉ kho được gán — xem ma trận); ngoài org →
   403; đơn không tồn tại → 404.
7. Idempotency cho đơn: tạo đơn + mọi chuyển trạng thái đều nhận
   `Idempotency-Key` (header) hoặc `idempotency_key` (body); server dùng
   `withStockIdempotency` (GOAL-004) với tên miền key
   `order:create:<key>` / `order:<hành động>:<key>`; gửi lại cùng key +
   cùng loại + cùng org → trả đúng response đã lưu kèm `replayed: true`,
   KHÔNG tạo đơn mới, KHÔNG đổi trạng thái lần nữa, KHÔNG động vào kho
   (số đơn, số movement, mức tồn không đổi — test chứng minh). Key khác
   nhau thì thực thi bình thường. Thiếu key thì vẫn thực thi (không bắt
   buộc) nhưng không có bảo vệ gửi lại.
8. Chống bán quá tồn: mọi giữ/xuất qua `applyMovement` trong
   `BEGIN IMMEDIATE` + `CHECK` ở DB (D17); test tạo nhiều đơn nháp cùng
   biến thể rồi xác nhận đồng thời — tổng giữ thành công <= `available`,
   các đơn vượt nhận 400 `insufficient_stock`, tồn cuối không âm,
   `reserved` không vượt `on_hand`. Test xác nhận cùng một đơn 2 lần
   đồng thời (khác key): chỉ 1 lần thành công, lần còn lại 400 (đơn không
   còn ở `draft`). Test gửi lại cùng idempotency key đồng thời: chỉ 1 lần
   thực thi.
9. Lịch sử đơn: `order_events` ghi đủ mọi lần tạo/chuyển trạng thái
   (`from_status`/`to_status`/`actor_id`/`note`/`created_at`); `GET
   /api/orders/:id` trả `events` theo đúng thứ tự đã chốt (ghi rõ trong
   docs); hủy đơn khi đang xử lý giải phóng đúng số đã giữ (test: xác
   nhận giữ 10 → xử lý → hủy → `reserved` về 0, `on_hand` không đổi,
   `available` về như trước khi xác nhận).
10. RBAC đơn: mở rộng helper `can()` ở `src/rbac.ts` thêm actions
    `create-order`, `confirm-order`, `process-order`, `complete-order`,
    `cancel-order`, `view-orders` theo đúng ma trận ở trên; mọi endpoint
    đơn qua `requireRole` + `can()` (vai sai → 403, ngoài org → 403, sai
    chi nhánh/kho → 403). Test chứng minh từng ô cấm trong ma trận (ít
    nhất: warehouse tạo đơn → 403, accountant xác nhận đơn → 403, sales
    xử lý đơn → 403, sales xác nhận đơn ngoài chi nhánh → 403, warehouse
    hoàn tất đơn có kho ngoài phạm vi → 403, user org A đọc đơn org B →
    403).
11. Audit log cho đơn: ghi vào `audit_log` đã có MỌI thao tác tạo đơn,
    xác nhận/xử lý/hoàn tất/hủy; mỗi bản ghi có `user_id` người thực
    hiện, `created_at`, `action` + `detail` JSON (`target_order_id`,
    `order_code`, `from_status`/`to_status`, `total`, KHÔNG chứa dữ liệu
    nhạy cảm); xem log theo luật GOAL-002 (`GET /api/audit-log`: `owner`
    toàn org, `manager` trong phạm vi, các vai khác → 403). Lưu ý:
    `order_events` đã là lịch sử trạng thái chi tiết; `audit_log` là lớp
    ghi nhận thao tác nhạy cảm theo chuẩn GOAL-002 — cả hai đều phải có,
    không thay nhau.
12. Test mới (vitest + supertest, thêm vào file test mới —
    KHÔNG sửa 125 test đã khóa của GOAL-001..004): chứng minh tạo đơn
    đúng snapshot giá (đổi giá sau không đổi giá đơn), tạo đơn không giữ
    hàng, xác nhận giữ đúng số + thiếu tồn 400 không giữ dòng nào, hủy từ
    nháp/xác nhận/đang xử lý đúng (giải phóng đúng số), hoàn tất
    release+out đúng số học (reserved về 0, on_hand trừ đúng), chuyển sai
    → 400 (draft → completed, completed → cancelled, xác nhận 2 lần),
    idempotency (tạo lại cùng key → cùng mã đơn, không tạo đơn mới;
    chuyển trạng thái lại cùng key → `replayed: true`, không động kho),
    race (đồng thời nhiều xác nhận → tổng giữ <= available, không bán quá
    tồn), tìm kiếm/lọc/phân trang (theo status/channel/code/customer,
    limit/offset + tổng số), RBAC 403 theo ma trận (yêu cầu 10), kho
    `inactive` chặn xác nhận → 400, biến thể sản phẩm ngừng kinh doanh
    không tạo đơn được → 400. Test dùng dữ liệu giả lập (2 org, 2 kho trở
    lên trong cùng org, 2 biến thể trở lên).
13. Dữ liệu GIẢ LẬP hoàn toàn; mật khẩu seed qua biến môi trường (như
    GOAL-001..004: `OMNIFLOW_SEED_*_PASSWORD`), không commit credential
    thật; `check.sh` vẫn quét secret (grep như GOAL-001); seed KHÔNG cần
    thêm đơn mẫu (demo tự tạo đơn) — nhưng giữ nguyên 2 user, 2 sản phẩm,
    2 kho + mức tồn mẫu để test khóa vẫn xanh.
14. `scripts/check.sh` (CHK-1) và `scripts/demo.sh` (CHK-2) được MỞ RỘNG
    trong goal này: thêm bước đơn vào smoke/demo (tạo đơn tại quầy →
    xác nhận giữ hàng → xử lý → hoàn tất xuất kho → tạo đơn khác → xác
    nhận → hủy khi đang xử lý giải phóng đúng → chuyển sai 400 →
    idempotency gửi lại không tạo đơn mới → race đồng thời không bán quá
    tồn → RBAC 403: warehouse tạo đơn, sales xử lý đơn, ngoài org),
    giữ tất cả bước GOAL-001..004 xanh (health, login, owner-only,
    idempotency, backup/restore, RBAC người dùng, sản phẩm/giá/CSV, kho).
    Cả 2 script tự chạy được, tự dọn dẹp, in PASS/FAIL từng bước.
15. Docs: `docs/RBAC.md` bổ sung ma trận đơn (bảng ở trên) + mô hình phạm
    vi đơn (chi nhánh + kho); `docs/DECISIONS.md` thêm D19 (mô hình đơn:
    state machine, snapshot giá, giữ/giải phóng/commit release+out, mã
    đơn, idempotency trong transaction, race một process) và D20 nếu có
    quyết định tách hàm resolve giá dùng chung (Lead ghi); `README.md`/
    `docs/SETUP.md` cập nhật endpoint đơn, khớp lệnh đã chạy thật. Không
    có file `.github/workflows/` trong repo (gh token thiếu scope
    `workflow` — CI là follow-up sau khi user cấp scope). Không claim
    VPS, không claim deploy production (local-only, D9).

## Ngoài phạm vi (thuộc goal sau, không làm trong GOAL-005)

16. Thanh toán/hoàn tiền (GOAL-006): không thu tiền, không trạng thái thanh
    toán trên đơn (trường thanh toán để Goal sau thêm), không webhook, không
    đối soát đơn–thanh toán.
17. Giao hàng/trả hàng (GOAL-007): không yêu cầu giao, không gán đơn vị vận
    chuyển, không trả hàng nhập lại kho — "hoàn tất" ở đây chỉ là xuất kho
    xong, chưa phải giao tới khách.
18. Khách hàng + CRM (GOAL-008): `customer_name` chỉ là chuỗi tự do trên
    đơn, không có bảng khách hàng, không hợp nhất hồ sơ trùng, không lịch
    sử chăm sóc.
19. Khuyến mãi (GOAL-009): không mã giảm giá, không chương trình theo điều
    kiện — giá đơn chỉ dùng giá hiệu dụng GOAL-003 đã snapshot.
20. Báo cáo/đối soát (GOAL-010), thông báo (GOAL-011): không tổng hợp
    doanh thu theo đơn, không thông báo đơn mới (chỉ audit log + lịch sử
    đơn).
21. Đa chi nhánh cho 1 user (bảng `user_scopes`), quên mật khẩu / đặt lại
    mật khẩu qua email, SSO/OAuth, upload ảnh thật — là follow-up, không
    làm trong goal này.
22. Deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user
    cấp scope `workflow`).

## Rủi ro / phụ thuộc

- **Phụ thuộc GOAL-003 + GOAL-004:** cần sản phẩm/biến thể/SKU, fallback
  giá 8 bước, `effectivePrice()`, kho đa kho, `applyMovement`
  reserve/release/out, `withStockIdempotency`, RBAC + `audit_log` đã chạy.
  Nếu GOAL-004 chưa close thì không select GOAL-005.
- **Rủi ro hoàn tất đơn sai số học (quan trọng nhất):** `out` trực tiếp
  không trừ `reserved` (D17) — hoàn tất bằng một movement `out` duy nhất
  sẽ để `reserved` treo mãi và `available` sai sau đó. Bắt buộc release +
  out trong cùng transaction (xem quyết định mô hình); test hoàn tất phải
  kiểm tra cả `reserved` về 0 VÀ `on_hand` trừ đúng VÀ `available` cuối.
- **Rủi ro xác nhận nửa vời:** giữ từng dòng riêng lẻ không bọc chung
  transaction sẽ để lại đơn giữ được một nửa khi dòng sau thiếu tồn —
  bắt buộc giữ mọi dòng trong CÙNG MỘT transaction, dòng nào thiếu thì
  rollback toàn bộ.
- **Rủi ro idempotency ngoài transaction:** `withIdempotency` của GOAL-001
  kiểm tra key ngoài transaction — dùng cho tạo đơn/chuyển trạng thái sẽ
  để lọt thực thi trùng khi hai yêu cầu cùng key chạy đồng thời (bài học
  GOAL-004); bắt buộc dùng `withStockIdempotency` (kiểm tra + thực thi +
  ghi key trong một transaction).
- **Rủi ro race trong test:** test đồng thời nhiều xác nhận chạy trên một
  process Node + SQLite đồng bộ — các yêu cầu được xếp hàng ở event loop
  nên "đồng thời" ở đây là đồng thời ở mức HTTP, không phải đa process;
  test chứng minh bất biến (tổng giữ <= available, tồn không âm) chứ không
  chứng minh được khả năng chống race đa process (ngoài phạm vi, ghi rõ
  trong DECISIONS.md).
- **Rủi ro giá snapshot sai kênh/chi nhánh:** giá hiệu dụng phụ thuộc cả
  kênh lẫn chi nhánh của đơn — tạo đơn kênh `web` chi nhánh A phải snapshot
  đúng giá web của A, không lấy giá quầy hay giá chi nhánh B; test phải có
  case giá riêng theo kênh/chi nhánh (seed đã có giá web riêng 160000 cho
  SP-SEED-01).
- **Rủi ro mã đơn trùng khi đồng thời:** hai đơn tạo cùng lúc trong ngày
  không được trùng mã — số thứ tự `NNNN` phải tính trong cùng transaction
  tạo đơn (đếm đơn trong ngày của org rồi +1, trong `BEGIN IMMEDIATE`),
  không tính ngoài transaction rồi mới insert.
