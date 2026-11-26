# OmniFlow — Ma trận quyền RBAC (GOAL-002)

Vai: `owner` (chủ doanh nghiệp), `manager` (quản lý), `sales` (bán hàng),
`warehouse` (kho), `accountant` (kế toán). Mọi thao tác kiểm tra cả **vai**
VÀ **phạm vi**: vai sai thao tác → 403; đúng vai sai phạm vi → 403; ngoài
org → 403. Helper phân quyền ở `src/rbac.ts` (`can()`), middleware
`requireRole`/`requireScope` trong `src/app.ts`.

## Mô hình phạm vi (D13)

Phạm vi = `users.branch_id` nullable + `users.warehouse_id` nullable, KHÔNG
có bảng `user_scopes`. `branch_id NULL` = toàn bộ chi nhánh trong org; có giá
trị = đúng 1 chi nhánh đó. Giới hạn: 1 user tối đa 1 chi nhánh trong GOAL-002
(đa chi nhánh là Goal riêng sau). `warehouse_id` chỉ là trường chuẩn bị
(INTEGER NULL, không FK — bảng `warehouses` là GOAL-004), phạm vi kho chỉ được
kiểm chứng ở mức helper `can()`, chưa có endpoint nghiệp vụ kho.

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
