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

## D22 — Mô hình payment/refund: trạng thái, hoàn tiền riêng bảng, webhook chống trùng bằng reference UNIQUE, idempotency trong transaction, đối soát tính ở service (27/11/2026)

- Quyết định (GOAL-006): thanh toán là dữ liệu cấp org, gắn với đơn —
  bảng `payments` (`org_id`/`branch_id` NOT NULL — chi nhánh thu tiền lấy
  theo chi nhánh của đơn, không lấy từ body; `order_id` FK tới `orders`;
  `method` `cash`/`bank_transfer`/`gateway`; `amount` nguyên đồng > 0;
  `currency` `VND`; `status` `requested`/`paid`/`failed`/`refunded`/
  `partially_refunded`; `gateway_reference` TEXT UNIQUE khi có giá trị;
  `received_by` FK tới `users`; `received_at`/`created_at`/`updated_at`).
  Không có endpoint DELETE payment (chỉ hoàn tiền bằng bản ghi refund,
  giữ lịch sử).
- Hoàn tiền là bản ghi riêng (`refunds`: `payment_id` FK, `amount` > 0,
  `reason` bắt buộc, `status` `requested`/`completed`/`failed`,
  `created_by`), không sửa payment gốc; adapter fake hoàn luôn thành
  công nên `requested` chuyển ngay sang `completed` trong cùng
  transaction. Tổng hoàn không bao giờ vượt số đã trả: DB CHECK tổng
  tích lũy không làm được bằng CHECK đơn giản nên bắt buộc kiểm tra
  (tổng hoàn hiện tại + amount mới) trong cùng `BEGIN IMMEDIATE` rồi mới
  insert. Hoàn đủ → payment `refunded`, hoàn một phần →
  `partially_refunded`. Hoàn tiền KHÔNG đổi trạng thái đơn GOAL-005
  (trả hàng/nhập lại kho là GOAL-007).
- Lịch sử giao dịch append-only (`payment_events`: `payment_id` FK,
  `event_type` `created`/`paid`/`failed`/`refund_completed`/
  `webhook_duplicate_ignored`/`webhook_ignored`, `actor_id` NULL khi là
  webhook, `detail` JSON; chỉ INSERT, không có API UPDATE/DELETE).
  Payments trả mới nhất trước; events trả cũ nhất trước (như
  `order_events` ở D19).
- Thu tiền mặt/chuyển khoản = ghi nhận trực tiếp, `paid` ngay trong cùng
  transaction, 1 event `paid` + 1 audit log; đơn `draft` vẫn thu được
  (đặt cọc trước khi xác nhận); đơn `cancelled` → 400; trả thừa (tổng
  paid > tổng đơn) được phép ghi nhận nhưng hiện rõ là thừa trong đối
  soát (`outstanding` âm, `payment_status` `overpaid`) — không tự động
  chặn, không giấu số thừa.
- Thu qua cổng = yêu cầu (`requested` + `gateway_reference` từ adapter
  đã sửa, D23) rồi webhook chốt, đúng một lần. Webhook giả lập `POST
  /api/payments/webhook` KHÔNG yêu cầu session đăng nhập nhưng phải kiểm
  tra chữ ký giả lập: header `X-Fake-Signature` = sha256 hex của
  `` `${gateway_reference}:${status}:${amount}:${secret}` `` (secret qua
  biến môi trường `OMNIFLOW_WEBHOOK_SECRET`, không commit secret thật);
  sai/thiếu chữ ký → 401; thiếu secret ở môi trường thì endpoint webhook
  trả 503 (không bao giờ chấp nhận webhook không chữ ký), server vẫn chạy
  các route khác. Reference không tồn tại → 404; `amount` webhook khác
  `amount` payment → 400. `paid` lần 2 → 200 kèm `duplicate: true`, ghi
  event `webhook_duplicate_ignored`, không đổi gì; `failed` sau `paid` →
  200, bỏ qua, ghi event `webhook_ignored`, KHÔNG đổi `paid` thành
  `failed` (tiền đã về thì failed muộn không có hiệu lực); `failed`
  trước rồi `paid` sau → `paid` vẫn chốt bình thường. Mọi webhook đều
  ghi event (kể cả bản trùng) để đối soát thấy được. Chống ghi nhận 2
  lần bằng `UNIQUE(gateway_reference)` + kiểm tra trạng thái trong cùng
  transaction `BEGIN IMMEDIATE`.
- Idempotency cho tạo payment + hoàn tiền qua `withStockIdempotency`
  (GOAL-004) — kiểm tra key + thực thi + ghi key trong CÙNG MỘT
  transaction `BEGIN IMMEDIATE`; tên miền `payment:create:<key>` /
  `payment:refund:<key>`; gửi lại cùng key + cùng loại + cùng org → trả
  đúng response đã lưu kèm `replayed: true`, không tạo mới. KHÔNG dùng
  `withIdempotency` của GOAL-001 (kiểm tra ngoài transaction, có khe
  race — bài học GOAL-004/005). Webhook KHÔNG dùng idempotency key của
  client — chống trùng bằng `gateway_reference` UNIQUE. Thiếu key thì
  vẫn thực thi (không bắt buộc) nhưng không có bảo vệ gửi lại.
- Đối soát đơn–thanh toán tính ở service từ bảng payments/refunds, không
  lưu cột tổng riêng (tránh lệch): `order_total` (tổng đơn GOAL-005),
  `paid_total` (tổng payment `paid`/`partially_refunded`/`refunded` trừ
  tổng refund `completed`), `refunded_total`, `outstanding`
  (`order_total - paid_total`, âm nghĩa là thừa), `payment_status`
  (`unpaid`/`partially_paid`/`paid`/`overpaid`/`refunded` — `refunded`
  khi `paid_total` về 0 sau khi đã từng trả). Đơn `cancelled` vẫn xem
  được lịch sử thanh toán/hoàn của nó.
- RBAC thanh toán: `can()` mở rộng 3 actions (`create-payment`,
  `refund-payment`, `view-payments`) theo ma trận `docs/RBAC.md` — ghi
  nhận thu tiền: owner/manager/accountant toàn org, sales chỉ đơn thuộc
  chi nhánh mình, warehouse 403; hoàn tiền: owner/manager/accountant,
  sales/warehouse 403; xem: owner/manager/accountant toàn org, sales chỉ
  chi nhánh mình, warehouse chỉ đơn có `warehouse_id` trong phạm vi.
  Webhook là ngoại lệ duy nhất, xác thực bằng chữ ký.
- Audit log: mọi thao tác tạo payment, webhook chốt/thất bại, hoàn tiền
  đều ghi `audit_log` (`action` `create-payment`/`webhook-paid`/
  `webhook-failed`/`refund-payment`, `detail` JSON `target_payment_id`/
  `order_id`/`order_code`/`method`/`amount`/`gateway_reference`, KHÔNG
  chứa dữ liệu nhạy cảm, KHÔNG chứa thông tin thẻ); webhook có `user_id`
  NULL + `detail` ghi rõ `webhook` (`source: 'webhook'`).
  `payment_events` là lịch sử giao dịch chi tiết; `audit_log` là lớp ghi
  nhận thao tác nhạy cảm theo chuẩn GOAL-002 — cả hai đều phải có, không
  thay nhau.
- KHÔNG lưu thông tin thẻ: không có field nào chứa số thẻ/CVV trong DB,
  API hay log (test quét chứng minh).
- Bảo vệ race chỉ có ý nghĩa trong một process (D1): app một tiến trình,
  bảo vệ race chỉ có ý nghĩa trong một process; đa process ngoài phạm
  vi. Test đồng thời chứng minh bất biến (tổng đã trả chỉ tính 1 lần,
  tổng hoàn không vượt số đã trả), không chứng minh được đa process.
- Lý do: webhook gửi lặp/trễ/sai thứ tự là hành vi bình thường của cổng
  thật — chỉ chống bằng `UNIQUE(gateway_reference)` + kiểm tra trạng
  thái trong cùng transaction thì mới không tính tiền 2 lần; tổng hoàn
  tích lũy không CHECK được bằng DB CHECK nên phải kiểm tra trong
  transaction; đối soát tính ở service thì không bao giờ lệch với dữ
  liệu gốc.
- Đổi khi: cổng thanh toán thật (goal riêng, ngoài phạm vi vĩnh viễn của
  dự án giả lập), đa process thật (thay store), hoặc cho phép lưu phương
  thức thanh toán của khách (GOAL-008, vẫn không lưu thông tin thẻ).

## D23 — Sửa FakePaymentAdapter: reference duy nhất theo giao dịch + cơ chế giả lập lỗi chỉ dùng trong test (27/11/2026)

- Quyết định (GOAL-006): `FakePaymentAdapter.charge(amount, currency,
  transactionId?)` — có `transactionId` thì digest theo
  `${amount}:${currency}:${transactionId}`, không có thì giữ digest cũ
  `${amount}:${currency}` (bắt buộc: test khóa GOAL-001 gọi
  `charge(50000,'VND')` 2 lần vẫn bằng nhau). Route tạo payment gateway
  gọi charge với mã giao dịch `${orderCode}:${paymentId}` (tạo payment
  trước rồi mới gọi charge để có payment id) nên 2 lần thu cùng số tiền
  cho 2 đơn khác nhau không còn trùng `gateway_reference` — sửa đúng
  điểm rủi ro lớn nhất của brief (digest cũ theo số tiền sẽ làm
  `UNIQUE(gateway_reference)` chặn nhầm lần thu thứ hai). Vẫn
  deterministic (cùng input → cùng output), vẫn `simulated: true`.
- Thêm `refund(paymentReference, amount)` vào adapter, trả
  `FAKE-REF-<hash12>` deterministic theo `${paymentReference}:${amount}`
  (cùng giao dịch + cùng số tiền → cùng reference hoàn).
- Thêm `failNext()` static, một lần: lần `charge()` kế tiếp trả
  `status: 'failed'`, sau đó tự tắt và charge lại `success`. CHỈ dùng
  trong test — route production không bao giờ gọi `failNext()`; ghi rõ
  trong code để không lọt ra production path.
- Lý do: reference phải duy nhất theo giao dịch chứ không theo số tiền,
  nếu không `UNIQUE(gateway_reference)` vừa là lá chắn chống trùng
  webhook vừa thành rào cản chặn nhầm lần thu hợp lệ thứ hai.
- Đổi khi: cổng thanh toán thật (ngoài phạm vi vĩnh viễn), hoặc cần giả
  lập thêm loại lỗi (thêm cờ tương tự, vẫn chỉ dùng trong test).

## D24 — Mô hình giao hàng: state machine riêng, adapter mở rộng mã vận đơn deterministic (27/11/2026)

- Quyết định (GOAL-007): shipment là dữ liệu cấp org gắn với đơn
  (`shipments`: `org_id`/`order_id` NOT NULL FK, `carrier`/`destination`
  NOT NULL, `tracking_code` TEXT NOT NULL UNIQUE, `fee` INTEGER >= 0,
  `eta_days` INTEGER > 0, `status` CHECK `IN ('requested','in_transit',
  'delivered','failed')` mặc định `'requested'`; `shipment_events`
  append-only, chỉ INSERT). State machine riêng, KHÔNG động vào trạng
  thái đơn GOAL-005 (đơn vẫn `completed`): `requested → in_transit →
  delivered`, `requested`/`in_transit → failed` (thất bại là trạng thái
  cuối — muốn giao lại thì tạo shipment mới). Chuyển sai thứ tự → 400,
  không đổi gì, không ghi event. Gửi lại cùng trạng thái hiện tại → 200
  no-op ở mức trạng thái: trả shipment hiện tại, KHÔNG tạo event mới,
  KHÔNG ghi audit mới (khác webhook GOAL-006 ghi event cả bản trùng — ở
  đây cập nhật lặp không phải bản trùng từ bên ngoài mà là cập nhật lặp).
  Chỉ đơn `completed` mới được yêu cầu giao (hàng đã xuất kho ở GOAL-005);
  mỗi đơn tối đa 1 shipment chưa cuối (`requested`/`in_transit`) — yêu
  cầu thêm → 400. Không có endpoint DELETE shipment, không API sửa/xóa
  `shipment_events` (gọi → 404).
- `FakeShippingAdapter` mở rộng thêm `trackingRef(orderCode, carrier,
  shipmentId)` trả `FAKE-TRK-<sha256(orderCode:carrier:shipmentId) 12 ký
  tự đầu>`; digest PHẢI có shipment id — nếu chỉ digest theo mã đơn +
  carrier thì 2 lần giao cùng đơn cùng carrier trùng `tracking_code` và
  `UNIQUE` chặn nhầm lần giao hợp lệ sau khi shipment cũ `failed`/
  `delivered`. `quote()` giữ nguyên (phí `15000 + số chặng 500g × 5000`,
  ETA 1 ngày nếu đích Hà Nội, 2 ngày còn lại, `simulated: true`).
  Khối lượng giao mặc định = tổng số lượng mặt hàng trong đơn × 500g
  (sản phẩm chưa có trường cân nặng; không thêm trường cân nặng trong
  goal này). Server insert shipment trước để lấy id rồi mới tính mã vận
  đơn và cập nhật trong cùng transaction — không bao giờ lộ trạng thái
  trung gian ra ngoài.
- Lý do: hãng vận chuyển gửi cập nhật lặp/trễ/sai thứ tự là hành vi bình
  thường — chỉ chống bằng kiểm tra trạng thái hiện tại trong cùng
  transaction `BEGIN IMMEDIATE` + gửi lại cùng trạng thái là no-op không
  ghi event thì mới không ghi nhận sai.
- Đổi khi: đơn vị vận chuyển thật (ngoài phạm vi vĩnh viễn của dự án
  giả lập), hoặc sản phẩm có trường cân nặng thật (thay 500g mặc định).

## D25 — Mô hình trả hàng: vòng đời, nhập lại kho có chọn lọc, hoàn tiền dùng lại đường GOAL-006 (27/11/2026)

- Quyết định (GOAL-007): return là dữ liệu cấp org gắn với đơn
  (`returns`: `org_id`/`order_id` NOT NULL FK, `code` UNIQUE trong org
  dạng `TH-YYYYMMDD-NNNN` — số thứ tự trong ngày theo từng org, tính
  trong cùng transaction tạo yêu cầu, như mã đơn `DH-...` ở D19;
  `reason` NOT NULL; `status` CHECK `IN ('requested','approved',
  'rejected','received','refunded')`; `reviewed_by`/`received_by` FK
  tới `users` NULL cho tới khi tới bước đó; `review_reason` NULL;
  `return_items`: `UNIQUE(return_id, variant_id)`, `qty > 0`,
  `condition` CHECK `IN ('resalable','damaged')`, `unit_price >= 0`
  snapshot từ `order_items`; `return_events` append-only, chỉ INSERT).
  Vòng đời: `requested → approved → received → refunded`;
  `requested → rejected` (trạng thái cuối, bắt buộc có `review_reason`).
  Mọi chuyển khác → 400, không đổi gì, không ghi event. Chỉ đơn
  `completed` mới được yêu cầu trả; biến thể phải thuộc đơn; tổng trả
  tích lũy mỗi biến thể (cộng MỌI yêu cầu trả chưa bị từ chối của đơn đó,
  kể cả yêu cầu đang chờ duyệt — không chỉ yêu cầu đã nhận) không được
  vượt số lượng đã đặt. Trả hàng KHÔNG đổi trạng thái đơn.
- Nhận hàng (`approved → received`) + nhập lại kho trong CÙNG MỘT
  transaction `BEGIN IMMEDIATE`: mặt hàng `resalable` nhập lại kho của
  đơn bằng `applyMovement` loại `in` (`reference` = mã trả `TH-...`,
  `reason` ghi rõ nhập lại từ trả hàng), 1 movement mỗi dòng bán lại
  được; mặt hàng `damaged` KHÔNG nhập kho, KHÔNG ghi movement — chỉ ghi
  nhận trong `return_items` + event detail (số lượng hỏng từng biến thể).
  Bước nào lỗi thì rollback toàn bộ — không có trạng thái "đã nhận nhưng
  chưa nhập kho". Không thêm loại movement mới (dùng lại `in` của D17).
- Hoàn tiền trả hàng (`received → refunded`) dùng LẠI đúng đường GOAL-006
  (`createRefundTx` ở `src/app.ts` + bảng `refunds`, không viết lại logic
  hoàn): số tiền hoàn = tổng `unit_price × qty` trên mọi mặt hàng của yêu
  cầu trả (CẢ bán lại được LẪN hỏng — khách trả hàng thì được hoàn tiền
  bất kể tình trạng hàng, chỉ khác ở chỗ không nhập kho), tính từ snapshot
  `order_items`, không tin client; hoàn vào các payment đã `paid` của đơn
  theo thứ tự cũ nhất trước cho tới đủ số tiền, mỗi lần hoàn là một bản
  ghi `refunds` riêng với `reason` là mã trả `TH-...`. Số tiền hoàn vượt
  số còn hoàn được của đơn (đơn chưa trả đủ tiền, hoặc đã hoàn trước đó)
  → 400, không tạo refund nào, yêu cầu trả ở lại `received` (kiểm tra
  tổng hoàn được TRƯỚC khi gọi `createRefundTx` lần nào để không tạo
  refund dở dang). Hoàn tiền cho trả hàng KHÔNG đổi trạng thái đơn.
- Đối soát sau trả dùng lại `computePaymentSummary` (`src/payments.ts`,
  D22): refund của trả hàng tự vào đối soát vì nằm trong bảng `refunds`.
  Trạng thái đối soát thêm `partially_refunded` (GOAL-007): khi đơn có
  yêu cầu trả đã hoàn tiền (`returns.status = 'refunded'`) mà vẫn còn
  tiền ròng đã trả (`paid_total > 0`) thì `payment_status` là
  `partially_refunded` — phân biệt với hoàn tiền trực tiếp GOAL-006,
  vốn giữ `partially_paid` theo test khóa GOAL-006 (đơn draft, không có
  return). Đây là sửa tối thiểu ở code cũ để hai bộ test khóa (GOAL-006
  đòi `partially_paid`, GOAL-007 đòi `partially_refunded` cho cùng trạng
  thái số học) cùng xanh; xem ghi chú trong `computePaymentSummary`.
- Bảo vệ race chỉ có ý nghĩa trong một process (D1): app một tiến trình,
  bảo vệ race chỉ có ý nghĩa trong một process; đa process ngoài phạm vi.
  Test đồng thời chứng minh bất biến (chỉ 1 shipment/1 lần nhập kho/1 lần
  hoàn), không chứng minh được đa process.
- Lý do: đường hoàn GOAL-006 đã khóa tổng hoàn không vượt số đã trả —
  viết lại sẽ lệch; tổng trả tích lũy phải tính cả yêu cầu chờ duyệt nếu
  không 2 yêu cầu chờ duyệt cùng vượt số đặt sẽ cùng lọt; hàng hỏng vẫn
  hoàn tiền vì khách đã trả hàng, chỉ không nhập kho.
- Đổi khi: cổng thanh toán thật (ngoài phạm vi vĩnh viễn), hoặc cho phép
  trả một phần tiền theo chính sách khác (ví dụ trừ phí) — khi đó số tiền
  hoàn không còn bằng tổng snapshot nữa.

## D26 — Mô hình khách hàng + CRM (GOAL-008, 27/11/2026)

- Quyết định (GOAL-008): khách hàng là dữ liệu cấp org, có chi nhánh
  chính `customers.branch_id` NULL = chưa gán (khách mua ở nhiều chi
  nhánh vẫn chỉ có MỘT chi nhánh chính; lịch sử mua tính theo org, không
  theo chi nhánh). `customers`: `org_id` NOT NULL FK, `name` NOT NULL,
  `phone`/`email`/`address` NULL, `status` CHECK `IN ('active','merged')`
  mặc định `'active'`, `merged_into_id` NULL FK tới `customers`,
  `UNIQUE(org_id, phone)` (SQLite cho nhiều NULL — trùng điện thoại chỉ
  tính với khách `active`, trùng → 409). Migration 013 tạo thêm
  `customer_points` (ledger append-only: `type` CHECK `IN
  ('earn','redeem')`, `points` CHECK `> 0`, `reason` NOT NULL,
  `order_id` NULL FK, `created_by` NOT NULL FK) và `customer_notes`
  (append-only: `author_id` NOT NULL FK, `content` NOT NULL), cộng
  `ALTER TABLE orders ADD customer_id NULL FK + points_discount INTEGER
  NOT NULL DEFAULT 0 CHECK >= 0` (đơn cũ giữ NULL/0, hành vi không đổi).
  `POST /api/orders` nhận thêm `customer_id` optional (không tồn tại →
  404, ngoài org → 403, khách `merged` → 400; không gửi thì như trước).
- Tích điểm: chỉ đơn `completed` thuộc khách, 1 điểm / 10.000đ trên
  (`order_total` − tổng hoàn `completed` của đơn tại thời điểm tích),
  làm tròn xuống; tổng sau hoàn < 10.000đ → 400, không ghi ledger 0
  điểm; mỗi đơn tích 1 lần. Điểm KHÔNG hết hạn (không có cột
  `expires_at`, không có job hết hạn), KHÔNG bị thu hồi khi đơn bị hoàn
  tiền sau đó (không có clawback trong goal này). Số dư = tổng `earn` −
  tổng `redeem` tính ở service, KHÔNG lưu cột số dư riêng.
- Đổi điểm: chỉ đơn `draft` của chính khách, 1 điểm = 100đ, discount =
  min(`points` × 100, `order_total`); số điểm trừ vẫn là số điểm đã gửi
  dù tiền trừ bị cắt ở tổng đơn; một đơn chỉ đổi 1 lần; điểm không bao
  giờ âm. Ghi ledger `redeem` + cập nhật `orders.points_discount` trong
  CÙNG MỘT transaction `BEGIN IMMEDIATE`. Đối soát dùng lại
  `computePaymentSummary` (D22): `outstanding` = `order_total` −
  `points_discount` − `paid_total`; `payment_status` GIỮ NGUYÊN logic
  D22 trên (`paid_total`, `refunded_total`, `order_total`) — đơn đổi
  điểm hết tổng mà chưa trả đồng nào vẫn `unpaid`. Tích điểm tính trên
  `order_total`, KHÔNG trừ `points_discount` của chính đơn đó.
- Phân khúc tính ở service mỗi lần đọc, KHÔNG lưu cột `segment`:
  VIP khi `total_spent` ≥ 5.000.000đ HOẶC `order_count` ≥ 10 đơn
  completed; ngủ quên khi có ≥ 1 đơn completed và lần mua cuối > 90
  ngày; thường xuyên khi `order_count` ≥ 3; còn lại mới. Thứ tự ưu tiên
  VIP → ngủ quên → thường xuyên → mới (VIP 100 ngày không mua vẫn VIP).
  `total_spent` = tổng `total` các đơn `completed`, CHƯA trừ hoàn tiền;
  `order_count` = số đơn `completed`; `last_order_at` = `created_at`
  đơn `completed` mới nhất (NULL khi chưa có).
- Hợp nhất có xác nhận: `POST /api/customers/:id/merge` bắt buộc
  `confirm: true` (thiếu/sai → 400, không làm gì); `:id` là hồ sơ GIỮ
  LẠI. Trong CÙNG MỘT transaction: mọi đơn + ledger + ghi chú của nguồn
  chuyển sang hồ sơ giữ; nguồn chuyển `status` `'merged'`,
  `merged_into_id` = id hồ sơ giữ, `phone`/`email` về NULL; row nguồn
  GIỮ LẠI (không xóa) để audit còn trỏ được. Khách `merged` không tạo
  đơn/tích/đổi điểm/ghi chú/hợp nhất tiếp (→ 400, trừ xem/export).
- Export + xóa + PII: `GET /api/customers/:id/export` trả `{customer,
  orders (kèm items), points: {balance, ledger}, notes}` + 1 audit log
  (khách `merged` vẫn export được, orders/points/notes rỗng kèm
  `merged_into_id`). `audit_log.detail` của MỌI thao tác khách KHÔNG
  chứa `phone`/`email`/`address` (chỉ id + số liệu); log server cũng
  không in phone/email. Xóa cứng (`DELETE /api/customers/:id`) chỉ khi
  khách CHƯA CÓ đơn nào (có đơn → 400; đã `merged` → 400), xóa kèm ghi
  chú + ledger trong cùng transaction + 1 audit log; không có cột
  `deleted_at`, không có thùng rác.
- RBAC: `can()` thêm 9 actions `create-customer`, `update-customer`,
  `view-customers`, `earn-points`, `redeem-points`, `add-note`,
  `merge-customers`, `export-customer`, `delete-customer` (xóa là action
  RIÊNG chỉ `owner`/`manager`, không dùng chung `update-customer`).
  Sales chỉ thấy/thao tác khách thuộc chi nhánh mình; khách chưa gán chi
  nhánh (`branch_id` NULL) thì sales không thấy (403 khi gọi trực tiếp,
  bị lọc khỏi danh sách); `owner`/`manager`/`accountant` thấy mọi khách
  (xem ma trận đầy đủ ở `docs/RBAC.md`).
- Idempotency: `withStockIdempotency` (GOAL-004) trong cùng transaction
  `BEGIN IMMEDIATE`, tên miền `customer:points-earn:<key>` /
  `customer:points-redeem:<key>` / `customer:merge:<key>` (thêm
  `customer:create:<key>` cho tạo khách và `customer:note-create:<key>`
  cho ghi chú); gửi lại cùng key trả đúng response cũ kèm `replayed:
  true`, không cộng/trừ điểm hay chuyển hồ sơ lần 2. App một tiến trình
  (D1) nên bảo vệ race chỉ có ý nghĩa trong một process; đa process
  ngoài phạm vi.
- Lý do: số dư/segment/tóm tắt tính ở service để không lệch khi đơn mới
  hoàn tất (như đối soát D22); ledger/ghi chú append-only để lịch sử
  không bị sửa; hợp nhất giữ row nguồn để audit còn trỏ được và để
  điện thoại được giải phóng (phone về NULL) mà lịch sử không mất.
- Đổi khi: cho điểm hết hạn (thêm cột + job), thu hồi điểm khi hoàn tiền
  sau (clawback), hoặc khuyến mãi GOAL-009 (mã giảm giá — điểm đổi ở đây
  là điểm tích lũy CRM, không phải mã giảm giá).

## D27 — Mô hình khuyến mãi (GOAL-009, 27/11/2026)

- Mã giảm giá: bảng `promotions` cấp org, `code` chuẩn hóa UPPERCASE +
  trim khi tạo, `UNIQUE(org_id, code)`; `code` không đổi sau khi tạo
  (PATCH gửi `code` → 400 — muốn mã khác thì tạo mã mới). Loại giảm:
  `percent` (`value` nguyên 1..100, `cap` nguyên > 0, chỉ percent) hoặc
  `fixed` (`value` nguyên > 0; gửi `cap` với fixed → 400). Điều kiện áp:
  `min_order_total` (mặc định 0), `channels` JSON (NULL = mọi kênh),
  `branch_id` (NULL = mọi chi nhánh), `valid_from`/`valid_to` ISO 8601
  (NULL = không giới hạn, `valid_from` >= `valid_to` → 400),
  `usage_limit`/`per_customer_limit` (NULL = không giới hạn).
  `status` `active`/`locked` (khóa = đặt `locked`, mở lại = `active`).
  Không có endpoint DELETE vĩnh viễn cho mã (chỉ khóa bằng status).
- Tính giảm là hàm thuần `calculateDiscount(total, promo,
  pointsDiscount)` trên tổng đơn GỐC (snapshot GOAL-005, CHƯA trừ điểm):
  percent → `floor(total × value / 100)` rồi min với `cap` và với phần
  còn lại sau điểm (`total − points_discount`); fixed → `min(value,
  total − points_discount`). Không bao giờ âm,
  `promo_discount + points_discount <= total`.
- Luật chồng giảm với điểm GOAL-008 — MỘT luật duy nhất, không phụ thuộc
  thứ tự áp: gọi C = số giảm của mã TRƯỚC khi cắt ở phần còn lại
  (percent: `min(floor(total × value / 100), cap)`; fixed: `value`),
  P = điểm muốn đổi × 100. Tổng giảm cuối = `min(C + P, total)`. Áp mã
  trước: `promo_discount = min(C, total − points_discount hiện tại)`,
  rồi đổi điểm sau bị cắt ở `total − promo_discount`. Đổi điểm trước:
  `points_discount = min(P, total)`, rồi áp mã sau bị cắt ở
  `total − points_discount`. Sửa tối thiểu ở `src/customers.ts` redeem:
  `discount = min(points × 100, order_total − promo_discount)` — không
  đổi hành vi khi đơn chưa có mã. KHÔNG tính % trên tổng đã trừ điểm.
- Áp mã: chỉ đơn `draft`, một đơn một mã, trong CÙNG MỘT transaction
  `BEGIN IMMEDIATE`: kiểm tra mọi điều kiện (mã tồn tại trong org,
  chưa khóa, đúng kênh/chi nhánh, trong thời gian hiệu lực, đủ tổng tối
  thiểu, còn lượt tổng + lượt mỗi khách — lượt mỗi khách chỉ tính khi
  đơn có `customer_id`, đơn không gắn khách chỉ tính giới hạn tổng) +
  ghi 1 dòng `promotion_usages` (status `used`, `discount_amount` =
  số giảm đã tính) + cập nhật `orders.promotion_id`/`promo_discount` +
  1 audit log. `orders.total` là tổng snapshot gốc, KHÔNG bị sửa khi áp
  mã. Không có endpoint gỡ mã khỏi đơn (muốn đổi mã thì hủy đơn rồi tạo
  đơn mới).
- Giới hạn dùng: tổng lượt = số dòng `promotion_usages` status `used`
  của mã (không tính dòng `released`); lượt mỗi khách = số dòng `used`
  của mã với `customer_id` đó. Chống vượt giới hạn đồng thời bằng
  transaction `BEGIN IMMEDIATE` + `withStockIdempotency` (GOAL-004):
  10 lần áp cùng mã giới hạn 5 lượt cùng lúc → đúng 5 thành công.
  App một tiến trình (D1), bảo vệ race chỉ có ý nghĩa trong một process;
  đa process ngoài phạm vi.
- Hủy đơn có mã thì hoàn lượt dùng: trong CÙNG transaction với đổi trạng
  thái đơn (`transitionOrderTx` cancel), dòng usage của đơn chuyển
  `used` → `released` (`released_at` = thời điểm hủy, `release_reason`
  = mã đơn đã hủy), `orders.promo_discount` về 0, `promotion_id` về
  NULL — lượt dùng giải phóng, khách dùng lại được (kể cả giới hạn mỗi
  khách). Hủy đơn không có mã thì không động tới bảng usages. Trả
  hàng/hoàn tiền (GOAL-007) và hoàn tiền trực tiếp (GOAL-006) KHÔNG hoàn
  lượt dùng: mã đã dùng thật khi đặt đơn, số tiền hoàn tính theo snapshot
  giá (D25).
- Đối soát: `computePaymentSummary` mở rộng `outstanding =
  order_total − points_discount − promo_discount − paid_total`;
  `payment_status` GIỮ NGUYÊN logic D22 (như GOAL-008 đã làm với điểm):
  đơn đổi điểm/mã hết tổng mà chưa trả đồng nào vẫn `unpaid`; đơn đã trả
  đủ phần còn phải trả sau giảm nhưng chưa bằng tổng gốc thì vẫn
  `partially_paid` theo logic D22. Tích điểm tính trên `order_total`
  gốc, KHÔNG trừ `promo_discount` (như D26 không trừ `points_discount`):
  đơn 250.000đ áp mã 10% vẫn tích 25 điểm khi completed.
- RBAC: `can()` thêm 4 actions `create-promotion`, `update-promotion`,
  `apply-promotion`, `view-promotions` — tạo/sửa/khóa: chỉ
  owner/manager; áp mã: owner/manager toàn org, sales chỉ đơn thuộc chi
  nhánh mình; xem mã: owner/manager/accountant toàn org, sales chỉ mã
  `branch_id` NULL hoặc đúng chi nhánh mình, warehouse 403. Mọi endpoint
  qua `requireRole` + `can()` (xem ma trận đầy đủ ở `docs/RBAC.md`).
- Audit: tạo/sửa/khóa mã + áp mã + hoàn lượt dùng khi hủy đơn đều ghi
  `audit_log` (`action` `create-promotion` / `update-promotion` /
  `apply-promotion` / `promotion-usage-released`, `detail` JSON với
  `target_promotion_id`, `promotion_code`, `target_order_id`/`order_code`
  khi áp mã hoặc hoàn lượt, `discount` khi áp mã, KHÔNG chứa thông tin
  thẻ). Hoàn lượt dùng khi hủy đơn chọn cách ghi 1 audit RIÊNG
  `promotion-usage-released` (thay vì ghi kèm trong detail của
  `cancel-order`) để bản ghi hoàn lượt tìm được trực tiếp theo
  `target_promotion_id` mà không phải parse detail của audit hủy đơn.
  `promotion_usages` là lịch sử dùng mã chi tiết (append-only, chỉ
  INSERT + chuyển `used` → `released`, không có API DELETE usage),
  `audit_log` là lớp ghi nhận thao tác nhạy cảm — cả hai đều phải có,
  không thay nhau.
- Idempotency: `withStockIdempotency` (GOAL-004) trong cùng transaction
  `BEGIN IMMEDIATE`, tên miền `promotion:create:<key>` /
  `promotion:apply:<key>` (header `Idempotency-Key` hoặc
  `idempotency_key` trong body); gửi lại cùng key trả đúng response cũ
  kèm `replayed: true`, không tạo mã/usage mới, không trừ lượt dùng lần
  nữa. KHÔNG dùng `withIdempotency` của GOAL-001 cho áp mã (nó kiểm tra
  key ngoài transaction).
- Lý do: lịch sử dùng mã append-only để lượt dùng đã giải phóng vẫn tra
  được (dòng cũ chuyển `released`, không xóa); tính giảm thuần trên tổng
  gốc để hai chiều áp mã/đổi điểm cho cùng kết quả; outstanding trừ cả
  điểm lẫn mã nhưng `payment_status` giữ D22 để không vỡ hành vi đã khóa
  của GOAL-006/007/008 (GOAL-010 đối soát tổng hợp có thể xem lại ngữ
  nghĩa `payment_status` với `tests revise` nếu cần).
- Đổi khi: cho phép gỡ/đổi mã trên đơn nháp (thêm endpoint gỡ mã + hoàn
  lượt dùng), mã dùng nhiều lần trên cùng đơn, hoặc khuyến mãi theo
  nhóm sản phẩm (hiện chỉ theo tổng đơn).

## D28 — Mô hình báo cáo + đối soát (GOAL-010, 27/11/2026)

- Định nghĩa chỉ số (tiền số nguyên đồng, không float): doanh thu chỉ
  tính đơn có `status = 'completed'` tại thời điểm báo cáo; thời gian
  của một đơn là thời điểm hoàn tất — `created_at` của `order_events`
  có `to_status = 'completed'` (lưu UTC, không có cột `completed_at`
  riêng, không thêm cột mới). Đơn `draft`/`confirmed`/`processing`/
  `cancelled` KHÔNG vào doanh thu, kể cả đơn đã thu tiền đặt cọc (tiền
  thu của đơn chưa completed không cộng vào doanh thu). Đơn completed
  rồi bị trả hàng vẫn tính doanh thu gộp — tiền hoàn trừ riêng ở cột
  hoàn tiền, không sửa lại doanh thu. Doanh thu gộp = Σ `orders.total`
  (snapshot GOAL-005) của đơn completed trong kỳ; doanh thu thuần = Σ
  (`total` − `points_discount` − `promo_discount`); số đơn = số đơn
  completed trong kỳ; tiền đã thu = Σ `paid_total`, tiền hoàn = Σ
  `refunded_total`, tiền còn phải thu = Σ `outstanding` — cả ba theo
  `computePaymentSummary` (D22/D27) của từng đơn completed trong kỳ,
  tính THEO ĐƠN, không theo ngày thu (âm nghĩa là thừa, hiện rõ không
  giấu). Khoảng thời gian `from`/`to` là ngày theo Asia/Ho_Chi_Minh
  (`YYYY-MM-DD`), chuyển sang UTC để lọc (`from` 00:00 +07 = hôm trước
  17:00 UTC, `to` 00:00 +07 của ngày sau `to` là cận trên, khoảng nửa
  mở `[startUtc, endUtc)`); mặc định là tháng hiện tại (ngày 1 tới hôm
  nay, theo Asia/Ho_Chi_Minh); `from` > `to` → 400, định dạng ngày sai
  → 400. Lọc ngày trong SQL bằng `datetime(created_at)` để chuẩn hóa
  cả hai dạng timestamp đang có trong DB (ISO `...T...Z` và
  `YYYY-MM-DD HH:MM:SS` UTC); nhóm theo ngày/tháng dùng ngày hoàn tất
  theo Asia/Ho_Chi_Minh (đơn hoàn tất 00:30 +07 ngày 1 thuộc ngày 1).
- Nhóm doanh thu (`group_by` ∈ `day`/`month`/`channel`/`branch`/
  `product`/`category`, mặc định `day`; lạ → 400; kênh lạ → 400; chi
  nhánh không tồn tại → 404, ngoài org → 403; kỳ rỗng → totals 0, rows
  rỗng, 200): nhóm `product` dùng `order_items` (mỗi dòng tính theo
  `line_total` snapshot); nhóm `category` gom theo danh mục của sản
  phẩm, sản phẩm chưa có danh mục gom vào nhóm `Chưa phân loại`.
  Công thức phân bổ điểm/mã/đã thu/hoàn cho một dòng sản phẩm: phần
  của dòng = `floor(line_total × số giảm của đơn / total)`; phần dư
  (do làm tròn xuống) chia +1đ cho các dòng có phần lẻ lớn nhất, để
  tổng các dòng khớp đúng `points_discount`/`promo_discount`/
  `paid_total`/`refunded_total` của đơn (hàm thuần
  `allocateDiscounts` cho một dòng, `allocateProportional` cho cả đơn
  trong `src/reports.ts`). `outstanding` của dòng = `gross − điểm −
  mã − đã thu`, nên tổng các dòng khớp `outstanding_total`.
  `order_count` ở nhóm `product`/`category` là số đơn khác nhau của
  mỗi dòng — một đơn có nhiều dòng sản phẩm thì đếm ở nhiều dòng, nên
  tổng `order_count` các dòng có thể vượt `totals.order_count` (chỉ
  riêng cột này; các cột tiền vẫn khớp totals).
- Báo cáo tồn kho: `levels` theo từng cặp (biến thể, kho) từ
  `stock_levels` (`available = on_hand − reserved`, D17), `movements`
  tóm tắt theo loại `{type, count, qty_total}` trong kỳ (lọc theo
  `created_at` UTC, `qty_total` = Σ `qty_change`, có dấu), `low_stock`
  = các cặp có `available < products.min_stock` kèm `min_stock` và
  `shortage = min_stock − available`. Kho `inactive` vẫn hiện trong
  báo cáo (chỉ đọc). Lọc kho/biến thể không tồn tại → 404, ngoài org
  → 403.
- Đối soát 3 mặt (chỉ đọc, không sửa dữ liệu): (a) kho — với mỗi cặp
  (biến thể, kho) có ÍT NHẤT 1 movement: tồn kỳ vọng = Σ `qty_change`,
  giữ kỳ vọng = Σ `reserved_change` của MỌI movement của cặp đó từ
  đầu (không chỉ trong kỳ), so với `stock_levels` hiện tại (thiếu
  dòng = 0); lệch → 1 dòng `kind: 'stock-level'`, `severity: 'error'`.
  Cặp seed chỉ có `stock_levels` mà không có movement nào (seed tạo
  mức tồn mẫu không ghi movement, để test backup/restore không vỡ FK)
  KHÔNG tính là lệch — mức seed là baseline, chỉ kiểm tra cặp có
  movement. Tinh chỉnh (demo.sh phát hiện 27/11): cặp seed SAU ĐÓ có
  movement (vd demo GOAL-005 bán biến thể seed SKU-SEED-01-M ở Kho Phụ:
  seed 20, reserve/out −2 → tồn 18) thì Σ thuần (−2) báo lệch SAI;
  baseline của cặp phải cộng vào kỳ vọng: baseline = `on_hand_after −
  qty_change` của movement ĐẦU TIÊN của cặp (mọi movement đều ghi mức
  sau khi áp dụng, `stock_movements.on_hand_after/reserved_after`), kỳ
  vọng = baseline + Σ mọi movement. Cặp bắt đầu từ 0 thì baseline = 0,
  công thức rút gọn về Σ thuần (test khóa 'chen lech ton' vẫn assert
  expected = Σ = 200). Tương tự cho `reserved`: baseline =
  `reserved_after − reserved_change` của movement đầu tiên. (b) đơn–kho — với mỗi đơn completed trong kỳ: mỗi dòng
  `order_items` phải có movement `out` (`reference` = mã đơn,
  `qty_change` = −số lượng dòng, đúng kho của đơn) kèm movement
  `release` tương ứng (`reserved_change` = −số lượng, D19: hoàn tất =
  release + out trong cùng transaction); thiếu/thừa/sai số → 1 dòng
  `kind: 'order-stock'`, `severity: 'error'`, kèm `order_code`,
  `variant_id`, `expected_qty` (âm, = −số lượng kỳ vọng xuất),
  `actual_qty`. (c) đơn–tiền — dùng lại `computePaymentSummary`
  (D22/D27): `outstanding > 0` → 1 dòng `kind: 'order-payment'`,
  `severity: 'info'`, `note` chứa `chưa thu đủ`; `outstanding < 0` →
  `note` chứa `thu thừa`; đây là TRẠNG THÁI, không phải lỗi dữ liệu.
  `payment_status = 'refunded'` mà `refunded_total` lệch tổng refund
  `completed` → dòng `severity: 'error'` (kiểm tra này hiện không bao
  giờ nổ vì `computePaymentSummary` tính `refunded_total` bằng đúng
  tổng đó — giữ lại như chốt chặn). Dòng `order-payment` ghi cả
  `expected` = số phải thu ròng (`total − points_discount −
  promo_discount`), `actual` = `paid_total`, `difference` = `actual −
  expected`, và `payment_status` trong `note` để người đọc tự thấy sự
  khác biệt.
- `payment_status` GIỮ NGUYÊN logic D22 (GOAL-010 KHÔNG đổi ngữ
  nghĩa): đơn đổi điểm/mã hết tổng mà chưa trả đồng nào vẫn `unpaid`;
  hoàn trực tiếp một phần giữ `partially_paid`, hoàn qua trả hàng giữ
  `partially_refunded` (chỉ khi có return đã hoàn tiền — D25). Ngữ
  nghĩa này có thể gây nhầm trong báo cáo (đơn trả đủ phần còn phải
  trả sau giảm nhưng chưa bằng tổng gốc vẫn `partially_paid`) — báo
  cáo hiển thị cả `outstanding` lẫn `payment_status`; muốn đổi thì làm
  `tests revise` ở goal sau, không đổi lén trong goal này.
- Báo cáo khuyến mãi: theo từng mã — `used_count`/`released_count`
  đếm theo trạng thái HIỆN TẠI của usage tạo trong kỳ,
  `total_discount` = Σ `discount_amount` của usage `used` tạo trong
  kỳ (theo `created_at` của usage), `order_count` = số đơn khác nhau
  có usage trong kỳ; lọc `code` theo chuỗi con; mã chưa từng dùng
  trong kỳ vẫn hiện với các số 0. Báo cáo điểm: `earned_total`/`redeemed_total`
  = Σ điểm `earn`/`redeem` trong kỳ từ ledger `customer_points`,
  `redeemed_amount` = `redeemed_total` × 100đ (D26); điểm tích tính
  trên tổng gốc (D27: không trừ `promo_discount`).
- Xuất CSV (`?format=csv`, `format` lạ → 400): cùng dữ liệu với bản
  JSON cùng filter (cùng `from`/`to`/filter, cùng kỳ), dùng
  `csv-stringify` như GOAL-003 (BOM đầu file, tự quote trường chứa
  dấu phẩy); cột đúng như brief R-7; dòng `TOTAL` cuối file cho báo
  cáo doanh thu/khuyến mãi/điểm (khớp `totals` của JSON); báo cáo tồn
  và đối soát không có dòng `TOTAL` (mỗi dòng là một cặp/một lệch).
  CSV tồn kho thêm `min_stock`/`shortage` cho từng cặp (lấy từ
  `products.min_stock`, `shortage = max(0, min_stock − available)`).
- RBAC báo cáo: `can()` mở rộng 2 actions `view-reports` (xem JSON)
  và `export-reports` (xuất CSV) — owner/manager/accountant toàn org
  (chỉ xem, báo cáo chỉ đọc); sales chỉ chi nhánh mình (không có
  `branch_id` thì mặc định lọc chi nhánh mình, `branch_id` khác →
  403, xem báo cáo tồn → 403); warehouse chỉ xem báo cáo tồn kho
  (`GET /api/reports/stock`, chỉ kho được gán — `warehouse_id` NULL =
  mọi kho, hỏi kho ngoài phạm vi → 403), các báo cáo khác → 403. Mọi
  endpoint báo cáo qua `requireRole` + `can()` (vai sai → 403, ngoài
  org → 403, sai chi nhánh/kho → 403). Phạm vi org: hệ thống chạy
  local cho một doanh nghiệp (seed tạo đúng 1 org, D9); các hàm thuần
  báo cáo tổng hợp dữ liệu của org triển khai đó (org có id nhỏ nhất
  — org seed), nên user thuộc org khác đọc báo cáo mặc định bị 403
  (ma trận R-8: "user org A đọc báo cáo org B → 403"); hỏi chi
  nhánh/kho thuộc org khác cũng 403 (qua lookup `branch_id`/
  `warehouse_id`/`variant_id` trước khi tính).
- Audit log: CHỈ xuất CSV mới ghi `audit_log` (action
  `export-report`, `detail` JSON `{report ∈ revenue/stock/
  reconciliation/promotions/points, from, to, format: 'csv', filter
  đã dùng: channel/branch_id/warehouse_id/variant_id/code/group_by
  khi có}`, KHÔNG chứa thông tin thẻ, KHÔNG chứa PII khách — chỉ id
  + số liệu); xem JSON không ghi audit (tránh nhiễu log). Xem log theo
  luật GOAL-002 (`GET /api/audit-log`: owner toàn org, manager trong
  phạm vi, các vai khác → 403).
- Không bảng tổng riêng: mọi số liệu tính ở service (`src/reports.ts`,
  hàm thuần) từ các bảng đã có, KHÔNG tạo bảng tổng hợp mới, KHÔNG lưu
  cột tổng riêng, KHÔNG migration 015 (không cần index mới cho truy
  vấn báo cáo ở quy mô này), KHÔNG cache kết quả trong DB hay file
  (mỗi lần gọi tính lại từ dữ liệu gốc). Báo cáo không yêu cầu
  idempotency (GET hai lần trả cùng kết quả, không ghi gì thêm khi xem
  JSON).
- Lý do: thời điểm hoàn tất lấy từ `order_events` thay vì thêm cột
  `completed_at` để không sửa schema GOAL-005 và giữ một nguồn sự
  thật duy nhất cho vòng đời đơn; tiền thu/hoàn tính theo đơn (không
  theo ngày thu) để khớp đúng định nghĩa đối soát D22; đối soát kho
  dùng Σ movement từ đầu (không chỉ trong kỳ) vì `count` đặt lại tuyệt
  đối và `transfer` có 2 phía — chỉ Σ toàn bộ mới cho kỳ vọng đúng;
  cộng baseline từ movement đầu tiên vì mức seed tồn tại trước khi có
  movement (xem tinh chỉnh mặt (a) ở trên).
  cặp seed không movement được loại khỏi mặt (a) để dữ liệu mẫu đã
  biết cho 0 dòng `error`; audit chỉ cho CSV để log không bị nhiễu
  bởi lượt xem JSON.
- Đổi khi: cần báo cáo theo thời gian thực trên dữ liệu lớn (thêm
  index qua migration chỉ thêm index, hoặc bảng tổng hợp — phải qua
  goal riêng và ghi rõ lý do), hoặc đổi ngữ nghĩa `payment_status`
  (qua `tests revise`), hoặc báo cáo đa org thật (thêm `org_id` vào
  các hàm thuần thay vì gate org triển khai).

## D29 — Mô hình thông báo + công việc nền (GOAL-011, 28/11/2026)

- Danh mục sự kiện (R-1): `order.confirmed` / `order.completed` /
  `order.cancelled`; `payment.paid` / `payment.failed` /
  `payment.refunded`; `shipment.shipped` / `shipment.delivered` /
  `shipment.failed`; `return.requested` / `return.approved` /
  `return.rejected` / `return.received`; `stock.low`;
  `promotion.expiring`. Người nhận mặc định: đơn/thanh toán/giao/trả
  → email khách (nếu đơn có `customer_id` và khách có email) + owner;
  thanh toán/hoàn tiền → thêm accountant; trả hàng → thêm sales của chi
  nhánh đơn; tồn thấp → user warehouse được gán kho đó + manager; mã sắp
  hết hạn → owner + manager. Người nhận là user thì kiểm tra
  `notification_preferences` lúc tạo job (thiếu dòng = BẬT; tắt → không
  tạo job, không tạo notification, không tính failed); khách (email)
  luôn gửi nếu có email.
- Gửi qua `FakeEmailAdapter.send` (`simulated: true`, `messageId`
  deterministic `FAKE-MAIL-<sha256 12 ký tự>`), log append-only vào
  bảng `notifications` (migration 015): `org_id`, `event_key`,
  `event_type`, `channel='email'`, `recipient_user_id` nullable,
  `recipient_email` snapshot, `subject`, `body`, `status` sent/failed,
  `error` nullable, `message_id`, `created_at`. KHÔNG gửi email thật.
- `event_key` = `${event_type}:${entity}:${detail}`: vd
  `order.completed:DH-20261128-0001`,
  `stock.low:variant:12:warehouse:3:2026-11-28` (ngày Asia/Ho_Chi_Minh,
  tối đa 1 lần/ngày/cặp),
  `promotion.expiring:7:2026-11-30` (1 lần/mã/ngày hết hạn). Chống
  trùng theo (event_key + người nhận): 1 job send-notification cho 1
  người nhận; gửi lại cùng event_key + cùng người nhận → trả job đã có,
  không tạo mới; gửi lại cùng trạng thái (no-op D24) → không tạo job.
- Mẫu nội dung cố định từng loại (subject/body chứa mã đơn / số tiền /
  SKU / tên kho / mã khuyến mãi tùy loại; số tiền ghi số nguyên không
  định dạng — vd `250000` — để test đối chiếu chuỗi; KHÔNG chứa thông
  tin thẻ, KHÔNG chứa PII thừa ngoài email đích đã snapshot):
  đơn xác nhận/hoàn tất/hủy — `Đơn <mã> đã xác nhận/hoàn tất/bị hủy.
  Tổng tiền: <total> VND.`; đã nhận tiền — `Đã nhận <amount> VND cho
  đơn <mã>`; thanh toán thất bại — `Thanh toán đơn <mã> thất bại`;
  hoàn tiền — `Đã hoàn tiền <amount> VND cho đơn <mã>`; giao hàng —
  `Đơn <mã> đã giao cho đơn vị vận chuyển / đã giao thành công / giao
  hàng thất bại`; trả hàng — `Yêu cầu trả hàng [mã trả] cho đơn <mã>
  đã được tạo/duyệt/bị từ chối/đã nhận hàng`; tồn thấp —
  `Tồn thấp: <SKU> tại <kho>` / `Sản phẩm <tên> (<SKU>) tại kho <kho>:
  còn <available>, mức tối thiểu <min_stock>, thiếu <shortage>.`;
  mã sắp hết hạn — `Mã <code> sắp hết hạn (<valid_to>)` / `Mã khuyến
  mãi <code> hết hạn ngày <valid_to>. Đã dùng <used>/<limit>.`
- Job queue trong tiến trình (R-4): bảng `jobs` (migration 015): `id`,
  `type` ∈ send-notification/low-stock-scan/promo-expiry-scan, `payload`
  JSON (send-notification: `event_key`, `event_type`,
  `to_user_id`/`to_email`, `subject`, `body`; scan: `period_key`),
  `status` ∈ pending/running/done/failed, `attempts` (mặc định 0),
  `max_attempts` = 3, `next_run_at` (ISO UTC, mặc định now),
  `last_error` nullable, `created_at`, `updated_at`. Runner
  `processDueJobs(db, now)`: lấy job pending có `next_run_at <= now`
  theo `created_at`, chạy TUẦN TỰ từng job, mỗi job trong transaction
  riêng (running → done/failed/pending-lại + ghi log trong cùng
  transaction). Trả `{processed, done, failed}` — `failed` đếm job lỗi
  trong lần chạy này (kể cả job về pending chờ retry).
- Retry + backoff (R-5): `max_attempts` = 3 (chốt). Job fail →
  `attempts` + 1, về pending với `next_run_at` = now + `60 ×
  2^(attempts-1)` giây (lần 1 fail → +60s, lần 2 fail → +120s); lần 3
  fail → `failed` + `last_error` + audit `job-failed` +
  `notification-failed`. Test KHÔNG chờ thật (đặt `next_run_at` trực
  tiếp / `now` giả lập). Cơ chế giả lập lỗi gửi: `FakeEmailAdapter`
  thêm `failNext()` static một lần như D23 — CHỈ dùng trong test (và
  helper `scripts/notif-ops.ts` cho demo/smoke), route production
  không bao giờ gọi.
- Scheduler + scan (R-6/R-7/R-8): `setInterval` 60 phút/loại scan khi
  server chạy thật (`src/server.ts` gọi `startNotificationScheduler`;
  KHÔNG chạy trong test — test chỉ gọi `createApp`). Mỗi loại scan có
  `period_key` = ngày hiện tại Asia/Ho_Chi_Minh; đã có job scan cùng
  loại + cùng `period_key` ở pending/running/done thì KHÔNG tạo thêm
  (kiểm tra trong transaction). low-stock-scan quét cặp
  (biến thể, kho) ĐÃ CÓ dòng `stock_levels` với `available < min_stock`
  (cặp chưa từng nhập kho không có dòng tồn thì không tính là cặp tồn
  thấp — mỗi ngày tính lại từ dữ liệu gốc); mỗi cặp sinh 1 job
  `stock.low` / 1 người nhận. promo-expiry-scan quét promotion `active`
  có `valid_to` trong 3 ngày tới theo ngày Asia/Ho_Chi_Minh (đã hết hạn
  thì không nhắc, `valid_to` NULL thì không nhắc); mỗi mã sinh 1 job
  `promotion.expiring` / 1 người nhận; nội dung ghi `used_count` (số
  usage `used`) / `usage_limit` (NULL → "không giới hạn").
  `POST /api/jobs/run` chạy ngay job due (KHÔNG enqueue scan — test
  khóa AC-3 đòi `processed` chính xác); scan kích hoạt tay ngoài API
  bằng helper `scripts/notif-ops.ts` (mở cùng file DB, chạy cùng code
  `src/jobs.ts`) cho demo/smoke.
- Khôi phục khi khởi động (R-4): server start đưa mọi job `running` về
  `pending` (`attempts` giữ nguyên, `next_run_at` = now) qua
  `recoverRunningJobs(db, now)`.
- Hook sự kiện (R-9): tạo job trong CÙNG transaction với cập nhật trạng
  thái gốc — `transitionOrderTx` (confirmed/completed/cancelled;
  `process` không sinh thông báo), `createPaymentTx` (chỉ thu trực
  tiếp cash/bank_transfer chót `paid` ngay; thu qua cổng ở `requested`
  chờ webhook), `processWebhookTx` (paid chót / failed — webhook lặp
  hoặc đã trả thì không tạo job), `createRefundTx` (mọi refund tạo ra),
  `updateShipmentTx` (in_transit → shipped, delivered, failed; gửi
  lại cùng trạng thái là no-op, không tạo job), `createReturnTx`
  (requested), `reviewReturnTx` (approved/rejected), `receiveReturnTx`
  (received). Hook CHỈ THÊM tạo job, KHÔNG đổi hành vi đã khóa của
  GOAL-005/006/007 (state machine, webhook chống trùng, hoàn tiền,
  `computePaymentSummary` D22/D25).
- Quyết định đã giao cho Worker (ghi rõ lựa chọn + lý do):
  (a) Refund tạo qua luồng trả hàng (return-refund) CÓ sinh job
  `payment.refunded`: brief R-9 ghi hook "(c) refund tạo (GOAL-006)"
  được đọc theo nghĩa refund nào tạo ra cũng sinh job (kể cả qua trả
  hàng) — `refundReturnTx` dùng lại đúng đường `createRefundTx` của
  GOAL-006 nên hook đặt ở `createRefundTx` bao cả hai luồng; dedupe
  theo (event_key + người nhận) nên nhiều payment hoàn chung một đơn
  vẫn chỉ sinh 1 job/người nhận. Test khóa KHÔNG assert job cho luồng
  này (ghi chú trong test), quyết định thuộc Worker theo R-9.
  (b) Bảng `jobs` không có `org_id`, `notifications` không có
  `branch_id`/`warehouse_id`: KHÔNG thêm cột mới — suy org/chi
  nhánh/kho từ payload/event_key (`deriveEventScope` /
  `deriveJobOrg` trong `src/notifications.ts`): mã đơn → tra đơn
  (`org_id`/`branch_id`/`warehouse_id`, giới hạn theo org của bản
  ghi khi biết trước vì mã đơn trùng nhau giữa 2 org là có thể);
  `stock.low` → id kho trong event_key → tra kho; `promotion.expiring`
  → id mã → tra khuyến mãi; job scan không gắn thực thể nào nên là
  global theo `period_key` (owner/manager thấy mọi job scan,
  warehouse chỉ thấy job low-stock-scan). Job send-notification không
  suy được org (vd job test chèn tay với mã đơn giả) thì owner/manager
  vẫn thấy (không chặn nhầm), còn kiểm tra ngoài org chỉ áp khi suy
  được org khác.
  (c) Chống trùng đổi từ `UNIQUE(event_key)` toàn cục (stub Tester)
  sang `UNIQUE(org_id, event_key, recipient_email)` (migration 015):
  stub sai theo hợp đồng test — cùng event_key gửi cho 2 người nhận
  (owner + khách, warehouse + manager) PHẢI có 2 dòng notifications
  (test khóa AC-2 đòi `notes.length == 2` cho 1 event_key
  stock.low/promotion.expiring), nên UNIQUE toàn cục theo event_key
  là không thể đúng; mặt khác mã đơn là số thứ tự theo từng org nên
  2 org có thể trùng mã đơn — UNIQUE theo event_key sẽ làm mất log
  của org thứ hai. Với UNIQUE mới, cùng event_key + cùng người nhận
  trong 1 org vẫn chỉ có 1 bản ghi (dedupe giữ nguyên), khác người
  nhận hoặc khác org thì ghi riêng. DB nào đã migrate 015 với
  UNIQUE cũ thì giữ nguyên ràng buộc cũ (migration không chạy lại);
  DB mới nhận UNIQUE mới.
- Preferences (R-3): bảng `notification_preferences` (migration 015):
  `user_id`, `event_type`, `enabled` (0/1),
  `UNIQUE(user_id, event_type)`; thiếu dòng = BẬT (không seed dòng mặc
  định). API `GET/PATCH /api/notification-preferences` (`user_id` vắng
  = chính mình; `event_type` lạ → 400; `enabled` không phải boolean →
  400); GET trả đủ 15 loại với `enabled` boolean.
- API (R-10): `GET /api/notifications?event_type=&status=&from=&to=`
  + `GET /api/notifications/:id`; `GET /api/jobs?status=&type=` +
  `GET /api/jobs/:id`; `POST /api/jobs/run` (trả `{processed, done,
  failed}`); `POST /api/jobs/:id/retry` (failed → pending, attempts 0,
  `next_run_at` = now, `last_error` NULL + audit `job-retried`; chưa
  failed → 400; không thấy → 404). List kèm `total`/`page`/`limit`
  (page mặc định 1, limit mặc định 20 tối đa 100); `status`/`event_type`
  /`type` lạ → 400; ngoài org → 403. Job trả cho client có `payload`
  đã giải JSON.
- RBAC (R-11): `can()` thêm 4 actions `view-notifications` /
  `manage-notification-preferences` / `view-jobs` / `run-jobs`:
  owner/manager toàn org (xem + chạy job + retry); sales chỉ xem thông
  báo thuộc chi nhánh mình (thông báo không gắn chi nhánh thì sales
  không thấy; xem job → 403); warehouse chỉ xem thông báo `stock.low`
  của kho được gán + job low-stock-scan (xem job khác → 403, chạy job
  → 403); accountant xem thông báo payment/refund toàn org (chỉ xem,
  chạy job → 403). Preferences: user tự xem/sửa của mình; owner/manager
  sửa cho user trong org; sales/warehouse/accountant sửa của người khác
  → 403. Mọi endpoint qua `requireAuth` + `can()` (vai sai/sai chi
  nhánh/kho/ngoài org → 403).
- Audit (R-12): CHỈ thất bại cuối + retry tay — gửi thất bại cuối
  (`notification-failed`, detail `{event_key, event_type,
  recipient_user_id (nếu có), error}` — KHÔNG nội dung email, KHÔNG
  email khách), job failed cuối (`job-failed`, detail `{job_id,
  job_type, last_error}`), retry tay (`job-retried`, detail `{job_id,
  job_type}`). Gửi thành công KHÔNG ghi audit. Xem log theo luật
  GOAL-002 (`GET /api/audit-log`).
- Lý do: job trong tiến trình + `setInterval` thay vì Redis/cron hệ
  thống vì quy mô giả lập local (R-18 loại trừ vĩnh viễn); dedupe 2
  lớp (job theo event_key + người nhận, notification theo
  org/event_key/email) vì runner chạy tuần tự vẫn có thể gặp job scan
  chạy lại cùng ngày; suy phạm vi từ event_key thay vì thêm cột vì
  schema 3 bảng đã chốt ở migration 015 và event_key đã mang đủ định
  danh thực thể (mã đơn / id kho / id mã).
- Đổi khi: cần gửi thật (thêm adapter + goal riêng, KHÔNG dùng
  FakeEmailAdapter cho production), cần dedupe theo (event_key +
  recipient_user_id) thay vì email (khi user đổi email giữa enqueue
  và gửi), hoặc job scan cần gắn org (thêm `org_id` vào bảng `jobs`
  qua migration mới — phải qua goal riêng và ghi rõ lý do).

## D30 — UI tổng quan + vận hành (GOAL-012, 28/11/2026)

- Nguồn số liệu dashboard (R-1/R-9): KHÔNG tính lại bằng SQL riêng.
  Doanh thu hôm nay/tháng này qua `computeRevenueReport` (GOAL-010,
  chỉ đơn `completed`, khoảng ngày theo Asia/Ho_Chi_Minh, `branchId`
  khi sales xem chi nhánh mình — nên số dashboard khớp đúng số
  `GET /api/reports/revenue` cùng khoảng). Đơn chờ xử lý đếm từ bảng
  `orders` theo trạng thái `draft`/`confirmed`/`processing` (kèm mã đơn
  để đối chiếu với `GET /api/orders?status=`). Tồn thấp qua
  `computeStockReport` (GOAL-004): cặp (biến thể, kho) có
  `available < min_stock`, lọc theo kho thuộc chi nhánh khi sales xem.
  Thông báo qua bảng `notifications` (GOAL-011). Giao/trả qua bảng
  `shipments`/`returns` (GOAL-007). Khách VIP qua `customerView` /
  `segmentFor` (GOAL-008: VIP khi `total_spent >= 5.000.000đ` hoặc
  `order_count >= 10`); điểm đã đổi trong tháng qua
  `computePointsReport` (GOAL-010: `redeemed × 100đ`); khách mới trong
  tháng đếm từ `customers.created_at` trong tháng. Job failed qua bảng
  `jobs` (GOAL-011, kèm link retry tay `/api/jobs/:id/retry`).
- Định nghĩa "chưa đọc" (R-1): notification có `status = 'sent'` được
  tạo SAU lần cuối cùng user đó mở trang `/dashboard/notifications`.
  Mốc "đã xem" lưu trong bộ nhớ tiến trình theo user id
  (`Map<userId, ISO-timestamp>` trong `createApp`), KHÔNG thêm cột DB
  mới (schema đã chốt ở migration 015, không có cột đọc riêng). Chưa
  mở trang lần nào → mọi notification `sent` trong phạm vi đều tính là
  chưa đọc. Khởi động lại tiến trình thì mốc reset (mọi `sent` lại tính
  là chưa đọc) — chấp nhận được vì đây chỉ là chỉ báo tổng quan, không
  phải trạng thái nghiệp vụ; nếu sau này cần trạng thái đọc bền vững thì
  thêm bảng/cột riêng qua goal riêng.
- Health mở rộng (R-5): `GET /health` giữ `{status: 'ok'}` khi DB ok,
  thêm `db: 'ok'` (kiểm tra kết nối SQLite thật bằng `SELECT 1`),
  `version` đọc từ `package.json` lúc khởi động (không hard-code),
  `uptime_seconds` = `Math.floor(process.uptime())` (số nguyên ≥ 0).
  DB lỗi → `status: 'error'` + `db: 'error'` + HTTP 503.
- Sao lưu/khôi phục (R-6): CHỈ bọc `scripts/backup.sh` +
  `scripts/restore.sh` GOAL-001 (không viết logic sao lưu mới). File
  backup mặc định vào `<repo>/backups/omniflow-<timestamp>-<rand>.db`;
  API trả `{file, size, created_at}` với `file` dạng tương đối
  `backups/<tên>`. Trang `/ops/backup` hiện bản sao lưu gần nhất (tên
  file + thời gian + kích thước, hoặc "Chưa có sao lưu"). Restore nhận
  đúng giá trị `file` đã trả (cũng nhận tên file trần); yêu cầu
  `confirm: true`, thiếu/sai → 400; file không tồn tại → 404; đường
  dẫn tuyệt đối, `..`, `\` hoặc đường dẫn con khác → 400 (chỉ file
  nằm trong thư mục backup mặc định). Đường dẫn file DB đang chạy lấy
  qua `PRAGMA database_list` (DB `:memory:` không có file → backup/
  restore trả 400). Audit ghi `create-backup` / `restore-backup`.
- Audit mở rộng (R-7): `GET /audit-log` thêm lọc `actor=` (id người
  dùng, số), `action=` (khớp đúng), `from=`/`to=` (YYYY-MM-DD theo
  Asia/Ho_Chi_Minh, `from <= to`) + phân trang `page`/`limit` (mặc
  định page 1, limit 20, tối đa 100). Lọc sai giá trị → 400. Giữ hành
  vi cũ: owner/manager only (ngoài vai → 403), manager vẫn chỉ thấy
  bản ghi trong phạm vi qua `visibleAuditRows`; nội dung log không
  đổi; `GET /api/audit-log` giữ nguyên.
- RBAC dashboard/vận hành (R-10) — `can()` thêm 3 actions
  `view-dashboard` / `view-ops` / `run-backup` (xem ma trận đầy đủ ở
  `docs/RBAC.md`): owner/manager/accountant xem dashboard toàn org;
  sales chỉ dashboard chi nhánh mình (`?branch_id=` khác → 403, xem
  toàn org → 403); warehouse không xem dashboard doanh thu → 403
  (chỉ xem màn hình giao hàng thuộc kho được gán); accountant xem
  dashboard chỉ xem (chạy backup/restore → 403); sales/warehouse xem
  vận hành → 403; user org A xem dashboard org B → 403 (gate theo
  `branch_id` + `org_id` của chi nhánh, theo mẫu `branch_id` của API
  báo cáo/đơn).
- Quyết định R-6 thắng R-10 cho backup/restore (coordinator, 28/11):
  R-10 ma trận ghi "owner/manager … chạy backup/restore" là câu tổng
  quát, bị R-6 ghi đè cho riêng tính năng backup: backup/restore là
  OWNER-ONLY — `GET /ops/backup`, `POST /api/ops/backup`,
  `POST /api/ops/restore` đều chỉ owner, manager cũng 403 (test đã
  khóa theo hướng này). `can(manager, 'view-ops') = true` theo ma
  trận, nhưng trang `/ops/backup` gate bằng `run-backup` (owner-only),
  KHÔNG dùng `view-ops` cho trang này. `can(manager, 'run-backup')`
  = false; `can(owner, 'run-backup')` = true, mọi vai còn lại false.
- EJS (R-8): 5 màn hình mới (`dashboard`, `dashboard-shipments`,
  `dashboard-customers`, `dashboard-notifications`, `ops-backup`) dùng
  chung `public/style.css`, tiếng Việt, mobile-first, điều hướng bằng
  link/button focus được (không `onclick`); trạng thái rỗng hiển thị
  0/empty đúng nghĩa, không crash; lỗi service → trang lỗi 500 không
  lộ stack trace.
- Lý do: dùng lại service đã khóa thay vì SQL riêng để số dashboard
  không bao giờ lệch API báo cáo; mốc "đã xem" trong bộ nhớ thay vì
  cột DB vì schema đã chốt và chỉ báo tổng quan không cần bền vững;
  backup qua script sẵn có thay vì logic mới vì cơ chế GOAL-001 đã
  được kiểm chứng (kể cả test backup/restore).
- Đổi khi: cần trạng thái đọc bền vững theo user (thêm cột/bảng qua
  goal riêng), cần backup ra ngoài thư mục mặc định (thêm cấu hình
  qua biến môi trường + goal riêng), hoặc cần trang vận hành cho
  manager (nới `run-backup` qua goal riêng — hiện tại R-6 chốt
  owner-only).
