# GOAL-007 v1: solo-direct

Mot package WP-MAIN duy nhat xay toan bo giao hang + tra hang trong mot lan: migration 012 tao shipments/shipment_events/returns/return_items/return_events (UNIQUE tracking_code, UNIQUE code TH-YYYYMMDD-NNNN trong org, CHECK status/condition/qty/fee/eta, FK org/order/variant/user); mo rong FakeShippingAdapter them trackingRef(orderCode, carrier, shipmentId) tra FAKE-TRK-<hash12> (digest phai co shipment id, cung input cung ma, khac shipment khac ma), giu quote() + simulated: true; routes POST /api/orders/:id/shipments (chi don completed, carrier/destination bat buoc, fee/eta tu quote() voi khoi luong = tong so luong x 500g, toi da 1 shipment chua cuoi moi don, 201 + 1 event created + 1 audit log), POST /api/shipments/:id/status (requested -> in_transit -> delivered, requested/in_transit -> failed bat buoc reason, sai thu tu -> 400 khong doi gi khong ghi event, gui lai cung trang thai -> 200 no-op KHONG tao event moi, failed la trang thai cuoi), GET /api/orders/:id/shipments + GET /api/shipments/:id (kem events cu nhat truoc); POST /api/orders/:id/returns (chi don completed, bien the thuoc don, tong tra tich luy tinh ca yeu cau chua bi tu choi khong vuot so da dat, unit_price snapshot tu order_items, ma TH-YYYYMMDD-NNNN, 201 + event created + audit), POST /api/returns/:id/approve + /reject (chi tu requested, tu choi bat buoc reason), POST /api/returns/:id/receive (chi tu approved, resalable nhap lai kho cua don bang applyMovement loai in reference = ma tra trong CUNG MOT transaction BEGIN IMMEDIATE, damaged KHONG nhap kho KHONG ghi movement), POST /api/returns/:id/refund (chi tu received, so tien = tong unit_price x qty CA resalable lan damaged, dung DUNG createRefundTx o src/app.ts + bang refunds cua GOAL-006 — KHONG viet lai logic hoan, hoan vao payment paid cu nhat truoc, vuot so con hoan duoc -> 400 return o lai received), GET /api/orders/:id/returns + GET /api/returns/:id (kem items + events); moi thao tac giao/tra qua withStockIdempotency trong BEGIN IMMEDIATE voi ten mien shipment:create:<key> / shipment:update:<key> / return:create:<key> / return:review:<key> / return:receive:<key> / return:refund:<key> (gui lai -> replayed: true, KHONG tao moi); doi chieu sau tra dung lai computePaymentSummary (src/payments.ts) + GET /api/stock/levels; mo rong src/rbac.ts them 8 actions request-shipment/update-shipment/view-shipments/request-return/review-return/receive-return/refund-return/view-returns theo ma tran brief (Target dung branchId + warehouseId cua don); audit_log MOI thao tac giao/tra (action + detail JSON target_order_id/order_code/target_shipment_id/target_return_id/tracking_code/return_code/from_status/to_status, KHONG chua thong tin the); shipment_events/return_events append-only (khong co API UPDATE/DELETE, goi sua/xoa -> 404/405); docs RBAC/D24/D25/README/SETUP; mo rong check.sh/demo.sh them buoc giao/tra, giu cac buoc GOAL-001..006 xanh. D24 (mo hinh giao hang): shipment la du lieu cap org gan don, state machine rieng khong doi trang thai don GOAL-005, chi giao don completed, 1 shipment chua cuoi moi don, khoi luong mac dinh tong so luong x 500g (khong them truong can nang), ma van don deterministic co shipment id trong digest, gui lai cung trang thai la no-op muc trang thai (khac webhook GOAL-006). D25 (mo hinh tra hang): vong doi requested -> approved -> received -> refunded / requested -> rejected; nhan hang + nhap lai kho co chon loc trong cung transaction (khong co trang thai 'da nhan nhung chua nhap kho', dung lai movement in cua D17); hoan tien tra hang tinh CA hang hong, dung lai dung duong GOAL-006 (createRefundTx + refunds, hoan vao payment cu nhat truoc), vuot so con hoan duoc -> 400; tong tra tich luy tinh ca yeu cau dang cho duyet; app mot tien trinh (D1) nen bao ve race chi co y nghia trong mot process, da process ngoai pham vi.

```json
{
  "id": "GOAL-007",
  "version": 1,
  "goalId": "GOAL-007",
  "goalVersion": 1,
  "mode": "solo-direct",
  "approach": "Mot package WP-MAIN duy nhat xay toan bo giao hang + tra hang trong mot lan: migration 012 tao shipments/shipment_events/returns/return_items/return_events (UNIQUE tracking_code, UNIQUE code TH-YYYYMMDD-NNNN trong org, CHECK status/condition/qty/fee/eta, FK org/order/variant/user); mo rong FakeShippingAdapter them trackingRef(orderCode, carrier, shipmentId) tra FAKE-TRK-<hash12> (digest phai co shipment id, cung input cung ma, khac shipment khac ma), giu quote() + simulated: true; routes POST /api/orders/:id/shipments (chi don completed, carrier/destination bat buoc, fee/eta tu quote() voi khoi luong = tong so luong x 500g, toi da 1 shipment chua cuoi moi don, 201 + 1 event created + 1 audit log), POST /api/shipments/:id/status (requested -> in_transit -> delivered, requested/in_transit -> failed bat buoc reason, sai thu tu -> 400 khong doi gi khong ghi event, gui lai cung trang thai -> 200 no-op KHONG tao event moi, failed la trang thai cuoi), GET /api/orders/:id/shipments + GET /api/shipments/:id (kem events cu nhat truoc); POST /api/orders/:id/returns (chi don completed, bien the thuoc don, tong tra tich luy tinh ca yeu cau chua bi tu choi khong vuot so da dat, unit_price snapshot tu order_items, ma TH-YYYYMMDD-NNNN, 201 + event created + audit), POST /api/returns/:id/approve + /reject (chi tu requested, tu choi bat buoc reason), POST /api/returns/:id/receive (chi tu approved, resalable nhap lai kho cua don bang applyMovement loai in reference = ma tra trong CUNG MOT transaction BEGIN IMMEDIATE, damaged KHONG nhap kho KHONG ghi movement), POST /api/returns/:id/refund (chi tu received, so tien = tong unit_price x qty CA resalable lan damaged, dung DUNG createRefundTx o src/app.ts + bang refunds cua GOAL-006 — KHONG viet lai logic hoan, hoan vao payment paid cu nhat truoc, vuot so con hoan duoc -> 400 return o lai received), GET /api/orders/:id/returns + GET /api/returns/:id (kem items + events); moi thao tac giao/tra qua withStockIdempotency trong BEGIN IMMEDIATE voi ten mien shipment:create:<key> / shipment:update:<key> / return:create:<key> / return:review:<key> / return:receive:<key> / return:refund:<key> (gui lai -> replayed: true, KHONG tao moi); doi chieu sau tra dung lai computePaymentSummary (src/payments.ts) + GET /api/stock/levels; mo rong src/rbac.ts them 8 actions request-shipment/update-shipment/view-shipments/request-return/review-return/receive-return/refund-return/view-returns theo ma tran brief (Target dung branchId + warehouseId cua don); audit_log MOI thao tac giao/tra (action + detail JSON target_order_id/order_code/target_shipment_id/target_return_id/tracking_code/return_code/from_status/to_status, KHONG chua thong tin the); shipment_events/return_events append-only (khong co API UPDATE/DELETE, goi sua/xoa -> 404/405); docs RBAC/D24/D25/README/SETUP; mo rong check.sh/demo.sh them buoc giao/tra, giu cac buoc GOAL-001..006 xanh. D24 (mo hinh giao hang): shipment la du lieu cap org gan don, state machine rieng khong doi trang thai don GOAL-005, chi giao don completed, 1 shipment chua cuoi moi don, khoi luong mac dinh tong so luong x 500g (khong them truong can nang), ma van don deterministic co shipment id trong digest, gui lai cung trang thai la no-op muc trang thai (khac webhook GOAL-006). D25 (mo hinh tra hang): vong doi requested -> approved -> received -> refunded / requested -> rejected; nhan hang + nhap lai kho co chon loc trong cung transaction (khong co trang thai 'da nhan nhung chua nhap kho', dung lai movement in cua D17); hoan tien tra hang tinh CA hang hong, dung lai dung duong GOAL-006 (createRefundTx + refunds, hoan vao payment cu nhat truoc), vuot so con hoan duoc -> 400; tong tra tich luy tinh ca yeu cau dang cho duyet; app mot tien trinh (D1) nen bao ve race chi co y nghia trong mot process, da process ngoai pham vi.",
  "risks": [
    "Requirements R-1 (migration 012), R-9 (idempotency), R-10 (chong ghi nhan 2 lan), R-13 (test moi) duoc DUNG CHUNG o nhieu AC (AC-1+AC-3 dung R-1; AC-1/AC-2/AC-3 dung R-9, R-10, R-13) — theo luat APOS mot criterion can test phai thuoc dung MOT package, tach Multi-WP se buoc tach requirements/AC bang goal revise; Solo WP-MAIN tranh duoc van de nay (tien le GOAL-006: R-12 o 3 AC, Solo).",
    "Ma van don trung: digest trackingRef PHAI co shipment id — neu chi digest theo orderCode + carrier thi 2 lan giao cung don cung carrier trung tracking_code va UNIQUE chan nham lan giao hop le sau khi shipment cu failed/delivered; test AC-1 chung minh cung orderCode + carrier nhung khac shipmentId cho ma khac nhau.",
    "Gui lai cung trang thai giao KHONG duoc ghi event moi (khac webhook GOAL-006 ghi event ca ban trung) — Worker de nham copy mo hinh webhook se lam test AC-2 do; test dem event truoc/sau gui lap.",
    "Hoan tien tra hang: Worker de viet lai logic hoan thay vi dung createRefundTx o src/app.ts (KHONG phai src/payments.ts) se lam sai kiem tra tong hoan khong vuot so da tra va mat dong bo refunds; test AC-3 chung minh refund nam trong bang refunds GOAL-006 voi reason = ma tra + vuot so con hoan duoc -> 400.",
    "Nhan hang dong thoi 2 lan hoac hoan tien dong thoi 2 lan: chi chong bang BEGIN IMMEDIATE + kiem tra trang thai trong cung transaction moi khong nhap kho/hoan 2 lan; test race chung minh chi 1 lan thuc thi (lan con lai 400 hoac replayed: true).",
    "Tong tra tich luy: de chi cong yeu cau da nhan se cho tra vuot so da dat khi co nhieu yeu cau dang cho duyet; bat buoc cong MOI yeu cau chua bi tu choi; test AC-3 chung minh yeu cau thu hai vuot tong tich luy -> 400.",
    "208 test GOAL-001..006 da khoa — khong sua; brief-007.md + goal-007.json DA commit rieng tren main — KHONG dua 2 file nay vao commit package (gate APOS-SCOPE); FakeShippingAdapter.quote() hien tai phai giu nguyen hanh vi (phi 15000 + so chang 500g x 5000, ETA 1 ngay Ha Noi / 2 ngay con lai) de test khoa GOAL-001 van xanh.",
    "Khong can dependency moi nen khong co exception needs-human cho package.json. Khong co file .github/workflows/ trong repo (gh token thieu scope workflow)."
  ],
  "baseCommit": "205ad295e5fd442ca46148207f1b6d8f3a4215c4",
  "sourceSha256": "5586ce9122656edcbd73a2cf609470e1e354ef85fb39ffeb00c70cec04c7f906",
  "rationale": "Goal lien mach mot mien giao/tra: migration 012 + adapter + routes giao + routes tra + hoan tien dung lai GOAL-006 + doi soat + ma tran quyen chia se cung DB/app/audit log va phu thuoc lan nhau theo thu tu (AC-2/AC-3 build tren bang + shipment/return cua AC-1, AC-4 cham cung file rbac.ts/app.ts/check/demo); tach WP se chi them chi phi tich hop va buoc tach requirements dung chung (R-1/R-9/R-10/R-13) qua goal revise, trong khi Solo da chung minh hieu qua o GOAL-001/002/003/004/005/006 (dac biet GOAL-006 Solo 4 AC, 35 test, gate xanh ngay submit dau).",
  "sharedPaths": [],
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
  ],
  "entries": [
    "POST /api/orders/:id/shipments",
    "POST /api/shipments/:id/status",
    "GET /api/orders/:id/shipments",
    "GET /api/shipments/:id",
    "POST /api/orders/:id/returns",
    "POST /api/returns/:id/approve",
    "POST /api/returns/:id/reject",
    "POST /api/returns/:id/receive",
    "POST /api/returns/:id/refund",
    "GET /api/orders/:id/returns",
    "GET /api/returns/:id",
    "src/adapters/index.ts: FakeShippingAdapter.quote(weightGrams, destination), trackingRef(orderCode, carrier, shipmentId)",
    "src/rbac.ts: can()",
    "src/payments.ts: computePaymentSummary(db, orderId)"
  ],
  "acceptanceMapping": [
    {
      "acceptanceId": "AC-1",
      "verification": "WP-MAIN: migration 012 tao shipments (org/order NOT NULL FK, carrier/destination NOT NULL, tracking_code TEXT NOT NULL UNIQUE, fee INTEGER >= 0, eta_days INTEGER > 0, status requested/in_transit/delivered/failed mac dinh requested), shipment_events append-only (shipment_id FK, event_type, actor_id FK, detail, created_at), returns (org/order NOT NULL FK, code TEXT NOT NULL UNIQUE dang TH-YYYYMMDD-NNNN, reason NOT NULL, status requested/approved/rejected/received/refunded, reviewed_by/received_by FK NULL toi khi toi buoc do, review_reason NULL), return_items (return_id/variant_id FK, qty > 0, condition resalable/damaged, unit_price >= 0 snapshot tu order_items, UNIQUE(return_id, variant_id)), return_events append-only; POST /api/orders/:id/shipments 201 chi don completed (don draft/confirmed/processing/cancelled -> 400), carrier/destination trong -> 400, don khong ton tai 404, ngoai org 403, don da co shipment chua cuoi -> 400, shipment moi duoc phep sau khi shipment cu failed/delivered (ma moi khac ma cu); fee/eta tu FakeShippingAdapter.quote() voi khoi luong = tong so luong x 500g; trackingRef(orderCode, carrier, shipmentId) tra FAKE-TRK-<hash12> deterministic (cung input cung ma, khac shipment khac ma), giu simulated: true; idempotency tao shipment qua withStockIdempotency ten mien shipment:create:<key> (gui lai -> replayed: true, cung shipment, khong tao moi); giao hang KHONG doi trang thai don; khong co endpoint DELETE shipment/return"
    },
    {
      "acceptanceId": "AC-2",
      "verification": "WP-MAIN: POST /api/shipments/:id/status nhan {status: in_transit | delivered | failed, reason?, idempotency_key?} — chi cho requested -> in_transit -> delivered va requested/in_transit -> failed (failed la trang thai cuoi); chuyen sai thu tu -> 400, khong doi gi, khong ghi event; gui lai cung trang thai hien tai -> 200, tra shipment hien tai, KHONG tao event moi; failed bat buoc co reason (thieu -> 400); thanh cong -> 200 + event tuong ung + audit log; moi chuyen trong BEGIN IMMEDIATE; cap nhat dong thoi in_transit roi delivered khong ghi nhan sai thu tu (events la tien to dung thu tu created/in_transit/delivered); shipment_events append-only (PATCH/DELETE -> 404/405); shipment khong ton tai 404, ngoai org 403, status la 400"
    },
    {
      "acceptanceId": "AC-3",
      "verification": "WP-MAIN: POST /api/orders/:id/returns 201 chi don completed, bien the phai thuoc don, tong tra tich luy moi bien the (cong moi yeu cau chua bi tu choi) khong vuot so da dat, trung bien the trong cung yeu cau -> 400, items rong/reason trong/qty <= 0/condition la -> 400, unit_price snapshot tu order_items (khong tin client), ma TH-YYYYMMDD-NNNN, 1 event created + 1 audit log; approve/reject chi tu requested (trang thai khac -> 400), tu choi bat buoc reason, reject xong khong tinh vao tong tich luy; receive chi tu approved, trong CUNG MOT transaction: resalable nhap lai kho cua don bang applyMovement loai in (reference = ma tra, 1 movement moi dong resalable), damaged KHONG nhap kho KHONG ghi movement; refund chi tu received, so tien = tong unit_price x qty CA resalable lan damaged, dung DUNG createRefundTx o src/app.ts + bang refunds GOAL-006 (moi lan hoan 1 ban ghi refunds rieng reason = ma tra, hoan vao payment paid cu nhat truoc), vuot so con hoan duoc -> 400 khong tao refund nao return o lai received; GET shipments/returns kem items + events; doi chieu sau tra day du: GET /api/orders/:id/payments hien paid_total da tru tong refund, refunded_total tang dung so tien hoan, payment_status chuyen dung; GET /api/stock/levels hien on_hand tang dung so ban lai duoc, hang hong khong tang ton"
    },
    {
      "acceptanceId": "AC-4",
      "verification": "WP-MAIN: can() mo rong 8 actions request-shipment/update-shipment/view-shipments/request-return/review-return/receive-return/refund-return/view-returns theo ma tran brief (yeu cau giao/cap nhat: owner/manager/warehouse dung kho, sales/accountant 403; yeu cau tra: owner/manager/sales dung chi nhanh, warehouse/accountant 403; duyet/tu choi: owner/manager; nhan hang: owner/manager/warehouse dung kho; hoan tien tra hang: owner/manager/accountant; xem: moi vai theo pham vi); moi endpoint giao/tra qua requireRole + can() (vai sai/sai chi nhanh/sai kho/ngoai org -> 403); audit_log ghi MOI thao tac giao/tra (user_id nguoi thuc hien, created_at, action + detail JSON target_order_id/order_code/target_shipment_id/target_return_id/tracking_code/return_code/from_status/to_status, KHONG chua thong tin the), xem qua GET /api/audit-log theo luat GOAL-002; shipment_events/return_events ghi du moi lan tao/chuyen trang thai theo thu tu thoi gian tang dan, gui lai cung trang thai giao KHONG ghi event moi; test moi (vitest + supertest, file moi tests/shipments-returns-acceptance.test.ts) chung minh toan bo AC-1..AC-3 + RBAC 403; du lieu gia lap (2 org, 2 don tro len trong cung org); check.sh/demo.sh mo rong buoc giao/tra, giu cac buoc GOAL-001..006 xanh; docs RBAC/D24/D25/README/SETUP cap nhat; khong CI/VPS"
    }
  ],
  "verificationStrategy": "Tester viet tests/shipments-returns-acceptance.test.ts (L2) goi entries da khai + stub routes 501 trong src/app.ts va stub trackingRef() nem 'not implemented' trong src/adapters/index.ts (can() mac dinh false cho action moi nen test RBAC do dung ly do; computePaymentSummary da co tu GOAL-006, test doi chieu dung ham that), tests submit khoa; Worker viet code tren commit da khoa test, chay ./scripts/check.sh va ./scripts/demo.sh local truoc khi submit; gate APOS (L0 tsc, L1 vitest, L2 acceptance) quyet dinh."
}
```
