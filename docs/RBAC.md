# OmniFlow — Ma trận quyền RBAC (GOAL-002)

Vai: `owner` (chủ doanh nghiệp), `manager` (quản lý), `sales` (bán hàng),
`warehouse` (kho), `accountant` (kế toán). Mọi thao tác kiểm tra cả **vai**
VÀ **phạm vi**: vai sai thao tác → 403; đúng vai sai phạm vi → 403; ngoài
org → 403. Helper phân quyền ở `src/rbac.ts` (`can()`), middleware
`requireRole`/`requireScope` trong `src/app.ts`.

## Mô hình phạm vi (D13, cập nhật GOAL-004)

Phạm vi = `users.branch_id` nullable + `users.warehouse_id` nullable, KHÔNG
có bảng `user_scopes`. `branch_id NULL` = toàn bộ chi nhánh trong org; có giá
trị = đúng 1 chi nhánh đó. Giới hạn: 1 user tối đa 1 chi nhánh trong GOAL-002
(đa chi nhánh là Goal riêng sau). `warehouse_id` từ GOAL-004 đã có ý nghĩa
thật: `NULL` = làm ở mọi kho trong org; có giá trị = chỉ đúng kho đó.
Gán `warehouse_id` qua `PATCH /api/users/:id/scope` được kiểm tra ở tầng
service (D18): kho không tồn tại → 400, kho ngoài org → 403. Kho là cấp org
nên phạm vi chi nhánh KHÔNG gate thao tác kho; phạm vi kho gate bằng
`users.warehouse_id` (xem ma trận kho ở dưới).

- Email duy nhất trong TOÀN hệ thống (D14), giữ `UNIQUE` trên `users.email`.
- `users.status` có 3 giá trị: `active` (mặc định) / `locked` (khóa tạm thời,
  mở lại được) / `revoked` (thu hồi cuối cùng, không mở lại được — muốn vào
  lại phải mời mới). Không DELETE row khi thu hồi, để giữ lịch sử `audit_log`.
- Vai `staff` cũ được remap thành `sales` ở migration 007.
- Khóa/thu hồi vô hiệu session NGAY: xóa mọi session của user đó, và
  `lookupSession` chỉ chấp nhận user đang `active`.
- Mỗi org luôn còn ít nhất 1 `owner` đang `active`: khóa/thu hồi/đổi vai chủ
  duy nhất còn lại → 400. Không được khóa/thu hồi/đổi vai chính mình.

## Ma trận vai × thao tác × phạm vi

| Thao tác | owner | manager | sales / warehouse / accountant |
|---|---|---|---|
| Mời nhân viên (`POST /api/users/invite`) | Được, mọi vai, mọi chi nhánh trong org | Chỉ mời `sales`/`warehouse`/`accountant`, chỉ trong phạm vi của mình | Không (403) |
| Khóa / mở khóa (`POST /api/users/:id/lock`, `/unlock`) | Được, mọi vai (trừ chính mình và chủ duy nhất còn lại) | Chỉ khóa/mở vai cấp dưới trong phạm vi của mình | Không (403) |
| Thu hồi (`POST /api/users/:id/revoke`) | Được, mọi vai (trừ chính mình và chủ duy nhất còn lại) | Chỉ thu hồi vai cấp dưới trong phạm vi của mình | Không (403) |
| Đổi vai người khác (`PATCH /api/users/:id/role`) | Được (chỉ owner) | Không (403) — tránh tự nâng quyền | Không (403) |
| Đổi phạm vi người khác (`PATCH /api/users/:id/scope`) | Được, mọi vai | Chỉ đổi vai cấp dưới, phạm vi mới phải nằm trong phạm vi của mình | Không (403) |
| Đổi mật khẩu người khác (`POST /api/users/:id/change-password`) | Được, mọi vai trong org | Chỉ đổi vai cấp dưới trong phạm vi của mình | Không (403) |
| Đổi mật khẩu của mình (`POST /api/users/change-password`) | Được (mọi vai đang `active`, phải nhập mật khẩu hiện tại) | Được | Được |
| Xem danh sách nhân viên (`GET /api/users`) | Được, toàn org | Được, chỉ user trong phạm vi của mình | Không (403), chỉ xem hồ sơ của mình (`GET /me`) |
| Xem nhật ký (`GET /api/audit-log`, trang `/audit-log`) | Được, toàn org | Được, chỉ bản ghi liên quan user trong phạm vi của mình + bản ghi do mình thực hiện | Không (403) |
| Tạo chi nhánh (`POST /api/branches`) | Được, trong org của mình | Không (403) | Không (403) |
| Nghiệp vụ bán hàng / kho / kế toán | — | — | CHỈ LÀ ĐỊNH HƯỚNG cho GOAL-003/004/005/006: `sales` tạo đơn, `warehouse` nhập/xuất kho, `accountant` xem thanh toán/báo cáo. GOAL-002 KHÔNG làm endpoint nghiệp vụ nên KHÔNG test các ô này qua HTTP |

## Ma trận quyền sản phẩm/giá/CSV (GOAL-003)

Sản phẩm là dữ liệu **cấp org** (D15): bảng `products` có `org_id`, KHÔNG
có `branch_id` — một sản phẩm bán ở mọi chi nhánh trong org. Phạm vi chi
nhánh chỉ gate **giá riêng theo chi nhánh** (xem dưới). Các thao tác còn lại
gate theo org. Helper `can()` mở rộng 8 actions: `create-product`,
`update-product`, `discontinue-product`, `manage-category`, `change-price`,
`view-price-history`, `import-csv`, `export-csv` (+ `view-branch-price`
nội bộ cho việc xem giá riêng từng chi nhánh).

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

### Mô hình phạm vi giá theo chi nhánh

- Giá riêng có `branch_id` NULL áp cho mọi chi nhánh: ai cũng xem được.
- Giá riêng có `branch_id` cụ thể: `owner`/`manager` xem được mọi chi
  nhánh (kể cả khi `users.branch_id` của họ trỏ một chi nhánh — vai chủ/quản
  lý không bị giới hạn chi nhánh khi xem giá); `sales`/`warehouse`/
  `accountant` có `branch_id` chỉ xem được giá đúng chi nhánh của mình —
  hỏi giá chi nhánh khác (`GET /api/products/:id/price?branch_id=...`) →
  **403**, và `GET /api/products/:id/prices` tự lọc bỏ giá chi nhánh khác.
- Đổi giá riêng theo chi nhánh (owner/manager) không bị giới hạn chi nhánh:
  quản lý đặt được giá mọi chi nhánh trong org.

## Ma trận quyền kho / tồn (GOAL-004, D17)

Kho là dữ liệu **cấp org** (D17): một kho phục vụ cả doanh nghiệp,
`branch_id` trên kho chỉ để hiển thị, không gate quyền. Phạm vi kho gate
bằng `users.warehouse_id` (`NULL` = mọi kho trong org). Helper `can()` mở
rộng 11 actions: `create-warehouse`, `manage-warehouse`, `stock-in`,
`stock-out`, `stock-adjust`, `stock-count`, `stock-transfer`, `stock-reserve`,
`stock-release`, `view-stock`, `view-stock-movements`; kiểu `Target` mở rộng
thêm `warehouseId`. Mọi endpoint kho qua `requireAuth` + `can()`.

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

Lưu ý:

- Kho `inactive` vẫn đọc được (chi tiết + lịch sử) nhưng thao tác tồn mới
  → 400. Không có endpoint DELETE kho; không có API sửa/xóa lịch sử biến
  động (gọi → 404).
- Xuất/chuyển/giữ yêu cầu `qty <= available` (`available = on_hand -
  reserved`), vi phạm → 400 `insufficient_stock`, không ghi movement.
  Xuất kho không trừ `reserved` (hàng đã giữ chỉ xuất qua luồng đơn
  GOAL-005). Biến thể của sản phẩm đã ngừng kinh doanh vẫn nhập/xuất được.
- Ngưỡng tồn thấp = `products.min_stock` (cấp sản phẩm), đánh giá theo từng
  cặp (biến thể, kho). Giữ hàng rồi không giải phóng thì `available` thấp
  mãi — hành vi đúng trong goal này (GOAL-005 mới giải phóng khi hủy đơn).
- Idempotency: header `Idempotency-Key` hoặc trường `idempotency_key`
  trong body; tên miền key `stock:<loại thao tác>:<key>`; gửi lại trả đúng
  response cũ kèm `replayed: true`. Thiếu key vẫn thực thi (không bắt buộc)
  nhưng không có bảo vệ gửi lại.

### Endpoints mới (GOAL-004)

| Endpoint | Vai trò |
|---|---|
| `POST /api/warehouses`, `PATCH /api/warehouses/:id` | chỉ owner |
| `GET /api/warehouses`, `GET /api/warehouses/:id` | mọi vai (lọc theo org) |
| `POST /api/stock/in`, `/out`, `/adjust`, `/count`, `/transfer`, `/reserve`, `/release` | owner / manager (mọi kho); warehouse (chỉ kho được gán); sales / accountant → 403 |
| `GET /api/stock/levels` | mọi vai (warehouse chỉ thấy kho được gán) |
| `GET /api/stock/movements`, `GET /api/stock/low-stock` | owner / manager / accountant / warehouse (chỉ kho được gán); sales → 403 |

Audit log: mọi thao tác tạo/sửa kho, nhập/xuất/điều chỉnh/kiểm kê/chuyển/
giữ/giải phóng đều ghi `audit_log` (`action` chứa `stock`/`warehouse` +
`detail` JSON với `target_warehouse_id`, `target_variant_id` và
`before`/`after` có `on_hand`/`reserved`). Xem log theo luật GOAL-002
(`owner` toàn org, `manager` trong phạm vi + do mình làm — với bản ghi
không gắn `target_user_id` thì xét người thực hiện có trong phạm vi chi
nhánh của manager không; các vai khác → 403). `stock_movements` là lịch sử
chi tiết, `audit_log` là lớp ghi nhận thao tác nhạy cảm — cả hai đều phải
có, không thay nhau.

## Ma trận quyền đơn hàng (GOAL-005, D19)

Đơn là dữ liệu **cấp org**, có chi nhánh + kho xuất hàng bắt buộc
(`orders.branch_id`, `orders.warehouse_id` NOT NULL). Phạm vi đơn gate
CẢ hai chiều: chi nhánh của đơn (`branch_id`) và kho của đơn
(`warehouse_id`). Helper `can()` mở rộng 6 actions: `create-order`,
`confirm-order`, `process-order`, `complete-order`, `cancel-order`,
`view-orders`; kiểu `Target` dùng `branchId` + `warehouseId` đã có.
Mọi endpoint đơn qua `requireAuth` + `can()`.

| Thao tác | owner | manager | sales | warehouse | accountant |
|---|---|---|---|---|---|
| Tạo đơn (`POST /api/orders`) | Được | Được | Được (đúng chi nhánh của mình) | Không (403) | Không (403) |
| Xác nhận đơn (`POST /api/orders/:id/confirm`) | Được | Được | Được (đơn thuộc chi nhánh của mình) | Không (403) | Không (403) |
| Xử lý đơn (`POST /api/orders/:id/process`) | Được | Được | Không (403) | Được, chỉ đơn có `warehouse_id` trong phạm vi của mình (`warehouse_id` NULL = mọi kho) | Không (403) |
| Hoàn tất đơn (`POST /api/orders/:id/complete`) | Được | Được | Không (403) | Được, chỉ đơn có `warehouse_id` trong phạm vi của mình | Không (403) |
| Hủy đơn (`POST /api/orders/:id/cancel`) | Được | Được | Được (đơn thuộc chi nhánh của mình) | Không (403) | Không (403) |
| Xem danh sách/chi tiết đơn (`GET /api/orders...`) | Được, toàn org | Được, toàn org | Được, chỉ đơn thuộc chi nhánh của mình | Được, chỉ đơn có `warehouse_id` trong phạm vi của mình | Được, toàn org (chỉ xem) |

Lưu ý:

- `sales` xem đơn ngoài chi nhánh của mình → 403; `warehouse` xem đơn có
  kho ngoài phạm vi → 403; mọi vai xem đơn ngoài org → 403.
- Chi nhánh của đơn lấy từ người tạo: user có `branchId` thì đơn thuộc chi
  nhánh đó (body gửi `branch_id` khác → 403); user toàn org (`branchId`
  NULL, chỉ owner/manager) thì body PHẢI có `branch_id` thuộc org (thiếu
  hoặc ngoài org → 400/403).
- Không có endpoint DELETE đơn (chỉ hủy bằng trạng thái, giữ lịch sử);
  không có API sửa/xóa `order_events` (gọi → 404).
- Idempotency: header `Idempotency-Key` hoặc trường `idempotency_key`
  trong body; tên miền key `order:create:<key>` /
  `order:<hành động>:<key>`; gửi lại trả đúng response cũ kèm
  `replayed: true`. Thiếu key vẫn thực thi (không bắt buộc) nhưng không
  có bảo vệ gửi lại.

### Ma trận thanh toán (GOAL-006)

Payment là dữ liệu cấp org, gắn với đơn; `branch_id` của payment lấy theo
chi nhánh của đơn (không lấy từ body). Phạm vi gate bằng `branchId` +
`warehouseId` của đơn (kiểu `Target` đã có).

| Thao tác | owner | manager | sales | warehouse | accountant |
|---|---|---|---|---|---|
| Ghi nhận thu tiền (`POST /api/orders/:id/payments`) | Được, toàn org | Được, toàn org | Được, chỉ đơn thuộc chi nhánh của mình | Không (403) | Được, toàn org |
| Hoàn tiền (`POST /api/payments/:id/refunds`) | Được, toàn org | Được, toàn org | Không (403) | Không (403) | Được, toàn org |
| Xem thanh toán/đối soát (`GET /api/orders/:id/payments`, `GET /api/payments/:id`) | Được, toàn org | Được, toàn org | Được, chỉ đơn thuộc chi nhánh của mình | Được, chỉ xem đơn có `warehouse_id` trong phạm vi của mình | Được, toàn org |

Ghi chú: `sales` xem payment của đơn ngoài chi nhánh của mình → 403;
`warehouse` không được tạo payment hay hoàn tiền dù đúng kho → 403; mọi
vai xem payment ngoài org → 403. Webhook không qua ma trận này (xác thực
bằng chữ ký giả lập `X-Fake-Signature`, xem D22).

### Endpoints mới (GOAL-006)

| Endpoint | Vai trò |
|---|---|
| `POST /api/orders/:id/payments` | owner / manager / sales (đơn thuộc chi nhánh mình) / accountant; warehouse → 403 |
| `POST /api/payments/:id/refunds` | owner / manager / accountant; sales / warehouse → 403 |
| `GET /api/orders/:id/payments`, `GET /api/payments/:id` | mọi vai, lọc theo phạm vi (sales: chi nhánh mình; warehouse: kho được gán; accountant: toàn org, chỉ xem) |
| `POST /api/payments/webhook` | không qua session — xác thực bằng chữ ký `X-Fake-Signature` (sai/thiếu → 401; thiếu secret môi trường → 503) |

Audit log: mọi thao tác tạo payment, webhook chốt/thất bại, hoàn tiền đều
ghi `audit_log` (`action` `create-payment`/`webhook-paid`/`webhook-failed`/
`refund-payment`, `detail` JSON với `target_payment_id`, `order_id`,
`order_code`, `method`, `amount`, `gateway_reference`, KHÔNG chứa thông
tin thẻ); webhook có `user_id` NULL + `detail` ghi rõ `webhook`. Xem log
theo luật GOAL-002 (`GET /api/audit-log`: `owner` toàn org, `manager`
trong phạm vi, các vai khác → 403). `payment_events` là lịch sử giao dịch
chi tiết (append-only, cũ nhất trước), `audit_log` là lớp ghi nhận thao
tác nhạy cảm — cả hai đều phải có, không thay nhau. Không có endpoint
DELETE payment, không có API sửa/xóa lịch sử giao dịch.

### Ma trận giao hàng + trả hàng (GOAL-007, D24/D25)

Giao hàng/trả hàng là dữ liệu cấp org, gắn với đơn. Phạm vi gate bằng
`branchId` + `warehouseId` của đơn (kiểu `Target` đã có — giống ma trận
đơn/thanh toán). Helper `can()` mở rộng 8 actions:
`request-shipment`, `update-shipment`, `view-shipments`,
`request-return`, `review-return`, `receive-return`, `refund-return`,
`view-returns`. Mọi endpoint giao/trả qua `requireAuth` + `can()`.

| Thao tác | owner | manager | sales | warehouse | accountant |
|---|---|---|---|---|---|
| Yêu cầu giao (`POST /api/orders/:id/shipments`) | Được | Được | Không (403) | Được, chỉ đơn có `warehouse_id` trong phạm vi của mình | Không (403) |
| Cập nhật trạng thái giao (`POST /api/shipments/:id/status`) | Được | Được | Không (403) | Được, chỉ đơn có `warehouse_id` trong phạm vi của mình | Không (403) |
| Xem giao hàng (`GET /api/orders/:id/shipments`, `GET /api/shipments/:id`) | Được, toàn org | Được, toàn org | Được, chỉ đơn thuộc chi nhánh của mình | Được, chỉ đơn có `warehouse_id` trong phạm vi của mình | Được, toàn org (chỉ xem) |
| Yêu cầu trả (`POST /api/orders/:id/returns`) | Được | Được | Được (đơn thuộc chi nhánh của mình) | Không (403) | Không (403) |
| Duyệt/từ chối trả (`POST /api/returns/:id/approve`, `/reject`) | Được | Được | Không (403) | Không (403) | Không (403) |
| Nhận hàng trả (`POST /api/returns/:id/receive`) | Được | Được | Không (403) | Được, chỉ đơn có `warehouse_id` trong phạm vi của mình | Không (403) |
| Hoàn tiền trả hàng (`POST /api/returns/:id/refund`) | Được | Được | Không (403) | Không (403) | Được, toàn org |
| Xem trả hàng (`GET /api/orders/:id/returns`, `GET /api/returns/:id`) | Được, toàn org | Được, toàn org | Được, chỉ đơn thuộc chi nhánh của mình | Được, chỉ đơn có `warehouse_id` trong phạm vi của mình | Được, toàn org (chỉ xem) |

Ghi chú: `sales` xem shipment/return của đơn ngoài chi nhánh của mình →
403; `warehouse` không được yêu cầu trả hay hoàn tiền trả hàng dù đúng kho
→ 403; mọi vai xem shipment/return ngoài org → 403.

### Endpoints mới (GOAL-007)

| Endpoint | Vai trò |
|---|---|
| `POST /api/orders/:id/shipments` | owner / manager / warehouse (đơn có kho trong phạm vi mình); sales / accountant → 403 |
| `POST /api/shipments/:id/status` | owner / manager / warehouse (đơn có kho trong phạm vi mình); sales / accountant → 403 |
| `GET /api/orders/:id/shipments`, `GET /api/shipments/:id` | mọi vai, lọc theo phạm vi (sales: chi nhánh mình; warehouse: kho được gán; accountant: toàn org, chỉ xem) |
| `POST /api/orders/:id/returns` | owner / manager / sales (đơn thuộc chi nhánh mình); warehouse / accountant → 403 |
| `POST /api/returns/:id/approve`, `/reject` | owner / manager; sales / warehouse / accountant → 403 |
| `POST /api/returns/:id/receive` | owner / manager / warehouse (đơn có kho trong phạm vi mình); sales / accountant → 403 |
| `POST /api/returns/:id/refund` | owner / manager / accountant; sales / warehouse → 403 |
| `GET /api/orders/:id/returns`, `GET /api/returns/:id` | mọi vai, lọc theo phạm vi (sales: chi nhánh mình; warehouse: kho được gán; accountant: toàn org, chỉ xem) |

Audit log: mọi thao tác yêu cầu giao, cập nhật trạng thái giao, yêu cầu
trả, duyệt/từ chối, nhận hàng, hoàn tiền trả hàng đều ghi `audit_log`
(`action` `create-shipment`/`update-shipment`/`create-return`/
`review-return`/`receive-return`/`refund-return`, `detail` JSON với
`target_order_id`, `order_code`, `target_shipment_id`/
`target_return_id`, `tracking_code`/`return_code`, `from_status`/
`to_status`, KHÔNG chứa dữ liệu nhạy cảm, KHÔNG chứa thông tin thẻ).
Xem log theo luật GOAL-002. `shipment_events`/`return_events` là lịch sử
chi tiết (append-only, cũ nhất trước), `audit_log` là lớp ghi nhận thao
tác nhạy cảm — cả hai đều phải có, không thay nhau. Không có endpoint
DELETE shipment/return, không có API sửa/xóa lịch sử giao/trả (gọi →
404). Idempotency: header `Idempotency-Key` hoặc `idempotency_key`
trong body; tên miền key `shipment:create:<key>` /
`shipment:update:<key>` / `return:create:<key>` /
`return:review:<key>` / `return:receive:<key>` /
`return:refund:<key>`; gửi lại trả đúng response cũ kèm
`replayed: true`.

### Ma trận quyền khách hàng + CRM (GOAL-008, D26)

Khách hàng là dữ liệu cấp org, có chi nhánh chính `branch_id` NULL = chưa
gán. Phạm vi gate bằng `branchId` của khách (kiểu `Target` đã có). Helper
`can()` mở rộng 9 actions: `create-customer`, `update-customer`,
`view-customers`, `earn-points`, `redeem-points`, `add-note`,
`merge-customers`, `export-customer`, `delete-customer` (xóa là action
riêng chỉ `owner`/`manager`). Mọi endpoint khách qua `requireRole` +
`can()`.

| Thao tác | owner | manager | sales | warehouse | accountant |
|---|---|---|---|---|---|
| Tạo khách (`POST /api/customers`) | Được | Được | Được (khách mới thuộc chi nhánh của mình; gửi `branch_id` khác → 403; không gửi `branch_id` thì khách thuộc chi nhánh mình) | Không (403) | Không (403) |
| Sửa khách (`PATCH /api/customers/:id`) | Được | Được | Được (khách thuộc chi nhánh của mình) | Không (403) | Không (403) |
| Xem/tìm khách (`GET /api/customers...`, `GET /api/customers/:id`, `GET /api/customers/:id/orders`, `GET /api/customers/:id/points`, `GET /api/customers/:id/notes`) | Được, toàn org | Được, toàn org | Được, chỉ khách thuộc chi nhánh của mình | Được, toàn org (chỉ xem, để tra khách khi giao/nhận hàng) | Được, toàn org (chỉ xem) |
| Tích điểm (`POST /api/customers/:id/points/earn`) | Được | Được | Được (khách thuộc chi nhánh của mình) | Không (403) | Không (403) |
| Đổi điểm (`POST /api/customers/:id/points/redeem`) | Được | Được | Được (khách thuộc chi nhánh của mình) | Không (403) | Không (403) |
| Ghi chú (`POST /api/customers/:id/notes`) | Được | Được | Được (khách thuộc chi nhánh của mình) | Không ghi (403); xem được toàn org (chỉ xem) | Không ghi (403); xem được toàn org (chỉ xem) |
| Hợp nhất (`POST /api/customers/:id/merge`) | Được | Được | Không (403) | Không (403) | Không (403) |
| Xuất dữ liệu (`GET /api/customers/:id/export`) | Được, toàn org | Được, toàn org | Được, chỉ khách thuộc chi nhánh của mình | Không (403) | Được, toàn org |
| Xóa khách (`DELETE /api/customers/:id`) | Được (chỉ khách chưa có đơn) | Được (chỉ khách chưa có đơn) | Không (403) | Không (403) | Không (403) |

Ghi chú: `sales` xem/tích/đổi/ghi chú khách ngoài chi nhánh của mình →
403; khách chưa gán chi nhánh (`branch_id` NULL) thì `sales` không thấy
(403 khi gọi trực tiếp, bị lọc khỏi danh sách); mọi vai xem khách ngoài
org → 403. Xem lịch sử điểm (`GET /api/customers/:id/points`) và ghi chú
theo luật xem khách (cùng action `view-customers`).

### Endpoints mới (GOAL-008)

| Endpoint | Vai trò |
|---|---|
| `POST /api/customers` | owner / manager / sales (khách mới thuộc chi nhánh mình); warehouse / accountant → 403 |
| `PATCH /api/customers/:id` | owner / manager / sales (khách thuộc chi nhánh mình); warehouse / accountant → 403 |
| `GET /api/customers`, `GET /api/customers/:id`, `GET /api/customers/:id/orders`, `GET /api/customers/:id/points`, `GET /api/customers/:id/notes` | mọi vai, lọc theo phạm vi (sales: chỉ chi nhánh mình, không thấy khách chưa gán; warehouse/accountant: toàn org, chỉ xem) |
| `POST /api/customers/:id/points/earn`, `POST /api/customers/:id/points/redeem` | owner / manager / sales (khách thuộc chi nhánh mình); warehouse / accountant → 403 |
| `POST /api/customers/:id/notes` | owner / manager / sales (khách thuộc chi nhánh mình); warehouse / accountant → 403 |
| `POST /api/customers/:id/merge` | owner / manager; sales / warehouse / accountant → 403 |
| `GET /api/customers/:id/export` | owner / manager / accountant toàn org, sales chỉ chi nhánh mình; warehouse → 403 |
| `DELETE /api/customers/:id` | owner / manager (chỉ khách chưa có đơn); sales / warehouse / accountant → 403 |

Audit log: mọi thao tác tạo/sửa khách, tích/đổi điểm, ghi chú, hợp nhất,
xuất dữ liệu, xóa khách đều ghi `audit_log` (`action`
`create-customer`/`update-customer`/`earn-points`/`redeem-points`/
`add-note`/`merge-customers`/`export-customer`/`delete-customer`,
`detail` JSON với `target_customer_id`, `target_order_id` khi có,
`points` khi tích/đổi, `source_customer_id` khi hợp nhất, KHÔNG chứa
`phone`/`email`/`address`, KHÔNG chứa thông tin thẻ). Xem log theo luật
GOAL-002. `customer_points`/`customer_notes` là lịch sử chi tiết
(append-only), `audit_log` là lớp ghi nhận thao tác nhạy cảm — cả hai
đều phải có, không thay nhau. Không có API sửa/xóa ghi chú hay ledger
(gọi → 404). Idempotency: header `Idempotency-Key` hoặc
`idempotency_key` trong body; tên miền key
`customer:points-earn:<key>` / `customer:points-redeem:<key>` /
`customer:merge:<key>` (thêm `customer:create:<key>` cho tạo khách và
`customer:note-create:<key>` cho ghi chú); gửi lại trả đúng response cũ
kèm `replayed: true`.

### Ma trận quyền khuyến mãi (GOAL-009, D27)

Mã giảm giá là dữ liệu cấp org; phạm vi gate bằng `branch_id` của mã
(`NULL` = mọi chi nhánh) khi xem, và bằng `branch_id` của đơn khi áp mã.
Helper `can()` mở rộng 4 actions: `create-promotion`,
`update-promotion`, `apply-promotion`, `view-promotions`. Mọi endpoint
khuyến mãi qua `requireRole` + `can()`.

| Thao tác | owner | manager | sales | warehouse | accountant |
|---|---|---|---|---|---|
| Tạo mã (`POST /api/promotions`) | Được | Được | Không (403) | Không (403) | Không (403) |
| Sửa/khóa/mở mã (`PATCH /api/promotions/:id`) | Được | Được | Không (403) | Không (403) | Không (403) |
| Áp mã (`POST /api/orders/:id/promotion`) | Được, toàn org | Được, toàn org | Được, chỉ đơn thuộc chi nhánh mình | Không (403) | Không (403) |
| Xem mã (`GET /api/promotions`, `GET /api/promotions/:id`) | Được, toàn org | Được, toàn org | Được, chỉ mã `branch_id` NULL (mọi chi nhánh) hoặc đúng chi nhánh mình | Không (403) | Được, toàn org |

Ghi chú: `sales` xem mã giới hạn chi nhánh khác → 403; `sales` áp mã cho
đơn ngoài chi nhánh → 403; mọi vai xem/áp mã ngoài org → 403. Lọc danh
sách theo `branch_id` khớp chính xác: mã `branch_id` NULL không xuất
hiện khi lọc theo một chi nhánh cụ thể.

### Endpoints mới (GOAL-009)

| Endpoint | Vai trò |
|---|---|
| `POST /api/promotions` | owner / manager; sales / warehouse / accountant → 403 |
| `PATCH /api/promotions/:id` | owner / manager; sales / warehouse / accountant → 403 |
| `GET /api/promotions`, `GET /api/promotions/:id` | owner / manager / accountant toàn org, sales chỉ mã `branch_id` NULL hoặc đúng chi nhánh mình; warehouse → 403 |
| `POST /api/orders/:id/promotion` | owner / manager toàn org, sales chỉ đơn thuộc chi nhánh mình; warehouse / accountant → 403 |

### Ma trận quyền báo cáo + đối soát (GOAL-010, D28)

Báo cáo là dữ liệu chỉ đọc, tính ở service từ các bảng đã có (không
bảng tổng riêng, không migration 015). Helper `can()` mở rộng 2
actions: `view-reports` (xem báo cáo JSON) và `export-reports` (xuất
CSV). Mọi endpoint báo cáo qua `requireRole` + `can()`; ngoài ra route
gate thêm theo loại báo cáo (warehouse chỉ báo cáo tồn, sales không xem
báo cáo tồn) và theo org triển khai (user thuộc org khác đọc báo cáo
mặc định → 403).

| Thao tác | owner | manager | sales | warehouse | accountant |
|---|---|---|---|---|---|
| Xem doanh thu / đối soát / khuyến mãi / điểm (`GET /api/reports/revenue`, `/reconciliation`, `/promotions`, `/points`) | Được, toàn org | Được, toàn org | Được, chỉ chi nhánh mình (không có `branch_id` thì mặc định lọc chi nhánh mình; `branch_id` khác → 403) | Không (403) | Được, toàn org (chỉ xem) |
| Xem tồn kho (`GET /api/reports/stock`) | Được, toàn org | Được, toàn org | Không (403) | Được, chỉ kho được gán (`warehouse_id` NULL = mọi kho; hỏi kho ngoài phạm vi → 403) | Được, toàn org (chỉ xem) |
| Xuất CSV các báo cáo trên (`?format=csv`) | Được, toàn org | Được, toàn org | Được, đúng phạm vi xem của mình | Được, chỉ báo cáo tồn kho trong phạm vi | Được, toàn org |

Ghi chú: `sales` xem doanh thu chi nhánh khác → 403; `sales` xem báo
cáo tồn → 403; `warehouse` xem doanh thu/đối soát/khuyến mãi/điểm →
403; `warehouse` xem tồn kho ngoài phạm vi → 403; user org A đọc báo
cáo org B → 403 (hỏi `branch_id`/`warehouse_id`/`variant_id` thuộc org
khác → 403; gọi báo cáo mặc định khi thuộc org khác → 403); lọc theo
kho/biến thể không tồn tại → 404; `format` lạ → 400.

### Endpoints mới (GOAL-010)

| Endpoint | Vai trò |
|---|---|
| `GET /api/reports/revenue?from=&to=&channel=&branch_id=&group_by=` | owner / manager / accountant toàn org, sales chỉ chi nhánh mình; warehouse → 403 |
| `GET /api/reports/stock?warehouse_id=&variant_id=&from=&to=` | owner / manager / accountant toàn org, warehouse chỉ kho được gán; sales → 403 |
| `GET /api/reports/reconciliation?from=&to=&branch_id=` | owner / manager / accountant toàn org, sales chỉ chi nhánh mình; warehouse → 403 |
| `GET /api/reports/promotions?from=&to=&code=` | owner / manager / accountant toàn org, sales chỉ chi nhánh mình; warehouse → 403 |
| `GET /api/reports/points?from=&to=` | owner / manager / accountant toàn org, sales chỉ chi nhánh mình; warehouse → 403 |
| Mọi endpoint trên + `?format=csv` | cùng phạm vi xem như JSON; xuất CSV ghi audit log `export-report` |

Audit log: CHỈ xuất CSV mới ghi `audit_log` (action `export-report`,
`detail` JSON `{report, from, to, format: 'csv', filter đã dùng:
channel/branch_id/warehouse_id/variant_id/code/group_by khi có}`,
KHÔNG chứa thông tin thẻ, KHÔNG chứa PII khách — chỉ id + số liệu);
xem báo cáo JSON không ghi audit (tránh nhiễu log). Xem log theo luật
GOAL-002 (`GET /api/audit-log`: owner toàn org, manager trong phạm vi,
các vai khác → 403). Không có API sửa/xóa báo cáo (báo cáo chỉ đọc, gọi
POST/DELETE → 404); không thêm màn hình báo cáo (GOAL-012).

### Ma trận quyền thông báo + job (GOAL-011, D29)

Thông báo/job là dữ liệu cấp org, lọc theo vai + phạm vi suy từ
`event_key` (`deriveEventScope`/`deriveJobOrg`, D29): mã đơn → chi
nhánh/kho của đơn; `stock.low` → kho trong event_key;
`promotion.expiring` → org của mã. Bảng `jobs` không có `org_id`,
bảng `notifications` không có `branch_id`/`warehouse_id` nên phạm vi
được suy ra, không thêm cột. Helper `can()` mở rộng 4 actions:
`view-notifications` (xem thông báo), `manage-notification-preferences`
(xem/sửa cài đặt nhận), `view-jobs` (xem job), `run-jobs` (chạy job tay
+ retry). Mọi endpoint thông báo/job qua `requireAuth` + `can()`; ngoài
org → 403.

| Thao tác | owner | manager | sales | warehouse | accountant |
|---|---|---|---|---|---|
| Xem thông báo (`GET /api/notifications`, `GET /api/notifications/:id`) | Được, toàn org | Được, toàn org | Được, chỉ thông báo thuộc chi nhánh mình (thông báo không gắn chi nhánh thì không thấy) | Được, chỉ thông báo `stock.low` của kho được gán | Được, chỉ thông báo payment/refund toàn org (chỉ xem) |
| Xem/sửa cài đặt nhận (`GET/PATCH /api/notification-preferences`) | Được, của mình + user trong org | Được, của mình + user trong org | Được, chỉ của mình (sửa của người khác → 403) | Được, chỉ của mình (sửa của người khác → 403) | Được, chỉ của mình (sửa của người khác → 403) |
| Xem job (`GET /api/jobs`, `GET /api/jobs/:id`) | Được, toàn org (+ job scan global) | Được, toàn org (+ job scan global) | Không (403) | Được, chỉ job `low-stock-scan` | Không (403) |
| Chạy job tay + retry (`POST /api/jobs/run`, `POST /api/jobs/:id/retry`) | Được | Được | Không (403) | Không (403) | Không (403) |

Ghi chú: `sales` xem thông báo chi nhánh khác → 403; `sales` xem job
→ 403; `warehouse` xem thông báo không phải tồn kho → 403;
`warehouse` chạy job → 403; `accountant` chạy job → 403; user org A
đọc thông báo/job org B → 403; job chưa `failed` mà retry → 400;
`event_type`/`status`/`type` lạ → 400.

### Endpoints mới (GOAL-011)

| Endpoint | Vai trò |
|---|---|
| `GET /api/notification-preferences?user_id=` | tự xem của mình; owner/manager xem cho user trong org; vai khác xem của người khác → 403 |
| `PATCH /api/notification-preferences` | như trên; `event_type` lạ → 400, `enabled` không phải boolean → 400 |
| `GET /api/notifications?event_type=&status=&from=&to=` | owner/manager toàn org; sales chỉ chi nhánh mình; warehouse chỉ `stock.low` kho được gán; accountant chỉ payment/refund |
| `GET /api/notifications/:id` | như trên theo từng bản ghi; ngoài org → 403 |
| `GET /api/jobs?status=&type=`, `GET /api/jobs/:id` | owner/manager toàn org; warehouse chỉ job `low-stock-scan`; sales/accountant → 403 |
| `POST /api/jobs/run` | owner/manager; trả `{processed, done, failed}` |
| `POST /api/jobs/:id/retry` | owner/manager; failed → pending (attempts 0, `next_run_at` = now, `last_error` NULL) + audit `job-retried`; chưa failed → 400 |

Audit log: CHỈ thất bại cuối + retry tay mới ghi `audit_log` — gửi
thất bại cuối (`notification-failed`, `detail` `{event_key,
event_type, recipient_user_id (nếu có), error}` — KHÔNG nội dung
email, KHÔNG email khách), job failed cuối (`job-failed`, `detail`
`{job_id, job_type, last_error}`), retry tay (`job-retried`, `detail`
`{job_id, job_type}`). Gửi thành công KHÔNG ghi audit (lịch sử gửi đã
có bảng `notifications`). Xem log theo luật GOAL-002. Không thêm màn
hình thông báo/job (GOAL-012); email chỉ qua `FakeEmailAdapter`
(`simulated: true`), không gửi email thật.

### Ma trận quyền dashboard + vận hành (GOAL-012, D30)

Dashboard/vận hành là dữ liệu cấp org, lọc theo vai + phạm vi chi
nhánh/kho. Helper `can()` mở rộng 3 actions: `view-dashboard` (xem
dashboard + các màn hình tổng quan giao/trả, khách/điểm, thông báo/job),
`view-ops` (xem trang vận hành), `run-backup` (chạy backup/restore).
Mọi endpoint qua `requireAuth` + `can()`; ngoài org → 403.
`?branch_id=` trên `/dashboard` theo mẫu `branch_id` của API báo
cáo/đơn: chi nhánh không tồn tại → 404, ngoài org → 403, sales xin
chi nhánh khác → 403.

| Thao tác | owner | manager | sales | warehouse | accountant |
|---|---|---|---|---|---|
| Xem dashboard (`GET /dashboard`, `?branch_id=` tùy chọn) | Được, toàn org | Được, toàn org | Được, chỉ chi nhánh mình (không `branch_id` → mặc định chi nhánh mình; xin chi nhánh khác/toàn org → 403) | Không (403 — không xem dashboard doanh thu) | Được, toàn org (chỉ xem) |
| Màn hình giao/trả (`GET /dashboard/shipments`) | Được, toàn org | Được, toàn org | Được, chỉ đơn thuộc chi nhánh mình | Được, chỉ đơn thuộc kho được gán | Được, toàn org (chỉ xem) |
| Màn hình khách/điểm (`GET /dashboard/customers`) | Được, toàn org | Được, toàn org | Được, chỉ khách thuộc chi nhánh mình | Không (403) | Được, toàn org (chỉ xem) |
| Màn hình thông báo/job (`GET /dashboard/notifications`) | Được, toàn org | Được, toàn org | Được, chỉ thông báo chi nhánh mình (job → không hiện) | Được, chỉ thông báo `stock.low` kho được gán + job `low-stock-scan` | Được, chỉ thông báo payment/refund (job → không hiện) |
| Xem trang vận hành (`GET /ops/backup`) | Được | Không (403) | Không (403) | Không (403) | Không (403) |
| Chạy backup/restore (`POST /api/ops/backup`, `POST /api/ops/restore`) | Được | Không (403) | Không (403) | Không (403) | Không (403) |

Ghi chú: backup/restore là OWNER-ONLY theo R-6 — R-6 ghi đè dòng tổng
quát "owner/manager … chạy backup/restore" của R-10 cho riêng tính
năng backup (xem D30). `can(manager, 'view-ops') = true` theo ma
trận, nhưng trang `/ops/backup` gate bằng `run-backup` (owner-only),
KHÔNG dùng `view-ops` cho trang này. `can(manager, 'run-backup')`
= false. Restore yêu cầu `confirm: true` (thiếu/sai → 400), file
không tồn tại → 404, file ngoài thư mục backup → 400.

### Endpoints mới (GOAL-012)

| Endpoint | Vai trò |
|---|---|
| `GET /dashboard` | owner/manager/accountant toàn org; sales chỉ chi nhánh mình; warehouse → 403 |
| `GET /dashboard/shipments` | owner/manager/accountant toàn org; sales chỉ chi nhánh mình; warehouse chỉ kho được gán |
| `GET /dashboard/customers` | owner/manager/accountant toàn org; sales chỉ chi nhánh mình; warehouse → 403 |
| `GET /dashboard/notifications` | owner/manager/accountant toàn org; sales chỉ chi nhánh mình; warehouse chỉ `stock.low` + job `low-stock-scan` |
| `GET /health` | không cần đăng nhập; trả `{status, db, version, uptime_seconds}`; DB lỗi → 503 |
| `GET /ops/backup` | chỉ owner |
| `POST /api/ops/backup` | chỉ owner; trả `{file, size, created_at}` |
| `POST /api/ops/restore` | chỉ owner; body `{file, confirm: true}`; thiếu/sai confirm → 400, file không tồn tại → 404, file ngoài thư mục backup → 400 |
| `GET /audit-log?actor=&action=&from=&to=&page=&limit=` | owner/manager; lọc sai giá trị → 400; mặc định page 1, limit 20, tối đa 100 |

Audit log: backup/restore ghi `audit_log` (`create-backup` /
`restore-backup`, `detail` JSON với `file` (+ `size` khi tạo).
Xem log theo luật GOAL-002 + lọc/phân trang GOAL-012.

Audit log: mọi thao tác tạo/sửa/khóa mã, áp mã, hoàn lượt dùng khi hủy
đơn đều ghi `audit_log` (`action` `create-promotion` /
`update-promotion` / `apply-promotion` / `promotion-usage-released`,
`detail` JSON với `target_promotion_id`, `promotion_code`,
`target_order_id`/`order_code` khi áp mã hoặc hoàn lượt, `discount` khi
áp mã, KHÔNG chứa thông tin thẻ). Xem log theo luật GOAL-002.
`promotion_usages` là lịch sử dùng mã chi tiết (append-only),
`audit_log` là lớp ghi nhận thao tác nhạy cảm — cả hai đều phải có,
không thay nhau. Không có API sửa/xóa usage (gọi → 404); không có
endpoint gỡ mã khỏi đơn (muốn đổi mã thì hủy đơn rồi tạo đơn mới).
Idempotency: header `Idempotency-Key` hoặc `idempotency_key` trong body;
tên miền key `promotion:create:<key>` / `promotion:apply:<key>`; gửi lại
trả đúng response cũ kèm `replayed: true`, không tạo mã/usage mới.

### Endpoints mới (GOAL-005)

| Endpoint | Vai trò |
|---|---|
| `POST /api/orders` | owner / manager / sales (đúng chi nhánh); warehouse / accountant → 403 |
| `GET /api/orders`, `GET /api/orders/:id` | mọi vai, lọc theo phạm vi (sales: chi nhánh mình; warehouse: kho được gán; accountant: toàn org, chỉ xem) |
| `POST /api/orders/:id/confirm`, `/cancel` | owner / manager / sales (đơn thuộc chi nhánh mình); warehouse / accountant → 403 |
| `POST /api/orders/:id/process`, `/complete` | owner / manager / warehouse (đơn có kho trong phạm vi mình); sales / accountant → 403 |

Audit log: mọi thao tác tạo đơn, xác nhận/xử lý/hoàn tất/hủy đều ghi
`audit_log` (`action` `create-order`/`confirm-order`/`process-order`/
`complete-order`/`cancel-order`, `detail` JSON với `target_order_id`,
`order_code`, `from_status`/`to_status`, `total`). Xem log theo luật
GOAL-002 (`GET /api/audit-log`: `owner` toàn org, `manager` trong phạm
vi, các vai khác → 403). `order_events` là lịch sử trạng thái chi tiết,
`audit_log` là lớp ghi nhận thao tác nhạy cảm — cả hai đều phải có,
không thay nhau.

### Endpoints mới (GOAL-003)

| Endpoint | Vai trò |
|---|---|
| `POST /api/products`, `PATCH /api/products/:id` | owner / manager / sales |
| `GET /api/products`, `GET /api/products/:id` | mọi vai (lọc theo org) |
| `PATCH /api/products/:id/status` | owner / manager |
| `POST /api/products/:id/variants`, `GET /api/products/:id/variants`, `PATCH /api/products/:id/variants/:variantId` | tạo/sửa: owner / manager / sales; xem: mọi vai |
| `POST /api/categories`, `GET /api/categories`, `PATCH /api/categories/:id` | tạo/sửa: owner / manager; xem: mọi vai |
| `POST /api/products/:id/attributes`, `DELETE /api/products/:id/attributes/:attrId` | owner / manager / sales |
| `POST /api/products/:id/images`, `DELETE /api/products/:id/images/:imageId` | owner / manager / sales (chỉ metadata `url` + `alt_text`, không upload file) |
| `POST /api/products/:id/prices`, `GET /api/products/:id/prices`, `GET /api/products/:id/price` | đổi giá: owner / manager; xem: mọi vai (giá riêng lọc theo chi nhánh) |
| `GET /api/products/:id/price-history` | owner / manager / accountant |
| `POST /api/products/import/preview`, `POST /api/products/import` | owner / manager |
| `GET /api/products/export` | mọi vai |

Audit log: mọi thao tác tạo/sửa sản phẩm, tạo/sửa biến thể, tạo/sửa danh
mục, ngừng kinh doanh/mở bán lại, đổi giá, nhập CSV đều ghi `audit_log`
(`action` + `detail` JSON với `target_product_id` và `before`/`after`).

## Tài khoản bị khóa / thu hồi

- `POST /login` với tài khoản bị khóa → **403** `{"error":"Tài khoản đang bị khóa","code":"account_locked"}`, phân biệt với sai mật khẩu → **401**.
- Tài khoản bị thu hồi đăng nhập → **403** `{"error":"Tài khoản đã bị thu hồi","code":"account_revoked"}`.
- Session đang chạy của tài khoản bị khóa/thu hồi bị vô hiệu ngay: gọi API
  cũ → **401** (session không còn hợp lệ).

## Audit log

Mọi thao tác mời, khóa, mở khóa, thu hồi, đổi vai, đổi phạm vi, đổi mật khẩu
(người khác và của mình), tạo chi nhánh đều ghi `audit_log`: ai làm
(`user_id`), lúc nào (`created_at`), thay đổi gì (`action` + `detail` JSON
với `target_user_id` và `before`/`after`). KHÔNG ghi mật khẩu/hash vào log,
không trả mật khẩu trong response.

## Ví dụ request/response

Mời nhân viên (owner, cookie session):

```http
POST /api/users/invite
Content-Type: application/json

{"email":"sales-moi@example.local","password":"<mat-khau-ban-dau>","role":"sales","branch_id":1}
```

```http
HTTP/1.1 201 Created

{"user":{"id":3,"org_id":1,"branch_id":1,"warehouse_id":null,"email":"sales-moi@example.local","role":"sales","status":"active","created_at":"..."}}
```

Manager mời `owner` → `403`; email trùng → `409`; chi nhánh ngoài org → `403`.

Khóa nhân viên:

```http
POST /api/users/3/lock
```

```http
HTTP/1.1 200 OK

{"user":{"id":3,"org_id":1,"branch_id":1,"warehouse_id":null,"email":"sales-moi@example.local","role":"sales","status":"locked","created_at":"..."}}
```

Thu hồi: `POST /api/users/3/revoke` → `status` thành `revoked`; mở lại
`revoked` bằng `/unlock` → `400`. Đổi vai: `PATCH /api/users/3/role`
`{"role":"warehouse"}` (chỉ owner). Đổi phạm vi:
`PATCH /api/users/3/scope` `{"branch_id":2}`. Đổi mật khẩu người khác:
`POST /api/users/3/change-password` `{"newPassword":"..."}`. Đổi mật khẩu
của mình: `POST /api/users/change-password`
`{"currentPassword":"...","newPassword":"..."}`.

Xem nhật ký (owner thấy toàn org):

```http
GET /api/audit-log
```

```json
[{"id":1,"org_id":1,"user_id":1,"action":"invite","detail":"{\"target_user_id\":3,\"before\":null,\"after\":{\"email\":\"sales-moi@example.local\",\"role\":\"sales\",\"branch_id\":1,\"warehouse_id\":null,\"status\":\"active\"}}","created_at":"..."}]
```

Trang xem log: `GET /audit-log` (EJS, owner/manager; vai khác → 403).

## Endpoints mới (GOAL-002)

| Endpoint | Vai trò |
|---|---|
| `POST /api/users/invite` | owner / manager (theo ma trận) |
| `POST /api/users/:id/lock`, `/unlock`, `/revoke` | owner / manager (theo ma trận) |
| `PATCH /api/users/:id/role` | chỉ owner |
| `PATCH /api/users/:id/scope` | owner / manager (theo ma trận) |
| `POST /api/users/:id/change-password` | owner / manager (theo ma trận) |
| `POST /api/users/change-password` | mọi vai `active` (nhập mật khẩu hiện tại) |
| `GET /api/users` | owner toàn org, manager trong phạm vi |
| `POST /api/branches` | chỉ owner |
| `GET /api/audit-log`, `GET /audit-log` | owner toàn org, manager trong phạm vi |
