# OmniFlow — brief GOAL-001: Nền tảng

## Bối cảnh

OmniFlow là hệ thống vận hành thương mại đa kênh cho doanh nghiệp vừa (nhiều
doanh nghiệp, nhiều chi nhánh, nhiều kho, nhiều kênh bán), dự án dài hạn để kiểm
tra APOS ở quy mô lớn. Roadmap: `docs/ROADMAP.md` (12 Goal). Quyết định kiến
trúc: `docs/DECISIONS.md` (D1–D10).

GOAL-001 làm nền tảng: repo + APOS setup + khung app chạy được + auth + đa
tenant ở mức khung + adapter fake + docs vận hành + seed giả lập tối thiểu.
Không làm nghiệp vụ sản phẩm/kho/đơn trong goal này (GOAL-003/004/005).
Dữ liệu GIẢ LẬP hoàn toàn; không tiền thật, không dịch vụ trả phí.
Dự án chỉ làm LOCAL — không có VPS trong phạm vi (user xác nhận 26/11 21:49).

Toolchain trên máy: Node v24.22.1, npm 10.9.4, sqlite3 CLI, gh đăng nhập
jayer1308. APOS v0.1.0 @ 7e341b1, CLI `node ~/workspace/apos/dist/cli.js`.
Đề xuất appetite: size M, 480 phút, 3 lần thử (Human delegate duyệt ở gate A;
đặt dư vì APOS tính wall-clock từ lúc select — bài học DRAK GOAL-002).

## Yêu cầu

1. Repo public `jayer1308/omniflow`, branch `main`, git identity local
   `jayer1308 <m813082003@gmail.com>`.
2. `apos init` trong repo: `.apos/project.yaml`, role skills, managed block trong
   `AGENTS.md`.
3. Setup APOS: `setup draft` với stack typescript, sửa nếu cần, commit, `setup
   probe` pass, rồi approve bằng quyền Human delegate cho OmniFlow.
4. App khởi động được: `npm install` rồi `npm start` chạy server; endpoint
   `GET /health` trả `{"status":"ok"}`.
5. Migration chạy theo thứ tự, tạo đủ bảng: `orgs`, `branches`, `users`,
   `sessions`, `audit_log`, `idempotency_keys`. Mọi bảng nghiệp vụ có `org_id`.
6. Seed dữ liệu GIẢ LẬP tối thiểu: 1 doanh nghiệp, 1 chi nhánh, 1 tài khoản chủ
   doanh nghiệp + 1 nhân viên. Mật khẩu cấp qua biến môi trường/script seed,
   không commit mật khẩu thật.
7. Auth: đăng nhập/đăng xuất bằng session + bcrypt; sai mật khẩu bị từ chối;
   session hết hạn thì phải đăng nhập lại.
8. Hai vai cơ bản ở mức nền: chủ doanh nghiệp (`owner`) và nhân viên (`staff`);
   route chỉ dành cho owner thì staff bị chặn (401/403), có test chứng minh.
   RBAC đầy đủ 5 vai là GOAL-002.
9. Đa tenant ở mức khung: middleware gắn `org_id`/`branch_id` của user đang
   đăng nhập vào request; mọi query nghiệp vụ qua scope này; truy cập dữ liệu
   ngoài org bị từ chối, có test chứng minh.
10. Adapter interface cho thanh toán, vận chuyển, email (`src/adapters/`) với
    bản fake xác định (deterministic) chạy local, trả kết quả giả lập rõ ràng
    là giả lập. Không kết nối cổng thật.
11. Idempotency: helper + bảng `idempotency_keys` (key duy nhất); gửi lại cùng
    key trả kết quả đã lưu, không thực thi lại. Có test chứng minh.
12. Docs: `README.md` + `docs/SETUP.md` (cài đặt, chạy local, chạy test,
    sao lưu/khôi phục); script sao lưu tạo file backup, khôi phục từ file
    backup đưa dữ liệu về đúng trạng thái, có test/script chứng minh.
13. `scripts/check.sh` (CHK-1) và `scripts/demo.sh` (CHK-2) tự chạy được:
    tự build, tự chạy test, tự start/stop server trên port riêng, dọn dẹp sau
    khi chạy; in PASS/FAIL từng bước; không dựa vào server/DB chạy sẵn.
14. `docs/ROADMAP.md` và `docs/DECISIONS.md` có mặt trong repo, ghi đúng các
    quyết định D1–D10.
15. Không có file `.github/workflows/` trong repo lúc đầu (gh token thiếu scope
    `workflow` — CI là follow-up sau khi user cấp scope). Không claim VPS,
    không claim deploy production.
16. Không commit bí mật/credential: check.sh kiểm tra bằng grep các mẫu
    thường gặp (password/token/secret trong code, trừ placeholder và test
    fixture ghi rõ là giả).

## Ngoài phạm vi (thuộc goal sau, không làm trong GOAL-001)

17. Nghiệp vụ sản phẩm/giá/CSV (GOAL-003), kho (GOAL-004), đơn hàng (GOAL-005).
18. RBAC đầy đủ 5 vai, mời/khóa/thu hồi nhân viên, phân quyền theo chi nhánh/kho (GOAL-002).
19. Tích hợp cổng thanh toán/vận chuyển/email thật — chỉ dùng fake (GOAL-006/007/011 gắn adapter thật sau nếu có).
20. Deploy production/VPS, CI workflow (pending: user cấp scope `workflow`; VPS ngoài phạm vi).
