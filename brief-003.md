# OmniFlow — brief GOAL-003: Sản phẩm, giá, CSV

## Bối cảnh (vấn đề)

OmniFlow là hệ thống vận hành thương mại đa kênh cho doanh nghiệp vừa (nhiều
doanh nghiệp, nhiều chi nhánh, nhiều kho, nhiều kênh bán), dự án dài hạn để kiểm
tra APOS ở quy mô lớn. Roadmap: `docs/ROADMAP.md` (12 Goal). Quyết định kiến
trúc: `docs/DECISIONS.md` (D1–D14).

GOAL-003 xây danh mục sản phẩm trên nền GOAL-001 (đã CLOSED) + GOAL-002 (RBAC,
đã CLOSED): sản phẩm + biến thể + SKU + mã vạch, giá theo kênh/chi nhánh +
lịch sử giá, import/export CSV có kiểm tra từng dòng + xem trước. Phụ thuộc:
GOAL-001. Không làm nghiệp vụ kho (GOAL-004), đơn hàng (GOAL-005), thanh toán
(GOAL-006) trong goal này.
Dữ liệu GIẢ LẬP hoàn toàn; không tiền thật, không dịch vụ trả phí.
Dự án chỉ làm LOCAL — không có VPS trong phạm vi (user xác nhận 26/11 21:49).

Đề xuất: size M, appetite 480 phút, 3 lần thử (Human delegate duyệt ở gate A;
đặt dư vì APOS tính wall-clock từ lúc select — bài học DRAK GOAL-002).

Điểm xuất phát (GOAL-001 + GOAL-002, đã khóa — KHÔNG sửa): `src/app.ts`
(Express, EJS, session cookie, middleware `requireRole`/`requireScope`,
route RBAC người dùng/chi nhánh/audit log), `src/rbac.ts` (helper `can()`,
actions hiện tại: invite/lock/unlock/revoke/change-role/change-scope/
change-password-other/list-users/view-audit-log/create-branch),
`src/db.ts` (migration 001–007; chưa có bảng sản phẩm nào),
`src/seed.ts` (1 org, 1 branch, 2 user: owner + sales), `src/tenant.ts`
(middleware scope org/branch), `src/idempotency.ts`, `tests/acceptance.test.ts`
(17 test đã khóa) + `tests/rbac-acceptance.test.ts` (21 test đã khóa —
KHÔNG sửa test cũ, seed phải giữ 2 user để test khóa vẫn xanh),
`scripts/check.sh` (CHK-1) + `scripts/demo.sh` (CHK-2) — goal này MỞ RỘNG
2 script, giữ các bước GOAL-001/GOAL-002 xanh.

## Kết quả mong muốn

Cuối goal, một `owner`/`manager`/`sales` đăng nhập vào hệ thống có thể tạo
sản phẩm có biến thể và SKU không trùng trong org, đặt giá chuẩn và giá riêng
theo kênh/chi nhánh (hệ thống tự fallback về giá chuẩn khi không có giá
riêng), xem được lịch sử mọi lần đổi giá, nhập hàng loạt sản phẩm bằng CSV
(xem trước, báo lỗi từng dòng, một dòng lỗi thì không ghi dòng nào), xuất CSV
đúng dữ liệu hiện tại của org mình — và mọi thao tác đều bị chặn đúng khi sai
vai, sai chi nhánh, hoặc ngoài org, với audit log đầy đủ.

## Quyết định mô hình (Lead/Worker ghi vào DECISIONS.md làm D15, D16)

- **Sản phẩm là dữ liệu cấp org, không gắn chi nhánh.** Bảng `products` có
  `org_id`, KHÔNG có `branch_id`: một sản phẩm bán ở mọi chi nhánh trong org.
  Phạm vi chi nhánh (D13) chỉ áp dụng cho **giá riêng theo chi nhánh**: user
  có `branch_id` chỉ được đặt/xem giá riêng của đúng chi nhánh của mình;
  `owner`/`manager` toàn org (`branch_id NULL`) được mọi chi nhánh. Kiểm tra
  vai + phạm vi vẫn qua helper `can()` mở rộng (xem ma trận ở dưới).
- **Biến thể thuộc sản phẩm cha.** Bảng `product_variants` có `product_id`
  FK tới `products`, mỗi biến thể có SKU riêng; SKU duy nhất trong cùng
  doanh nghiệp: `UNIQUE(org_id, sku)` trên bảng biến thể (kèm `org_id`
  denormalize để ràng buộc đúng phạm vi org). Mã sản phẩm (`products.code`)
  cũng duy nhất trong org: `UNIQUE(org_id, code)`. Trùng SKU/mã → 409 với
  lỗi rõ ràng, KHÔNG ghi đè lặng lẽ, KHÔNG tự sinh mã thay thế.
- **Mã vạch (barcode) optional, duy nhất trong org nếu có.** Cột
  `barcode TEXT NULL` trên biến thể (mã vạch gắn với biến thể cụ thể, không
  gắn với sản phẩm cha); `UNIQUE(org_id, barcode)` — SQLite cho phép nhiều
  NULL nên sản phẩm không có mã vạch vẫn hợp lệ. Trùng mã vạch → 409.
- **Giá lưu số nguyên đồng (D10), không dùng float.** Giá bán chuẩn là cột
  `products.price` (số nguyên đồng, >= 0). Giá riêng theo kênh/chi nhánh ở
  bảng `product_prices` (`product_id`, `variant_id` NULL = áp cho cả sản
  phẩm, `channel` TEXT, `branch_id` NULL = áp cho mọi chi nhánh,
  `price` số nguyên đồng >= 0). Quy tắc fallback khi tính giá bán (ghi vào
  `docs/PRICING.md`): (1) giá riêng của biến thể theo kênh + chi nhánh,
  (2) giá riêng của biến thể theo kênh, (3) giá riêng của biến thể theo chi
  nhánh, (4) giá riêng của sản phẩm theo kênh + chi nhánh, (5) giá riêng
  của sản phẩm theo kênh, (6) giá riêng của sản phẩm theo chi nhánh,
  (7) giá override của biến thể (nếu có), (8) giá bán chuẩn của sản phẩm.
  Không có giá riêng nào → giá chuẩn. Không có "giá âm", không có giá theo
  kênh mà kênh không tồn tại trong danh mục kênh cho phép.
- **Lịch sử giá append-only.** Bảng `price_history` chỉ INSERT, không có
  API UPDATE/DELETE; mỗi lần đổi giá (chuẩn, riêng, override biến thể) ghi
  một dòng: ai đổi, lúc nào (UTC, D10), giá cũ → giá mới, lý do (bắt buộc
  có lý do dạng text, tối thiểu 1 ký tự sau khi trim — đổi giá không lý do
  → 400).
- **CSV import là toàn bộ hoặc không (atomic).** Validate TẤT CẢ các dòng
  trước, báo lỗi TỪNG DÒNG (số dòng + lý do), rồi mới ghi — một dòng lỗi thì
  không ghi dòng nào (transaction rollback). Không fail-fast ở dòng lỗi đầu
  tiên: phải báo hết mọi dòng lỗi trong một lần chạy để người dùng sửa một
  lượt. CSV import chỉ nhập **sản phẩm gốc** (một dòng = một sản phẩm);
  biến thể chỉ tạo qua API, không nhập qua CSV trong goal này.
- **Hình ảnh chỉ lưu metadata/đường dẫn, chưa upload thật.** Bảng
  `product_images` lưu `url`/`path` + `alt_text` + thứ tự hiển thị; KHÔNG
  có endpoint upload file, KHÔNG lưu file nhị phân, KHÔNG resize/CDN.
  Upload thật là follow-up (Goal riêng sau).
- **Danh mục phẳng có cha optional, thuộc tính key/value tự do.** Bảng
  `categories` (`org_id`, `name`, `parent_id` NULL FK tự tham chiếu —
  tối đa 1 cấp cha, không làm cây nhiều cấp); bảng `product_attributes`
  (`product_id`, `key`, `value` TEXT) — key bắt buộc, không giới hạn trước
  danh mục key. Danh mục + thuộc tính đều lọc theo org.

## Ma trận quyền (sản phẩm/giá/CSV — bổ sung vào `docs/RBAC.md`)

Vai: `owner`, `manager`, `sales`, `warehouse`, `accountant` (GOAL-002).
Quy tắc chung (D4): mọi thao tác kiểm tra cả vai VÀ phạm vi; vai sai thao
tác → 403; đúng vai sai phạm vi → 403; ngoài org → 403. Sản phẩm là cấp org
nên phạm vi chi nhánh chỉ gate giá riêng theo chi nhánh (xem quyết định mô
hình ở trên); các thao tác còn lại gate theo org.

| Thao tác | owner | manager | sales | warehouse / accountant |
|---|---|---|---|---|
| Xem/tìm/lọc sản phẩm, biến thể, danh mục (`GET /api/products...`) | Được, toàn org | Được, toàn org | Được, toàn org | Được, toàn org |
| Tạo/sửa sản phẩm, biến thể, thuộc tính, ảnh metadata (`POST/PATCH /api/products...`) | Được | Được | Được | Không (403) |
| Ngừng kinh doanh / mở bán lại (`PATCH /api/products/:id/status`) | Được | Được | Không (403) | Không (403) |
| Tạo/sửa danh mục (`POST/PATCH /api/categories...`) | Được | Được | Không (403) | Không (403) |
| Đổi giá (chuẩn, riêng theo kênh/chi nhánh, override biến thể) | Được | Được | Không (403) | Không (403) |
| Xem giá riêng theo chi nhánh | Được, mọi chi nhánh | Được, mọi chi nhánh | Được, chỉ chi nhánh của mình | Được, chỉ chi nhánh của mình (`accountant` xem để đối soát; `warehouse` xem để biết giá xuất) |
| Xem lịch sử giá (`GET /api/products/:id/price-history`) | Được | Được | Không (403) | Chỉ `accountant` được; `warehouse` không (403) |
| Xem trước CSV (`POST /api/products/import/preview`) | Được | Được | Không (403) | Không (403) |
| Nhập CSV (`POST /api/products/import`) | Được | Được | Không (403) | Không (403) |
| Xuất CSV (`GET /api/products/export`) | Được | Được | Được | Được |
| Xem audit log sản phẩm/giá/CSV | Theo luật xem log GOAL-002 (`owner` toàn org, `manager` trong phạm vi; các vai khác → 403) | — | — | — |

## Yêu cầu

1. Migration 008 tạo bảng `products` (`org_id` NOT NULL FK tới `orgs`,
   `code` TEXT NOT NULL, `name` TEXT NOT NULL, `unit` TEXT NOT NULL
   — đơn vị tính, `price` INTEGER NOT NULL >= 0 — giá bán chuẩn, số nguyên
   đồng theo D10, `min_stock` INTEGER NOT NULL DEFAULT 0 >= 0 — mức tồn tối
   thiểu dùng cho cảnh báo GOAL-004, `status` TEXT NOT NULL DEFAULT
   `'active'` CHECK `('active','discontinued')` — đang bán / ngừng kinh
   doanh, `category_id` NULL FK tới `categories`, `created_at` /
   `updated_at`): `UNIQUE(org_id, code)`; tên bắt buộc (rỗng → 400); giá
   âm hoặc không phải số nguyên → 400; `min_stock` âm → 400. Migration
   chạy tuần tự sau 001–007, giữ dữ liệu cũ, không vỡ 38 test đã khóa.
2. Migration 008 (tiếp) tạo bảng `product_variants` (`org_id` NOT NULL FK,
   `product_id` NOT NULL FK tới `products`, `sku` TEXT NOT NULL, `name`
   TEXT NOT NULL — tên biến thể, ví dụ "Size M / Đỏ", `barcode` TEXT NULL,
   `price_override` INTEGER NULL >= 0 — giá riêng của biến thể, NULL = dùng
   giá sản phẩm cha theo quy tắc fallback): `UNIQUE(org_id, sku)` và
   `UNIQUE(org_id, barcode)`; trùng SKU → 409, trùng barcode → 409, cả hai
   đều có lỗi rõ ràng (nêu rõ SKU/barcode nào trùng), không ghi đè lặng lẽ;
   tạo biến thể cho sản phẩm ngoài org hoặc không tồn tại → 403/404.
   Biến thể không có sản phẩm cha độc lập: xóa sản phẩm cha là không được
   phép trong goal này (chỉ ngừng kinh doanh, xem yêu cầu 4).
3. Migration 008 (tiếp) tạo bảng `categories` (`org_id` NOT NULL FK,
   `name` TEXT NOT NULL, `parent_id` NULL FK tự tham chiếu — tối đa 1 cấp
   cha), bảng `product_attributes` (`product_id` NOT NULL FK, `key` TEXT
   NOT NULL, `value` TEXT NOT NULL — key rỗng → 400), bảng
   `product_images` (`product_id` NOT NULL FK, `url` TEXT NOT NULL — chỉ
   metadata/đường dẫn, `alt_text` TEXT NULL, `sort_order` INTEGER DEFAULT
   0). Tên danh mục bắt buộc; danh mục cha phải cùng org (khác org → 403);
   thuộc tính/ảnh gắn vào sản phẩm ngoài org → 403. Không có endpoint
   upload file thật trong goal này.
4. API CRUD sản phẩm: `POST /api/products` tạo (201, trả sản phẩm đã tạo),
   `GET /api/products` liệt kê (lọc theo org của user, lọc theo
   `status`/`category_id`, tìm theo `code`/`name`, phân trang
   `limit`/`offset`), `GET /api/products/:id` chi tiết (kèm biến thể,
   thuộc tính, ảnh, danh mục), `PATCH /api/products/:id` sửa (tên, giá
   chuẩn, đơn vị, `min_stock`, danh mục). Ngừng kinh doanh:
   `PATCH /api/products/:id/status` `{"status":"discontinued"}` — KHÔNG có
   endpoint DELETE sản phẩm (xóa cứng bị cấm: giữ lịch sử cho GOAL-004/
   GOAL-005); sản phẩm ngừng kinh doanh vẫn đọc được (chi tiết + lịch sử
   giá), vẫn xuất CSV khi lọc đúng trạng thái, nhưng không cho tạo biến thể
   mới và không cho đổi giá mới (→ 400, trừ mở bán lại thành `active`).
   Mọi response không bao giờ lộ dữ liệu org khác.
5. API biến thể + danh mục + thuộc tính + ảnh: `POST
   /api/products/:id/variants` tạo biến thể (201; SKU/barcode trùng → 409),
   `GET /api/products/:id/variants` liệt kê, `PATCH
   /api/products/:id/variants/:variantId` sửa (tên, barcode,
   `price_override`); `POST /api/categories` + `GET /api/categories` +
   `PATCH /api/categories/:id`; `POST /api/products/:id/attributes` +
   `DELETE /api/products/:id/attributes/:attrId` (thuộc tính được xóa —
   chỉ thuộc tính và ảnh metadata được xóa, sản phẩm và biến thể thì
   không); `POST /api/products/:id/images` (chỉ nhận `url` + `alt_text`,
   KHÔNG nhận file upload) + `DELETE /api/products/:id/images/:imageId`.
   Validate: SKU rỗng → 400; barcode trùng → 409; `price_override` âm
   hoặc không phải số nguyên → 400.
6. Giá theo kênh/chi nhánh: bảng `product_prices` (`org_id` NOT NULL FK,
   `product_id` NOT NULL FK, `variant_id` NULL FK — NULL = áp cho cả sản
   phẩm, `channel` TEXT NOT NULL — kênh bán (`counter`/`web`/`api`...,
   chỉ chấp nhận kênh trong danh mục cho phép, kênh lạ → 400),
   `branch_id` NULL FK tới `branches` — NULL = áp cho mọi chi nhánh,
   `price` INTEGER NOT NULL >= 0, `UNIQUE(org_id, product_id, variant_id,
   channel, branch_id)` — một mức giá riêng cho một tổ hợp, ghi đè mức cũ
   bằng lần đổi giá mới có ghi lịch sử chứ không tạo dòng trùng). API:
   `POST /api/products/:id/prices` đặt giá riêng (kèm `reason` bắt buộc),
   `GET /api/products/:id/prices` liệt kê giá riêng,
   `GET /api/products/:id/price?channel=...&branch_id=...&variant_id=...`
   trả giá bán hiệu dụng theo đúng thứ tự fallback 8 bước (ghi trong
   `docs/PRICING.md`, xem quyết định mô hình ở trên) kèm trường
   `source` nêu rõ mức giá nào đã áp dụng (`base`/`variant_override`/
   `channel`/`branch`/`channel_branch`...). Đổi giá chuẩn (`PATCH
   /api/products/:id` đổi `price`) cũng phải kèm `reason` (thiếu → 400)
   và cũng ghi lịch sử.
7. Lịch sử giá append-only: bảng `price_history` (`org_id` NOT NULL FK,
   `product_id` NOT NULL FK, `variant_id` NULL FK, `scope` TEXT — `base`/
   `variant_override`/`channel`/`branch`/`channel_branch`, `channel`
   NULL, `branch_id` NULL, `old_price` INTEGER NULL — NULL = chưa từng có
   giá, `new_price` INTEGER NOT NULL, `changed_by` NOT NULL FK tới
   `users`, `reason` TEXT NOT NULL, `created_at`): mọi lần đổi giá (chuẩn,
   riêng, override biến thể) đều INSERT một dòng; KHÔNG có API
   UPDATE/DELETE lịch sử (gọi sửa/xóa → 404/405); `GET
   /api/products/:id/price-history` trả danh sách mới nhất trước, lọc theo
   org, chỉ vai được phép mới xem (xem ma trận). Đổi giá mà giá mới bằng
   giá cũ thì vẫn ghi lịch sử (ghi rõ không thay đổi giá trị) hay từ chối
   400 — chọn MỘT hành vi và ghi rõ trong `docs/PRICING.md` (khuyến nghị:
   400 "giá mới trùng giá hiện tại" để tránh log rác).
8. CSV import có xem trước + báo lỗi từng dòng: `POST
   /api/products/import/preview` nhận file CSV (multipart `file`,
   `text/csv`, UTF-8) và trả kết quả dry-run KHÔNG ghi dòng nào:
   `{valid: [...], errors: [{line, reason}], summary}` — mỗi dòng lỗi nêu
   rõ số dòng (tính từ dòng dữ liệu đầu tiên, header là dòng 1) + lý do
   (thiếu cột bắt buộc, giá không phải số nguyên >= 0, mã trùng trong file,
   mã trùng DB, trạng thái không hợp lệ...). Cột bắt buộc: `code`, `name`,
   `price`, `unit`; cột optional: `min_stock`, `status`
   (`active`/`discontinued`), `category`, `barcode`. Mã trùng NHAU trong
   cùng file → lỗi cả hai dòng trùng. Header thiếu cột bắt buộc → 400 toàn
   file (không phải lỗi từng dòng).
9. CSV import atomic (toàn bộ hoặc không): `POST /api/products/import`
   nhận cùng định dạng file như preview; validate TẤT CẢ các dòng trước
   (không fail-fast ở dòng lỗi đầu — phải báo hết mọi dòng lỗi trong một
   lần chạy); một dòng lỗi → trả 422 kèm danh sách lỗi từng dòng và KHÔNG
   ghi dòng nào (transaction rollback — test chứng minh số sản phẩm trước
   và sau bằng nhau); không lỗi → ghi tất cả trong một transaction, trả
   201 kèm `{imported: n}`; trùng mã/SKU với DB → lỗi dòng đó (409 không
   dùng ở đây — lỗi import là 422 theo dòng, vì một request có thể lỗi
   nhiều dòng); import ghi audit log một dòng (số lượng, tên file). Import
   giới hạn 1000 dòng/file (vượt → 400) để tránh request quá lớn.
10. CSV export đúng dữ liệu hiện tại: `GET /api/products/export` trả file
    CSV (UTF-8, header đúng các cột import: `code`, `name`, `price`,
    `unit`, `min_stock`, `status`, `category`, `barcode`) của đúng org
    người gọi (lọc theo org, KHÔNG lẫn org khác); hỗ trợ lọc
    `?status=...&category_id=...`; xuất rỗng (org chưa có sản phẩm) vẫn
    trả header + 0 dòng dữ liệu, không lỗi; dữ liệu xuất ra import lại
    được (round-trip: export → import preview không lỗi trùng mã mới —
    preview của file vừa export phải báo trùng mã với DB, chứng minh dữ
    liệu khớp nhau).
11. RBAC sản phẩm/giá/CSV: mở rộng helper `can()` ở `src/rbac.ts` thêm
    actions `create-product`, `update-product`, `discontinue-product`,
    `manage-category`, `change-price`, `view-price-history`,
    `import-csv`, `export-csv` theo đúng ma trận ở trên; mọi endpoint
    sản phẩm/giá/CSV qua `requireRole` + `can()` (vai sai → 403, ngoài
    org → 403, manager/sales/accountant/warehouse xem giá riêng chi nhánh
    khác → 403). Test chứng minh từng ô cấm trong ma trận (ít nhất: sales
    đổi giá → 403, warehouse tạo sản phẩm → 403, sales ngừng kinh doanh →
    403, accountant xem lịch sử giá được nhưng warehouse → 403, sales
    import CSV → 403, user org A đọc/xem/sửa sản phẩm org B → 403).
12. Audit log cho sản phẩm/giá/CSV: ghi vào `audit_log` đã có MỌI thao tác
    tạo/sửa sản phẩm, tạo/sửa biến thể, tạo/sửa danh mục, ngừng kinh doanh/
    mở bán lại, đổi giá (chuẩn/riêng/override), nhập CSV (một dòng log với
    số lượng + tên file); mỗi bản ghi có `user_id` người thực hiện,
    `created_at`, `action` + `detail` JSON (`target_product_id` và
    `before`/`after`, KHÔNG chứa dữ liệu nhạy cảm); xem log theo luật
    GOAL-002 (`GET /api/audit-log`: `owner` toàn org, `manager` trong
    phạm vi, các vai khác → 403).
13. Test mới (vitest + supertest, thêm vào file test mới — KHÔNG sửa 38
    test đã khóa của GOAL-001/GOAL-002): chứng minh SKU trùng trong org →
    409 (và SKU giống nhau ở org khác thì ĐƯỢC — tính duy nhất chỉ trong
    org), barcode trùng trong org → 409, ngừng kinh doanh giữ lại sản phẩm
    + lịch sử giá (đọc lại được, tạo biến thể mới → 400), thứ tự fallback
    giá 8 bước (mỗi bước một case), lịch sử giá append-only (đổi giá 2 lần
    → 2 dòng, không có API sửa/xóa), CSV preview báo lỗi từng dòng mà
    không ghi dòng nào, CSV import atomic (1 dòng lỗi → 0 dòng được ghi;
    file sạch → ghi đủ), export khớp dữ liệu hiện tại + lọc theo org,
    RBAC 403 theo ma trận (yêu cầu 11). Test dùng dữ liệu giả lập (2 org,
    2 chi nhánh trở lên trong cùng org).
14. Dữ liệu GIẢ LẬP hoàn toàn; mật khẩu seed qua biến môi trường (như
    GOAL-001/GOAL-002: `OMNIFLOW_SEED_*_PASSWORD`), không commit
    credential thật; `check.sh` vẫn quét secret (grep như GOAL-001);
    seed mở rộng thêm vài sản phẩm + biến thể + giá mẫu (giữ 2 user để
    test khóa vẫn xanh).
15. `scripts/check.sh` (CHK-1) và `scripts/demo.sh` (CHK-2) được MỞ RỘNG
    trong goal này: thêm bước sản phẩm/giá/CSV vào smoke/demo (tạo sản phẩm
    → tạo biến thể → trùng SKU 409 → đặt giá riêng + kiểm tra fallback →
    xem lịch sử giá → preview CSV có dòng lỗi (không ghi) → import CSV lỗi
    (0 dòng được ghi) → import CSV sạch → export khớp → RBAC 403: sales
    đổi giá, warehouse tạo sản phẩm, ngoài org), giữ tất cả bước
    GOAL-001/GOAL-002 xanh (health, login, owner-only, idempotency,
    backup/restore, RBAC người dùng). Cả 2 script tự chạy được, tự dọn
    dẹp, in PASS/FAIL từng bước.
16. Docs: `docs/RBAC.md` bổ sung ma trận sản phẩm/giá/CSV (bảng ở trên) +
    mô hình phạm vi giá theo chi nhánh; `docs/PRICING.md` mới (quy tắc
    fallback 8 bước + ví dụ từng bước + hành vi đổi giá trùng + lịch sử
    giá append-only); `docs/DECISIONS.md` thêm D15 (mô hình sản phẩm/biến
    thể/SKU/barcode + giá fallback + CSV atomic + sản phẩm cấp org) và D16
    (CSV chỉ nhập sản phẩm gốc, không nhập biến thể; ảnh chỉ metadata,
    chưa upload thật); `README.md`/`docs/SETUP.md` cập nhật endpoint và
    vai mới, khớp lệnh đã chạy thật. Không có file `.github/workflows/`
    trong repo (gh token thiếu scope `workflow` — CI là follow-up sau khi
    user cấp scope). Không claim VPS, không claim deploy production
    (local-only, D9).

## Ngoài phạm vi (thuộc goal sau, không làm trong GOAL-003)

17. Nghiệp vụ kho đa kho (GOAL-004): `min_stock` ở goal này chỉ là trường
    ngưỡng để GOAL-004 dùng cảnh báo tồn thấp; không có số lượng tồn, không
    có bảng `warehouses`, không nhập/xuất/điều chỉnh/kiểm kê/chuyển kho,
    không có tồn giữ/có thể bán.
18. Đơn hàng (GOAL-005), thanh toán/hoàn tiền (GOAL-006), khuyến mãi
    (GOAL-009): giá riêng theo kênh/chi nhánh KHÔNG phải khuyến mãi — không
    mã giảm giá, không chương trình giảm giá theo điều kiện/thời gian, không
    bằng chứng giá tại thời điểm đặt đơn.
19. Upload ảnh thật (lưu file, resize, CDN), đa chi nhánh cho 1 user (bảng
    `user_scopes`), quên mật khẩu / đặt lại mật khẩu qua email, bắt buộc đổi
    mật khẩu lần đầu, đăng nhập SSO/OAuth — là follow-up, không làm trong
    goal này.
20. Deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user
    cấp scope `workflow`).

## Rủi ro / phụ thuộc

- **Phụ thuộc GOAL-001 + GOAL-002:** cần migration 001–007, helper `can()`,
  middleware `requireRole`/`requireScope`, bảng `audit_log` và cơ chế
  session đã chạy. Nếu GOAL-002 chưa close thì không select GOAL-003.
- **Rủi ro UNIQUE + NULL trên SQLite:** `UNIQUE(org_id, barcode)` cho phép
  nhiều NULL (đúng ý), nhưng `UNIQUE(org_id, product_id, variant_id,
  channel, branch_id)` có NULL ở `variant_id`/`branch_id` sẽ KHÔNG chặn
  trùng như kỳ vọng (SQLite coi NULL khác nhau) — Worker phải xử lý bằng
  kiểm tra trùng ở tầng service (SELECT trước khi INSERT trong cùng
  transaction) hoặc partial index; test trùng giá riêng phải chứng minh
  không tạo được 2 dòng cho cùng một tổ hợp.
- **Rủi ro CSV parsing:** dấu phẩy trong tên sản phẩm, dòng trống cuối file,
  BOM UTF-8, xuống dòng trong ô có dấu ngoặc kép — parser phải xử lý đúng
  (dùng thư viện CSV hoặc tự viết có test); test preview phải có case tên
  chứa dấu phẩy và dòng trống.
- **Rủi ro scope giá theo chi nhánh:** sản phẩm là cấp org nhưng giá riêng
  là cấp chi nhánh — dễ nhầm lẫn khi viết `can()` (cho xem giá chi nhánh
  khác) hoặc khi liệt kê giá (trả cả giá chi nhánh khác cho user bị giới
  hạn). Test RBAC phải có case manager/sales/accountant ở chi nhánh A
  không xem được giá riêng chi nhánh B.
- **Rủi ro đổi giá trùng:** quyết định 400 khi giá mới trùng giá hiện tại
  (yêu cầu 7) phải được ghi rõ trong `docs/PRICING.md` và test cả hai chiều
  (đổi giá trùng → 400, đổi giá khác → ghi lịch sử); nếu Lead thấy 400 gây
  khó cho import giá hàng loạt thì đưa về PM sửa brief trước khi code.
