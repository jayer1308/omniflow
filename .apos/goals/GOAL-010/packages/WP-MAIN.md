# WP-MAIN v1: OmniFlow co bao cao + doi soat tren du lieu that da co: bao cao doanh thu theo kenh/chi nhanh/san pham/danh muc/thoi gian (mac dinh thang hien tai, chi tinh don completed, thoi gian theo thoi diem hoan tat tu order_events, hien thi Asia/Ho_Chi_Minh); bao cao ton kho + bien dong + canh bao ton thap; doi soat 3 mat kho–don–thanh toan (le th liet ke tung dong kem so ky vong vs thuc te, du lieu mau da biet cho 0 dong error); bao cao khuyen mai da dung + diem da doi; xuat CSV cho moi bao cao (so lieu khop API JSON); phan quyen xem bao cao theo vai + scope chi nhanh/kho (accountant toan org, sales chi chi nhanh minh, warehouse chi bao cao ton theo kho duoc gan); audit log cho xuat bao cao; bao cao tinh o service, khong luu bang tong rieng; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc bao cao moi; 3 yeu cau mo coi khuyen mai (R-18 GOAL-006, R-16 GOAL-007, R-17 GOAL-008) duoc loai tru co ly do (out-of-scope)

```json
{
  "id": "WP-MAIN",
  "goalId": "GOAL-010",
  "goalVersion": 1,
  "version": 1,
  "owner": "lead",
  "outcome": "OmniFlow co bao cao + doi soat tren du lieu that da co: bao cao doanh thu theo kenh/chi nhanh/san pham/danh muc/thoi gian (mac dinh thang hien tai, chi tinh don completed, thoi gian theo thoi diem hoan tat tu order_events, hien thi Asia/Ho_Chi_Minh); bao cao ton kho + bien dong + canh bao ton thap; doi soat 3 mat kho–don–thanh toan (le th liet ke tung dong kem so ky vong vs thuc te, du lieu mau da biet cho 0 dong error); bao cao khuyen mai da dung + diem da doi; xuat CSV cho moi bao cao (so lieu khop API JSON); phan quyen xem bao cao theo vai + scope chi nhanh/kho (accountant toan org, sales chi chi nhanh minh, warehouse chi bao cao ton theo kho duoc gan); audit log cho xuat bao cao; bao cao tinh o service, khong luu bang tong rieng; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc bao cao moi; 3 yeu cau mo coi khuyen mai (R-18 GOAL-006, R-16 GOAL-007, R-17 GOAL-008) duoc loai tru co ly do (out-of-scope)",
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
  "dependencies": [],
  "interfaces": [
    "GOAL-010@v1"
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Bao cao doanh thu + luat chi tinh completed (AC-1): dinh nghia chi so — chi don status 'completed' tai thoi diem bao cao; thoi gian don la thoi diem hoan tat (order_events to_status='completed', created_at UTC, hien thi Asia/Ho_Chi_Minh); don draft/confirmed/processing/cancelled KHONG vao doanh thu (ke ca da thu dat coc); don completed bi tra hang van tinh doanh thu gop, tien hoan tru rieng; gross = Σ orders.total, net = Σ (total − points_discount − promo_discount), so don = so don completed trong ky, tien da thu = Σ paid_total (theo don, khong theo ngay thu), tien hoan = Σ refunded_total, con phai thu = Σ outstanding (am nghia la thua); from/to la ngay theo Asia/Ho_Chi_Minh, mac dinh thang hien tai, from > to -> 400; tien so nguyen dong. GET /api/reports/revenue?from=&to=&channel=&branch_id=&group_by= (group_by ∈ day/month/channel/branch/product/category, mac dinh day) tra {from, to, timezone: 'Asia/Ho_Chi_Minh', totals: {gross_revenue, net_revenue, order_count, paid_total, refunded_total, outstanding_total, points_discount_total, promo_discount_total}, rows: [...]} — totals bang tong cac rows; nhom product dung order_items (line_total snapshot, diem/ma phan bo theo ti le line_total/total, ghi cong thuc trong D28); nhom category gom san pham chua co danh muc vao 'Chua phan loai'; ky rong -> totals 0, rows rong (200). Moi API bao cao loc theo org.",
      "goalAcceptanceId": "AC-1",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-2",
      "text": "Bao cao ton kho + doi soat 3 mat (AC-2): GET /api/reports/stock?warehouse_id=&variant_id=&from=&to= tra ton tai thoi diem goi + bien dong trong ky — levels theo tung cap (bien the, kho) {variant_id, sku, product_name, warehouse_id, warehouse_name, on_hand, reserved, available} (available = on_hand − reserved, D17), movements tom tat theo loai {type, count, qty_total} trong ky, low_stock = cac cap available < products.min_stock kem min_stock va shortage; loc kho/bien the khong ton tai -> 404, ngoai org -> 403; kho inactive van hien. GET /api/reports/reconciliation?from=&to=&branch_id= tra {from, to, timezone, summary: {checked_orders, checked_stock_pairs, mismatch_count}, mismatches: [...]} theo 3 mat: (a) kho — ton ky vong = Σ qty_change / giu ky vong = Σ reserved_change cua MOI movement tu dau so voi stock_levels hien tai, lech -> kind 'stock-level' kem expected/actual/difference; (b) don–kho — moi don completed trong ky: moi dong order_items phai co movement out (reference = ma don, qty_change = −so luong) kem release tuong ung (D19), thieu/thua/sai so -> kind 'order-stock' kem order_code/variant_id/expected_qty/actual_qty; (c) don–tien — dung lai computePaymentSummary: outstanding > 0 -> kind 'order-payment' 'chua thu du' severity info, outstanding < 0 -> 'thu thua' severity info, refunded_total lech tong refund completed -> severity error. Doi soat tung don dung lai computePaymentSummary (outstanding = order_total − points_discount − promo_discount − paid_total), payment_status GIU NGUYEN logic D22; bao cao hien thi ca outstanding lan payment_status.",
      "goalAcceptanceId": "AC-2",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-3",
      "text": "Bao cao khuyen mai + diem + xuat CSV (AC-3): GET /api/reports/promotions?from=&to=&code= tra theo tung ma {code, promotion_id, used_count, released_count, total_discount, order_count} — used_count = so usage 'used', released_count = so usage 'released' (D27), total_discount = Σ discount_amount cua usage 'used' tao trong ky, order_count = so don khac nhau co usage trong ky; loc code theo chuoi con; ma chua dung trong ky van hien voi so 0. GET /api/reports/points?from=&to= tra {totals: {earned_total, redeemed_total, redeemed_amount}, rows: [{customer_id, customer_name, earned, redeemed, redeemed_amount}]} — redeemed_amount = redeemed_total × 100d (D26), diem tich tren tong goc (D27). Moi endpoint bao cao (revenue/stock/reconciliation/promotions/points) nhan them ?format=csv tra Content-Type text/csv; charset=utf-8, cung du lieu voi ban JSON: dung cac cot da dinh nghia (doanh thu: key,label,gross_revenue,net_revenue,order_count,paid_total,refunded_total,points_discount_total,promo_discount_total; ton kho: variant_id,sku,product_name,warehouse_id,warehouse_name,on_hand,reserved,available,min_stock,shortage; doi soat: kind,severity,order_code,variant_id,warehouse_id,expected,actual,difference,note; khuyen mai: code,used_count,released_count,total_discount,order_count; diem: customer_id,customer_name,earned,redeemed,redeemed_amount); dong TOTAL cuoi file cho bao cao doanh thu/khuyen mai/diem (khop totals JSON); dung csv-stringify nhu GOAL-003 (xu ly BOM, dau phay trong ten).",
      "goalAcceptanceId": "AC-3",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-4",
      "text": "RBAC + audit + khong bang tong + test/checks/docs (AC-4): mo rong helper can() o src/rbac.ts them 2 actions view-reports (xem bao cao JSON) va export-reports (xuat CSV) theo dung ma tran bao cao (xem doanh thu/doi soat/khuyen mai/diem + xuat CSV: owner/manager toan org, accountant toan org chi xem; sales chi chi nhanh minh — khong co branch_id thi mac dinh loc chi nhanh minh, branch_id khac -> 403, xem bao cao ton -> 403; warehouse chi xem bao cao ton kho duoc gan — warehouse_id NULL = moi kho, hoi kho ngoai pham vi -> 403, cac bao cao khac -> 403); moi endpoint bao cao qua requireRole + can() (vai sai/sai chi nhanh/kho/ngoai org -> 403). Audit log ghi MOI lan xuat CSV bao cao (action 'export-report', detail JSON {report, from, to, format: 'csv', filter da dung}, KHONG chua thong tin the/PII); xem JSON khong ghi audit. Moi so lieu bao cao tinh o service tu bang da co (orders/order_items/order_events, payments/refunds, stock_levels/stock_movements, promotion_usages, customer_points, products/variants/categories), KHONG tao bang tong hop moi, KHONG luu cot tong rieng, KHONG cache; test moi (vitest + supertest, file moi) chung minh toan bo hanh vi AC-1..AC-3 + RBAC 403 + audit xuat CSV; du lieu GIA LAP hoan toan, secret qua bien moi truong, check.sh van quet secret; scripts/check.sh va scripts/demo.sh duoc MO RONG them buoc bao cao, giu cac buoc GOAL-001..009 xanh, tu chay duoc, tu don dep, in PASS/FAIL tung buoc; docs RBAC/DECISIONS(D28)/README/SETUP cap nhat.",
      "goalAcceptanceId": "AC-4",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    }
  ],
  "integration": "Solo: the package is the whole Goal",
  "paths": [
    "src/**",
    "tests/**",
    "scripts/**",
    "docs/**",
    "README.md",
    ".gitignore"
  ],
  "stubPaths": [
    "src/app.ts",
    "src/db.ts",
    "src/seed.ts",
    "src/auth.ts",
    "src/orders.ts",
    "src/payments.ts",
    "src/customers.ts",
    "src/rbac.ts",
    "src/stock.ts",
    "src/products.ts",
    "src/promotions.ts",
    "src/reports.ts",
    "src/adapters/index.ts",
    "src/tenant.ts",
    "src/idempotency.ts"
  ]
}
```
