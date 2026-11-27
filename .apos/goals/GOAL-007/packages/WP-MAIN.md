# WP-MAIN v1: OmniFlow co nghiep vu giao hang + tra hang tren don hang GOAL-005: yeu cau giao cho don completed qua adapter fake (ma van don deterministic, phi/ETA tu quote), cap nhat trang thai giao lap la no-op khong ghi event, sai thu tu bi tu choi; tra hang duyet/tu choi co ly do, nhan hang nhap lai kho dung so ban lai duoc (hang hong khong nhap kho), hoan tien qua dung duong GOAL-006; doi chieu don-thanh toan-kho sau tra dung so; RBAC theo ma tran giao/tra + audit log day du; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc giao/tra moi; yeu cau R-20 cua GOAL-004 duoc loai tru co ly do (out-of-scope)

```json
{
  "id": "WP-MAIN",
  "goalId": "GOAL-007",
  "goalVersion": 1,
  "version": 1,
  "owner": "lead",
  "outcome": "OmniFlow co nghiep vu giao hang + tra hang tren don hang GOAL-005: yeu cau giao cho don completed qua adapter fake (ma van don deterministic, phi/ETA tu quote), cap nhat trang thai giao lap la no-op khong ghi event, sai thu tu bi tu choi; tra hang duyet/tu choi co ly do, nhan hang nhap lai kho dung so ban lai duoc (hang hong khong nhap kho), hoan tien qua dung duong GOAL-006; doi chieu don-thanh toan-kho sau tra dung so; RBAC theo ma tran giao/tra + audit log day du; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc giao/tra moi; yeu cau R-20 cua GOAL-004 duoc loai tru co ly do (out-of-scope)",
  "scope": [
    "docs/",
    "src/",
    "scripts/",
    "tests/",
    "README.md",
    "brief-007.md",
    "goal-007.json",
    ".gitignore"
  ],
  "exclusions": [
    "Khuyến mãi (GOAL-009), báo cáo/đối soát tổng hợp (GOAL-010), khách hàng + CRM (GOAL-008), thông báo (GOAL-011), UI tổng quan (GOAL-012) — thuộc goal sau, không làm trong GOAL-007.",
    "Đơn vị vận chuyển thật / giao hàng thật, tài khoản hãng vận chuyển — ngoài phạm vi vĩnh viễn của dự án giả lập này.",
    "Deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user cấp scope workflow).",
    "Yêu cầu R-20 của GOAL-004 được loại trừ có lý do (out-of-scope) trong goal này — xem requirement R-20; không adopt vì R-20 gộp 3 phạm vi (thanh toán GOAL-006 đã xong, trả hàng là yêu cầu riêng GOAL-007, khuyến mãi là yêu cầu riêng GOAL-009)."
  ],
  "dependencies": [],
  "interfaces": [
    "GOAL-007@v1"
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Giao hang + schema giao/tra (AC-1): migration 012 tao 5 bang shipments/shipment_events/returns/return_items/return_events; POST /api/orders/:id/shipments tao shipment — chi don completed, carrier/destination bat buoc, fee/eta tu FakeShippingAdapter.quote() (khoi luong = tong so luong x 500g), tracking_code deterministic duy nhat theo shipment, 1 shipment chua cuoi moi don; FakeShippingAdapter mo rong them ma van don deterministic (vi du trackingRef(orderCode, carrier, shipmentId) tra FAKE-TRK-<hash12>), giu simulated: true; idempotency yeu cau giao dung withStockIdempotency (ten mien shipment:create:<key>) trong cung transaction BEGIN IMMEDIATE, gui lai tra replayed: true khong tao moi; moi tao shipment trong BEGIN IMMEDIATE + UNIQUE(tracking_code) chong ghi nhan 2 lan",
      "goalAcceptanceId": "AC-1",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-2",
      "text": "Cap nhat trang thai giao hang lap/sai thu tu (AC-2): POST /api/shipments/:id/status nhan {status: 'in_transit' | 'delivered' | 'failed', reason?, idempotency_key?} — chi cho phep requested -> in_transit -> delivered va requested/in_transit -> failed (failed la trang thai cuoi); chuyen sai thu tu -> 400, khong doi gi, khong ghi event; gui lai cung trang thai hien tai -> 200, tra shipment hien tai, KHONG tao event moi; failed bat buoc co reason; thanh cong -> 200 + event tuong ung + audit log; moi chuyen trong BEGIN IMMEDIATE",
      "goalAcceptanceId": "AC-2",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-3",
      "text": "Tra hang: yeu cau/duyet/nhan/nhap lai kho/hoan tien/doi chieu (AC-3): POST /api/orders/:id/returns nhan {items: [{variant_id, qty, condition}], reason} — chi don completed, bien the phai thuoc don, tong tra tich luy moi bien the (tinh ca yeu cau chua bi tu choi) khong vuot so da dat, unit_price snapshot tu order_items, ma TH-YYYYMMDD-NNNN; duyet/tu choi chi tu requested (tu choi bat buoc co reason); nhan hang chi tu approved, trong CUNG MOT transaction: resalable nhap lai kho cua don bang applyMovement loai in (reference = ma tra), damaged KHONG nhap kho, KHONG ghi movement; hoan tien chi tu received, so tien = tong unit_price x qty (ca ban lai duoc lan hong), dung dung duong GOAL-006 (createRefundTx + bang refunds, hoan vao payment paid cu nhat truoc, vuot so con hoan duoc -> 400, return o lai received); GET shipments/returns kem items + events; doi chieu sau tra: payments summary (paid_total tru refund, payment_status dung) + stock levels (on_hand tang dung so ban lai duoc) khop nhau",
      "goalAcceptanceId": "AC-3",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-4",
      "text": "RBAC + audit + test/checks/docs (AC-4): mo rong helper can() o src/rbac.ts them 8 actions request-shipment, update-shipment, view-shipments, request-return, review-return, receive-return, refund-return, view-returns theo dung ma tran giao/tra (yeu cau giao/cap nhat: owner/manager/warehouse dung kho, sales/accountant 403; yeu cau tra: owner/manager/sales dung chi nhanh; duyet/tu choi: owner/manager; nhan hang: owner/manager/warehouse dung kho; hoan tien tra hang: owner/manager/accountant; xem: moi vai theo pham vi); moi endpoint giao/tra qua requireRole + can() (vai sai/sai chi nhanh/sai kho/ngoai org -> 403); audit_log ghi MOI thao tac giao/tra; shipment_events/return_events ghi du moi lan tao/chuyen trang thai (gui lai cung trang thai giao thi KHONG ghi event moi); test moi (vitest + supertest, file moi) chung minh toan bo hanh vi AC-1..AC-3 + RBAC 403; du lieu GIA LAP hoan toan, secret qua bien moi truong, check.sh van quet secret; scripts/check.sh va scripts/demo.sh duoc MO RONG them buoc giao/tra, giu cac buoc GOAL-001..006 xanh, tu chay duoc, tu don dep, in PASS/FAIL tung buoc; docs RBAC/DECISIONS(D24, D25)/README/SETUP cap nhat",
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
    "views/**",
    "public/**",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vitest.config.*",
    "README.md",
    "docs/**",
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
