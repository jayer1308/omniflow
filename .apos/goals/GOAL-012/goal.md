# GOAL-012 v1: OmniFlow co UI tong quan + van hanh: dashboard (doanh thu hom nay/thang nay, don cho xu ly, ton thap, thong bao chua doc — so lieu tu service da co, khop API bao cao GOAL-010), man hinh giao/tra tong quan, man hinh khach/diem tong quan, man hinh thong bao/job tong quan; health check mo rong (DB, version, uptime); trang sao luu/khoi phuc qua dung co che GOAL-001; trang nhat ky audit co loc/phan trang; EJS tieng Viet mobile-first dong nhat, dung duoc bang ban phim; RBAC theo ma tran dashboard/van hanh + audit log day du; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc dashboard/van hanh moi (CHK-2 timeoutMs 20 phut tu v1); 4 yeu cau mo coi thong bao + R-20 cua GOAL-008 duoc loai tru co ly do (out-of-scope); inbox sach hoan toan sau khi dong — goal cuoi cua roadmap

Status: approved

```json
{
  "id": "GOAL-012",
  "version": 1,
  "outcome": "OmniFlow co UI tong quan + van hanh: dashboard (doanh thu hom nay/thang nay, don cho xu ly, ton thap, thong bao chua doc — so lieu tu service da co, khop API bao cao GOAL-010), man hinh giao/tra tong quan, man hinh khach/diem tong quan, man hinh thong bao/job tong quan; health check mo rong (DB, version, uptime); trang sao luu/khoi phuc qua dung co che GOAL-001; trang nhat ky audit co loc/phan trang; EJS tieng Viet mobile-first dong nhat, dung duoc bang ban phim; RBAC theo ma tran dashboard/van hanh + audit log day du; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc dashboard/van hanh moi (CHK-2 timeoutMs 20 phut tu v1); 4 yeu cau mo coi thong bao + R-20 cua GOAL-008 duoc loai tru co ly do (out-of-scope); inbox sach hoan toan sau khi dong — goal cuoi cua roadmap",
  "source": {
    "path": "brief-012.md",
    "sha256": "de29ff727927decf86e3802cac0961960d3b7dbf116b19b074eb0763e5959463",
    "capturedAt": "2026-11-28T02:05:28.400Z",
    "origin": "human"
  },
  "requirements": [
    {
      "id": "R-1",
      "sourceSpan": "dòng 188–195",
      "text": "Dashboard tổng quan: GET /dashboard (EJS, requireAuth) hiển thị: doanh thu hôm nay, doanh thu tháng này, số đơn chờ xử lý theo từng trạng thái (draft/confirmed/processing), số cặp tồn thấp, số thông báo chưa đọc. Doanh thu lấy qua computeRevenueReport (GOAL-010) với khoảng hôm nay/tháng này theo Asia/Ho_Chi_Minh, chỉ đơn completed. Đơn chờ xử lý đếm từ bảng orders theo trạng thái. Tồn thấp đếm từ logic low-stock GOAL-004 (available < min_stock). Thông báo chưa đọc theo định nghĩa D30. Số liệu hiển thị đúng định dạng tiền Việt (vd 250.000đ).",
      "disposition": "acceptance"
    },
    {
      "id": "R-2",
      "sourceSpan": "dòng 196–200",
      "text": "Màn hình giao/trả tổng quan: GET /dashboard/shipments (EJS) hiển thị: danh sách đơn đang giao (shipments status requested/shipped/in_transit kèm mã vận đơn + carrier + trạng thái), trả chờ duyệt (returns status requested kèm mã đơn + lý do), trả vừa nhận gần nhất (5 bản ghi). Có link sang chi tiết đơn. Dữ liệu GOAL-007.",
      "disposition": "acceptance"
    },
    {
      "id": "R-3",
      "sourceSpan": "dòng 201–204",
      "text": "Màn hình khách/điểm tổng quan: GET /dashboard/customers (EJS) hiển thị: danh sách khách VIP (segment VIP theo luật GOAL-008), tổng điểm đã đổi trong tháng (redeemed × 100đ), khách mới trong tháng. Dữ liệu GOAL-008.",
      "disposition": "acceptance"
    },
    {
      "id": "R-4",
      "sourceSpan": "dòng 205–208",
      "text": "Màn hình thông báo/job tổng quan: GET /dashboard/notifications (EJS) hiển thị: thông báo mới nhất (10 bản ghi, theo event_type/status), job failed cần chú ý (kèm link retry tay qua API GOAL-011). Dữ liệu GOAL-011. Đây là màn hình mà R-16 của GOAL-011 đã defer sang GOAL-012 — GOAL-012 sở hữu nó bằng requirements riêng, không loại trừ.",
      "disposition": "acceptance"
    },
    {
      "id": "R-5",
      "sourceSpan": "dòng 209–213",
      "text": "Health check mở rộng: GET /health trả {status, db, version, uptime_seconds}; DB ok → db: 'ok', status: 'ok'; DB lỗi → status: 'error' + 503. version đọc từ package.json (không hard-code). uptime_seconds tính từ lúc process start (số nguyên ≥ 0).",
      "disposition": "acceptance"
    },
    {
      "id": "R-6",
      "sourceSpan": "dòng 214–221",
      "text": "Sao lưu/khôi phục qua UI: GET /ops/backup (EJS, owner-only) hiển thị trạng thái sao lưu gần nhất (tên file + thời gian + kích thước, hoặc 'chưa có sao lưu' nếu không có); POST /api/ops/backup (owner-only) tạo file backup bằng scripts/backup.sh, trả {file, size, created_at}; POST /api/ops/restore (owner-only, body {file, confirm: true}) khôi phục bằng scripts/restore.sh (thiếu/sai confirm → 400, file không tồn tại → 404, file ngoài thư mục backup → 400). KHÔNG viết logic sao lưu mới.",
      "disposition": "acceptance"
    },
    {
      "id": "R-7",
      "sourceSpan": "dòng 222–226",
      "text": "Nhật ký audit có lọc/phân trang: mở rộng GET /audit-log (EJS, đã có): query actor=, action=, from=, to=, page, limit (mặc định page 1, limit 20 tối đa 100); lọc sai giá trị → 400; phân trang đúng (total/page/limit); giữ hành vi cũ (owner/manager only, ngoài vai → 403). API GET /api/audit-log đã có giữ nguyên.",
      "disposition": "acceptance"
    },
    {
      "id": "R-8",
      "sourceSpan": "dòng 227–231",
      "text": "EJS + trạng thái tải/rỗng/lỗi: các màn hình mới dùng chung public/style.css, tiếng Việt, mobile-first; màn hình hẹp 360px không vỡ layout; luồng chính dùng được bằng bàn phím (link/button focus được); khi chưa có dữ liệu hiển thị 0/empty đúng nghĩa, không crash; lỗi service hiển thị trang lỗi 500 không lộ stack trace.",
      "disposition": "acceptance"
    },
    {
      "id": "R-9",
      "sourceSpan": "dòng 232–236",
      "text": "Số dashboard khớp API báo cáo: số doanh thu trên dashboard (hôm nay/tháng này) PHẢI khớp số từ GET /api/reports/revenue cùng khoảng (test so sánh trực tiếp); số tồn thấp khớp GET /api/stock/low-stock; số đơn chờ xử lý khớp GET /api/orders lọc theo trạng thái.",
      "disposition": "acceptance"
    },
    {
      "id": "R-10",
      "sourceSpan": "dòng 237–248",
      "text": "RBAC màn hình/vận hành: mở rộng can() thêm actions view-dashboard / view-ops / run-backup theo ma trận: owner/manager toàn org (xem dashboard + vận hành + chạy backup/restore); sales chỉ xem dashboard thuộc chi nhánh mình (doanh thu/đơn/tồn của chi nhánh mình; xem dashboard toàn org → 403; xem vận hành → 403); warehouse chỉ xem phần tồn kho/giao hàng thuộc kho được gán (xem dashboard doanh thu → 403; xem vận hành → 403); accountant xem dashboard doanh thu/báo cáo toàn org (chỉ xem, chạy backup/restore → 403). Mọi endpoint qua requireAuth + can() (vai sai/sai chi nhánh/kho/ngoài org → 403). Test chứng minh từng ô cấm (ít nhất: sales xem dashboard toàn org → 403, sales xem vận hành → 403, warehouse xem doanh thu → 403, accountant chạy backup → 403, user org A xem dashboard org B → 403).",
      "disposition": "acceptance"
    },
    {
      "id": "R-11",
      "sourceSpan": "dòng 249–255",
      "text": "Test mới: vitest + supertest, thêm vào file test mới — KHÔNG sửa 404 test đã khóa của GOAL-001..011; chứng minh dashboard hiển thị đúng số (so với API), màn hình giao/trả/khách/thông báo có đúng dữ liệu, health mở rộng, backup/restore qua API (tạo → đổi dữ liệu → restore → đúng trạng thái), audit lọc/phân trang, RBAC 403 theo ma trận, trạng thái rỗng/lỗi. Dữ liệu test giả lập (2 org, 2 chi nhánh, 2 kho, 2 kênh trở lên).",
      "disposition": "acceptance"
    },
    {
      "id": "R-12",
      "sourceSpan": "dòng 256–260",
      "text": "Dữ liệu GIẢ LẬP + không secret: mật khẩu seed + secret qua biến môi trường (như GOAL-001..011), không commit credential thật; check.sh vẫn quét secret; seed KHÔNG thêm user/sản phẩm/kho mới (giữ nguyên 2 user, 2 sản phẩm, 2 kho + mức tồn mẫu để test khóa vẫn xanh); không lưu thông tin thẻ ở bất kỳ đâu (DB, API, log, audit_log).",
      "disposition": "acceptance"
    },
    {
      "id": "R-13",
      "sourceSpan": "dòng 261–271",
      "text": "Scripts mở rộng: scripts/check.sh (CHK-1) và scripts/demo.sh (CHK-2) được MỞ RỘNG trong goal này: thêm bước dashboard/vận hành (mở dashboard → doanh thu hôm nay/tháng này khớp API báo cáo → đơn chờ xử lý đúng số → tồn thấp đúng số → thông báo chưa đọc → màn hình giao/trả có đơn đang giao → màn hình khách có VIP → màn hình thông báo có job failed + retry → health trả đủ field → backup qua API → đổi dữ liệu → restore qua API → dữ liệu về đúng → audit lọc theo actor/action + phân trang → RBAC 403: sales xem dashboard toàn org, warehouse xem doanh thu, accountant chạy backup), giữ tất cả bước GOAL-001..011 xanh. Cả 2 script tự chạy được, tự dọn dẹp, in PASS/FAIL từng bước. CHK-2 khai timeoutMs 1200000 (20 phút) ngay từ v1.",
      "disposition": "acceptance"
    },
    {
      "id": "R-14",
      "sourceSpan": "dòng 272–277",
      "text": "Docs + roadmap hoàn tất: docs/RBAC.md bổ sung ma trận dashboard/vận hành; docs/DECISIONS.md thêm D30 (nguồn số liệu dashboard + định nghĩa 'chưa đọc' + health/backup/audit mở rộng); README.md/docs/SETUP.md cập nhật màn hình/endpoint mới, khớp lệnh đã chạy thật; docs/ROADMAP.md đánh dấu 12 goal chính + GOAL-005A đã đóng (roadmap hoàn tất). Không có file .github/workflows/ trong repo.",
      "disposition": "acceptance"
    },
    {
      "id": "R-15",
      "sourceSpan": "dòng 278–282",
      "text": "Phạm vi: không thêm nghiệp vụ mới ngoài dashboard/vận hành; không đổi logic tính đã khóa (computePaymentSummary, state machine đơn, giá hiệu dụng, luật điểm/mã); không kết nối dịch vụ thật; không claim VPS, không claim deploy production (local-only, D9).",
      "disposition": "acceptance"
    },
    {
      "id": "R-21",
      "sourceSpan": "dòng 324–326 (brief-006.md)",
      "adopts": {
        "sourceSha256": "d3721a8812fccf7a526b1aebe77d2422a5001c1990065724601563c638fc6eb1",
        "requirementId": "R-20"
      },
      "text": "Thông báo (GOAL-011): không gửi email khi nhận được tiền hay hoàn tiền (chỉ audit log + lịch sử giao dịch).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "R-20 chỉ là câu phủ định phạm vi của GOAL-006 (nói GOAL-006 không gửi email khi nhận tiền hay hoàn tiền), không phải yêu cầu dương cần implement; toàn bộ phạm vi thông báo đã được sở hữu bởi requirements riêng R-1..R-15 của GOAL-011 (đã implement + kiểm chứng đầy đủ, gate xanh, check/demo xanh). Adopt vào GOAL-012 (UI/vận hành) sẽ nhận sai phạm vi."
    },
    {
      "id": "R-22",
      "sourceSpan": "dòng 589–590 (brief-008.md)",
      "adopts": {
        "sourceSha256": "1096245ab8319996180e7a82f65599d1190491a46acc89c3efdc211a5e96cb71",
        "requirementId": "R-19"
      },
      "text": "Thông báo (GOAL-011): không gửi email/SMS cho khách khi tích/đổi điểm hay hợp nhất hồ sơ (chỉ audit log + ledger + ghi chú).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "R-19 chỉ là câu phủ định phạm vi của GOAL-008 (nói GOAL-008 không gửi email/SMS khi tích/đổi điểm hay hợp nhất hồ sơ), không phải yêu cầu dương cần implement; toàn bộ phạm vi thông báo đã được sở hữu bởi requirements riêng R-1..R-15 của GOAL-011 (đã implement + kiểm chứng đầy đủ, gate xanh, check/demo xanh). Adopt vào GOAL-012 (UI/vận hành) sẽ nhận sai phạm vi."
    },
    {
      "id": "R-23",
      "sourceSpan": "dòng 409–412 (brief-009.md)",
      "adopts": {
        "sourceSha256": "53b60a14c7ebe698576b7162fbd1c6a420efea47cc1ef98d85af41a58aff4ed7",
        "requirementId": "R-17"
      },
      "text": "Thông báo (GOAL-011): không gửi email/SMS cho khách khi áp mã hay khi mã sắp hết hạn (chỉ audit log + lịch sử dùng mã).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "R-17 chỉ là câu phủ định phạm vi của GOAL-009 (nói GOAL-009 không gửi email/SMS khi áp mã hay khi mã sắp hết hạn), không phải yêu cầu dương cần implement; toàn bộ phạm vi thông báo đã được sở hữu bởi requirements riêng R-1..R-15 của GOAL-011 (đã implement + kiểm chứng đầy đủ, gate xanh, check/demo xanh). Adopt vào GOAL-012 (UI/vận hành) sẽ nhận sai phạm vi."
    },
    {
      "id": "R-24",
      "sourceSpan": "dòng 337–342 (brief-010.md)",
      "adopts": {
        "sourceSha256": "75a653e0e8585ea8176c733d4ce2ccc9a4262627a88554779a4e234b00b62d7f",
        "requirementId": "R-14"
      },
      "text": "Thông báo (GOAL-011): không gửi email/SMS khi có lệch đối soát hay khi doanh thu đạt ngưỡng (chỉ báo cáo + audit log); thông báo là yêu cầu riêng của GOAL-011.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "R-14 chỉ là câu phủ định phạm vi của GOAL-010 (nói GOAL-010 không gửi email/SMS khi có lệch đối soát hay khi doanh thu đạt ngưỡng), không phải yêu cầu dương cần implement; toàn bộ phạm vi thông báo đã được sở hữu bởi requirements riêng R-1..R-15 của GOAL-011 (đã implement + kiểm chứng đầy đủ, gate xanh, check/demo xanh). Adopt vào GOAL-012 (UI/vận hành) sẽ nhận sai phạm vi."
    },
    {
      "id": "R-25",
      "sourceSpan": "dòng 594 (brief-008.md)",
      "adopts": {
        "sourceSha256": "1096245ab8319996180e7a82f65599d1190491a46acc89c3efdc211a5e96cb71",
        "requirementId": "R-20"
      },
      "text": "UI tổng quan (GOAL-012): không thêm màn hình khách/CRM.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "R-20 chỉ là câu phủ định phạm vi của GOAL-008 (nói GOAL-008 không thêm màn hình khách/CRM), không phải yêu cầu dương cần implement; phạm vi màn hình khách/điểm tổng quan đã được sở hữu bởi requirements riêng R-3 của GOAL-012 này (màn hình khách/điểm tổng quan — khách VIP, điểm đã đổi, khách mới). Adopt vào GOAL-012 sẽ nhận một câu phủ định làm tiêu chí nên loại trừ có lý do."
    }
  ],
  "scope": [
    "docs/",
    "src/",
    "scripts/",
    "tests/",
    "views/",
    "public/",
    "README.md",
    "brief-012.md",
    "goal-012.json",
    ".gitignore"
  ],
  "exclusions": [
    "Nghiep vu moi ngoai dashboard/van hanh (khong them loai don/thanh toan/khuyen mai/khach moi); khong doi logic tinh da khoa (computePaymentSummary, state machine don, gia hieu dung, luat diem/ma) — thuoc cac goal truoc, khong lam trong GOAL-012.",
    "Dich vu that (email/SMS/push that, cong thanh toan that, don vi van chuyen that) — ngoai pham vi vinh vien cua du an gia lap nay; deploy production/VPS (ngoai pham vi, local-only), CI workflow (cho user cap scope workflow).",
    "Yeu cau R-20 cua GOAL-006, R-19 cua GOAL-008, R-17 cua GOAL-009 va R-14 cua GOAL-010 duoc loai tru co ly do (out-of-scope) trong goal nay — xem requirement R-21/R-22/R-23/R-24; chung chi la cau phu dinh pham vi thong bao cua goal goc, toan bo pham vi thong bao da duoc so huu boi requirements rieng R-1..R-15 cua GOAL-011; adopt vao GOAL-012 (UI/van hanh) se nhan sai pham vi.",
    "Yeu cau R-20 cua GOAL-008 duoc loai tru co ly do (out-of-scope) trong goal nay — xem requirement R-25; R-20 chi la cau phu dinh pham vi cua GOAL-008 (noi GOAL-008 khong lam man hinh khach/CRM), pham vi man hinh khach/diem tong quan da duoc so huu boi requirements rieng R-3 cua GOAL-012."
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Dashboard + man hinh tong quan (AC-1): GET /dashboard (EJS): doanh thu hom nay + thang nay (qua computeRevenueReport GOAL-010, chi don completed, theo Asia/Ho_Chi_Minh), don cho xu ly theo tung trang thai draft/confirmed/processing, so cap ton thap (available < min_stock, GOAL-004), so thong bao chua doc (dinh nghia D30). GET /dashboard/shipments (EJS): don dang giao (shipments requested/shipped/in_transit kem ma van don + carrier + trang thai), tra cho duyet (returns requested kem ma don + ly do), tra vua nhan gan nhat (5 ban ghi), link sang chi tiet don — du lieu GOAL-007. GET /dashboard/customers (EJS): khach VIP (segment VIP theo luat GOAL-008), tong diem da doi trong thang (redeemed x 100d), khach moi trong thang — du lieu GOAL-008. GET /dashboard/notifications (EJS): thong bao moi nhat (10 ban ghi, theo event_type/status), job failed can chu y kem link retry tay qua API GOAL-011 — du lieu GOAL-011. So dashboard PHAI khop so API bao cao GOAL-010 cung khoang (test so sanh truc tiep). So tien hien thi dung dinh dang Viet (vd 250.000d).",
      "requirementIds": [
        "R-1",
        "R-2",
        "R-3",
        "R-4",
        "R-9",
        "R-11"
      ],
      "examples": [
        {
          "input": "mo GET /dashboard sau khi tao don 250000 hoan tat thu 100000 (test moi)",
          "expected": "200, HTML chua doanh thu hom nay/thang nay khop so GET /api/reports/revenue cung khoang, don cho xu ly dung so, ton thap dung so"
        },
        {
          "input": "mo GET /dashboard/shipments sau khi tao shipment + return requested (test moi)",
          "expected": "200, HTML chua don dang giao kem ma van don + tra cho duyet kem ly do"
        },
        {
          "input": "mo GET /dashboard/customers sau khi tao khach VIP + doi diem (test moi)",
          "expected": "200, HTML chua khach VIP + tong diem da doi trong thang"
        },
        {
          "input": "mo GET /dashboard/notifications sau khi tao job failed gia lap (test moi)",
          "expected": "200, HTML chua thong bao moi nhat + job failed kem link retry"
        }
      ],
      "boundaries": [
        "so dashboard lay tu service da co (computeRevenueReport GOAL-010, logic low-stock GOAL-004, bang notifications GOAL-011); KHONG tinh lai bang SQL rieng gay lech",
        "dinh nghia 'chua doc' theo D30; khong them cot DB moi neu tranh duoc",
        "don cho xu ly = draft/confirmed/processing; doanh thu chi don completed"
      ],
      "prohibited": [
        "khong duoc tinh lai doanh thu/ton bang SQL rieng (phai dung service GOAL-010/004)",
        "khong duoc doi hanh vi da khoa cua GOAL-005/006/007/008/009/010/011 (state machine, webhook, hoan tien, diem, ma, bao cao, thong bao)",
        "khong duoc sua test da khoa cua GOAL-001..011; khong duoc doi hanh vi computePaymentSummary hay state machine don"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-2",
      "text": "Van hanh: health + sao luu/khoi phuc + audit (AC-2): GET /health mo rong tra {status, db, version, uptime_seconds} — db: 'ok' khi query SELECT 1 thanh cong, version doc tu package.json (khong hard-code), uptime_seconds tu luc process start (so nguyen >= 0); DB loi -> status: 'error' + 503. GET /ops/backup (EJS, owner-only) hien thi trang thai sao luu gan nhat (ten file + thoi gian + kich thuoc, hoac 'chua co sao luu'); POST /api/ops/backup (owner-only) tao file backup bang scripts/backup.sh, tra {file, size, created_at}; POST /api/ops/restore (owner-only, body {file, confirm: true}) khoi phuc bang scripts/restore.sh. Mo rong GET /audit-log (EJS, da co): them loc actor=/action=/from=/to= + phan trang page/limit (mac dinh page 1, limit 20 toi da 100); loc sai gia tri -> 400; giu hanh vi cu (owner/manager only, ngoai vai -> 403).",
      "requirementIds": [
        "R-5",
        "R-6",
        "R-7"
      ],
      "examples": [
        {
          "input": "GET /health (test moi)",
          "expected": "200, {status:'ok', db:'ok', version: <package.json>, uptime_seconds: so nguyen >= 0}"
        },
        {
          "input": "POST /api/ops/backup -> doi du lieu -> POST /api/ops/restore {file, confirm:true} (test moi)",
          "expected": "201/200, {file, size, created_at}; doi du lieu -> restore qua API -> du lieu ve dung trang thai truoc backup"
        },
        {
          "input": "restore sai confirm / file la / backup sai vai (test moi)",
          "expected": "400 thieu confirm; 404 file khong ton tai; 403 sales/accountant goi backup"
        },
        {
          "input": "GET /audit-log?actor=&action=&from=&to=&page=&limit= (test moi)",
          "expected": "200, loc dung theo actor + action + khoang thoi gian, phan trang total/page/limit dung; loc sai gia tri -> 400"
        }
      ],
      "boundaries": [
        "health mo rong GIU {status: 'ok'} khi DB ok (test khoa GOAL-001 van xanh)",
        "backup/restore CHI bọc scripts/backup.sh + restore.sh da co; KHONG viet logic sao luu moi",
        "restore yeu cau confirm: true, thieu/sai -> 400; file ngoai thu muc backup -> 400",
        "audit-log mo rong GIU hanh vi cu (owner/manager only, ngoai vai -> 403)"
      ],
      "prohibited": [
        "khong duoc doi hanh vi /health cu (phai giu status ok khi DB ok)",
        "khong duoc viet logic sao luu/khoi phuc moi (chi bọc 2 script GOAL-001)",
        "khong duoc sua test da khoa cua GOAL-001..011; khong duoc commit secret/credential that; khong duoc commit file .github/workflows/ (CI cho user cap scope workflow)"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-3",
      "text": "EJS + RBAC (AC-3): cac man hinh moi dung chung public/style.css, tieng Viet, mobile-first, dong nhat voi man hinh da co; viewport 360px khong vo layout; luong chinh (xem dashboard -> xem chi tiet -> quay lai) dung duoc bang ban phim. RBAC: mo rong can() them 3 actions view-dashboard / view-ops / run-backup theo ma tran brief-012.md yeu cau 10 (owner/manager toan org; sales chi dashboard chi nhanh minh, xem van hanh -> 403; warehouse chi phan ton kho/giao hang thuoc kho duoc gan, xem doanh thu -> 403, xem van hanh -> 403; accountant xem dashboard doanh thu/bao cao toan org chi xem, chay backup/restore -> 403). Moi endpoint qua requireAuth + can() (vai sai/sai chi nhanh/kho/ngoai org -> 403).",
      "requirementIds": [
        "R-8",
        "R-10"
      ],
      "examples": [
        {
          "input": "render cac man hinh moi o viewport hep (test moi)",
          "expected": "200, HTML chua dung so lieu + link dieu huong; viewport 360px khong vo layout"
        },
        {
          "input": "test RBAC theo tung o cam trong ma tran dashboard/van hanh (test moi)",
          "expected": "403: sales xem dashboard toan org, sales xem van hanh, warehouse xem doanh thu, accountant chay backup, user org A xem dashboard org B"
        },
        {
          "input": "mo dashboard tren DB moi seed (test moi)",
          "expected": "200, dashboard hien 0/empty dung nghia khi DB seed toi thieu"
        }
      ],
      "boundaries": [
        "man hinh moi dung chung public/style.css; khong doi man hinh cu tru khi can de gan link dashboard",
        "viewport 360px khong vo layout; luong chinh dung duoc bang ban phim (link/button focus duoc, khong chi onclick)",
        "khi chua co du lieu hien thi 0/empty dung nghia, khong crash; loi service -> trang loi 500 khong lo stack trace"
      ],
      "prohibited": [
        "khong duoc doi man hinh cu (index/login/audit-log) tru khi can de gan link dashboard",
        "khong duoc lo stack trace ra trang loi",
        "khong duoc sua test da khoa cua GOAL-001..011"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-4",
      "text": "Test + checks/docs + du lieu gia lap (AC-4): test moi (vitest + supertest, file moi) chung minh toan bo hanh vi AC-1..AC-3 (dashboard dung so so voi API, man hinh giao/tra/khach/thong bao dung du lieu, health mo rong, backup/restore qua API, audit loc/phan trang, RBAC 403, trang thai rong/loi); du lieu GIA LAP hoan toan, secret qua bien moi truong, check.sh van quet secret; scripts/check.sh va scripts/demo.sh duoc MO RONG them buoc dashboard/van hanh (mo dashboard -> doanh thu hom nay/thang nay khop API bao cao -> don cho xu ly dung so -> ton thap dung so -> thong bao chua doc -> man hinh giao/tra co don dang giao -> man hinh khach co VIP -> man hinh thong bao co job failed + retry -> health tra du field -> backup qua API -> doi du lieu -> restore qua API -> du lieu ve dung -> audit loc theo actor/action + phan trang -> RBAC 403: sales xem dashboard toan org, warehouse xem doanh thu, accountant chay backup), giu cac buoc GOAL-001..011 xanh, tu chay duoc, tu don dep, in PASS/FAIL tung buoc; docs RBAC/DECISIONS(D30)/ROADMAP/README/SETUP cap nhat.",
      "requirementIds": [
        "R-12",
        "R-13",
        "R-14",
        "R-15"
      ],
      "examples": [
        {
          "input": "./scripts/check.sh; ./scripts/demo.sh",
          "expected": "./scripts/check.sh exit 0 va ./scripts/demo.sh in PASS tung buoc, gom cac buoc GOAL-001..011 xanh + buoc dashboard/van hanh moi"
        },
        {
          "input": "doc RBAC/DECISIONS/ROADMAP/README/SETUP sau goal",
          "expected": "docs/RBAC.md bo sung ma tran dashboard/van hanh; docs/DECISIONS.md them D30; docs/ROADMAP.md danh dau 12 goal chinh + GOAL-005A da dong; README.md/docs/SETUP.md cap nhat man hinh/endpoint moi, khop lenh da chay that"
        }
      ],
      "boundaries": [
        "test moi them vao file test moi, KHONG sua 404 test da khoa cua GOAL-001..011; du lieu test gia lap (2 org, 2 chi nhanh, 2 kho, 2 kenh tro len)",
        "seed KHONG them user/san pham/kho moi (giu nguyen 2 user, 2 san pham, 2 kho + muc ton mau de test khoa van xanh)",
        "CHK-2 khai timeoutMs 1200000 (20 phut) ngay tu v1 — bai hoc GOAL-010 (timeout mac dinh APOS 10 phut, demo.sh chay rieng da 6m43s, issue #89)",
        "khong duoc claim VPS, deploy production hay cong thanh toan that"
      ],
      "prohibited": [
        "khong duoc sua test da khoa cua GOAL-001..011; khong duoc commit secret/credential that; khong duoc commit file .github/workflows/ (CI cho user cap scope workflow)",
        "khong duoc luu thong tin the o bat ky dau (DB, API, log, audit_log)",
        "khong duoc claim VPS, deploy production hay cong thanh toan that"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    }
  ],
  "checks": [
    {
      "id": "CHK-1",
      "kind": "command",
      "command": "./scripts/check.sh",
      "expect": "pass",
      "runs": 1,
      "timeoutMs": 600000,
      "env": {}
    },
    {
      "id": "CHK-2",
      "kind": "command",
      "command": "./scripts/demo.sh",
      "expect": "pass",
      "runs": 1,
      "timeoutMs": 1200000,
      "env": {}
    }
  ],
  "dependencies": [],
  "priority": 3
}
```
