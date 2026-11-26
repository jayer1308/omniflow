# OmniFlow — Decisions (ADR nhẹ, ghi theo thời gian)

Quy ước: mỗi quyết định có số D, ngày, nội dung, lý do, và điều gì làm nó đổi.

## D1 — Monorepo một repo, một tiến trình (26/11/2026)

- Quyết định: toàn bộ OmniFlow trong MỘT repo public `jayer1308/omniflow`,
  một tiến trình Node duy nhất (`npm start`), không tách service lúc đầu.
- Lý do: đơn giản để phát triển/vận hành ban đầu; ranh giới module rõ (routes →
  services/domain → store) để sau này tách được khi cần.
- Đổi khi: một module cần scale/deploy độc lập, hoặc team lớn hơn 3 người làm song song.

## D2 — TypeScript + Node 24 + Express + SQLite (node:sqlite) (26/11/2026)

- Quyết định: TypeScript, Node 24, Express, SQLite qua `node:sqlite` có sẵn trong
  Node 24 (không cần native build như better-sqlite3), server-rendered EJS +
  JS thuần + CSS mobile-first tiếng Việt, Vitest (+ supertest).
- Lý do: stack đơn giản, ít tầng build, chạy được ngay bằng `npm start`; dữ liệu
  một file `data/omniflow.db` nên sao lưu = copy file; catalog APOS có sẵn stack
  typescript với vitest đã kiểm chứng.
- Trade-off: SQLite khóa ghi toàn DB — đủ cho local + demo + kiểm tra APOS, nhưng
  không phải lựa chọn cho production nhiều ghi đồng thời. Đường lên: thay lớp
  store bằng Postgres (giữ nguyên interface), xem D3.
- Đổi khi: cần nhiều writer đồng thời thật, hoặc deploy VPS production.

## D3 — Ranh giới store: interface, không SQL rải khắp nơi (26/11/2026)

- Quyết định: mọi truy vấn SQL nằm trong lớp `src/store/`; services/domain chỉ
  gọi hàm store, không tự viết SQL. Migration có version, chạy tuần tự.
- Lý do: để thay SQLite bằng Postgres sau này chỉ sửa một lớp; test được bằng
  DB giả lập/in-memory.
- Đổi khi: không — đây là ranh giới kiến trúc dài hạn.

## D4 — Multi-tenant: org_id trên mọi bảng nghiệp vụ (26/11/2026)

- Quyết định: mọi bảng nghiệp vụ có `org_id`; mọi query qua middleware scope
  theo org/branch của user đang đăng nhập; test truy cập ngoài org/phạm vi là
  acceptance bắt buộc (GOAL-002 trở đi).
- Lý do: yêu cầu cách ly dữ liệu giữa các doanh nghiệp là cốt lõi; làm sai ở
  nền thì sửa sau rất đắt.
- Đổi khi: không — nguyên tắc bảo mật dài hạn.

## D5 — Adapter cho payment/shipping/email, bản fake chạy local (26/11/2026)

- Quyết định: thanh toán, vận chuyển, email là interface adapter
  (`src/adapters/*`) với bản fake xác định (deterministic) chạy local.
  Không kết nối cổng thật, không tiền thật, không dịch vụ trả phí.
- Lý do: yêu cầu sản phẩm nói rõ dùng bộ giả lập; adapter thật gắn sau chỉ
  bằng cách thêm implementation mới, không sửa domain.
- Đổi khi: user cấp tài khoản/sandbox thật cho một cổng cụ thể (Goal riêng).

## D6 — Idempotency: key theo (loại yêu cầu + id bên ngoài) (26/11/2026)

- Quyết định: mọi thao tác có thể gửi lại (tạo đơn, thanh toán, webhook, trừ kho)
  đều có idempotency key lưu trong DB; gửi lại cùng key trả kết quả cũ, không
  thực thi lại. Ledger kho là append-only.
- Lý do: yêu cầu chống xử lý lặp là rủi ro đúng đắn lớn nhất của hệ thống
  (trừ kho 2 lần, thu tiền 2 lần); làm ở nền từ GOAL-001 (bảng + helper),
  dùng dần ở các Goal sau.
- Đổi khi: không — nguyên tắc dài hạn.

## D7 — Không dùng dữ liệu thật, không chi phí phát sinh (26/11/2026)

- Quyết định: toàn bộ dữ liệu là giả lập (seed script); bí mật qua biến môi
  trường, không commit credential; không mua dịch vụ, không kết nối tài khoản thật.
- Lý do: user yêu cầu rõ; đây cũng là ranh giới an toàn của dự án.
- Đổi khi: user cấp ngân sách/quyền bằng văn bản cho một dịch vụ cụ thể.

## D8 — CI workflow HOÃN (26/11/2026)

- Quyết định: repo KHÔNG có `.github/workflows/` lúc đầu. CI là follow-up.
- Lý do: gh token jayer1308 thiếu scope `workflow` — GitHub từ chối mọi push
  chứa file workflow (đã gặp ở DRAK). Chờ user cấp scope rồi thêm CI sau.
- Đổi khi: user cấp scope `workflow` cho token (lúc đó thêm `ci.yml`: npm ci +
  check.sh + demo.sh).

## D9 — Local-only, không có VPS (26/11/2026)

- Quyết định: dự án chỉ làm local. Không có VPS trong phạm vi, không deploy production.
- Lý do: user xác nhận 26/11 21:49 — thông tin VPS trước đó là sai và không cần thiết.
  Không hỏi thêm về VPS, không ghi pending VPS.
- Đổi khi: không — ngoài phạm vi dự án.

## D10 — Múi giờ + tiền tệ (26/11/2026)

- Quyết định: lưu thời gian UTC trong DB, hiển thị Asia/Ho_Chi_Minh; tiền lưu
  bằng số nguyên (đồng, không dùng float).
- Lý do: tránh lỗi làm tròn tiền và lệch múi giờ trong báo cáo/đối soát
  (GOAL-010 sẽ định nghĩa rõ).
- Đổi khi: khi có doanh nghiệp ở múi giờ khác (thêm timezone theo org).

## D11 — L0 tsc chỉ kiểm tra `src/`, `node:sqlite` nạp qua require (26/11/2026)

- Quyết định: `tsconfig.json` include chỉ `src/**/*.ts`; test chạy qua
  Vitest/esbuild nên không được typecheck. `src/db.ts` nạp `node:sqlite`
  bằng `require` runtime (kèm `import type` để lấy kiểu), vì Vitest 2
  (Vite 5) chưa nhận `node:sqlite` là builtin và import tĩnh làm rớt lúc
  load test.
- Lý do: acceptance test đã khóa có một cast kiểu không qua được tsc strict;
  sửa test để vừa typecheck sẽ vi phạm khóa test. Giữ test nguyên, thu hẹp
  phạm vi L0 thay vì làm yếu test.
- Đổi khi: nâng Vitest lên bản nhận `node:sqlite`, hoặc sửa test qua
  `tests revise` rồi mở rộng include trở lại `tests/`.

## D12 — Go symlink node_modules trước khi `npm ci` trong check/demo (26/11/2026)

- Quyết định: `scripts/check.sh` và `scripts/demo.sh` kiểm tra `[ -L node_modules ]`
  thì `rm node_modules` (chỉ gỡ link) trước khi chạy `npm ci`.
- Lý do: gate APOS link `node_modules` của main checkout vào worktree bằng
  symlink; `npm ci` chạy qua symlink xóa sạch thư mục đích ở main checkout
  (đã tái hiện trực tiếp: main `node_modules` 177 mục → 0 mục), khiến các
  layer chạy sau đó fail "Cannot find package" dù check tự PASS. Đã file
  Kaiser1308/APOS#78.
- Đổi khi: APOS sửa `prepareDependencies` (copy thay vì link, hoặc bảo vệ link).

## D13 — Mô hình phạm vi: branch_id nullable + warehouse_id chuẩn bị (26/11/2026)

- Quyết định: phạm vi user = `users.branch_id` nullable + `users.warehouse_id`
  nullable, KHÔNG thêm bảng `user_scopes`. `branch_id NULL` = toàn bộ chi
  nhánh trong org; có giá trị = đúng 1 chi nhánh đó. `warehouse_id` chỉ là
  trường chuẩn bị (INTEGER NULL, không FK — bảng `warehouses` là GOAL-004),
  không kiểm tra tồn tại kho thật, không có nghiệp vụ kho trong GOAL-002.
- Lý do: phương án đơn giản nhất — không thêm bảng, không thêm join; helper
  `can()` kiểm tra phạm vi bằng một phép so sánh. Giới hạn: 1 user không được
  cấp 2 chi nhánh trở lên trong GOAL-002; phạm vi kho chỉ kiểm chứng ở mức
  helper `can()`, chưa có endpoint nghiệp vụ kho để test qua HTTP.
- Đổi khi: cần đa chi nhánh cho 1 user (Goal riêng thêm bảng `user_scopes`),
  hoặc GOAL-004 tạo bảng `warehouses` (lúc đó gắn FK + kiểm tra tồn tại cho
  `warehouse_id`).

## D14 — Email duy nhất toàn hệ thống, status 3 giá trị, remap staff → sales (26/11/2026)

- Quyết định: giữ `UNIQUE` trên `users.email` toàn hệ thống (không đổi thành
  duy nhất trong org); `users.status` có 3 giá trị `('active','locked','revoked')`,
  mặc định `'active'` — khóa là tạm thời (mở lại được), thu hồi là cuối cùng
  (không có API mở lại, muốn vào lại phải mời mới), không DELETE row khi thu
  hồi để giữ lịch sử `audit_log`; migration 007 remap mọi row `staff` cũ
  thành `sales`, seed đổi user nhân viên thành vai `sales` (giữ email
  `staff@example.local` và 2 user để test khóa vẫn xanh).
- Lý do: email duy nhất toàn hệ thống khớp login bằng email hiện tại, tránh
  một email thuộc 2 org gây nhầm lẫn khi đăng nhập; trạng thái thứ ba là cần
  thiết vì khóa và thu hồi khác nhau về tính cuối cùng; giữ row khi thu hồi
  vì `audit_log.user_id` FK tới `users`, xóa row sẽ vỡ FK.
- Đổi khi: không — nguyên tắc mô hình user của GOAL-002.

## D15 — Mô hình sản phẩm/biến thể/SKU/barcode + giá fallback + CSV atomic (26/11/2026)

- Quyết định: sản phẩm là dữ liệu **cấp org** (`products` có `org_id`,
  KHÔNG có `branch_id`); phạm vi chi nhánh chỉ gate **giá riêng theo chi
  nhánh**. Biến thể thuộc sản phẩm cha, SKU duy nhất trong org
  (`UNIQUE(org_id, sku)`), mã sản phẩm duy nhất trong org
  (`UNIQUE(org_id, code)`), barcode optional và duy nhất trong org nếu có
  (`UNIQUE(org_id, barcode)` — SQLite cho nhiều NULL, đúng ý). Trùng
  SKU/mã/barcode → 409, không ghi đè lặng lẽ. Không có endpoint DELETE sản
  phẩm/biến thể (chỉ ngừng kinh doanh, giữ lịch sử cho GOAL-004/005).
- Giá lưu số nguyên đồng (D10). Kênh bán cho phép chốt 3 kênh:
  `counter`/`web`/`api`; kênh lạ → 400. Fallback giá 8 bước theo
  `docs/PRICING.md` (biến thể kênh+chi nhánh → biến thể kênh → biến thể chi
  nhánh → sản phẩm kênh+chi nhánh → sản phẩm kênh → sản phẩm chi nhánh →
  `price_override` → giá chuẩn), kèm trường `source`. Đổi giá bắt buộc có
  `reason`; giá mới trùng giá hiện tại → 400 để tránh log rác. Lịch sử giá
  append-only, không API sửa/xóa.
- `UNIQUE(org_id, product_id, variant_id, channel, branch_id)` trên
  `product_prices` KHÔNG chặn trùng khi có NULL (SQLite coi NULL khác nhau)
  nên service kiểm tra trùng bằng SELECT trong cùng transaction; đặt lại
  cùng tổ hợp thì ghi đè mức cũ + ghi lịch sử, không tạo dòng trùng.
- CSV import là toàn bộ hoặc không (atomic): validate hết mọi dòng trước,
  báo lỗi từng dòng (số dòng + lý do, header là dòng 1), một dòng lỗi → 422
  và 0 dòng được ghi. Giới hạn 1000 dòng/file. Dùng thư viện `csv-parse` /
  `csv-stringify` (xử lý BOM, dấu phẩy trong tên, dòng trống) + `multer`
  cho multipart. Danh mục trong CSV là tên: chưa có thì import tự tạo danh
  mục đó trong org.
- Lý do: các quyết định này đều đã ghi trong brief GOAL-003; chốt lại ở đây
  để GOAL-004/005 dùng chung (giá tại thời điểm đặt đơn, tồn kho theo biến
  thể) không phải đoán lại.
- Đổi khi: thêm kênh bán mới, hoặc cần giá theo thời gian/khuyến mãi
  (GOAL-009 — giá riêng không phải khuyến mãi).

## D16 — CSV chỉ nhập sản phẩm gốc; ảnh chỉ metadata, chưa upload thật (26/11/2026)

- Quyết định: CSV import chỉ nhập **sản phẩm gốc** (một dòng = một sản phẩm,
  có giá chuẩn); biến thể chỉ tạo qua API, không nhập qua CSV. Cột `barcode`
  trong CSV được chấp nhận nhưng **không tạo biến thể** nên giá trị không
  được lưu. Ảnh sản phẩm chỉ lưu metadata (`url`/`path` + `alt_text` + thứ
  tự hiển thị) ở bảng `product_images`; KHÔNG có endpoint upload file thật,
  KHÔNG lưu file nhị phân, KHÔNG resize/CDN.
- Lý do: giữ phạm vi GOAL-003 gọn (import biến thể cần quy tắc SKU/barcode
  riêng và xử lý lỗi phức tạp hơn); upload thật cần quyết định lưu trữ riêng.
- Đổi khi: Goal riêng cho import biến thể qua CSV, hoặc Goal riêng cho
  upload ảnh thật.

## D17 — Mô hình kho: tồn theo biến thể, available tính được, không tồn âm (26/11/2026)

- Quyết định (GOAL-004, migration 009): kho là dữ liệu **cấp org**
  (`warehouses` có `org_id`, `branch_id` NULL optional chỉ để hiển thị,
  `status` `active`/`inactive`); tồn theo **biến thể**
  (`stock_levels`: `UNIQUE(org_id, warehouse_id, variant_id)`,
  `CHECK (on_hand >= 0)`, `CHECK (reserved >= 0)`,
  `CHECK (reserved <= on_hand)`); `available = on_hand - reserved` là số
  tính được, **không** lưu cột riêng. Lịch sử biến động append-only
  (`stock_movements`: `type` in/out/adjust/count/transfer_in/transfer_out/
  reserve/release, `qty_change` + `reserved_change`, `on_hand_after`/
  `reserved_after`, `reason` bắt buộc, `reference` tự do; chỉ INSERT,
  không có API sửa/xóa, không có endpoint DELETE kho).
- Chính sách tồn âm: **không cho xuất quá tồn có thể bán** — xuất, chuyển
  kho (kho nguồn), giữ hàng đều yêu cầu `qty <= available`, vi phạm → 400
  `insufficient_stock`, không ghi movement. Điều chỉnh/kiểm kê không được
  làm `on_hand < reserved` (→ 400). Xuất kho **không** trừ `reserved`:
  hàng đã giữ chỉ được xuất qua luồng đơn ở GOAL-005; trong GOAL-004, xuất
  kho chỉ trừ `on_hand` và vẫn phải thỏa `qty <= available`.
- `reserve`/`release` là API độc lập cho luồng đơn sau này: `reserve` tăng
  `reserved` (không đổi `on_hand`), `release` giảm `reserved`. Giữ hàng rồi
  không giải phóng thì `available` thấp mãi — đó là hành vi đúng trong goal
  này (GOAL-005 mới có luồng giải phóng khi hủy đơn); không "sửa" thành tự
  giải phóng.
- Ngưỡng tồn thấp = `products.min_stock` (D15, cấp sản phẩm), đánh giá theo
  từng cặp (biến thể, kho): `available < min_stock` thì cặp đó tồn thấp.
  Không thêm ngưỡng riêng cấp kho trong goal này.
- Idempotency cho thao tác tồn: key đặt tên miền `stock:<loại>:<key>`,
  kiểm tra key + thực thi + ghi key nằm trong **cùng một transaction
  `BEGIN IMMEDIATE`** (`withStockIdempotency` ở `src/stock.ts`) — không dùng
  `withIdempotency` của GOAL-001 một cách ngây thơ vì nó kiểm tra key ngoài
  transaction nên hai yêu cầu cùng key chạy đồng thời có thể cùng lọt qua.
  Gửi lại trả đúng response cũ kèm `replayed: true`, không thực thi lại.
- Chống race: mọi biến động chạy trong `BEGIN IMMEDIATE` + bất biến ép bằng
  `CHECK` ở schema. App là **một tiến trình duy nhất** (D1) nên bảo vệ race
  chỉ có ý nghĩa trong một process; đa process là ngoài phạm vi — không
  claim chống race đa process. Test đồng thời chứng minh bất biến (tổng xuất
  <= available, tồn không âm), không chứng minh được khả năng đa process.
- Biến thể của sản phẩm đã ngừng kinh doanh vẫn nhập/xuất được (hàng vật lý
  vẫn còn). Sản phẩm chưa có biến thể thì không nhập kho được (→ 400).
- Lý do: các quyết định này đều đã ghi trong brief GOAL-004; chốt lại ở đây
  để GOAL-005 (đơn hàng gọi reserve/release) dùng chung không phải đoán lại.
- Đổi khi: cần chế độ cho phép tồn âm (Goal riêng đổi chính sách), ngưỡng
  tồn thấp riêng theo kho, hoặc đa process thật (thay store, xem D2/D3).

## D18 — Kiểm tra `users.warehouse_id` tồn tại ở tầng service (26/11/2026)

- Quyết định (GOAL-004): khi gán `warehouse_id` qua
  `PATCH /api/users/:id/scope`, server kiểm tra ở **tầng service trong
  handler** (không rebuild bảng `users` để gắn FK như migration 007 đã
  làm): kho không tồn tại → 400, kho ngoài org → 403; gán `null` (bỏ gán)
  luôn hợp lệ.
- Lý do: yêu cầu của brief là **hành vi** (kho phải tồn tại trong cùng org),
  không phải cơ chế. Rebuild bảng `users` lần nữa tốn kém và rủi ro (phải
  tắt FK, copy toàn bộ user, remap) trong khi kho **không bao giờ bị xóa**
  (không có endpoint DELETE kho, D17) nên không có nguy cơ rò rỉ tham chiếu
  treo sau khi gán: một khi đã gán hợp lệ, kho đó tồn tại mãi. Kiểm tra ở
  tầng service là đủ và giữ migration 009 gọn (chỉ thêm 3 bảng kho).
- Đổi khi: kho có thể bị xóa (lúc đó phải gắn FK hoặc kiểm tra khi đọc), hoặc
  cần ràng buộc toàn vẹn ở tầng DB cho `warehouse_id`.

## D19 — Mô hình đơn hàng: state machine, snapshot giá, giữ/giải phóng/commit release+out (27/11/2026)

- Quyết định (GOAL-005, migration 010): đơn là dữ liệu **cấp org**
  (`orders` có `org_id`, `branch_id` NOT NULL, `warehouse_id` NOT NULL —
  client chọn kho lúc tạo đơn, không có kho mặc định ngầm; `code`
  `UNIQUE(org_id, code)` dạng `DH-YYYYMMDD-NNNN`, số thứ tự trong ngày
  theo từng org tính trong cùng transaction tạo đơn; `channel` CHECK
  `counter`/`web`/`api`; `customer_name` chuỗi tự do, chưa có bảng khách
  hàng; `status` CHECK state machine; `total` nguyên đồng, server tự
  tính từ các dòng, không tin client). `order_items` snapshot giá tại
  thời điểm đặt (`sku`/`name`/`unit_price`/`price_source`, `qty > 0`,
  `line_total = unit_price * qty`, `UNIQUE(order_id, variant_id)` —
  trùng biến thể trong cùng đơn → 400, không gộp lặng lẽ).
  `order_events` append-only (`from_status` NULL khi tạo đơn), chỉ
  INSERT, không có API sửa/xóa; `GET /api/orders/:id` trả `events` theo
  thứ tự thời gian tăng dần (cũ nhất trước). Không có endpoint DELETE đơn.
- State machine duy nhất: `draft → confirmed`, `confirmed → processing`,
  `processing → completed`, `draft`/`confirmed`/`processing → cancelled`.
  Mọi chuyển khác → 400, không đổi gì, không ghi event, không động kho.
  Tạo đơn với 0 dòng → 400; biến thể của sản phẩm đã ngừng kinh doanh
  → 400; kho `inactive` chặn cả tạo đơn lẫn xác nhận → 400.
- Xác nhận = giữ hàng nguyên tử mọi dòng trong CÙNG MỘT transaction
  `BEGIN IMMEDIATE` (`applyMovement` loại `reserve` cho từng dòng,
  `reference` = mã đơn); dòng nào `qty > available` → 400
  `insufficient_stock`, rollback toàn bộ, đơn ở lại `draft`, không ghi
  movement nào. Hủy từ `confirmed`/`processing` giải phóng đúng số đã
  giữ (`release`, cùng transaction với đổi trạng thái); hủy từ `draft`
  chỉ đổi trạng thái.
- Hoàn tất = **release + out trong CÙNG MỘT transaction** (commit giữ
  hàng → xuất): `applyMovement` loại `out` yêu cầu `qty <= available`
  và KHÔNG trừ `reserved` (D17), nên xuất trực tiếp khi đơn đang giữ
  hàng sẽ để `reserved` treo mãi và `available` sai sau đó. Mỗi dòng:
  (1) `release` đúng số đã giữ, rồi (2) `out` đúng số đó; cả hai
  movement cùng `reference` = mã đơn. Bước nào lỗi thì rollback toàn bộ
  — không có trạng thái "đã giải phóng nhưng chưa xuất". KHÔNG thêm loại
  movement mới `fulfill`.
- Idempotency cho tạo đơn + mọi chuyển trạng thái qua
  `withStockIdempotency` (kiểm tra key + thực thi + ghi key trong CÙNG
  MỘT transaction `BEGIN IMMEDIATE`), tên miền key
  `order:create:<key>` / `order:<hành động>:<key>`; gửi lại trả đúng
  response đã lưu kèm `replayed: true`, NGAY CẢ KHI đơn đã chuyển tiếp
  sang trạng thái khác sau đó. Không dùng `withIdempotency` của GOAL-001
  cho đơn (kiểm tra key ngoài transaction, có khe race). Thiếu key vẫn
  thực thi (không bắt buộc) nhưng không có bảo vệ gửi lại.
- Chống bán quá tồn: mọi giữ/xuất qua `applyMovement` trong
  `BEGIN IMMEDIATE` + `CHECK` ở DB (D17). App là **một tiến trình duy
  nhất** (D1) nên bảo vệ race chỉ có ý nghĩa trong một process; đa
  process ngoài phạm vi — không claim chống race đa process. Test đồng
  thời chứng minh bất biến (tổng giữ <= `available`, tồn không âm,
  `reserved` không vượt `on_hand`), không chứng minh được đa process.
- RBAC đơn: `can()` mở rộng 6 actions (`create-order`, `confirm-order`,
  `process-order`, `complete-order`, `cancel-order`, `view-orders`) theo
  ma trận `docs/RBAC.md` — tạo/xác nhận/hủy: owner/manager/sales (đúng
  chi nhánh); xử lý/hoàn tất: owner/manager/warehouse (đúng kho);
  xem: mọi vai, sales lọc chi nhánh mình, warehouse lọc kho được gán,
  accountant toàn org chỉ xem.
- Audit log: mọi thao tác đơn ghi `audit_log` (`action` tạo/xác
  nhận/xử lý/hoàn tất/hủy, `detail` JSON `target_order_id`/`order_code`/
  `from_status`/`to_status`/`total`); `order_events` là lịch sử trạng
  thái chi tiết, `audit_log` là lớp ghi nhận thao tác nhạy cảm — cả hai
  đều phải có, không thay nhau.
- Lý do: các quyết định này đều đã ghi trong brief GOAL-005; chốt lại ở
  đây để GOAL-006 (thanh toán) và GOAL-007 (giao hàng) dùng tiếp luồng
  đơn mà không phải đoán lại.
- Đổi khi: cần trạng thái thanh toán/giao hàng trên đơn (Goal sau thêm
  trường), đa process thật (thay store), hoặc cho phép bán quá tồn
  (Goal riêng đổi chính sách).

## D20 — Tách hàm resolve giá hiệu dụng dùng chung (27/11/2026)

- Quyết định (GOAL-005): logic resolve giá hiệu dụng theo fallback 8
  bước vốn nằm inline trong route `GET /api/products/:id/price`
  (đọc `product_prices` rồi gọi `effectivePrice()`) được tách thành
  `resolveEffectivePrice()` ở `src/products.ts`; route giá và luồng tạo
  đơn (snapshot giá tại thời điểm đặt) cùng dùng một hàm, không viết lại
  2 lần. Hàm nhận `productId`/`basePrice`/`variantId`/`variantOverride`/
  `channel`/`branchId`, tự đọc `product_prices` và trả `{price, source}`.
- Lý do: giá snapshot của đơn phải khớp đúng giá hiệu dụng GOAL-003
  (phụ thuộc cả kênh lẫn chi nhánh) — hai bản sao của logic tìm giá sẽ
  lệch nhau theo thời gian (ví dụ một bên sửa thứ tự fallback, bên kia
  quên). Tách ra thì route giá và đơn luôn đồng nhất; test snapshot giá
  (đổi giá sau không đổi giá đơn) kiểm chứng cả hai qua cùng một hàm.
- Đổi khi: giá cần thêm nguồn mới ngoài 8 bước (sửa `effectivePrice()` +
  `resolveEffectivePrice()` cùng lúc, một chỗ duy nhất).

## D21 — Adopt R-19 mồ côi của GOAL-004 vào GOAL-005A (27/11/2026)

- Ghi chú (GOAL-005A, goal bookkeeping ngoài 12 goal chính, không quyết
  định kiến trúc mới): yêu cầu R-19 của GOAL-004 (3 luồng giữ hàng tự
  động theo vòng đời đơn) đã được GOAL-005 implement đầy đủ nhưng
  goal-005.json không khai `adopts` chính thức nên APOS báo mồ côi
  (orphan-requirement). GOAL-005A nhận R-19 từ source `brief-004.md`
  (sha256 `a83e40111118d17ac74d1e1049134daca6958f7e46aa5126a7cf8b22f3884579`)
  và kiểm chứng lại bằng 10 test khóa mới
  (`tests/orders-005a-acceptance.test.ts`, proof `stays-green`) trên code
  GOAL-005 đã có.
- Xác nhận 3 luồng đã có từ GOAL-005, không sửa code nghiệp vụ trong goal
  này: xác nhận đơn tự động giữ hàng nguyên tử mọi dòng trong 1
  transaction (`src/orders.ts` `transitionOrderTx` + `src/stock.ts`
  `applyMovement`; thiếu tồn → 400 `insufficient_stock`, không giữ dòng
  nào, đơn ở lại draft); hủy đơn từ confirmed/processing tự động giải
  phóng đúng số đã giữ; hoàn tất đơn = release + out trong CÙNG MỘT
  transaction (không thêm loại movement mới, D19). Tạo đơn vẫn ở draft,
  không giữ hàng.
- Bài học quy trình (GOAL-005A): sau `goal revise`, proposal cũ bị xóa
  nên phải `lead propose` lại + `lead commit` lại trước khi
  `tests submit`; proposal nộp lại phải tăng `version` (không chỉ
  `goalVersion`). `tests submit` chỉ nhận full commit sha. Test L2 chỉ
  được import các module trong `stubPaths` của proposal — test dùng
  `src/auth.ts`/`src/db.ts`/`src/seed.ts` để dựng app thì phải khai cả 3
  vào `stubPaths` (theo mẫu GOAL-005), và commit nộp test phải chứa đúng
  bản `.apos` mới nhất (file `.apos` cũ trong cây commit sẽ bị chặn bởi
  guard protected-file).
- Đổi khi: không áp dụng — goal bookkeeping đã đóng khi inbox sạch.
