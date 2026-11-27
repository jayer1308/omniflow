# WP-MAIN v1: OmniFlow co nghiep vu khach hang + CRM tren don hang GOAL-005: ho so khach (chi nhanh chinh, dien thoai duy nhat trong org) + lich su mua (chi don completed) + tich diem 1 diem/10.000d khi don completed va doi diem 1 diem=100d tru tien don moi (khong het han, khong am, idempotency trong transaction) + ghi chu cham soc append-only + phan khuc tinh o service (VIP/ngu quen/thuong xuyen/moi, uu tien VIP truoc) + tim/loc khach theo ten/dien thoai/phan khuc/chi nhanh + hop nhat ho so trung co xac nhan (khong mat diem/lich su) + xuat du lieu khach va xoa chi khi chua co don, khong PII trong log; RBAC theo ma tran khach/CRM + audit log day du; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc khach/CRM moi; yeu cau R-16 va R-17 cua GOAL-006 duoc loai tru co ly do (out-of-scope)

```json
{
  "id": "WP-MAIN",
  "goalId": "GOAL-008",
  "goalVersion": 2,
  "version": 1,
  "owner": "lead",
  "outcome": "OmniFlow co nghiep vu khach hang + CRM tren don hang GOAL-005: ho so khach (chi nhanh chinh, dien thoai duy nhat trong org) + lich su mua (chi don completed) + tich diem 1 diem/10.000d khi don completed va doi diem 1 diem=100d tru tien don moi (khong het han, khong am, idempotency trong transaction) + ghi chu cham soc append-only + phan khuc tinh o service (VIP/ngu quen/thuong xuyen/moi, uu tien VIP truoc) + tim/loc khach theo ten/dien thoai/phan khuc/chi nhanh + hop nhat ho so trung co xac nhan (khong mat diem/lich su) + xuat du lieu khach va xoa chi khi chua co don, khong PII trong log; RBAC theo ma tran khach/CRM + audit log day du; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc khach/CRM moi; yeu cau R-16 va R-17 cua GOAL-006 duoc loai tru co ly do (out-of-scope)",
  "scope": [
    "docs/",
    "src/",
    "scripts/",
    "tests/",
    "README.md",
    "brief-008.md",
    "goal-008.json",
    ".gitignore"
  ],
  "exclusions": [
    "Khuyến mãi (GOAL-009), báo cáo/đối soát tổng hợp (GOAL-010), thông báo (GOAL-011), UI tổng quan (GOAL-012) — thuộc goal sau, không làm trong GOAL-008.",
    "Đơn vị vận chuyển thật / giao hàng thật, tài khoản hãng vận chuyển — ngoài phạm vi vĩnh viễn của dự án giả lập này; deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user cấp scope workflow).",
    "Yêu cầu R-16 của GOAL-006 được loại trừ có lý do (out-of-scope) trong goal này — xem requirement R-16; không adopt vì toàn bộ phạm vi giao/trả của R-16 đã được sở hữu bởi requirements riêng R-1..R-15 của GOAL-007 (đã implement + kiểm chứng đầy đủ), deferral gộp này giờ là thừa; adopt vào GOAL-008 sẽ nhận sai phạm vi (khách hàng + CRM, không phải giao/trả).",
    "Yêu cầu R-17 của GOAL-006 được loại trừ có lý do (out-of-scope) trong goal này — xem requirement R-22; R-17 chỉ là câu phủ định phạm vi của GOAL-006, phạm vi CRM đã được sở hữu bởi requirements riêng R-1..R-15 của GOAL-008."
  ],
  "dependencies": [],
  "interfaces": [
    "GOAL-008@v1"
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Ho so khach hang + lich su mua (AC-1): migration 013 tao 3 bang customers/customer_points/customer_notes + ALTER TABLE orders them customer_id NULL FK toi customers va points_discount INTEGER NOT NULL DEFAULT 0 CHECK >= 0 (don cu giu NULL/0); customers co org_id NOT NULL FK, branch_id NULL FK (chi nhanh chinh — NULL la chua gan; khach mua nhieu chi nhanh van chi co 1 chi nhanh chinh, lich su mua tinh theo org), name NOT NULL, phone/email/address NULL, status CHECK IN ('active','merged') mac dinh 'active', merged_into_id NULL FK toi customers, UNIQUE(org_id, phone) (SQLite cho nhieu NULL); POST /api/customers tao khach (name trong -> 400, trung phone khach active trong org -> 409, branch_id khong ton tai -> 404, ngoai org -> 403; sales tao khach: branch_id khac chi nhanh minh -> 403, khong gui thi khach thuoc chi nhanh minh) -> 201 kem purchase_summary rong + points_balance 0 + segment 'new'; PATCH /api/customers/:id sua khach (name trong -> 400, doi phone trung khach active khac -> 409, khach merged -> 400); POST /api/orders nhan them customer_id optional (khach khong ton tai -> 404, ngoai org -> 403, khach merged -> 400; khong gui thi nhu truoc); GET /api/customers/:id tra khach kem purchase_summary (total_spent = tong total cac don completed, CHUA tru hoan tien; order_count = so don completed; last_order_at = created_at don completed moi nhat, NULL khi chua co) + points_balance + segment; GET /api/customers/:id/orders tra don cua khach (moi nhat truoc, kem items, phan trang limit/offset nhu GOAL-005); moi API doc loc theo org + pham vi vai, ngoai org -> 403, khach khong ton tai -> 404",
      "goalAcceptanceId": "AC-1",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-2",
      "text": "Diem tich luy + doi diem + ledger (AC-2): customer_points ledger append-only (customer_id/org_id NOT NULL FK, type CHECK IN ('earn','redeem'), points INTEGER CHECK > 0, reason NOT NULL, order_id NULL FK, created_by NOT NULL FK, created_at; chi INSERT, khong co API UPDATE/DELETE ledger); so du = tong earn - tong redeem tinh o service; POST /api/customers/:id/points/earn {order_id, idempotency_key?} — chi don completed, don phai thuoc khach, moi don chi tich 1 lan, so diem = floor((order_total - tong hoan completed cua don) / 10000), tong sau hoan < 10.000d -> 400; POST /api/customers/:id/points/redeem {order_id, points, idempotency_key?} — chi don draft cua khach, points nguyen > 0 va <= so du, discount = min(points x 100, order_total), mot don chi doi 1 lan, trong CUNG MOT transaction ghi ledger redeem + cap nhat orders.points_discount; GET /api/customers/:id/points tra {balance, ledger} (moi nhat truoc); computePaymentSummary mo rong: outstanding = order_total - points_discount - paid_total, payment_status giu nguyen logic D22; idempotency dung withStockIdempotency voi ten mien customer:points-earn:<key> / customer:points-redeem:<key>, gui lai tra replayed: true khong cong/tru lan 2",
      "goalAcceptanceId": "AC-2",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-3",
      "text": "Ghi chu cham soc + phan khuc + tim/loc khach (AC-3): customer_notes append-only (customer_id/org_id NOT NULL FK, author_id NOT NULL FK, content NOT NULL, created_at; chi INSERT, khong co API UPDATE/DELETE); POST /api/customers/:id/notes {content} (trong -> 400, khach merged -> 400) -> 201 + audit log; GET /api/customers/:id/notes moi nhat truoc, phan trang nhu GOAL-005; segment tinh o service moi lan doc, KHONG luu cot rieng: vip khi total_spent >= 5.000.000d HOAC order_count >= 10; dormant khi co >= 1 don completed va lan mua cuoi > 90 ngay; frequent khi order_count >= 3; con lai new; thu tu uu tien VIP -> ngu quen -> thuong xuyen -> moi; GET /api/customers?name=&phone=&segment=&branch_id=&limit=&offset= (name/phone chuoi con khong phan biet hoa thuong; segment la -> 400; branch_id khong ton tai -> 404, ngoai org -> 403; limit mac dinh 20 toi da 100, offset mac dinh 0, kem total); khach merged khong xuat hien trong danh sach mac dinh; moi API doc loc theo org + pham vi vai",
      "goalAcceptanceId": "AC-3",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-4",
      "text": "Hop nhat ho so + xuat/xoa du lieu ca nhan (AC-4): POST /api/customers/:id/merge {source_customer_id, confirm, idempotency_key?} — :id la ho so GIU LAI; confirm phai la true (thieu/false -> 400, khong lam gi); hop nhat voi chinh minh -> 400; khach giu/nguon khong ton tai -> 404, ngoai org -> 403; nguon hoac giu da merged -> 400; thanh cong trong CUNG MOT transaction: moi don (orders.customer_id) + ledger (customer_points.customer_id) + ghi chu (customer_notes.customer_id) cua nguon chuyen sang khach giu; nguon chuyen status 'merged', merged_into_id = id khach giu, phone/email ve NULL; ghi 1 audit log (chi id, KHONG chua phone/email); tra khach giu kem purchase_summary + points_balance + segment sau hop nhat; GET /api/customers/:id/export tra JSON {customer, orders (kem items), points: {balance, ledger}, notes} + 1 audit log (khach merged van export duoc, orders/points/notes rong kem merged_into_id); DELETE /api/customers/:id chi khi khach CHUA CO don nao (co don -> 400; da merged -> 400), xoa cung ghi chu + ledger trong cung transaction + 1 audit log; audit detail cua MOI thao tac khach KHONG chua phone/email/address; idempotency hop nhat dung withStockIdempotency ten mien customer:merge:<key>, gui lai tra replayed: true khong chuyen lan 2",
      "goalAcceptanceId": "AC-4",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-5",
      "text": "RBAC + audit + test/checks/docs (AC-5): mo rong helper can() o src/rbac.ts them 9 actions create-customer, update-customer, view-customers, earn-points, redeem-points, add-note, merge-customers, export-customer, delete-customer theo dung ma tran khach/CRM (tao/sua: owner/manager/sales dung chi nhanh; xem: moi vai theo pham vi, warehouse/accountant toan org chi xem; tich/doi diem: owner/manager/sales dung chi nhanh; ghi chu: owner/manager/sales dung chi nhanh, warehouse/accountant chi xem; hop nhat: chi owner/manager; xuat: owner/manager/accountant toan org, sales dung chi nhanh, warehouse 403; xoa: chi owner/manager); moi endpoint khach qua requireRole + can() (vai sai/sai chi nhanh/ngoai org -> 403); audit_log ghi MOI thao tac khach/CRM; customer_points/customer_notes ghi du moi lan tich/doi/ghi chu (gui lai cung key thi KHONG ghi dong moi); test moi (vitest + supertest, file moi) chung minh toan bo hanh vi AC-1..AC-4 + RBAC 403; du lieu GIA LAP hoan toan, secret qua bien moi truong, check.sh van quet secret; scripts/check.sh va scripts/demo.sh duoc MO RONG them buoc khach/CRM, giu cac buoc GOAL-001..007 xanh, tu chay duoc, tu don dep, in PASS/FAIL tung buoc; docs RBAC/DECISIONS(D26)/README/SETUP cap nhat",
      "goalAcceptanceId": "AC-5",
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
    "brief-008.md",
    "goal-008.json",
    ".gitignore"
  ],
  "stubPaths": [
    "src/app.ts",
    "src/adapters/index.ts",
    "src/auth.ts",
    "src/db.ts",
    "src/orders.ts",
    "src/rbac.ts",
    "src/seed.ts",
    "src/tenant.ts",
    "src/idempotency.ts",
    "src/products.ts",
    "src/payments.ts",
    "src/stock.ts"
  ]
}
```
