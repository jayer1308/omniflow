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
