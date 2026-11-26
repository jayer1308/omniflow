# OmniFlow — brief GOAL-004: Kho đa kho + tồn giữ/có thể bán

## Bối cảnh (vấn đề)

OmniFlow là hệ thống vận hành thương mại đa kênh cho doanh nghiệp vừa (nhiều
doanh nghiệp, nhiều chi nhánh, nhiều kho, nhiều kênh bán), dự án dài hạn để kiểm
tra APOS ở quy mô lớn. Roadmap: `docs/ROADMAP.md` (12 Goal). Quyết định kiến
trúc: `docs/DECISIONS.md` (D1–D16).

GOAL-004 xây nghiệp vụ kho trên nền GOAL-001 (đã CLOSED) + GOAL-002 (RBAC,
đã CLOSED) + GOAL-003 (sản phẩm/giá/CSV, đã CLOSED): nhiều kho trong một
doanh nghiệp; nhập/xuất/điều chỉnh/kiểm kê/chuyển kho; tồn thực tế / tồn giữ /
tồn có thể bán; lịch sử biến động; cảnh báo tồn thấp; chống race + idempotency;
chính sách không cho tồn âm. Phụ thuộc: GOAL-001, GOAL-002, GOAL-003. Không
làm đơn hàng (GOAL-005), thanh toán (GOAL-006) trong goal này.
Dữ liệu GIẢ LẬP hoàn toàn; không tiền thật, không dịch vụ trả phí.
Dự án chỉ làm LOCAL — không có VPS trong phạm vi (user xác nhận 26/11 21:49).

Đề xuất: size L, appetite 480 phút, 3 lần thử (Human delegate duyệt ở gate A;
đặt dư vì APOS tính wall-clock từ lúc select — bài học DRAK GOAL-002).

Điểm xuất phát (GOAL-001 + GOAL-002 + GOAL-003, đã khóa — KHÔNG sửa):
`src/app.ts` (Express, EJS, session cookie, middleware `requireRole`/
`requireScope`, route người dùng/chi nhánh/audit log/sản phẩm/giá/CSV),
`src/rbac.ts` (helper `can()`, actions hiện tại: invite/lock/unlock/revoke/
change-role/change-scope/change-password-other/list-users/view-audit-log/
create-branch + 8 actions sản phẩm/giá/CSV), `src/db.ts` (migration 001–008;
chưa có bảng kho nào), `src/seed.ts` (1 org, 1 branch, 2 user: owner + sales;
2 sản phẩm mẫu + 1 biến thể + 1 giá riêng), `src/tenant.ts` (middleware scope
org/branch), `src/idempotency.ts` (helper `withIdempotency` — xem lưu ý ở dưới),
`src/products.ts` (fallback giá 8 bước, parse CSV), `tests/acceptance.test.ts`
(17 test đã khóa) + `tests/rbac-acceptance.test.ts` (21 test đã khóa) +
`tests/products-acceptance.test.ts` (45 test đã khóa — KHÔNG sửa test cũ, seed
phải giữ 2 user để test khóa vẫn xanh), `scripts/check.sh` (CHK-1) +
`scripts/demo.sh` (CHK-2) — goal này MỞ RỘNG 2 script, giữ các bước
GOAL-001/002/003 xanh.

## Kết quả mong muốn

Cuối goal, một `owner`/`manager`/`warehouse` đăng nhập vào hệ thống có thể tạo
nhiều kho trong doanh nghiệp, nhập/xuất/điều chỉnh/kiểm kê/chuyển kho cho từng
biến thể sản phẩm, giữ hàng (reserve) và giải phóng giữ hàng, luôn thấy đúng
3 con số tồn thực tế / tồn giữ / tồn có thể bán (available = on-hand −
reserved), tra được lịch sử mọi biến động (ai, lúc nào, lý do, trước/sau),
nhận cảnh báo khi tồn có thể bán xuống dưới ngưỡng `min_stock` của sản phẩm —
và mọi thao tác đều bị chặn đúng khi sai vai, sai kho, hoặc ngoài org, với
audit log đầy đủ; gửi lại cùng một yêu cầu (cùng idempotency key) không bao
giờ trừ kho 2 lần, kể cả khi nhiều yêu cầu chạy đồng thời.

## Quyết định mô hình (Lead/Worker ghi vào DECISIONS.md làm D17, D18)

- **Kho là dữ liệu cấp org.** Bảng `warehouses` có `org_id`, KHÔNG gắn bắt
  buộc vào một chi nhánh: một kho phục vụ cả doanh nghiệp. Có cột `branch_id`
  NULL optional (chi nhánh phụ trách, chỉ để hiển thị — KHÔNG dùng để gate
  quyền kho; xem ma trận quyền ở dưới). Kho có `status` `active`/`inactive`:
  kho `inactive` không nhận thao tác tồn mới (→ 400) nhưng vẫn đọc được lịch
  sử; KHÔNG có endpoint DELETE kho (giữ lịch sử cho GOAL-005/007).
- **Tồn theo biến thể, không theo sản phẩm cha.** Bảng `stock_levels` có
  `org_id`, `warehouse_id` FK tới `warehouses`, `variant_id` FK tới
  `product_variants`, `on_hand` và `reserved` (số nguyên >= 0);
  `UNIQUE(org_id, warehouse_id, variant_id)` — một dòng tồn cho một biến
  thể trong một kho; `CHECK (reserved <= on_hand)` ở tầng DB để bất biến
  không bao giờ vỡ dù logic app có lỗi. `available` là số tính được
  (`on_hand - reserved`), KHÔNG lưu cột riêng. Sản phẩm không có biến thể
  thì tồn gắn vào biến thể nào — quyết định: mọi sản phẩm dùng trong kho
  phải có ít nhất một biến thể (seed đã có biến thể cho SP-SEED-01; test
  tạo biến thể trước khi nhập kho). Không tạo dòng tồn "cấp sản phẩm".
- **Lịch sử biến động append-only.** Bảng `stock_movements` chỉ INSERT,
  không có API UPDATE/DELETE; mỗi lần thay đổi tồn ghi một dòng: `org_id`,
  `warehouse_id`, `variant_id`, `type` (`in`/`out`/`adjust`/`count`/
  `transfer_in`/`transfer_out`/`reserve`/`release`), `qty_change` (số nguyên
  có dấu: nhập +, xuất −, điều chỉnh +/−, kiểm kê = số đếm được − tồn cũ,
  giữ hàng 0 với `reserved_change`, xem ghi chú ở dưới), `on_hand_after`,
  `reserved_after` (ảnh chụp ngay sau biến động), `reason` TEXT bắt buộc,
  `reference` TEXT NULL (mã tham chiếu tự do, ví dụ mã đơn sau này ở
  GOAL-005 — goal này chỉ lưu, không bắt buộc), `actor_id` FK tới `users`,
  `created_at`. Vì một biến động có thể đổi cả `on_hand` lẫn `reserved`
  (giữ hàng đổi `reserved`, xuất kho đổi `on_hand`), bảng cần thêm cột
  `reserved_change` INTEGER DEFAULT 0 để ghi rõ phần thay đổi của tồn giữ;
  `qty_change` là phần thay đổi của tồn thực tế.
- **Chính sách tồn âm: KHÔNG cho xuất quá tồn có thể bán.** Xuất kho,
  chuyển kho (kho nguồn), giữ hàng đều yêu cầu `qty <= available` (tồn thực
  tế − tồn giữ); vi phạm → 400 kèm mã lỗi rõ ràng (`insufficient_stock`),
  KHÔNG ghi dòng tồn, KHÔNG ghi movement. Điều chỉnh/giảm tồn và kiểm kê
  cũng không được làm `on_hand < reserved` (→ 400). Không có chế độ "cho
  phép tồn âm" trong goal này; nếu sau này cần thì Goal riêng đổi chính sách
  và ghi rõ vào DECISIONS.md.
- **Giữ hàng (reserve) là API độc lập cho luồng đơn sau này.** Chưa có đơn
  hàng (GOAL-005) nên `reserve`/`release` là thao tác trực tiếp: `reserve`
  tăng `reserved` (không đổi `on_hand`), `release` giảm `reserved`.
  Xuất kho KHÔNG tự động trừ `reserved`: hàng đã giữ chỉ được xuất qua
  luồng đơn ở GOAL-005 (commit giữ hàng → xuất); trong goal này, xuất kho
  chỉ trừ `on_hand` và vẫn phải thỏa `qty <= available`. Ghi rõ ranh giới
  này trong docs để GOAL-005 không phải đoán lại.
- **Ngưỡng tồn thấp lấy từ `products.min_stock` (D15).** `min_stock` là
  ngưỡng cấp sản phẩm (org-level); cảnh báo đánh giá theo từng cặp
  (biến thể, kho): `available < min_stock` thì cặp đó ở trạng thái tồn
  thấp. Response mức tồn kèm cờ `low_stock`; có API riêng
  `GET /api/stock/low-stock` liệt kê các cặp tồn thấp (lọc theo kho).
  Không thêm ngưỡng riêng cấp kho trong goal này.
- **Idempotency cho thao tác tồn phải nằm trong cùng transaction.**
  Helper `withIdempotency` hiện tại (GOAL-001) kiểm tra key rồi mới thực thi
  rồi mới ghi key — 3 bước không nằm trong một transaction nên hai yêu cầu
  cùng key chạy đồng thời có thể cùng lọt qua bước kiểm tra. Với kho, yêu
  cầu bắt buộc: kiểm tra key + thực thi biến động + ghi key phải nằm trong
  CÙNG MỘT transaction `BEGIN IMMEDIATE` (viết helper giao dịch riêng cho
  kho, hoặc mở rộng `withIdempotency` thành bản giao dịch — Lead chọn cách,
  ghi vào DECISIONS.md). Key do client gửi qua header `Idempotency-Key`
  (hoặc trường `idempotency_key` trong body); server đặt tên miền key là
  `stock:<loại thao tác>:<key>` để cùng một key ở hai loại thao tác không
  va nhau; gửi lại cùng key + cùng loại + cùng org → trả đúng response đã
  lưu, không thực thi lại (kèm cờ `replayed: true` trong response để test
  chứng minh được). Thao tác nhập/xuất/điều chỉnh/kiểm kê/chuyển/giữ/giải
  phóng đều hỗ trợ idempotency; thao tác đọc (levels/movements/low-stock)
  không cần.
- **Chống race bằng transaction + CHECK ở DB, không chỉ bằng logic app.**
  Mọi biến động tồn chạy trong `BEGIN IMMEDIATE` (SQLite chỉ có một writer
  nên các transaction ghi được xếp hàng, không chen nhau); bất biến
  `on_hand >= 0`, `reserved >= 0`, `reserved <= on_hand` được ép bằng
  `CHECK` trong schema để kể cả khi logic app có lỗi thì DB vẫn từ chối
  (test chứng minh: gửi đồng thời N yêu cầu xuất, tổng xuất không vượt
  `available`, tồn cuối không âm). Lưu ý: app là một tiến trình duy nhất
  (D1) nên bảo vệ race chỉ có ý nghĩa trong một process; đa process là
  ngoài phạm vi (ghi rõ trong DECISIONS.md).
- **`users.warehouse_id` phải trỏ tới kho tồn tại trong cùng org.**
  Bảng `warehouses` là GOAL-004 mới có (D13 đã chuẩn bị trường
  `warehouse_id` INTEGER NULL không FK). Khi gán `warehouse_id` qua
  `PATCH /api/users/:id/scope`, server kiểm tra kho tồn tại trong cùng org
  (không tồn tại hoặc ngoài org → 400/403); Lead chọn cơ chế (rebuild bảng
  `users` để gắn FK như migration 007 đã làm, hoặc kiểm tra ở tầng service)
  và ghi quyết định vào DECISIONS.md — yêu cầu là hành vi, không phải cơ
  chế. Nhân viên kho (`warehouse_id` NULL) được làm ở mọi kho trong org;
  có giá trị thì chỉ đúng kho đó (xem ma trận quyền).

## Ma trận quyền (kho — bổ sung vào `docs/RBAC.md`)

Vai: `owner`, `manager`, `sales`, `warehouse`, `accountant` (GOAL-002).
Quy tắc chung (D4): mọi thao tác kiểm tra cả vai VÀ phạm vi; vai sai thao
tác → 403; đúng vai sai phạm vi → 403; ngoài org → 403. Kho là cấp org nên
phạm vi chi nhánh KHÔNG gate thao tác kho; phạm vi kho gate bằng
`users.warehouse_id` (xem quyết định mô hình ở trên). Helper `can()` mở
rộng thêm actions: `create-warehouse`, `manage-warehouse`, `stock-in`,
`stock-out`, `stock-adjust`, `stock-count`, `stock-transfer`,
`stock-reserve`, `stock-release`, `view-stock`, `view-stock-movements`;
kiểu `Target` mở rộng thêm `warehouseId` để kiểm tra phạm vi kho.

| Thao tác | owner | manager | warehouse | sales / accountant |
|---|---|---|---|---|
| Tạo kho (`POST /api/warehouses`) | Được | Không (403) | Không (403) | Không (403) |
| Sửa kho: đổi tên / active-inactive (`PATCH /api/warehouses/:id`) | Được | Không (403) | Không (403) | Không (403) |
| Xem danh sách/chi tiết kho (`GET /api/warehouses...`) | Được, toàn org | Được, toàn org | Được, toàn org | Được, toàn org |
| Nhập kho (`POST /api/stock/in`) | Được, mọi kho | Được, mọi kho | Được, chỉ kho được gán (`warehouse_id` NULL = mọi kho) | Không (403) |
| Xuất kho (`POST /api/stock/out`) | Được, mọi kho | Được, mọi kho | Được, chỉ kho được gán | Không (403) |
| Điều chỉnh tồn (`POST /api/stock/adjust`) | Được, mọi kho | Được, mọi kho | Được, chỉ kho được gán | Không (403) |
| Kiểm kê (`POST /api/stock/count`) | Được, mọi kho | Được, mọi kho | Được, chỉ kho được gán | Không (403) |
| Chuyển kho (`POST /api/stock/transfer`) | Được, mọi kho | Được, mọi kho | Được, chỉ khi CẢ kho nguồn VÀ kho đích đều trong phạm vi của mình | Không (403) |
| Giữ hàng (`POST /api/stock/reserve`) | Được, mọi kho | Được, mọi kho | Được, chỉ kho được gán | Không (403) |
| Giải phóng giữ hàng (`POST /api/stock/release`) | Được, mọi kho | Được, mọi kho | Được, chỉ kho được gán | Không (403) |
| Xem mức tồn (`GET /api/stock/levels`) | Được, toàn org | Được, toàn org | Được, chỉ kho được gán (NULL = mọi kho) | Được, toàn org (chỉ xem, để bán hàng/đối soát) |
| Xem lịch sử biến động (`GET /api/stock/movements`) | Được, toàn org | Được, toàn org | Được, chỉ kho được gán | `accountant` được; `sales` không (403) |
| Xem tồn thấp (`GET /api/stock/low-stock`) | Được, toàn org | Được, toàn org | Được, chỉ kho được gán | `accountant` được; `sales` không (403) |

## Yêu cầu

1. Migration 009 tạo bảng `warehouses` (`org_id` NOT NULL FK tới `orgs`,
   `name` TEXT NOT NULL, `branch_id` NULL FK tới `branches` — chi nhánh phụ
   trách, optional, chỉ để hiển thị, `status` TEXT NOT NULL DEFAULT
   `'active'` CHECK `('active','inactive')`, `created_at` / `updated_at`):
   tên bắt buộc (rỗng → 400); migration chạy tuần tự sau 001–008, giữ dữ
   liệu cũ, không vỡ 83 test đã khóa.
2. Migration 009 (tiếp) tạo bảng `stock_levels` (`org_id` NOT NULL FK tới
   `orgs`, `warehouse_id` NOT NULL FK tới `warehouses`, `variant_id` NOT
   NULL FK tới `product_variants`, `on_hand` INTEGER NOT NULL DEFAULT 0
   CHECK `>= 0`, `reserved` INTEGER NOT NULL DEFAULT 0 CHECK `>= 0`,
   `updated_at`): `UNIQUE(org_id, warehouse_id, variant_id)`; `CHECK
   (reserved <= on_hand)`; tồn của biến thể ngoài org → 403/404. Không có
   dòng tồn cấp sản phẩm (không có biến thể thì không nhập kho được — test
   chứng minh nhập kho sản phẩm chưa có biến thể → 400).
3. Migration 009 (tiếp) tạo bảng `stock_movements` append-only (`org_id`
   NOT NULL FK, `warehouse_id` NOT NULL FK, `variant_id` NOT NULL FK,
   `type` TEXT NOT NULL CHECK `IN ('in','out','adjust','count',
   'transfer_in','transfer_out','reserve','release')`, `qty_change`
   INTEGER NOT NULL — phần thay đổi của tồn thực tế, có dấu,
   `reserved_change` INTEGER NOT NULL DEFAULT 0 — phần thay đổi của tồn
   giữ, `on_hand_after` INTEGER NOT NULL, `reserved_after` INTEGER NOT
   NULL, `reason` TEXT NOT NULL, `reference` TEXT NULL, `actor_id` NOT
   NULL FK tới `users`, `created_at`): chỉ INSERT, không có API
   UPDATE/DELETE lịch sử (gọi sửa/xóa → 404/405).
4. API kho: `POST /api/warehouses` tạo (201, trả kho đã tạo; chỉ owner),
   `GET /api/warehouses` liệt kê (lọc theo org của user, lọc theo
   `status`/`branch_id`), `GET /api/warehouses/:id` chi tiết,
   `PATCH /api/warehouses/:id` sửa (tên, `status`; chỉ owner).
   KHÔNG có endpoint DELETE kho. Kho `inactive` vẫn đọc được (chi tiết +
   lịch sử) nhưng thao tác tồn mới → 400. Mọi response không bao giờ lộ dữ
   liệu org khác.
5. API nhập/xuất kho: `POST /api/stock/in` và `POST /api/stock/out` nhận
   `{warehouse_id, variant_id, qty, reason, idempotency_key?}` — `qty`
   phải là số nguyên > 0 (0/âm/không nguyên → 400), `reason` bắt buộc
   (rỗng → 400), kho/biến thể không tồn tại hoặc ngoài org → 404/403,
   biến thể của sản phẩm đã ngừng kinh doanh vẫn nhập/xuất được (hàng vật
   lý vẫn còn — ghi rõ trong docs). Nhập: `on_hand += qty`. Xuất: yêu cầu
   `qty <= available` (vi phạm → 400 `insufficient_stock`), `on_hand -=
   qty`, `reserved` không đổi. Mỗi lần thành công ghi 1 dòng movement
   (`in`/`out`) + trả mức tồn mới `{on_hand, reserved, available,
   low_stock}`. Cả hai chạy trong một transaction `BEGIN IMMEDIATE`.
6. API điều chỉnh + kiểm kê: `POST /api/stock/adjust` nhận
   `{warehouse_id, variant_id, qty_change, reason, idempotency_key?}` —
   `qty_change` là số nguyên có dấu khác 0 (0 → 400); điều chỉnh làm
   `on_hand < 0` hoặc `on_hand < reserved` → 400, không ghi gì.
   `POST /api/stock/count` nhận `{warehouse_id, variant_id, counted_qty,
   reason, idempotency_key?}` — `counted_qty` là số nguyên >= 0, đặt
   `on_hand = counted_qty` (chênh lệch ghi vào movement `count` với
   `qty_change = counted_qty - on_hand_cũ`); `counted_qty < reserved` →
   400. Cả hai bắt buộc `reason`, ghi movement + trả mức tồn mới, chạy
   trong transaction.
7. API chuyển kho nguyên tử: `POST /api/stock/transfer` nhận
   `{from_warehouse_id, to_warehouse_id, variant_id, qty, reason,
   idempotency_key?}` — `qty` nguyên > 0, hai kho phải khác nhau (giống
   nhau → 400), cùng org (khác org → 403), kho nguồn phải có
   `qty <= available` (không đủ → 400 `insufficient_stock`, kho đích
   không đổi gì); thành công thì trong CÙNG MỘT transaction: kho nguồn
   `on_hand -= qty` (movement `transfer_out`) + kho đích `on_hand += qty`
   (movement `transfer_in`, tạo dòng `stock_levels` nếu chưa có). Kho đích
   `inactive` → 400.
8. API giữ/giải phóng hàng: `POST /api/stock/reserve` nhận
   `{warehouse_id, variant_id, qty, reason, reference?, idempotency_key?}`
   — `qty` nguyên > 0, `qty <= available` (không đủ → 400
   `insufficient_stock`); `reserved += qty`, `on_hand` không đổi; movement
   `reserve` (`qty_change = 0`, `reserved_change = qty`).
   `POST /api/stock/release` nhận cùng định dạng — `qty <= reserved`
   (vượt → 400); `reserved -= qty`; movement `release`
   (`reserved_change = -qty`). `reference` là chuỗi tự do (ví dụ mã đơn
   sau này), chỉ lưu, không kiểm tra tồn tại.
9. API đọc tồn: `GET /api/stock/levels?warehouse_id=&variant_id=
   &low_stock=true|false&limit=&offset=` trả danh sách mức tồn của org
   (kèm `product_id`, `sku`, `on_hand`, `reserved`, `available`,
   `low_stock` — `available < products.min_stock`); vai `warehouse` chỉ
   thấy kho được gán; `GET /api/stock/movements?warehouse_id=&variant_id=
   &type=&limit=&offset=` trả mới nhất trước (kèm `on_hand_after`,
   `reserved_after`, `reason`, `reference`, `actor_id`); `GET
   /api/stock/low-stock?warehouse_id=` trả các cặp (biến thể, kho) có
   `available < min_stock` kèm `min_stock` và `available`. Mọi API đọc lọc
   theo org, không lộ org khác.
10. Idempotency cho thao tác tồn: nhập/xuất/điều chỉnh/kiểm kê/chuyển/
    giữ/giải phóng đều nhận `Idempotency-Key` (header) hoặc
    `idempotency_key` (body); server đặt tên miền key là
    `stock:<loại thao tác>:<key>`; gửi lại cùng key + cùng loại + cùng
    org → trả đúng response đã lưu kèm `replayed: true`, KHÔNG thực thi
    lại (số tồn và số movement không đổi — test chứng minh); kiểm tra key
    + thực thi + ghi key nằm trong CÙNG MỘT transaction `BEGIN IMMEDIATE`
    (xem quyết định mô hình — không dùng `withIdempotency` hiện tại một
    cách ngây thơ vì nó kiểm tra key ngoài transaction). Key khác nhau thì
    thực thi bình thường. Thiếu key thì vẫn thực thi (không bắt buộc gửi
    key) nhưng không có bảo vệ gửi lại.
11. Chống race: mọi biến động tồn chạy trong `BEGIN IMMEDIATE` + bất biến
    ép bằng `CHECK` trong schema; test gửi đồng thời nhiều yêu cầu xuất
    (ví dụ 10 yêu cầu xuất 10 trong khi `available` = 50) — tổng xuất
    thành công không vượt `available`, tồn cuối không âm, các yêu cầu vượt
    nhận 400 `insufficient_stock`. Test gửi lại cùng idempotency key đồng
    thời — chỉ 1 lần thực thi.
12. Cảnh báo tồn thấp: ngưỡng = `products.min_stock` (D15, cấp sản phẩm);
    cặp (biến thể, kho) có `available < min_stock` là tồn thấp; `GET
    /api/stock/low-stock` liệt kê đúng các cặp đó (kèm `min_stock`,
    `available`, `on_hand`, `reserved`); mức tồn trong `GET
    /api/stock/levels` kèm cờ `low_stock`; seed có ít nhất một cặp tồn
    thấp để demo thấy được.
13. RBAC kho: mở rộng helper `can()` ở `src/rbac.ts` thêm actions
    `create-warehouse`, `manage-warehouse`, `stock-in`, `stock-out`,
    `stock-adjust`, `stock-count`, `stock-transfer`, `stock-reserve`,
    `stock-release`, `view-stock`, `view-stock-movements` theo đúng ma
    trận ở trên (kiểu `Target` mở rộng `warehouseId`); mọi endpoint kho
    qua `requireRole` + `can()` (vai sai → 403, ngoài org → 403, sai kho
    được gán → 403, chuyển kho khi một trong hai kho ngoài phạm vi → 403).
    Gán `warehouse_id` qua `PATCH /api/users/:id/scope` phải kiểm tra kho
    tồn tại trong cùng org (không tồn tại/ngoài org → 400/403). Test chứng
    minh từng ô cấm trong ma trận (ít nhất: sales nhập kho → 403,
    accountant xuất kho → 403, warehouse nhập kho ngoài kho được gán →
    403, manager tạo kho → 403, sales xem movements → 403, user org A
    đọc/tạo kho org B → 403).
14. Audit log cho kho: ghi vào `audit_log` đã có MỌI thao tác tạo/sửa kho,
    nhập/xuất/điều chỉnh/kiểm kê/chuyển/giữ/giải phóng; mỗi bản ghi có
    `user_id` người thực hiện, `created_at`, `action` + `detail` JSON
    (`target_warehouse_id`, `target_variant_id` và `before`/`after` với
    `on_hand`/`reserved`, KHÔNG chứa dữ liệu nhạy cảm); xem log theo luật
    GOAL-002 (`GET /api/audit-log`: `owner` toàn org, `manager` trong phạm
    vi, các vai khác → 403). Lưu ý: `stock_movements` đã là lịch sử chi
    tiết; `audit_log` là lớp ghi nhận thao tác nhạy cảm theo chuẩn GOAL-002
    — cả hai đều phải có, không thay nhau.
15. Test mới (vitest + supertest, thêm vào file test mới — KHÔNG sửa 83
    test đã khóa của GOAL-001/002/003): chứng minh nhập/xuất đúng số học
    (`available = on_hand - reserved`), xuất quá `available` → 400 và
    không ghi movement, giữ/giải phóng đúng số học (xuất không trừ
    `reserved`), chuyển kho nguyên tử (nguồn không đủ → đích không đổi;
    thành công → 2 movement đúng loại), điều chỉnh/kiểm kê có lý do bắt
    buộc + đúng số học + không làm `on_hand < reserved`, idempotency
    (gửi lại cùng key → `replayed: true`, tồn + movement không đổi),
    race (đồng thời nhiều xuất → tổng không vượt `available`, tồn không
    âm), tồn thấp (đúng cặp, đúng cờ `low_stock`), RBAC 403 theo ma trận
    (yêu cầu 13), kho `inactive` chặn thao tác tồn mới → 400, nhập kho
    sản phẩm chưa có biến thể → 400. Test dùng dữ liệu giả lập (2 org, 2
    kho trở lên trong cùng org, 2 biến thể trở lên).
16. Dữ liệu GIẢ LẬP hoàn toàn; mật khẩu seed qua biến môi trường (như
    GOAL-001/002/003: `OMNIFLOW_SEED_*_PASSWORD`), không commit
    credential thật; `check.sh` vẫn quét secret (grep như GOAL-001);
    seed mở rộng thêm 2 kho mẫu + mức tồn mẫu cho sản phẩm seed (giữ 2
    user để test khóa vẫn xanh; ít nhất một cặp tồn thấp để demo).
17. `scripts/check.sh` (CHK-1) và `scripts/demo.sh` (CHK-2) được MỞ RỘNG
    trong goal này: thêm bước kho vào smoke/demo (tạo kho → nhập kho →
    xuất kho → xuất quá tồn 400 → giữ hàng → giải phóng → chuyển kho →
    kiểm kê → tồn thấp → idempotency gửi lại không trừ 2 lần → race đồng
    thời → RBAC 403: sales nhập kho, warehouse nhập kho ngoài phạm vi,
    ngoài org), giữ tất cả bước GOAL-001/002/003 xanh (health, login,
    owner-only, idempotency, backup/restore, RBAC người dùng, sản
    phẩm/giá/CSV). Cả 2 script tự chạy được, tự dọn dẹp, in PASS/FAIL
    từng bước.
18. Docs: `docs/RBAC.md` bổ sung ma trận kho (bảng ở trên) + mô hình phạm
    vi kho (`users.warehouse_id`); `docs/DECISIONS.md` thêm D17 (mô hình
    kho: tồn theo biến thể, available tính được, chính sách không tồn âm,
    reserve độc lập cho GOAL-005, ngưỡng `min_stock`, idempotency trong
    transaction, race một process) và D18 (cơ chế kiểm tra
    `users.warehouse_id` tồn tại — Lead chọn FK rebuild hay service check);
    `README.md`/`docs/SETUP.md` cập nhật endpoint kho, khớp lệnh đã chạy
    thật. Không có file `.github/workflows/` trong repo (gh token thiếu
    scope `workflow` — CI là follow-up sau khi user cấp scope). Không claim
    VPS, không claim deploy production (local-only, D9).

## Ngoài phạm vi (thuộc goal sau, không làm trong GOAL-004)

19. Đơn hàng (GOAL-005): không có luồng giữ hàng tự động khi tạo đơn,
    không có commit giữ hàng → xuất kho khi giao hàng, không có giải phóng
    giữ hàng tự động khi hủy đơn — các API `reserve`/`release` ở goal này
    là thao tác trực tiếp, GOAL-005 sẽ gọi chúng.
20. Thanh toán/hoàn tiền (GOAL-006), giao hàng/trả hàng (GOAL-007), khuyến
    mãi (GOAL-009): không mã giảm giá, không đối soát kho–đơn–thanh toán,
    không trả hàng nhập lại kho.
21. Đa chi nhánh cho 1 user (bảng `user_scopes`), ngưỡng tồn thấp riêng
    theo kho, cảnh báo qua email/thông báo (GOAL-011), upload ảnh thật,
    quên mật khẩu / đặt lại mật khẩu qua email, SSO/OAuth — là follow-up,
    không làm trong goal này.
22. Deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user
    cấp scope `workflow`).

## Rủi ro / phụ thuộc

- **Phụ thuộc GOAL-001 + GOAL-002 + GOAL-003:** cần migration 001–008,
  helper `can()`, middleware `requireRole`/`requireScope`, bảng `audit_log`
  và cơ chế session, sản phẩm/biến thể/SKU, `products.min_stock` đã chạy.
  Nếu GOAL-003 chưa close thì không select GOAL-004.
- **Rủi ro UNIQUE + NULL trên SQLite:** `UNIQUE(org_id, warehouse_id,
  variant_id)` không có NULL nên chặn trùng tốt; nhưng nếu sau này thêm cột
  NULL vào UNIQUE thì nhớ bài học D15 (SQLite coi NULL khác nhau) — kiểm
  tra trùng ở tầng service trong transaction.
- **Rủi ro idempotency ngoài transaction:** `withIdempotency` hiện tại
  kiểm tra key ngoài transaction — dùng ngây thơ cho kho sẽ để lọt thực thi
  trùng khi hai yêu cầu cùng key chạy đồng thời (xem quyết định mô hình);
  test idempotency đồng thời phải chứng minh chỉ 1 lần thực thi.
- **Rủi ro race trong test:** test đồng thời nhiều yêu cầu xuất chạy trên
  một process Node + SQLite đồng bộ — các yêu cầu được xếp hàng ở event
  loop nên "đồng thời" ở đây là đồng thời ở mức HTTP, không phải đa
  process; test chứng minh bất biến (tổng xuất <= available, tồn không âm)
  chứ không chứng minh được khả năng chống race đa process (ngoài phạm vi,
  ghi rõ trong DECISIONS.md).
- **Rủi ro phạm vi kho của vai warehouse:** `users.warehouse_id` là trường
  chuẩn bị từ GOAL-002 (D13) — GOAL-004 là lần đầu nó có ý nghĩa thật; dễ
  quên kiểm tra ở một endpoint (nhất là `transfer` có HAI kho và
  `low-stock`/`movements` có lọc theo kho). Test RBAC phải có case
  warehouse chỉ xem/thao tác đúng kho được gán ở mọi endpoint kho.
- **Rủi ro `reserved` kẹt:** giữ hàng rồi không giải phóng (không có đơn
  để commit) sẽ làm `available` thấp mãi — trong goal này là hành vi đúng
  (giữ là giữ); GOAL-005 sẽ có luồng giải phóng khi hủy đơn. Ghi rõ trong
  docs để không ai "sửa" hành vi này thành tự giải phóng.
