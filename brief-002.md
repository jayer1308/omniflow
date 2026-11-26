# OmniFlow — brief GOAL-002: Doanh nghiệp, chi nhánh, người dùng + RBAC

## Bối cảnh

OmniFlow là hệ thống vận hành thương mại đa kênh cho doanh nghiệp vừa (nhiều
doanh nghiệp, nhiều chi nhánh, nhiều kho, nhiều kênh bán), dự án dài hạn để kiểm
tra APOS ở quy mô lớn. Roadmap: `docs/ROADMAP.md` (12 Goal). Quyết định kiến
trúc: `docs/DECISIONS.md` (D1–D12).

GOAL-002 xây RBAC trên nền GOAL-001 (đã CLOSED): 5 vai, mời/khóa/thu hồi nhân
viên, phân quyền theo thao tác + phạm vi chi nhánh/kho, nhật ký thao tác nhạy
cảm, test truy cập ngoài phạm vi. Phụ thuộc: GOAL-001. Không làm nghiệp vụ sản
phẩm/kho/đơn trong goal này (GOAL-003/004/005).
Dữ liệu GIẢ LẬP hoàn toàn; không tiền thật, không dịch vụ trả phí.
Dự án chỉ làm LOCAL — không có VPS trong phạm vi (user xác nhận 26/11 21:49).

Đề xuất: size M, appetite 480 phút, 3 lần thử (Human delegate duyệt ở gate A;
đặt dư vì APOS tính wall-clock từ lúc select — bài học DRAK GOAL-002).

Điểm xuất phát (GOAL-001, đã khóa — KHÔNG sửa): `src/app.ts` (session + route
`owner-only`), `src/auth.ts` (`lookupSession` chưa kiểm tra trạng thái khóa),
`src/tenant.ts` (middleware scope org/branch), `src/db.ts` (migration 001–006;
`users.role` CHECK chỉ `('owner','staff')`, `users.branch_id NOT NULL`, chưa có
trường trạng thái), `src/seed.ts` (1 org, 1 branch, 2 user: owner + staff),
`tests/acceptance.test.ts` (17 test đã khóa — KHÔNG sửa test cũ, seed phải giữ
2 user để test `seed tao 1 org 1 branch 2 user` vẫn xanh), `scripts/check.sh`
(CHK-1) + `scripts/demo.sh` (CHK-2) — goal này MỞ RỘNG 2 script, giữ các bước
GOAL-001 xanh.

## Quyết định mô hình phạm vi (Lead/Worker ghi vào DECISIONS.md làm D13, D14)

- **Phạm vi = `users.branch_id` nullable + `users.warehouse_id` nullable
  (KHÔNG thêm bảng `user_scopes`).** `branch_id NULL` = toàn bộ chi nhánh
  trong org; có giá trị = đúng 1 chi nhánh đó. Đây là phương án đơn giản nhất:
  không thêm bảng, không thêm join; giới hạn là 1 user không được cấp 2 chi
  nhánh trở lên trong GOAL-002 (nếu sau này cần đa chi nhánh thì làm Goal riêng
  thêm bảng `user_scopes`).
- **Kho chưa có bảng** (`warehouses` là GOAL-004). `warehouse_id` ở GOAL-002
  chỉ là trường phạm vi chuẩn bị (INTEGER NULL, KHÔNG có FK, không kiểm tra
  tồn tại kho thật, không có nghiệp vụ kho). Khi GOAL-004 tạo bảng `warehouses`
  thì gắn FK + kiểm tra tồn tại sau. Phạm vi kho chỉ được kiểm chứng ở mức
  helper phân quyền `can()` (unit test), không có endpoint nghiệp vụ kho nào
  để test qua HTTP trong goal này.
- **Email duy nhất trong TOÀN hệ thống** (giữ `UNIQUE` hiện tại trên
  `users.email`, không đổi thành duy nhất trong org): đơn giản, khớp login
  bằng email hiện tại, tránh một email thuộc 2 org gây nhầm lẫn khi đăng nhập.
- **Thu hồi cần trạng thái thứ ba.** `users.status` có 3 giá trị
  `('active','locked','revoked')`, mặc định `'active'`. Khóa (`locked`) là tạm
  thời, mở lại được; thu hồi (`revoked`) là cuối cùng, không mở lại được (muốn
  vào lại phải mời mới). Không DELETE row khi thu hồi, để giữ lịch sử
  `audit_log` (cột `audit_log.user_id` FK tới `users`, xóa row sẽ vỡ FK).
- **Vai `staff` cũ được remap thành `sales`.** Migration 007 phải đổi
  `users.role` CHECK sang 5 vai và chuyển mọi row `staff` hiện có thành
  `sales`; seed đổi user nhân viên thành vai `sales` (giữ nguyên email
  `staff@example.local` và số lượng 2 user để test khóa vẫn xanh).

## Ma trận quyền (bản đầy đủ ghi trong `docs/RBAC.md`)

Vai: `owner` (chủ doanh nghiệp), `manager` (quản lý), `sales` (bán hàng),
`warehouse` (kho), `accountant` (kế toán). Quy tắc chung: mọi thao tác đều
kiểm tra cả vai VÀ phạm vi; vai sai thao tác → 403; đúng vai sai phạm vi → 403;
ngoài org → 403 (D4).

| Thao tác | owner | manager | sales / warehouse / accountant |
|---|---|---|---|
| Mời nhân viên | Được, mọi vai, mọi chi nhánh trong org | Chỉ mời `sales`/`warehouse`/`accountant`, chỉ trong phạm vi của mình | Không (403) |
| Khóa / mở khóa | Được, mọi vai (trừ chính mình và chủ duy nhất còn lại) | Chỉ khóa/mở vai cấp dưới trong phạm vi của mình | Không (403) |
| Thu hồi | Được, mọi vai (trừ chính mình và chủ duy nhất còn lại) | Chỉ thu hồi vai cấp dưới trong phạm vi của mình | Không (403) |
| Đổi vai người khác | Được (chỉ owner) | Không (403) — tránh tự nâng quyền | Không (403) |
| Đổi phạm vi người khác | Được, mọi vai | Chỉ đổi vai cấp dưới, phạm vi mới phải nằm trong phạm vi của mình | Không (403) |
| Đổi mật khẩu người khác | Được, mọi vai trong org | Chỉ đổi vai cấp dưới trong phạm vi của mình | Không (403) |
| Đổi mật khẩu của mình | Được (mọi vai đang `active`, phải nhập mật khẩu hiện tại) | Được | Được |
| Xem danh sách nhân viên (`GET /api/users`) | Được, toàn org | Được, chỉ user trong phạm vi của mình | Không (403), chỉ xem hồ sơ của mình (`/me`) |
| Xem nhật ký (`GET /api/audit-log`) | Được, toàn org | Được, chỉ bản ghi liên quan user trong phạm vi của mình + bản ghi do mình thực hiện | Không (403) |
| Tạo chi nhánh (`POST /api/branches`) | Được, trong org của mình | Không (403) | Không (403) |
| Nghiệp vụ bán hàng / kho / kế toán | — | — | CHỈ LÀ ĐỊNH HƯỚNG cho GOAL-003/004/005/006: `sales` tạo đơn, `warehouse` nhập/xuất kho, `accountant` xem thanh toán/báo cáo. GOAL-002 KHÔNG làm endpoint nghiệp vụ nên KHÔNG test các ô này qua HTTP; chỉ ghi định hướng trong `docs/RBAC.md`, các Goal sau mới enforce + test |

## Yêu cầu

1. Migration 007 mở rộng `users.role` CHECK sang 5 vai
   `('owner','manager','sales','warehouse','accountant')` và remap mọi row
   `staff` hiện có thành `sales`. Seed đổi user nhân viên thành vai `sales`
   (giữ email `staff@example.local`, giữ 2 user). Migration chạy tuần tự sau
   001–006, giữ dữ liệu cũ, không vỡ 17 test đã khóa.
2. Migration 007 thêm `users.status` CHECK
   `('active','locked','revoked')` mặc định `'active'`; đổi `users.branch_id`
   thành nullable (`NULL` = toàn org); thêm `users.warehouse_id` INTEGER NULL
   (không FK, không kiểm tra tồn tại kho — xem quyết định mô hình phạm vi ở
   trên). Mọi user mới mặc định `active`.
3. Ma trận quyền trong `docs/RBAC.md` (bảng ở trên, đầy đủ từng ô) + helper
   phân quyền `can()` ở tầng service (`src/rbac.ts`, test được trực tiếp không
   qua HTTP) + middleware `requireRole`/`requireScope` trong app. Vai sai thao
   tác → 403; đúng vai sai phạm vi → 403; ngoài org → 403. Không query nghiệp
   vụ nào bỏ qua kiểm tra vai + phạm vi.
4. Mời nhân viên: `owner`/`manager` tạo tài khoản mới trong org của mình qua
   API (ví dụ `POST /api/users/invite`), gán vai + `branch_id`/`warehouse_id`
   trong phạm vi của mình. Validate: email đúng định dạng và chưa tồn tại
   (trùng → 409); vai hợp lệ; `manager` không được mời `owner`/`manager`
   (→ 403); chi nhánh được gán phải thuộc org của người mời (→ 403 nếu ngoài
   org). Mật khẩu ban đầu do người mời cấp trong request (demo/test lấy từ
   biến môi trường, sinh ngẫu nhiên), chỉ lưu bcrypt hash, không lưu/ghi log
   mật khẩu dạng plain text, không trả mật khẩu trong response. Mọi lần mời
   đều ghi audit log.
5. Khóa nhân viên: API khóa/mở khóa (ví dụ `POST /api/users/:id/lock`,
   `POST /api/users/:id/unlock`). Tài khoản bị khóa đăng nhập bị từ chối rõ
   ràng: `POST /login` trả 403 với lỗi phân biệt được với sai mật khẩu (401).
   Session đang chạy bị vô hiệu NGAY: khi khóa phải xóa mọi session của user
   đó, VÀ `lookupSession` phải kiểm tra `status` (chỉ `active` mới có session
   hợp lệ) để session lọt qua vẫn bị chặn. Mở khóa chỉ `owner`/`manager` theo
   ma trận; không được khóa chính mình; mỗi org luôn còn ít nhất 1 `owner`
   đang `active` (khóa/thu hồi/đổi vai chủ cuối cùng → 400/403).
6. Thu hồi: API thu hồi (ví dụ `POST /api/users/:id/revoke`) đặt
   `status='revoked'`, xóa mọi session của user đó; sau thu hồi mọi đăng nhập
   và mọi thao tác đều bị chặn (login → 403, API → 401/403). Thu hồi là cuối
   cùng, không có API mở lại `revoked` (muốn vào lại phải mời mới). Không
   DELETE row user. Ghi audit log.
7. Đổi vai / đổi phạm vi / đổi mật khẩu người khác: API riêng cho từng thao
   tác (ví dụ `PATCH /api/users/:id/role`, `PATCH /api/users/:id/scope`,
   `POST /api/users/:id/change-password`). Chỉ `owner` được đổi vai; `manager`
   chỉ đổi phạm vi cho vai cấp dưới và phạm vi mới phải nằm trong phạm vi của
   mình; đổi mật khẩu người khác theo ma trận. Đổi mật khẩu của mình: mọi vai
   `active` được đổi, phải nhập đúng mật khẩu hiện tại. Mọi lần đổi đều ghi
   audit log (không ghi mật khẩu/hash vào log).
8. Quản lý chi nhánh + danh sách nhân viên: `owner` tạo chi nhánh mới trong
   org của mình (`POST /api/branches`, tên bắt buộc, `manager` và các vai khác
   → 403). `GET /api/users` liệt kê nhân viên: `owner` thấy toàn org,
   `manager` chỉ thấy user trong phạm vi của mình, các vai khác → 403 (chỉ
   xem hồ sơ của mình qua `/me`).
9. Nhật ký thao tác nhạy cảm (`audit_log` đã có từ GOAL-001): ghi MỌI thao tác
   mời, khóa, mở khóa, thu hồi, đổi vai, đổi phạm vi, đổi mật khẩu người khác,
   tạo chi nhánh. Mỗi bản ghi có: ai làm (`user_id` người thực hiện), lúc nào
   (`created_at`), thay đổi gì (`action` + `detail` JSON ghi rõ đối tượng
   `target_user_id` và `before`/`after`, KHÔNG chứa mật khẩu/hash). Có API xem
   log (`GET /api/audit-log`) + trang đơn giản liệt kê log (EJS sẵn có):
   `owner` xem toàn org, `manager` chỉ xem bản ghi liên quan user trong phạm
   vi của mình + bản ghi do mình thực hiện, các vai khác → 403.
10. Test chặn truy cập ngoài phạm vi: test (vitest + supertest, thêm vào test
    mới — KHÔNG sửa 17 test đã khóa) chứng minh: user org A truy cập dữ liệu /
    thao tác trên org B → 403; user đúng vai nhưng ngoài `branch_id` được cấp
    → 403; vai sai thao tác → 403 (mời/khóa/thu hồi/đổi vai/xem log/xem danh
    sách/tạo chi nhánh); tài khoản bị khóa dùng session cũ → 401/403; tài
    khoản bị thu hồi đăng nhập lại → 403. Test cả qua HTTP và trực tiếp helper
    `can()` ở tầng service (nếu helper tồn tại). Test dùng dữ liệu giả lập
    (2 org, 2 chi nhánh trở lên trong cùng org).
11. Dữ liệu GIẢ LẬP hoàn toàn; mật khẩu seed/mời qua biến môi trường (như
    GOAL-001: `OMNIFLOW_SEED_*_PASSWORD`, mật khẩu mời sinh ngẫu nhiên hoặc
    cấp qua env trong demo/test), không commit credential thật; `check.sh`
    vẫn quét secret (grep như GOAL-001).
12. `scripts/check.sh` (CHK-1) và `scripts/demo.sh` (CHK-2) được MỞ RỘNG trong
    goal này: thêm bước RBAC vào smoke/demo (mời → đăng nhập vai mới → khóa
    → session cũ bị chặn → xem audit log → truy cập ngoài phạm vi bị 403),
    giữ tất cả bước GOAL-001 xanh (health, login, owner-only, idempotency,
    backup/restore). Cả 2 script tự chạy được, tự dọn dẹp, in PASS/FAIL từng
    bước.
13. Docs: `docs/RBAC.md` mới (ma trận quyền đầy đủ + mô hình phạm vi + ví dụ
    request/response cho mời/khóa/thu hồi/xem log); `docs/DECISIONS.md` thêm
    D13 (mô hình phạm vi `branch_id` nullable + `warehouse_id` chuẩn bị) và
    D14 (email duy nhất toàn hệ thống, trạng thái 3 giá trị, remap
    `staff` → `sales`); `README.md`/`docs/SETUP.md` cập nhật endpoint và vai
    mới, khớp lệnh đã chạy thật.
14. Không có file `.github/workflows/` trong repo (gh token thiếu scope
    `workflow` — CI là follow-up sau khi user cấp scope). Không claim VPS,
    không claim deploy production (local-only, D9).

## Ngoài phạm vi (thuộc goal sau, không làm trong GOAL-002)

15. Nghiệp vụ sản phẩm/giá/CSV (GOAL-003), kho đa kho + tồn giữ/có thể bán
    (GOAL-004 — lúc đó mới có bảng `warehouses` thật và FK cho `warehouse_id`),
    đơn hàng (GOAL-005), thanh toán/hoàn tiền (GOAL-006).
16. Adapter thanh toán/vận chuyển/email thật — chỉ dùng fake đã có (GOAL-006/
    007/011 gắn adapter thật sau nếu có).
17. Đa chi nhánh cho 1 user (bảng `user_scopes`), quên mật khẩu / đặt lại mật
    khẩu qua email, bắt buộc đổi mật khẩu lần đầu, đăng nhập SSO/OAuth — là
    follow-up, không làm trong goal này.
18. Deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user
    cấp scope `workflow`).
