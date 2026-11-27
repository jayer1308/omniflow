# WP-MAIN v1: OmniFlow co nghiep vu thanh toan + hoan tien tren don hang GOAL-005: ghi nhan thu tien mat/chuyen khoan (paid ngay) va qua cong fake (requested roi webhook chot, dung mot lan du webhook tre/lap/sai thu tu); hoan tien bang ban ghi rieng, khong bao gio hoan vuot so da tra; idempotency trong transaction cho tao payment + hoan tien; doi soat don-thanh toan tung don + lich su giao dich append-only; RBAC theo ma tran thanh toan + audit log day du; KHONG luu thong tin the; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc thanh toan moi

```json
{
  "id": "WP-MAIN",
  "goalId": "GOAL-006",
  "goalVersion": 1,
  "version": 1,
  "owner": "lead",
  "outcome": "OmniFlow co nghiep vu thanh toan + hoan tien tren don hang GOAL-005: ghi nhan thu tien mat/chuyen khoan (paid ngay) va qua cong fake (requested roi webhook chot, dung mot lan du webhook tre/lap/sai thu tu); hoan tien bang ban ghi rieng, khong bao gio hoan vuot so da tra; idempotency trong transaction cho tao payment + hoan tien; doi soat don-thanh toan tung don + lich su giao dich append-only; RBAC theo ma tran thanh toan + audit log day du; KHONG luu thong tin the; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc thanh toan moi",
  "scope": [
    "docs/",
    "src/",
    "scripts/",
    "tests/",
    "package.json",
    "package-lock.json",
    "README.md",
    "brief-006.md",
    "goal-006.json",
    ".gitignore"
  ],
  "exclusions": [
    "Giao hàng/trả hàng (GOAL-007), khách hàng + CRM (GOAL-008), khuyến mãi (GOAL-009), báo cáo/đối soát tổng hợp (GOAL-010), thông báo (GOAL-011) — thuộc goal sau, không làm trong GOAL-006.",
    "Cổng thanh toán thật, tài khoản merchant, lưu thông tin thẻ, PCI — ngoài phạm vi vĩnh viễn của dự án giả lập này.",
    "Deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user cấp scope workflow)."
  ],
  "dependencies": [],
  "interfaces": [
    "GOAL-006@v1"
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Thu tien + adapter + schema thanh toan (AC-1): migration 011 tao 3 bang payments/refunds/payment_events; POST /api/orders/:id/payments tao payment — cash/bank_transfer thanh 'paid' ngay, gateway tao 'requested' + gateway_reference duy nhat theo giao dich; FakePaymentAdapter.charge() mo rong nhan ma dinh danh giao dich (ma don + payment id) de reference duy nhat ma van deterministic, giu simulated: true, them refund() + co che gia lap loi chi dung trong test; idempotency tao payment dung withStockIdempotency (ten mien payment:create:<key>) trong cung transaction BEGIN IMMEDIATE, gui lai tra replayed: true khong tao moi; moi tao payment/webhook chot trong BEGIN IMMEDIATE + UNIQUE(gateway_reference) chong ghi nhan 2 lan (phia tao payment)",
      "goalAcceptanceId": "AC-1",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-2",
      "text": "Webhook gia lap chot dung mot lan (AC-2): POST /api/payments/webhook nhan {gateway_reference, status: 'paid' | 'failed', amount} + header X-Fake-Signature, secret qua bien moi truong OMNIFLOW_WEBHOOK_SECRET (khong commit secret that); sai/thieu chu ky -> 401, thieu secret -> 503; reference khong ton tai -> 404; amount khac -> 400; 'paid' lan 2 -> 200 + duplicate: true, ghi event webhook_duplicate_ignored, khong doi gi; 'failed' sau 'paid' -> 200, bo qua, khong doi 'paid'; 'failed' truoc roi 'paid' sau -> 'paid' van chot binh thuong; webhook 'paid' cho payment 'requested' -> 'paid' + event 'paid' + audit log; moi webhook deu ghi event",
      "goalAcceptanceId": "AC-2",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-3",
      "text": "Hoan tien + doi soat + lich su giao dich (AC-3): POST /api/payments/:id/refunds nhan {amount, reason, idempotency_key?} — reason bat buoc, amount > 0, payment phai 'paid', tong hoan khong vuot so da tra (kiem tra trong BEGIN IMMEDIATE), thanh cong -> 201 refund 'completed' ngay, payment doi 'refunded'/'partially_refunded', ghi event refund_completed + audit log; idempotency hoan tien ten mien payment:refund:<key> qua withStockIdempotency, gui lai tra replayed: true; GET /api/orders/:id/payments tra danh sach payment (moi nhat truoc, kem refunds + events tung payment) + tom tat doi soat order_total/paid_total/refunded_total/outstanding/payment_status (unpaid/partially_paid/paid/overpaid/refunded); GET /api/payments/:id tra 1 payment kem refunds + events; payment_events ghi du moi lan tao/chot/that bai/hoan/webhook ke ca trung",
      "goalAcceptanceId": "AC-3",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-4",
      "text": "RBAC + audit + khong luu the + test/checks/docs (AC-4): mo rong helper can() o src/rbac.ts them actions create-payment, refund-payment, view-payments theo dung ma tran thanh toan (ghi nhan thu tien: owner/manager/sales dung chi nhanh/accountant toan org, warehouse 403; hoan tien: owner/manager/accountant, sales/warehouse 403; xem: owner/manager/accountant toan org, sales chi chi nhanh minh, warehouse chi xem don co warehouse_id trong pham vi); moi endpoint payment qua requireRole + can() (vai sai/sai chi nhanh/ngoai org -> 403), webhook la ngoai le duy nhat; audit_log ghi MOI thao tac tao payment, webhook chot/that bai, hoan tien; test moi (vitest + supertest, file moi) chung minh toan bo hanh vi AC-1..AC-3 + RBAC 403 + khong co field the/CVV; du lieu GIA LAP hoan toan, secret qua bien moi truong, check.sh van quet secret; scripts/check.sh va scripts/demo.sh duoc MO RONG them buoc thanh toan, giu cac buoc GOAL-001..005A xanh, tu chay duoc, tu don dep, in PASS/FAIL tung buoc; docs RBAC/DECISIONS/README/SETUP cap nhat",
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
  ]
}
```
