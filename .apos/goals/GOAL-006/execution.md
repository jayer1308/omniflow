# GOAL-006 v1: solo-direct

Mot package WP-MAIN duy nhat xay toan bo thanh toan + hoan tien trong mot lan: migration 011 tao payments/refunds/payment_events (UNIQUE gateway_reference, CHECK method/status/amount, FK org/branch/order/payment/user); module moi src/payments.ts (computePaymentSummary(db, orderId) tra order_total/paid_total/refunded_total/outstanding/payment_status, signWebhook(secret, gatewayReference, status, amount) = sha256 hex cua `${gateway_reference}:${status}:${amount}:${secret}`); mo rong FakePaymentAdapter: charge(amount, currency, transactionId?) — co transactionId thi digest theo `${amount}:${currency}:${transactionId}`, khong co thi giu digest cu `${amount}:${currency}` de test khoa GOAL-001 van xanh; them refund(paymentReference, amount) tra FAKE-REF-<hash> deterministic va failNext() static mot lan (lan charge ke tiep tra status 'failed', khong cap reference) chi dung trong test; routes POST /api/orders/:id/payments (cash/bank_transfer paid ngay, gateway requested + reference duy nhat theo ma don + payment id), POST /api/payments/webhook (khong session, xac thuc X-Fake-Signature, thieu secret -> 503, sai chu ky -> 401, trung/sai thu tu chi chot 1 lan), POST /api/payments/:id/refunds (ban ghi rieng, khong vuot so da tra, kiem tra trong BEGIN IMMEDIATE), GET /api/orders/:id/payments + GET /api/payments/:id (payments moi nhat truoc, events cu nhat truoc); moi tao payment/hoan tien/webhook chot deu qua withStockIdempotency (ten mien payment:create:<key> / payment:refund:<key>) trong BEGIN IMMEDIATE; mo rong src/rbac.ts them 3 actions create-payment/refund-payment/view-payments theo ma tran (Target dung branchId + warehouseId da co); audit_log moi thao tac (create-payment, webhook-paid, webhook-failed, refund-payment; webhook co user_id NULL + detail ghi ro webhook); docs RBAC/D22/D23/README/SETUP; mo rong check.sh/demo.sh them buoc thanh toan, giu cac buoc GOAL-001..005A xanh.

```json
{
  "id": "GOAL-006",
  "version": 1,
  "goalId": "GOAL-006",
  "goalVersion": 1,
  "mode": "solo-direct",
  "approach": "Mot package WP-MAIN duy nhat xay toan bo thanh toan + hoan tien trong mot lan: migration 011 tao payments/refunds/payment_events (UNIQUE gateway_reference, CHECK method/status/amount, FK org/branch/order/payment/user); module moi src/payments.ts (computePaymentSummary(db, orderId) tra order_total/paid_total/refunded_total/outstanding/payment_status, signWebhook(secret, gatewayReference, status, amount) = sha256 hex cua `${gateway_reference}:${status}:${amount}:${secret}`); mo rong FakePaymentAdapter: charge(amount, currency, transactionId?) — co transactionId thi digest theo `${amount}:${currency}:${transactionId}`, khong co thi giu digest cu `${amount}:${currency}` de test khoa GOAL-001 van xanh; them refund(paymentReference, amount) tra FAKE-REF-<hash> deterministic va failNext() static mot lan (lan charge ke tiep tra status 'failed', khong cap reference) chi dung trong test; routes POST /api/orders/:id/payments (cash/bank_transfer paid ngay, gateway requested + reference duy nhat theo ma don + payment id), POST /api/payments/webhook (khong session, xac thuc X-Fake-Signature, thieu secret -> 503, sai chu ky -> 401, trung/sai thu tu chi chot 1 lan), POST /api/payments/:id/refunds (ban ghi rieng, khong vuot so da tra, kiem tra trong BEGIN IMMEDIATE), GET /api/orders/:id/payments + GET /api/payments/:id (payments moi nhat truoc, events cu nhat truoc); moi tao payment/hoan tien/webhook chot deu qua withStockIdempotency (ten mien payment:create:<key> / payment:refund:<key>) trong BEGIN IMMEDIATE; mo rong src/rbac.ts them 3 actions create-payment/refund-payment/view-payments theo ma tran (Target dung branchId + warehouseId da co); audit_log moi thao tac (create-payment, webhook-paid, webhook-failed, refund-payment; webhook co user_id NULL + detail ghi ro webhook); docs RBAC/D22/D23/README/SETUP; mo rong check.sh/demo.sh them buoc thanh toan, giu cac buoc GOAL-001..005A xanh.",
  "risks": [
    "Reference trung vi digest theo so tien: FakePaymentAdapter hien tai cho 2 lan thu cung so tien cung gateway_reference — bat buoc charge() nhan them ma dinh danh giao dich (ma don + payment id) truoc khi test webhook; test AC-1 chung minh 2 don cung amount co reference khac nhau, neu quen thi UNIQUE(gateway_reference) chan nham lan thu thu hai.",
    "Webhook ghi nhan 2 lan: chi chong bang UNIQUE(gateway_reference) + kiem tra trang thai trong cung transaction BEGIN IMMEDIATE moi khong tinh tien 2 lan; webhook 'failed' sau 'paid' khong duoc lat 'paid' thanh 'failed'; test webhook dong thoi + gui lap chung minh duplicate: true va tong chi tinh 1 lan.",
    "Hoan vuot so da tra: DB CHECK don gian khong lam duoc — bat buoc tinh tong hoan hien tai + amount moi trong cung BEGIN IMMEDIATE roi moi insert; test hoan dong thoi vuot so da tra chung minh chi 1 lan thanh cong.",
    "Idempotency ngoai transaction: withIdempotency cua GOAL-001 kiem tra key ngoai transaction — dung cho payment/refund se de lot thuc thi trung; bat buoc dung withStockIdempotency voi ten mien payment:create:<key> / payment:refund:<key>.",
    "Chu ky webhook mo ho: brief viet sha256(gateway_reference:status:amount + secret) — Lead chot cong thuc chinh xac la sha256 hex cua `${gateway_reference}:${status}:${amount}:${secret}`; Worker phai theo dung cong thuc nay, test tinh chu ky doc lap bang node:crypto.",
    "173 test GOAL-001..005A da khoa — khong sua; brief-006.md + goal-006.json DA commit rieng tren main (038c4e4) — KHONG dua 2 file nay vao commit package (gate do APOS-SCOPE, bai hoc GOAL-004/005); charge() 2 tham so cu phai giu nguyen hanh vi (test khoa goi charge(50000,'VND') 2 lan doi ket qua bang nhau).",
    "Test race dong thoi tren mot process Node + SQLite dong bo chi chung minh bat bien (tong da tra chi tinh 1 lan, tong hoan khong vuot so da tra), khong chung minh chong race da process — ghi ro trong DECISIONS.md D22, khong claim qua.",
    "Khong can dependency moi nen khong co exception needs-human cho package.json nhu GOAL-003."
  ],
  "baseCommit": "a9157f67b2ce826544638f2d8ba6dc3906a4ce55",
  "sourceSha256": "d3721a8812fccf7a526b1aebe77d2422a5001c1990065724601563c638fc6eb1",
  "rationale": "Goal lien mach mot mien thanh toan: migration 011 + service payment + adapter + webhook + hoan tien + doi soat + ma tran quyen chia se cung DB/app/audit log va phu thuoc lan nhau theo thu tu (AC-2/AC-3 build tren bang + adapter cua AC-1, AC-4 cham cung file rbac.ts/app.ts/check/demo); tach WP se chi them chi phi tich hop va rui ro criterion thuoc 2 package, trong khi Solo da chung minh hieu qua o GOAL-001/002/003/004/005 (dac biet GOAL-004 Solo 4 AC, 36 test; GOAL-005 Solo 4 AC, 38 test).",
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
    "src/payments.ts",
    "src/adapters/index.ts",
    "src/app.ts",
    "src/auth.ts",
    "src/db.ts",
    "src/orders.ts",
    "src/rbac.ts",
    "src/seed.ts",
    "src/tenant.ts",
    "src/idempotency.ts",
    "src/products.ts",
    "src/stock.ts"
  ],
  "entries": [
    "POST /api/orders/:id/payments",
    "POST /api/payments/webhook",
    "POST /api/payments/:id/refunds",
    "GET /api/orders/:id/payments",
    "GET /api/payments/:id",
    "src/payments.ts: computePaymentSummary(db, orderId), signWebhook(secret, gatewayReference, status, amount)",
    "src/adapters/index.ts: FakePaymentAdapter.charge(amount, currency, transactionId?), refund(paymentReference, amount), failNext()",
    "src/rbac.ts: can()"
  ],
  "acceptanceMapping": [
    {
      "acceptanceId": "AC-1",
      "verification": "WP-MAIN: migration 011 tao payments (org/branch/order NOT NULL FK, method cash/bank_transfer/gateway, amount INTEGER > 0, currency VND default, status requested/paid/failed/refunded/partially_refunded, gateway_reference TEXT UNIQUE khi co gia tri, received_by NOT NULL FK, received_at/created_at/updated_at), refunds (payment_id FK, amount > 0, reason NOT NULL, status requested/completed/failed, created_by FK), payment_events append-only (payment_id FK, event_type, actor_id NULL khi webhook, detail, created_at); POST /api/orders/:id/payments 201: cash/bank_transfer paid ngay + event 'paid', gateway requested + gateway_reference duy nhat theo giao dich (ma don + payment id, 2 don cung amount khac reference); FakePaymentAdapter.charge() mo rong nhan transactionId (co thi digest theo amount:currency:transactionId, khong thi giu digest cu), refund() tra FAKE-REF-<hash> deterministic, failNext() static mot lan khien charge ke tiep tra status 'failed'; idempotency tao payment qua withStockIdempotency ten mien payment:create:<key> (gui lai -> replayed: true, cung payment, khong tao moi); input sai 400 (method la, amount <= 0/khong nguyen), don khong ton tai 404, ngoai org 403, don cancelled 400; branch_id payment = branch_id don; khong co endpoint DELETE payment"
    },
    {
      "acceptanceId": "AC-2",
      "verification": "WP-MAIN: POST /api/payments/webhook khong yeu cau session, xac thuc X-Fake-Signature = sha256 hex cua `${gateway_reference}:${status}:${amount}:${secret}` voi secret tu OMNIFLOW_WEBHOOK_SECRET (sai/thieu chu ky -> 401, thieu secret -> 503, server van chay route khac); reference khong ton tai -> 404; amount khac -> 400; webhook paid cho requested -> paid + event 'paid' + audit log; paid lan 2 / dong thoi 2 paid cung reference -> 200 + duplicate: true, ghi event 'webhook_duplicate_ignored', khong doi gi, tong chi tinh 1 lan; failed sau paid -> 200 bo qua, ghi event 'webhook_ignored', KHONG doi paid thanh failed; failed truoc roi paid sau -> paid van chot binh thuong; failed cho requested -> payment failed + event 'failed'; moi webhook deu ghi event"
    },
    {
      "acceptanceId": "AC-3",
      "verification": "WP-MAIN: POST /api/payments/:id/refunds 201 refund 'completed' ngay, payment doi 'refunded' (hoan du) / 'partially_refunded' (hoan mot phan), ghi event 'refund_completed' + audit log, tra refund kem payment da cap nhat + order_summary; reason trong / amount <= 0 / payment chua paid -> 400, payment khong ton tai -> 404, ngoai org -> 403, tong hoan vuot so da tra -> 400 khong tao refund nao (kiem tra tong hoan trong cung BEGIN IMMEDIATE); hoan dong thoi 2 lan vuot so da tra chi 1 thanh cong; idempotency hoan tien ten mien payment:refund:<key> qua withStockIdempotency (gui lai -> replayed: true); GET /api/orders/:id/payments tra payments moi nhat truoc kem refunds + events tung payment (events cu nhat truoc) + order_summary order_total/paid_total/refunded_total/outstanding/payment_status (unpaid/partially_paid/paid/overpaid/refunded, outstanding am hien ro la thua); GET /api/payments/:id tra 1 payment kem refunds + events; payment_events append-only (PATCH/DELETE -> 404/405); hoan tien KHONG doi trang thai don; luong day du gateway paid -> hoan mot phan -> hoan not: paid_total ve 0, outstanding ve bang order_total"
    },
    {
      "acceptanceId": "AC-4",
      "verification": "WP-MAIN: can() mo rong 3 actions create-payment/refund-payment/view-payments theo ma tran (tao payment: owner/manager/sales dung chi nhanh/accountant toan org, warehouse 403; hoan tien: owner/manager/accountant, sales/warehouse 403; xem: owner/manager/accountant toan org, sales chi chi nhanh minh, warehouse chi xem don co warehouse_id trong pham vi); moi endpoint payment qua requireRole + can() (vai sai/sai chi nhanh/ngoai org -> 403), webhook la ngoai le duy nhat; audit_log ghi MOI thao tac tao payment/webhook chot/that bai/hoan tien (action create-payment/webhook-paid/webhook-failed/refund-payment, user_id NULL + detail ghi ro webhook khi la webhook, detail target_payment_id/order_id/order_code/method/amount/gateway_reference, KHONG chua thong tin the), xem qua GET /api/audit-log theo luat GOAL-002; test moi (vitest + supertest, file moi tests/payments-acceptance.test.ts) chung minh toan bo AC-1..AC-3 + RBAC 403 + khong co field the/CVV trong DB/API/log (test quet); du lieu gia lap (2 org, 2 don tro len trong cung org); check.sh/demo.sh mo rong buoc thanh toan, giu cac buoc GOAL-001..005A xanh; docs RBAC/D22/D23/README/SETUP cap nhat; khong CI/VPS"
    }
  ],
  "verificationStrategy": "Tester viet tests/payments-acceptance.test.ts (L2) goi entries da khai + stub src/payments.ts (computePaymentSummary, signWebhook) va stub routes 501 trong src/app.ts, adapter cu giu nguyen (test goi charge 3 tham so qua cast de tranh loi tsc; test refund/failNext dung typeof-assertion de do bang assertion), tests submit khoa; Worker viet code tren commit da khoa test, chay ./scripts/check.sh va ./scripts/demo.sh local tu dau sach truoc khi submit; gate APOS (L0 tsc, L1 vitest, L2 acceptance) quyet dinh."
}
```
