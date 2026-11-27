# WP-MAIN v1: OmniFlow co nghiep vu thong bao + cong viec nen: gui thong bao qua adapter email fake khi don xac nhan/hoan tat/huy, thanh toan paid/failed, hoan tien, giao shipped/delivered/failed, tra hang duyet/tu choi/nhan, ton kho thap, khuyen mai sap het han (log append-only, event_key UNIQUE chong gui trung, cai dat nhan theo nguoi dung); hang doi job trong tien trinh (send-notification/low-stock-scan/promo-expiry-scan, retry toi da 3 lan + backoff 60s/120s, job lap theo lich 60 phut co dedupe theo ngay, khoi phuc job do dang khi khoi dong, chay tay + retry tay qua API); RBAC theo ma tran thong bao/job + audit log chi cho that bai/retry tay; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc thong bao/job moi (CHK-2 timeoutMs 20 phut tu v1); 4 yeu cau mo coi bao cao (R-19 GOAL-006, R-17 GOAL-007, R-18 GOAL-008, R-16 GOAL-009) duoc loai tru co ly do (out-of-scope)

```json
{
  "id": "WP-MAIN",
  "goalId": "GOAL-011",
  "goalVersion": 1,
  "version": 1,
  "owner": "lead",
  "outcome": "OmniFlow co nghiep vu thong bao + cong viec nen: gui thong bao qua adapter email fake khi don xac nhan/hoan tat/huy, thanh toan paid/failed, hoan tien, giao shipped/delivered/failed, tra hang duyet/tu choi/nhan, ton kho thap, khuyen mai sap het han (log append-only, event_key UNIQUE chong gui trung, cai dat nhan theo nguoi dung); hang doi job trong tien trinh (send-notification/low-stock-scan/promo-expiry-scan, retry toi da 3 lan + backoff 60s/120s, job lap theo lich 60 phut co dedupe theo ngay, khoi phuc job do dang khi khoi dong, chay tay + retry tay qua API); RBAC theo ma tran thong bao/job + audit log chi cho that bai/retry tay; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc thong bao/job moi (CHK-2 timeoutMs 20 phut tu v1); 4 yeu cau mo coi bao cao (R-19 GOAL-006, R-17 GOAL-007, R-18 GOAL-008, R-16 GOAL-009) duoc loai tru co ly do (out-of-scope)",
  "scope": [
    "docs/",
    "src/",
    "scripts/",
    "tests/",
    "README.md",
    "brief-011.md",
    "goal-011.json",
    ".gitignore"
  ],
  "exclusions": [
    "UI tổng quan (GOAL-012): không thêm màn hình thông báo/job (chỉ API + log) — thuộc GOAL-012, không làm trong GOAL-011.",
    "SMS / push / email thật — ngoài phạm vi vĩnh viễn của dự án giả lập này (chỉ FakeEmailAdapter, simulated: true); không tài khoản dịch vụ email thật, không API key thật.",
    "Redis / hàng đợi ngoài / cron hệ thống / worker process riêng — ngoài phạm vi vĩnh viễn (chỉ job queue trong tiến trình + setInterval); không deploy thêm process.",
    "Đơn vị vận chuyển thật / giao hàng thật, tài khoản hãng vận chuyển, cổng thanh toán thật — ngoài phạm vi vĩnh viễn của dự án giả lập này; deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user cấp scope workflow).",
    "Yêu cầu R-19 của GOAL-006, R-17 của GOAL-007, R-18 của GOAL-008 và R-16 của GOAL-009 được loại trừ có lý do (out-of-scope) trong goal này — xem requirement R-21/R-22/R-23/R-24; chúng chỉ là câu phủ định phạm vi báo cáo của goal gốc, toàn bộ phạm vi báo cáo đã được sở hữu bởi requirements riêng R-1..R-13 của GOAL-010; adopt vào GOAL-011 (thông báo) sẽ nhận sai phạm vi."
  ],
  "dependencies": [],
  "interfaces": [
    "GOAL-011@v1"
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Su kien thong bao + gui qua FakeEmailAdapter + log + khong trung (AC-1): cac su kien PHẢI sinh thong bao — don order.confirmed/order.completed/order.cancelled; thanh toan payment.paid/payment.failed/payment.refunded; giao shipment.shipped/shipment.delivered/shipment.failed; tra return.requested/return.approved/return.rejected/return.received; ton kho stock.low; khuyen mai promotion.expiring (xem R-7/R-8). Nguoi nhan theo bang yeu cau 1 brief-011.md: don/thanh toan/giao/tra -> email khach (neu don co customer_id + khach co email) + owner; thanh toan/hoan tien -> them accountant; tra hang -> them sales cua chi nhanh don; ton thap -> warehouse duoc gan kho + manager; ma sap het han -> owner + manager. Gui = FakeEmailAdapter.send (deterministic messageId, simulated: true), log vao bang notifications append-only (org_id, event_key UNIQUE, event_type, channel='email', recipient_user_id nullable, recipient_email snapshot, subject, body theo mau D29, status sent/failed, error nullable, message_id, created_at). event_key = ${event_type}:${entity}:${detail} (vd order.completed:DH-20261128-0001, stock.low:variant:12:warehouse:3:2026-11-28, promotion.expiring:7:2026-11-30). Hook: transitionOrderTx (confirmed/completed/cancelled), webhook paid/failed, refund tao, shipment doi trang thai, return duyet/tu choi/nhan — tao job send-notification trong CUNG transaction voi cap nhat trang thai goc khi co the; gui lai cung trang thai (no-op D24) thi KHONG tao job moi (event_key da co). Nguoi nhan la user thi kiem tra preferences truoc khi tao job (tat -> khong tao job, khong tao notification).",
      "goalAcceptanceId": "AC-1",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-2",
      "text": "Hang doi job + retry/backoff + scheduler + scan ton thap/ma het han (AC-2): bang jobs (migration 015): id, type ∈ send-notification/low-stock-scan/promo-expiry-scan, payload JSON, status ∈ pending/running/done/failed, attempts, max_attempts = 3, next_run_at (ISO UTC), last_error, created_at, updated_at. Runner processDueJobs(db, now): lay job pending co next_run_at <= now theo created_at, chay TUAN TU tung job, moi job trong transaction rieng (running -> done/failed/pending-lai). Retry: job fail -> attempts+1, pending lai voi next_run_at = now + 60 x 2^(attempts-1) giay (+60s, +120s); het 3 lan -> failed + last_error + audit job-failed. Co che gia lap loi gui: FakeEmailAdapter.failNext() static mot lan nhu D23, CHI dung trong test. Scheduler setInterval 60 phut/loai scan khi server chay that; dedupe theo period_key = ngay Asia/Ho_Chi_Minh (da co job scan cung loai + cung period_key o pending/running/done thi khong tao them, kiem tra trong transaction). low-stock-scan: moi cap (variant, warehouse) co available < min_stock -> 1 job stock.low, event_key stock.low:variant:<id>:warehouse:<id>:<YYYY-MM-DD +07>, nguoi nhan warehouse duoc gan kho + manager, noi dung ghi SKU/ten/kho/available/min_stock/shortage. promo-expiry-scan: promotion active co valid_to trong 3 ngay toi (theo Asia/Ho_Chi_Minh; da het han thi khong nhac) -> 1 job promotion.expiring, event_key promotion.expiring:<promotion_id>:<YYYY-MM-DD valid_to>, nguoi nhan owner + manager, noi dung code/valid_to/used_count/usage_limit. Khoi dong server dua job running ve pending (attempts giu nguyen, next_run_at = now).",
      "goalAcceptanceId": "AC-2",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-3",
      "text": "Preferences + API + RBAC + audit (AC-3): bang notification_preferences (migration 015): user_id, event_type, enabled, UNIQUE(user_id, event_type); thieu dong = BAT. API GET/PATCH /api/notification-preferences (tu xem/sua cua minh; owner/manager sua cho user trong org; sua cua nguoi khac voi vai khac -> 403; event_type la -> 400). API GET /api/notifications?event_type=&status=&from=&to= + GET /api/notifications/:id; GET /api/jobs?status=&type= + GET /api/jobs/:id; POST /api/jobs/run (chay ngay job due, tra {processed, done, failed}); POST /api/jobs/:id/retry (failed -> pending, attempts 0, next_run_at now, last_error NULL + audit job-retried; chua failed -> 400). RBAC mo rong can() them 4 actions view-notifications / manage-notification-preferences / view-jobs / run-jobs theo ma tran brief-011.md yeu cau 11 (owner/manager toan org; sales chi thong bao chi nhanh minh, xem job -> 403; warehouse chi thong bao stock.low kho duoc gan + job low-stock-scan, chay job -> 403; accountant xem thong bao payment/refund toan org chi xem, chay job -> 403; ngoai org -> 403). Audit log: gui that bai cuoi (action notification-failed, detail {event_key, event_type, recipient_user_id, error}, KHONG noi dung email, KHONG email khach) + job failed cuoi (job-failed, {job_id, job_type, last_error}) + retry tay (job-retried, {job_id, job_type}); gui thanh cong KHONG ghi audit.",
      "goalAcceptanceId": "AC-3",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-4",
      "text": "Test + checks/docs + du lieu gia lap (AC-4): test moi (vitest + supertest, file moi) chung minh toan bo hanh vi AC-1..AC-3 (hook su kien, khong trung event_key, preferences, retry/backoff khong cho that, scan ton thap/ma het han + dedupe theo ngay, khoi phuc job running khi start, RBAC 403, audit that bai); du lieu GIA LAP hoan toan, secret qua bien moi truong, check.sh van quet secret; scripts/check.sh va scripts/demo.sh duoc MO RONG them buoc thong bao/job (tao don 250.000d kenh counter -> xac nhan -> hoan tat -> thu tien 100.000d -> chay job due -> notification order.completed + payment.paid sent, gui lai cung event khong trung -> tao cap ton thap -> chay low-stock-scan -> notification stock.low dung kho -> tao ma sap het han trong 2 ngay -> chay promo-expiry-scan -> notification promotion.expiring -> job fail gia lap -> retry tay -> sent -> RBAC 403: sales xem job, warehouse chay job), giu cac buoc GOAL-001..010 xanh, tu chay duoc, tu don dep, in PASS/FAIL tung buoc; docs RBAC/DECISIONS(D29)/README/SETUP cap nhat.",
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
    "src/notifications.ts",
    "src/jobs.ts",
    "src/server.ts",
    "src/adapters/index.ts",
    "src/tenant.ts",
    "src/idempotency.ts"
  ]
}
```
