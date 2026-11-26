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
