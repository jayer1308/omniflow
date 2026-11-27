# GOAL-010 v1: OmniFlow co bao cao + doi soat tren du lieu that da co: bao cao doanh thu theo kenh/chi nhanh/san pham/danh muc/thoi gian (mac dinh thang hien tai, chi tinh don completed, thoi gian theo thoi diem hoan tat tu order_events, hien thi Asia/Ho_Chi_Minh); bao cao ton kho + bien dong + canh bao ton thap; doi soat 3 mat kho–don–thanh toan (le th liet ke tung dong kem so ky vong vs thuc te, du lieu mau da biet cho 0 dong error); bao cao khuyen mai da dung + diem da doi; xuat CSV cho moi bao cao (so lieu khop API JSON); phan quyen xem bao cao theo vai + scope chi nhanh/kho (accountant toan org, sales chi chi nhanh minh, warehouse chi bao cao ton theo kho duoc gan); audit log cho xuat bao cao; bao cao tinh o service, khong luu bang tong rieng; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc bao cao moi; 3 yeu cau mo coi khuyen mai (R-18 GOAL-006, R-16 GOAL-007, R-17 GOAL-008) duoc loai tru co ly do (out-of-scope)

Status: approved

```json
{
  "id": "GOAL-010",
  "version": 1,
  "outcome": "OmniFlow co bao cao + doi soat tren du lieu that da co: bao cao doanh thu theo kenh/chi nhanh/san pham/danh muc/thoi gian (mac dinh thang hien tai, chi tinh don completed, thoi gian theo thoi diem hoan tat tu order_events, hien thi Asia/Ho_Chi_Minh); bao cao ton kho + bien dong + canh bao ton thap; doi soat 3 mat kho–don–thanh toan (le th liet ke tung dong kem so ky vong vs thuc te, du lieu mau da biet cho 0 dong error); bao cao khuyen mai da dung + diem da doi; xuat CSV cho moi bao cao (so lieu khop API JSON); phan quyen xem bao cao theo vai + scope chi nhanh/kho (accountant toan org, sales chi chi nhanh minh, warehouse chi bao cao ton theo kho duoc gan); audit log cho xuat bao cao; bao cao tinh o service, khong luu bang tong rieng; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc bao cao moi; 3 yeu cau mo coi khuyen mai (R-18 GOAL-006, R-16 GOAL-007, R-17 GOAL-008) duoc loai tru co ly do (out-of-scope)",
  "source": {
    "path": "brief-010.md",
    "sha256": "c70ceb64b3c270f49aeb3a9461770e283f3bfbb86d8f4c7b11d4895d9f847bbd",
    "capturedAt": "2026-11-27T10:28:23.549Z",
    "origin": "human"
  },
  "requirements": [
    {
      "id": "R-1",
      "sourceSpan": "dòng 174–197",
      "text": "Định nghĩa chỉ số + luật chỉ tính đơn completed: doanh thu chỉ tính đơn có status = 'completed' tại thời điểm báo cáo; thời gian của một đơn là thời điểm hoàn tất — created_at của order_events có to_status = 'completed' (lưu UTC trong DB, không có cột completed_at riêng, không thêm cột mới cho việc này); đơn draft/confirmed/processing/cancelled KHÔNG vào doanh thu, kể cả đơn đã thu tiền đặt cọc (tiền thu của đơn chưa completed vẫn hiện ở mục tiền thu / đối soát từng đơn, không cộng vào doanh thu); đơn completed rồi bị trả hàng vẫn tính doanh thu gộp — tiền hoàn trừ riêng ở cột hoàn tiền, không sửa lại doanh thu; doanh thu gộp = Σ orders.total của đơn completed trong kỳ; doanh thu thuần = Σ (total − points_discount − promo_discount); số đơn = số đơn completed trong kỳ; tiền đã thu = Σ paid_total (theo computePaymentSummary) của các đơn completed trong kỳ — tính theo đơn, không theo ngày thu; tiền hoàn = Σ refunded_total của các đơn completed trong kỳ; tiền còn phải thu = Σ outstanding của các đơn completed trong kỳ (âm nghĩa là thừa, hiện rõ không giấu); khoảng thời gian from/to là ngày theo Asia/Ho_Chi_Minh (YYYY-MM-DD), chuyển sang UTC để lọc; mặc định là tháng hiện tại; from > to → 400; định dạng ngày sai → 400; mọi số tiền là số nguyên đồng, không float.",
      "disposition": "acceptance"
    },
    {
      "id": "R-2",
      "sourceSpan": "dòng 198–218",
      "text": "API báo cáo doanh thu theo kênh / chi nhánh / sản phẩm / thời gian: GET /api/reports/revenue?from=&to=&channel=&branch_id=&group_by= trả doanh thu trong kỳ, lọc theo kênh (counter/web/api, kênh lạ → 400) và chi nhánh (không tồn tại → 404, ngoài org → 403), nhóm theo group_by ∈ day/month/channel/branch/product/category (mặc định day; giá trị lạ → 400). Response JSON: {from, to, timezone: 'Asia/Ho_Chi_Minh', totals: {gross_revenue, net_revenue, order_count, paid_total, refunded_total, outstanding_total, points_discount_total, promo_discount_total}, rows: [{key, label, gross_revenue, net_revenue, order_count, paid_total, refunded_total, points_discount_total, promo_discount_total}]} — totals bằng tổng các rows; nhóm theo product dùng order_items (mỗi dòng tính theo line_total snapshot, trừ điểm/mã phân bổ theo tỉ lệ line_total/total của đơn — ghi rõ công thức phân bổ trong D28, tổng các dòng sản phẩm khớp net_revenue); nhóm theo category gom các sản phẩm cùng danh mục (sản phẩm chưa có danh mục gom vào nhóm 'Chưa phân loại'); nhóm theo day/month dùng ngày hoàn tất theo Asia/Ho_Chi_Minh; kỳ không có đơn nào → totals toàn 0, rows rỗng (200, không 404). Mọi API báo cáo lọc theo org của user đang đăng nhập.",
      "disposition": "acceptance"
    },
    {
      "id": "R-3",
      "sourceSpan": "dòng 219–232",
      "text": "API báo cáo tồn kho + biến động + cảnh báo tồn thấp: GET /api/reports/stock?warehouse_id=&variant_id=&from=&to= trả tồn kho tại thời điểm gọi + biến động trong kỳ: levels theo từng cặp (biến thể, kho) {variant_id, sku, product_name, warehouse_id, warehouse_name, on_hand, reserved, available} (available = on_hand − reserved, D17); movements tóm tắt theo loại {type, count, qty_total} trong kỳ (lọc theo created_at UTC, from/to theo Asia/Ho_Chi_Minh như yêu cầu 1); low_stock = các cặp có available < products.min_stock (D17) kèm min_stock và shortage = min_stock − available. Lọc theo kho không tồn tại → 404, ngoài org → 403; biến thể không tồn tại → 404. Kho inactive vẫn hiện trong báo cáo (chỉ đọc, không thao tác mới — D17). Số liệu lấy từ stock_levels + stock_movements đã có (GOAL-004), không bảng mới.",
      "disposition": "acceptance"
    },
    {
      "id": "R-4",
      "sourceSpan": "dòng 233–261",
      "text": "Đối soát 3 mặt kho–đơn–thanh toán (liệt kê từng dòng lệch): GET /api/reports/reconciliation?from=&to=&branch_id= đối soát trong kỳ theo 3 mặt, trả {from, to, timezone, summary: {checked_orders, checked_stock_pairs, mismatch_count}, mismatches: [...]}. Ba mặt kiểm tra: (a) kho — với mỗi cặp (biến thể, kho) có stock_levels hoặc có movement: tồn kỳ vọng = Σ qty_change của MỌI movement của cặp đó từ đầu (không chỉ trong kỳ) so với stock_levels.on_hand hiện tại; giữ kỳ vọng = Σ reserved_change so với stock_levels.reserved; lệch → 1 dòng mismatch kind: 'stock-level' kèm variant_id, warehouse_id, expected, actual, difference; (b) đơn–kho — với mỗi đơn completed trong kỳ: mỗi dòng order_items phải có movement out với reference = mã đơn và qty_change = −số lượng dòng, kèm movement release tương ứng (D19: hoàn tất = release + out trong cùng transaction); thiếu/thừa/sai số → 1 dòng mismatch kind: 'order-stock' kèm order_code, variant_id, expected_qty, actual_qty; (c) đơn–tiền — với mỗi đơn completed trong kỳ, dùng lại computePaymentSummary (D22/D27): đơn có outstanding > 0 → 1 dòng kind: 'order-payment' trạng thái 'chưa thu đủ' (đây là trạng thái, không phải lỗi dữ liệu — phân biệt bằng trường severity: 'info'); đơn có outstanding < 0 → 1 dòng kind: 'order-payment' trạng thái 'thu thừa' (severity: 'info'); đơn có payment_status = 'refunded' mà refunded_total ≠ tổng refund completed → dòng severity: 'error'. mismatch_count = số dòng trong mismatches; dữ liệu mẫu đã biết (luồng chuẩn GOAL-004/005/006/007) cho mismatch_count = 0 ở các dòng error (không có dòng stock-level hay order-stock nào). Không sửa dữ liệu khi đối soát (chỉ đọc).",
      "disposition": "acceptance"
    },
    {
      "id": "R-5",
      "sourceSpan": "dòng 262–276",
      "text": "Đối soát từng đơn dùng lại computePaymentSummary, KHÔNG đổi ngữ nghĩa payment_status: đối soát từng đơn trong báo cáo dùng lại computePaymentSummary (src/payments.ts, D22/D27): outstanding = order_total − points_discount − promo_discount − paid_total; payment_status GIỮ NGUYÊN logic D22 (như GOAL-008/009 đã làm: đơn đổi điểm/mã hết tổng mà chưa trả đồng nào vẫn 'unpaid'; hoàn trực tiếp một phần giữ 'partially_paid', hoàn qua trả hàng giữ 'partially_refunded' — xem D25). GOAL-010 KHÔNG đổi ngữ nghĩa payment_status (đây là hành vi đã khóa của GOAL-006/007/008/009 — muốn đổi thì làm tests revise ở goal sau, ghi rõ trong D28 nếu phát hiện ngữ nghĩa gây nhầm trong báo cáo). Báo cáo hiển thị cả outstanding lẫn payment_status để người đọc tự thấy sự khác biệt (ví dụ đơn trả đủ phần còn phải trả sau giảm nhưng chưa bằng tổng gốc vẫn 'partially_paid').",
      "disposition": "acceptance"
    },
    {
      "id": "R-6",
      "sourceSpan": "dòng 277–294",
      "text": "Báo cáo khuyến mãi đã dùng + điểm đã đổi: GET /api/reports/promotions?from=&to=&code= trả theo từng mã: {code, promotion_id, used_count, released_count, total_discount, order_count} — used_count = số usage status 'used', released_count = số usage 'released' (hủy đơn hoàn lượt, D27), total_discount = Σ discount_amount của usage 'used' tạo trong kỳ (theo created_at của usage), order_count = số đơn khác nhau có usage trong kỳ; lọc code theo chuỗi con (như GET /api/promotions); mã chưa từng dùng trong kỳ vẫn hiện với các số 0 (để thấy mã ế). GET /api/reports/points?from=&to= trả {totals: {earned_total, redeemed_total, redeemed_amount}, rows: [{customer_id, customer_name, earned, redeemed, redeemed_amount}]} — earned_total = Σ điểm earn trong kỳ, redeemed_total = Σ điểm redeem trong kỳ, redeemed_amount = redeemed_total × 100đ (D26: 1 điểm = 100đ); điểm tích tính trên tổng gốc (D27: không trừ promo_discount). Cả hai báo cáo lọc theo org + phạm vi vai (xem yêu cầu 8); kỳ không có dữ liệu → totals 0, rows rỗng (200).",
      "disposition": "acceptance"
    },
    {
      "id": "R-7",
      "sourceSpan": "dòng 295–312",
      "text": "Xuất CSV cho mỗi báo cáo (số liệu khớp API JSON): mọi endpoint báo cáo (yêu cầu 2, 3, 4, 6) nhận thêm ?format=csv trả Content-Type: text/csv; charset=utf-8, cùng dữ liệu với bản JSON (cùng from/to/filter, cùng kỳ): mỗi báo cáo có đúng các cột đã định nghĩa (doanh thu: key,label,gross_revenue,net_revenue,order_count,paid_total,refunded_total,points_discount_total,promo_discount_total; tồn kho: variant_id,sku,product_name,warehouse_id,warehouse_name,on_hand,reserved,available,min_stock,shortage; đối soát: kind,severity,order_code,variant_id,warehouse_id,expected,actual,difference,note; khuyến mãi: code,used_count,released_count,total_discount,order_count; điểm: customer_id,customer_name,earned,redeemed,redeemed_amount); dòng tổng TOTAL cuối file cho báo cáo doanh thu/khuyến mãi/điểm (khớp totals của JSON); số liệu CSV khớp đúng từng số với response JSON cùng filter (test so sánh trực tiếp); dùng csv-stringify như GOAL-003 (xử lý BOM, dấu phẩy trong tên); format lạ → 400. Xuất CSV ghi audit log (xem yêu cầu 9); xem JSON không ghi audit (tránh nhiễu log — ghi rõ trong D28).",
      "disposition": "acceptance"
    },
    {
      "id": "R-8",
      "sourceSpan": "dòng 313–329",
      "text": "RBAC xem báo cáo theo vai + scope chi nhánh: mở rộng helper can() ở src/rbac.ts thêm actions view-reports (xem báo cáo JSON) và export-reports (xuất CSV) theo đúng ma trận: xem doanh thu/đối soát/khuyến mãi/điểm + xuất CSV các báo cáo đó: owner/manager toàn org, accountant toàn org (chỉ xem, không sửa gì — báo cáo chỉ đọc); sales chỉ chi nhánh mình — gọi không có branch_id thì mặc định lọc chi nhánh mình, gọi branch_id khác → 403, gọi báo cáo tồn kho → 403; warehouse chỉ xem báo cáo tồn kho (GET /api/reports/stock, chỉ kho được gán — warehouse_id NULL = mọi kho; hỏi kho ngoài phạm vi → 403), các báo cáo khác → 403; mọi endpoint báo cáo qua requireRole + can() (vai sai → 403, ngoài org → 403, sai chi nhánh/kho → 403). Test chứng minh từng ô cấm trong ma trận (ít nhất: sales xem doanh thu chi nhánh khác → 403, sales xem báo cáo tồn → 403, warehouse xem doanh thu → 403, warehouse xem tồn kho ngoài phạm vi → 403, user org A đọc báo cáo org B → 403, accountant xem toàn org → 200 nhưng chỉ đọc).",
      "disposition": "acceptance"
    },
    {
      "id": "R-9",
      "sourceSpan": "dòng 330–342",
      "text": "Audit log cho xuất báo cáo: ghi vào audit_log đã có MỖI lần xuất CSV báo cáo (action export-report): mỗi bản ghi có user_id người thực hiện, created_at, action + detail JSON (report ∈ revenue/stock/reconciliation/promotions/points, from, to, format: 'csv', các filter đã dùng channel/branch_id/warehouse_id/code/group_by khi có, KHÔNG chứa thông tin thẻ, KHÔNG chứa PII khách — chỉ id + số liệu); xem log theo luật GOAL-002 (GET /api/audit-log: owner toàn org, manager trong phạm vi, các vai khác → 403). Xem báo cáo JSON không ghi audit (xem yêu cầu 7). Test: xuất CSV → audit log có đúng 1 bản ghi khớp filter đã xuất; xem JSON → không tăng số bản ghi audit.",
      "disposition": "acceptance"
    },
    {
      "id": "R-10",
      "sourceSpan": "dòng 343–355",
      "text": "Báo cáo tính ở service từ dữ liệu thật đã có, không lưu bảng tổng riêng: mọi số liệu báo cáo tính ở service (hàm thuần trong src/reports.ts mới hoặc mở rộng service hiện có — Lead chốt vị trí) từ các bảng đã có (orders/order_items/order_events, payments/refunds, stock_levels/stock_movements, promotion_usages, customer_points, products/product_variants/categories); KHÔNG tạo bảng tổng hợp mới, KHÔNG lưu cột tổng riêng, KHÔNG migration 015 trừ khi Lead chứng minh cần index cho truy vấn báo cáo (khi đó migration 015 chỉ thêm index, ghi rõ trong D28). Không cache kết quả báo cáo trong DB hay file (mỗi lần gọi tính lại từ dữ liệu gốc — tránh lệch như D22/D26/D27 đã chốt cho đối soát/điểm/khuyến mãi).",
      "disposition": "acceptance"
    },
    {
      "id": "R-11",
      "sourceSpan": "dòng 356–372",
      "text": "Test mới (vitest + supertest, thêm vào file test mới — KHÔNG sửa 333 test đã khóa của GOAL-001..009): chứng minh luật chỉ tính completed (đơn draft đã thu tiền không vào doanh thu; đơn cancelled không vào doanh thu; đơn completed bị trả hàng vẫn tính doanh thu gộp, tiền hoàn ở cột riêng), nhóm theo kênh/chi nhánh/sản phẩm/danh mục/ngày (tổng các dòng khớp totals; nhóm sản phẩm phân bổ điểm/mã theo tỉ lệ line_total/total), mặc định tháng hiện tại + biên múi giờ (đơn hoàn tất 00:30 +07 ngày 1 vẫn thuộc ngày 1, không rơi sang hôm trước theo UTC), báo cáo tồn (available = on_hand − reserved; tồn thấp đúng ngưỡng min_stock), đối soát 3 mặt (dữ liệu mẫu đã biết cho 0 dòng error; chèn lệch trực tiếp ở tầng DB — sửa stock_levels / thiếu movement out — rồi gọi API thấy đúng dòng lệch stock-level/order-stock kèm số kỳ vọng vs thực tế), báo cáo khuyến mãi + điểm (số mã, tổng giảm theo mã, điểm đổi × 100đ), CSV khớp JSON từng số (so sánh trực tiếp cùng filter), RBAC 403 theo ma trận (yêu cầu 8), audit xuất CSV (yêu cầu 9). Test dùng dữ liệu giả lập (2 org, 2 chi nhánh, 2 kho, 2 kênh trở lên).",
      "disposition": "acceptance"
    },
    {
      "id": "R-12",
      "sourceSpan": "dòng 373–379",
      "text": "Dữ liệu GIẢ LẬP hoàn toàn; mật khẩu seed + secret qua biến môi trường (như GOAL-001..009: OMNIFLOW_SEED_*_PASSWORD), không commit credential thật; check.sh vẫn quét secret (grep như GOAL-001); seed KHÔNG cần thêm mã mẫu (demo tự tạo) — nhưng giữ nguyên 2 user, 2 sản phẩm, 2 kho + mức tồn mẫu để test khóa vẫn xanh.",
      "disposition": "acceptance"
    },
    {
      "id": "R-13",
      "sourceSpan": "dòng 380–402",
      "text": "scripts/check.sh (CHK-1) và scripts/demo.sh (CHK-2) được MỞ RỘNG trong goal này: thêm bước báo cáo vào smoke/demo (tạo đơn 250.000đ kênh counter → xác nhận → xử lý → hoàn tất → thu tiền 100.000đ → tạo đơn draft 50.000đ + thu đặt cọc 20.000đ → tạo đơn khác rồi hủy → gọi báo cáo doanh thu tháng hiện tại: doanh thu gộp 250.000đ, số đơn 1, tiền đã thu 100.000đ, outstanding 150.000đ (đơn draft/hủy không vào) → gọi báo cáo theo kênh counter khớp số trên → gọi đối soát 3 mặt: mismatch error 0 → gọi báo cáo khuyến mãi + điểm → xuất CSV doanh thu khớp JSON → RBAC 403: sales xem doanh thu chi nhánh khác, warehouse xem doanh thu, sales xem báo cáo tồn), giữ tất cả bước GOAL-001..009 xanh (health, login, owner-only, idempotency, backup/restore, RBAC người dùng, sản phẩm/giá/CSV, kho, đơn, thanh toán, giao/trả, khách/CRM, khuyến mãi). Cả 2 script tự chạy được, tự dọn dẹp, in PASS/FAIL từng bước. Docs: docs/RBAC.md bổ sung ma trận báo cáo (bảng ở trên) + docs/DECISIONS.md thêm D28 (định nghĩa chỉ số + luật chỉ tính completed + thời điểm hoàn tất từ order_events + công thức phân bổ điểm/mã theo dòng sản phẩm + đối soát 3 mặt + CSV khớp JSON + audit chỉ cho xuất CSV + không bảng tổng riêng); README.md/docs/SETUP.md cập nhật endpoint báo cáo, khớp lệnh đã chạy thật. Không có file .github/workflows/ trong repo (gh token thiếu scope workflow — CI là follow-up sau khi user cấp scope). Không claim VPS, không claim deploy production (local-only, D9).",
      "disposition": "acceptance"
    },
    {
      "id": "R-14",
      "sourceSpan": "dòng 403–407",
      "text": "Thông báo (GOAL-011): không gửi email/SMS khi có lệch đối soát hay khi doanh thu đạt ngưỡng (chỉ báo cáo + audit log); thông báo là yêu cầu riêng của GOAL-011.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "deferred",
        "to": "GOAL-011"
      },
      "exclusionReason": "Thuộc GOAL-011, không làm trong GOAL-010"
    },
    {
      "id": "R-15",
      "sourceSpan": "dòng 408–412",
      "text": "UI tổng quan (GOAL-012): không thêm màn hình báo cáo (chỉ API JSON + CSV); màn hình tổng quan/báo cáo là yêu cầu riêng của GOAL-012.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "deferred",
        "to": "GOAL-012"
      },
      "exclusionReason": "Thuộc GOAL-012, không làm trong GOAL-010"
    },
    {
      "id": "R-21",
      "sourceSpan": "dòng 329–330 (brief-006.md)",
      "adopts": {
        "sourceSha256": "d3721a8812fccf7a526b1aebe77d2422a5001c1990065724601563c638fc6eb1",
        "requirementId": "R-18"
      },
      "text": "Khuyến mãi (GOAL-009): không mã giảm giá — số tiền thu chỉ đối soát với tổng đơn GOAL-005 đã snapshot.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "R-18 chỉ là câu phủ định phạm vi của GOAL-006 (nói GOAL-006 không làm khuyến mãi), không phải yêu cầu dương cần implement; toàn bộ phạm vi khuyến mãi đã được sở hữu bởi requirements riêng R-1..R-15 của GOAL-009 (đã implement + kiểm chứng đầy đủ, gate xanh, check/demo xanh). Adopt vào GOAL-010 (báo cáo) sẽ nhận sai phạm vi."
    },
    {
      "id": "R-22",
      "sourceSpan": "dòng 476–477 (brief-007.md)",
      "adopts": {
        "sourceSha256": "5586ce9122656edcbd73a2cf609470e1e354ef85fb39ffeb00c70cec04c7f906",
        "requirementId": "R-16"
      },
      "text": "Khuyến mãi (GOAL-009): không mã giảm giá — số tiền hoàn chỉ đối soát với tổng đơn GOAL-005 đã snapshot, không áp giảm giá khi trả hàng.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "R-16 chỉ là câu phủ định phạm vi của GOAL-007 (nói GOAL-007 không làm khuyến mãi), không phải yêu cầu dương cần implement; toàn bộ phạm vi khuyến mãi đã được sở hữu bởi requirements riêng R-1..R-15 của GOAL-009 (đã implement + kiểm chứng đầy đủ, gate xanh, check/demo xanh). Adopt vào GOAL-010 (báo cáo) sẽ nhận sai phạm vi."
    },
    {
      "id": "R-23",
      "sourceSpan": "dòng 553–555 (brief-008.md)",
      "adopts": {
        "sourceSha256": "1096245ab8319996180e7a82f65599d1190491a46acc89c3efdc211a5e96cb71",
        "requirementId": "R-17"
      },
      "text": "Khuyến mãi (GOAL-009): không mã giảm giá, không chương trình theo điều kiện — điểm đổi ở đây là điểm tích lũy CRM, không phải mã giảm giá; giá đơn vẫn dùng giá hiệu dụng GOAL-003 đã snapshot.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "R-17 chỉ là câu phủ định phạm vi của GOAL-008 (nói GOAL-008 không làm khuyến mãi), không phải yêu cầu dương cần implement; toàn bộ phạm vi khuyến mãi đã được sở hữu bởi requirements riêng R-1..R-15 của GOAL-009 (đã implement + kiểm chứng đầy đủ, gate xanh, check/demo xanh). Adopt vào GOAL-010 (báo cáo) sẽ nhận sai phạm vi."
    }
  ],
  "scope": [
    "docs/",
    "src/",
    "scripts/",
    "tests/",
    "README.md",
    "brief-010.md",
    "goal-010.json",
    ".gitignore"
  ],
  "exclusions": [
    "Thông báo (GOAL-011): không gửi email/SMS khi có lệch đối soát hay khi doanh thu đạt ngưỡng (chỉ báo cáo + audit log) — thuộc GOAL-011, không làm trong GOAL-010.",
    "UI tổng quan (GOAL-012): không thêm màn hình báo cáo (chỉ API JSON + CSV) — thuộc GOAL-012, không làm trong GOAL-010.",
    "Đơn vị vận chuyển thật / giao hàng thật, tài khoản hãng vận chuyển, cổng thanh toán thật — ngoài phạm vi vĩnh viễn của dự án giả lập này; deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user cấp scope workflow).",
    "Yêu cầu R-18 của GOAL-006, R-16 của GOAL-007 và R-17 của GOAL-008 được loại trừ có lý do (out-of-scope) trong goal này — xem requirement R-21/R-22/R-23; chúng chỉ là câu phủ định phạm vi khuyến mãi của goal gốc, toàn bộ phạm vi khuyến mãi đã được sở hữu bởi requirements riêng R-1..R-15 của GOAL-009; adopt vào GOAL-010 (báo cáo) sẽ nhận sai phạm vi."
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Bao cao doanh thu + luat chi tinh completed (AC-1): dinh nghia chi so — chi don status 'completed' tai thoi diem bao cao; thoi gian don la thoi diem hoan tat (order_events to_status='completed', created_at UTC, hien thi Asia/Ho_Chi_Minh); don draft/confirmed/processing/cancelled KHONG vao doanh thu (ke ca da thu dat coc); don completed bi tra hang van tinh doanh thu gop, tien hoan tru rieng; gross = Σ orders.total, net = Σ (total − points_discount − promo_discount), so don = so don completed trong ky, tien da thu = Σ paid_total (theo don, khong theo ngay thu), tien hoan = Σ refunded_total, con phai thu = Σ outstanding (am nghia la thua); from/to la ngay theo Asia/Ho_Chi_Minh, mac dinh thang hien tai, from > to -> 400; tien so nguyen dong. GET /api/reports/revenue?from=&to=&channel=&branch_id=&group_by= (group_by ∈ day/month/channel/branch/product/category, mac dinh day) tra {from, to, timezone: 'Asia/Ho_Chi_Minh', totals: {gross_revenue, net_revenue, order_count, paid_total, refunded_total, outstanding_total, points_discount_total, promo_discount_total}, rows: [...]} — totals bang tong cac rows; nhom product dung order_items (line_total snapshot, diem/ma phan bo theo ti le line_total/total, ghi cong thuc trong D28); nhom category gom san pham chua co danh muc vao 'Chua phan loai'; ky rong -> totals 0, rows rong (200). Moi API bao cao loc theo org.",
      "requirementIds": [
        "R-1",
        "R-2"
      ],
      "examples": [
        {
          "input": "don completed 250.000d (da thu 100.000d) + don draft 50.000d da thu dat coc 20.000d + don da huy -> GET /api/reports/revenue thang hien tai (test moi)",
          "expected": "200, totals: gross_revenue 250.000d, order_count 1, paid_total 100.000d, outstanding 150.000d"
        },
        {
          "input": "GET /api/reports/revenue?group_by=channel (test moi)",
          "expected": "200, rows theo channel khop totals; tong cac rows = totals"
        },
        {
          "input": "GET /api/reports/revenue?group_by=product (test moi)",
          "expected": "200, nhom product: tong cac dong san pham khop net_revenue (diem/ma phan bo theo ti le line_total/total)"
        },
        {
          "input": "don completed luc 00:30 +07 ngay 1 -> GET /api/reports/revenue?group_by=day (test moi)",
          "expected": "200, don hoan tat 00:30 +07 ngay 1 thuoc ngay 1, khong roi sang hom truoc theo UTC"
        },
        {
          "input": "GET /api/reports/revenue?from=2026-11-10&to=2026-11-01 (from > to); ?channel=phone (kenh la); ?group_by=week (gia tri la) (test moi)",
          "expected": "400"
        }
      ],
      "boundaries": [
        "chi tinh don status 'completed' tai thoi diem bao cao; thoi gian don la thoi diem hoan tat (order_events to_status='completed', created_at UTC), khong co cot completed_at rieng",
        "don draft/confirmed/processing/cancelled KHONG vao doanh thu, ke ca don da thu tien dat coc (tien thu cua don chua completed chi hien o muc tien thu / doi soat tung don)",
        "don completed roi bi tra hang van tinh doanh thu gop — tien hoan tru rieng o cot hoan tien, khong sua lai doanh thu",
        "khoang thoi gian from/to la ngay theo Asia/Ho_Chi_Minh, chuyen sang UTC de loc; mac dinh thang hien tai; from > to -> 400; dinh dang ngay sai -> 400",
        "ky khong co don nao -> totals toan 0, rows rong (200, khong 404)",
        "tien so nguyen dong, khong float"
      ],
      "prohibited": [
        "khong duoc tinh don draft/confirmed/processing/cancelled vao doanh thu; khong duoc tinh tien dat coc cua don chua completed vao doanh thu",
        "khong duoc them cot completed_at hay bang tong hop moi (xem R-10)",
        "khong duoc sua test da khoa cua GOAL-001..009; khong duoc doi hanh vi computePaymentSummary hay state machine don"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-2",
      "text": "Bao cao ton kho + doi soat 3 mat (AC-2): GET /api/reports/stock?warehouse_id=&variant_id=&from=&to= tra ton tai thoi diem goi + bien dong trong ky — levels theo tung cap (bien the, kho) {variant_id, sku, product_name, warehouse_id, warehouse_name, on_hand, reserved, available} (available = on_hand − reserved, D17), movements tom tat theo loai {type, count, qty_total} trong ky, low_stock = cac cap available < products.min_stock kem min_stock va shortage; loc kho/bien the khong ton tai -> 404, ngoai org -> 403; kho inactive van hien. GET /api/reports/reconciliation?from=&to=&branch_id= tra {from, to, timezone, summary: {checked_orders, checked_stock_pairs, mismatch_count}, mismatches: [...]} theo 3 mat: (a) kho — ton ky vong = Σ qty_change / giu ky vong = Σ reserved_change cua MOI movement tu dau so voi stock_levels hien tai, lech -> kind 'stock-level' kem expected/actual/difference; (b) don–kho — moi don completed trong ky: moi dong order_items phai co movement out (reference = ma don, qty_change = −so luong) kem release tuong ung (D19), thieu/thua/sai so -> kind 'order-stock' kem order_code/variant_id/expected_qty/actual_qty; (c) don–tien — dung lai computePaymentSummary: outstanding > 0 -> kind 'order-payment' 'chua thu du' severity info, outstanding < 0 -> 'thu thua' severity info, refunded_total lech tong refund completed -> severity error. Doi soat tung don dung lai computePaymentSummary (outstanding = order_total − points_discount − promo_discount − paid_total), payment_status GIU NGUYEN logic D22; bao cao hien thi ca outstanding lan payment_status.",
      "requirementIds": [
        "R-3",
        "R-4",
        "R-5"
      ],
      "examples": [
        {
          "input": "GET /api/reports/stock (test moi)",
          "expected": "200, levels kem on_hand/reserved/available; low_stock dung nguong products.min_stock kem shortage"
        },
        {
          "input": "GET /api/reports/stock?from=&to= (test moi)",
          "expected": "200, movements tom tat theo loai trong ky"
        },
        {
          "input": "du lieu mau da biet (luong chuan GOAL-004/005/006/007) -> GET /api/reports/reconciliation (test moi)",
          "expected": "200, summary.mismatch_count = 0 o cac dong error (khong co dong stock-level hay order-stock nao)"
        },
        {
          "input": "sua truc tiep stock_levels o tang DB roi goi GET /api/reports/reconciliation (test moi)",
          "expected": "200, mismatches co dung 1 dong kind 'stock-level' kem expected/actual/difference"
        },
        {
          "input": "thieu movement out cua mot don completed (chen lech o tang DB) roi goi GET /api/reports/reconciliation (test moi)",
          "expected": "200, mismatches co dung dong kind 'order-stock' kem order_code, variant_id, expected_qty/actual_qty"
        },
        {
          "input": "don completed chua thu du tien -> GET /api/reports/reconciliation (test moi)",
          "expected": "200, don chua thu du hien kind 'order-payment' severity 'info', khong phai error"
        }
      ],
      "boundaries": [
        "doi soat chi doc, khong sua du lieu",
        "ky vong ton kho = Σ qty_change / Σ reserved_change cua MOI movement cua cap (bien the, kho) tu dau, khong chi trong ky",
        "don outstanding > 0 la trang thai 'chua thu du' (severity info), khong phai loi du lieu; outstanding < 0 la 'thu thua' (severity info); chi lech so lieu moi la severity error",
        "payment_status GIU NGUYEN logic D22 — GOAL-010 KHONG doi ngu nghia (muon doi thi tests revise o goal sau)",
        "kho inactive van hien trong bao cao (chi doc, khong thao tac moi)"
      ],
      "prohibited": [
        "khong duoc sua du lieu khi doi soat (chi doc)",
        "khong duoc doi ngu nghia payment_status (partially_paid vs partially_refunded giu nguyen D22/D25)",
        "khong duoc sua test da khoa cua GOAL-001..009"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-3",
      "text": "Bao cao khuyen mai + diem + xuat CSV (AC-3): GET /api/reports/promotions?from=&to=&code= tra theo tung ma {code, promotion_id, used_count, released_count, total_discount, order_count} — used_count = so usage 'used', released_count = so usage 'released' (D27), total_discount = Σ discount_amount cua usage 'used' tao trong ky, order_count = so don khac nhau co usage trong ky; loc code theo chuoi con; ma chua dung trong ky van hien voi so 0. GET /api/reports/points?from=&to= tra {totals: {earned_total, redeemed_total, redeemed_amount}, rows: [{customer_id, customer_name, earned, redeemed, redeemed_amount}]} — redeemed_amount = redeemed_total × 100d (D26), diem tich tren tong goc (D27). Moi endpoint bao cao (revenue/stock/reconciliation/promotions/points) nhan them ?format=csv tra Content-Type text/csv; charset=utf-8, cung du lieu voi ban JSON: dung cac cot da dinh nghia (doanh thu: key,label,gross_revenue,net_revenue,order_count,paid_total,refunded_total,points_discount_total,promo_discount_total; ton kho: variant_id,sku,product_name,warehouse_id,warehouse_name,on_hand,reserved,available,min_stock,shortage; doi soat: kind,severity,order_code,variant_id,warehouse_id,expected,actual,difference,note; khuyen mai: code,used_count,released_count,total_discount,order_count; diem: customer_id,customer_name,earned,redeemed,redeemed_amount); dong TOTAL cuoi file cho bao cao doanh thu/khuyen mai/diem (khop totals JSON); dung csv-stringify nhu GOAL-003 (xu ly BOM, dau phay trong ten).",
      "requirementIds": [
        "R-6",
        "R-7"
      ],
      "examples": [
        {
          "input": "GET /api/reports/promotions (test moi)",
          "expected": "200, tung ma: used_count, released_count, total_discount, order_count"
        },
        {
          "input": "GET /api/reports/points (test moi)",
          "expected": "200, totals: earned_total, redeemed_total, redeemed_amount = redeemed_total x 100"
        },
        {
          "input": "GET /api/reports/revenue?format=csv so sanh truc tiep voi GET /api/reports/revenue (test moi)",
          "expected": "200, Content-Type text/csv; tung so CSV khop dung response JSON cung filter; dong TOTAL cuoi file khop totals"
        },
        {
          "input": "GET /api/reports/reconciliation?format=csv (test moi)",
          "expected": "200, CSV doi soat co dung cac cot kind,severity,order_code,variant_id,warehouse_id,expected,actual,difference,note"
        },
        {
          "input": "GET /api/reports/revenue?format=xml (test moi)",
          "expected": "400"
        }
      ],
      "boundaries": [
        "ma chua tung dung trong ky van hien voi cac so 0 (de thay ma e)",
        "diem tich tinh tren tong goc (D27: khong tru promo_discount); redeemed_amount = redeemed_total x 100d (D26)",
        "CSV cung du lieu voi ban JSON (cung from/to/filter, cung ky); format la -> 400",
        "xem JSON khong ghi audit; chi xuat CSV moi ghi audit (xem AC-4)"
      ],
      "prohibited": [
        "khong duoc de so lieu CSV lech JSON cung filter",
        "khong duoc tinh diem tich tren tong da tru ma (phai tren tong goc)",
        "khong duoc sua test da khoa cua GOAL-001..009"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-4",
      "text": "RBAC + audit + khong bang tong + test/checks/docs (AC-4): mo rong helper can() o src/rbac.ts them 2 actions view-reports (xem bao cao JSON) va export-reports (xuat CSV) theo dung ma tran bao cao (xem doanh thu/doi soat/khuyen mai/diem + xuat CSV: owner/manager toan org, accountant toan org chi xem; sales chi chi nhanh minh — khong co branch_id thi mac dinh loc chi nhanh minh, branch_id khac -> 403, xem bao cao ton -> 403; warehouse chi xem bao cao ton kho duoc gan — warehouse_id NULL = moi kho, hoi kho ngoai pham vi -> 403, cac bao cao khac -> 403); moi endpoint bao cao qua requireRole + can() (vai sai/sai chi nhanh/kho/ngoai org -> 403). Audit log ghi MOI lan xuat CSV bao cao (action 'export-report', detail JSON {report, from, to, format: 'csv', filter da dung}, KHONG chua thong tin the/PII); xem JSON khong ghi audit. Moi so lieu bao cao tinh o service tu bang da co (orders/order_items/order_events, payments/refunds, stock_levels/stock_movements, promotion_usages, customer_points, products/variants/categories), KHONG tao bang tong hop moi, KHONG luu cot tong rieng, KHONG cache; test moi (vitest + supertest, file moi) chung minh toan bo hanh vi AC-1..AC-3 + RBAC 403 + audit xuat CSV; du lieu GIA LAP hoan toan, secret qua bien moi truong, check.sh van quet secret; scripts/check.sh va scripts/demo.sh duoc MO RONG them buoc bao cao, giu cac buoc GOAL-001..009 xanh, tu chay duoc, tu don dep, in PASS/FAIL tung buoc; docs RBAC/DECISIONS(D28)/README/SETUP cap nhat.",
      "requirementIds": [
        "R-8",
        "R-9",
        "R-10",
        "R-11",
        "R-12",
        "R-13"
      ],
      "examples": [
        {
          "input": "test RBAC theo tung o cam trong ma tran bao cao (test moi)",
          "expected": "403: sales xem doanh thu chi nhanh khac; sales xem bao cao ton; warehouse xem doanh thu; warehouse xem ton kho ngoai pham vi; user org A doc bao cao org B"
        },
        {
          "input": "test RBAC cac o duoc phep (test moi)",
          "expected": "200: accountant xem toan org (chi doc); warehouse xem bao cao ton chi kho duoc gan"
        },
        {
          "input": "xuat CSV bao cao doanh thu roi doc audit_log (test moi)",
          "expected": "audit_log co dung 1 ban ghi action 'export-report' voi detail {report, from, to, format: 'csv', filter da dung}, KHONG chua thong tin the/PII"
        },
        {
          "input": "xem bao cao JSON roi doc audit_log (test moi)",
          "expected": "so ban ghi audit khong tang"
        },
        {
          "input": "./scripts/check.sh; ./scripts/demo.sh",
          "expected": "./scripts/check.sh exit 0 va ./scripts/demo.sh in PASS tung buoc, gom cac buoc GOAL-001..009 xanh + buoc bao cao moi"
        },
        {
          "input": "doc RBAC/DECISIONS/README/SETUP sau goal",
          "expected": "docs/RBAC.md bo sung ma tran bao cao; docs/DECISIONS.md them D28; README.md/docs/SETUP.md cap nhat endpoint bao cao, khop lenh da chay that"
        }
      ],
      "boundaries": [
        "xem bao cao JSON khong ghi audit (tranh nhieu log); chi xuat CSV moi ghi audit (xem R-9)",
        "khong tao bang tong hop moi, khong luu cot tong rieng, khong cache ket qua bao cao trong DB hay file — moi lan goi tinh lai tu du lieu goc; KHONG migration 015 tru khi Lead chung minh can index (khi do chi them index, ghi ro trong D28)",
        "seed KHONG them du lieu mau moi (demo tu tao) — giu nguyen 2 user, 2 san pham, 2 kho + muc ton mau de test khoa van xanh",
        "test moi them vao file test moi, KHONG sua 333 test da khoa cua GOAL-001..009; du lieu test gia lap (2 org, 2 chi nhanh, 2 kho, 2 kenh tro len)",
        "khong duoc claim VPS, deploy production hay cong thanh toan that; khong duoc luu thong tin the o bat ky dau (DB, API, log, audit_log)"
      ],
      "prohibited": [
        "khong duoc sua test da khoa cua GOAL-001..009; khong duoc commit secret/credential that; khong duoc commit file .github/workflows/ (CI cho user cap scope workflow)",
        "khong duoc luu bang tong hop rieng hay cot tong rieng; khong duoc cache ket qua bao cao",
        "khong duoc ghi PII khach (phone/email/address) hay thong tin the vao audit_log",
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
      "timeoutMs": 600000,
      "env": {}
    }
  ],
  "dependencies": [
    "GOAL-005",
    "GOAL-006",
    "GOAL-007"
  ],
  "priority": 3
}
```
