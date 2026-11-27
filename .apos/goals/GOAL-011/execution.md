# GOAL-011 v1: solo-direct

Mot package WP-MAIN duy nhat xay toan bo nghiep vu thong bao + cong viec nen trong mot lan: migration 015 them 3 bang notifications / notification_preferences / jobs (event_key UNIQUE, UNIQUE(user_id, event_type)); module moi src/notifications.ts chua mau email co dinh tung loai (D29), tao job send-notification + ghi log append-only, kiem tra preferences truoc khi tao job (thieu dong = BAT, tat -> bo qua, khong tao notification, khong tinh failed); module moi src/jobs.ts chua runner processDueJobs(db, now) chay TUAN TU tung job trong transaction rieng, retry max 3 + backoff 60 x 2^(attempts-1) giay (+60s, +120s, lan 3 -> failed + audit job-failed + notification-failed), 2 scan low-stock-scan / promo-expiry-scan dedupe theo period_key = ngay Asia/Ho_Chi_Minh, khoi phuc job running ve pending khi server start (attempts giu nguyen, next_run_at = now), scheduler setInterval 60 phut/loai scan chi khi server chay that (khong chay trong test tru khi bat co tuong minh); FakeEmailAdapter them failNext() static mot lan nhu D23, CHI dung trong test; hook tao job trong CUNG transaction tai transitionOrderTx (confirmed/completed/cancelled), webhook paid/failed, refund tao, shipment doi trang thai, return duyet/tu choi/nhan — gui lai cung trang thai (no-op D24) KHONG tao job moi vi event_key da co; routes moi GET/PATCH /api/notification-preferences, GET /api/notifications + /:id, GET /api/jobs + /:id, POST /api/jobs/run (tra {processed, done, failed}), POST /api/jobs/:id/retry (failed -> pending, attempts 0, next_run_at now, last_error NULL + audit job-retried; chua failed -> 400); mo rong src/rbac.ts them 4 actions view-notifications / manage-notification-preferences / view-jobs / run-jobs theo dung ma tran brief-011 yeu cau 11, moi endpoint qua requireRole + can(); audit CHI cho that bai cuoi + retry tay (notification-failed / job-failed / job-retried, detail KHONG chua noi dung email day du, KHONG chua email khach), gui thanh cong KHONG ghi audit; GIU NGUYEN computePaymentSummary logic D22/D25 (partially_refunded chi khi don co return da hoan tien; outstanding = total - points_discount - promo_discount - paid_total) va state machine don/webhook/hoan tien cua GOAL-005/006/007; test moi file moi tests/notifications-acceptance.test.ts (vitest + supertest) chung minh AC-1..AC-3, KHONG sua 370 test da khoa GOAL-001..010; mo rong scripts/check.sh + scripts/demo.sh them buoc thong bao/job (don 250.000d counter -> xac nhan -> hoan tat -> thu 100.000d -> chay job due -> notification order.completed + payment.paid sent, gui lai cung event khong trung -> cap ton thap -> low-stock-scan -> stock.low dung kho -> ma het han trong 2 ngay -> promo-expiry-scan -> promotion.expiring -> job fail gia lap -> retry tay -> sent -> RBAC 403: sales xem job, warehouse chay job), giu cac buoc GOAL-001..010 xanh; docs RBAC/D29/README/SETUP cap nhat.

```json
{
  "id": "GOAL-011",
  "version": 1,
  "goalId": "GOAL-011",
  "goalVersion": 1,
  "mode": "solo-direct",
  "approach": "Mot package WP-MAIN duy nhat xay toan bo nghiep vu thong bao + cong viec nen trong mot lan: migration 015 them 3 bang notifications / notification_preferences / jobs (event_key UNIQUE, UNIQUE(user_id, event_type)); module moi src/notifications.ts chua mau email co dinh tung loai (D29), tao job send-notification + ghi log append-only, kiem tra preferences truoc khi tao job (thieu dong = BAT, tat -> bo qua, khong tao notification, khong tinh failed); module moi src/jobs.ts chua runner processDueJobs(db, now) chay TUAN TU tung job trong transaction rieng, retry max 3 + backoff 60 x 2^(attempts-1) giay (+60s, +120s, lan 3 -> failed + audit job-failed + notification-failed), 2 scan low-stock-scan / promo-expiry-scan dedupe theo period_key = ngay Asia/Ho_Chi_Minh, khoi phuc job running ve pending khi server start (attempts giu nguyen, next_run_at = now), scheduler setInterval 60 phut/loai scan chi khi server chay that (khong chay trong test tru khi bat co tuong minh); FakeEmailAdapter them failNext() static mot lan nhu D23, CHI dung trong test; hook tao job trong CUNG transaction tai transitionOrderTx (confirmed/completed/cancelled), webhook paid/failed, refund tao, shipment doi trang thai, return duyet/tu choi/nhan — gui lai cung trang thai (no-op D24) KHONG tao job moi vi event_key da co; routes moi GET/PATCH /api/notification-preferences, GET /api/notifications + /:id, GET /api/jobs + /:id, POST /api/jobs/run (tra {processed, done, failed}), POST /api/jobs/:id/retry (failed -> pending, attempts 0, next_run_at now, last_error NULL + audit job-retried; chua failed -> 400); mo rong src/rbac.ts them 4 actions view-notifications / manage-notification-preferences / view-jobs / run-jobs theo dung ma tran brief-011 yeu cau 11, moi endpoint qua requireRole + can(); audit CHI cho that bai cuoi + retry tay (notification-failed / job-failed / job-retried, detail KHONG chua noi dung email day du, KHONG chua email khach), gui thanh cong KHONG ghi audit; GIU NGUYEN computePaymentSummary logic D22/D25 (partially_refunded chi khi don co return da hoan tien; outstanding = total - points_discount - promo_discount - paid_total) va state machine don/webhook/hoan tien cua GOAL-005/006/007; test moi file moi tests/notifications-acceptance.test.ts (vitest + supertest) chung minh AC-1..AC-3, KHONG sua 370 test da khoa GOAL-001..010; mo rong scripts/check.sh + scripts/demo.sh them buoc thong bao/job (don 250.000d counter -> xac nhan -> hoan tat -> thu 100.000d -> chay job due -> notification order.completed + payment.paid sent, gui lai cung event khong trung -> cap ton thap -> low-stock-scan -> stock.low dung kho -> ma het han trong 2 ngay -> promo-expiry-scan -> promotion.expiring -> job fail gia lap -> retry tay -> sent -> RBAC 403: sales xem job, warehouse chay job), giu cac buoc GOAL-001..010 xanh; docs RBAC/D29/README/SETUP cap nhat.",
  "risks": [
    "Requirements R-1/R-2/R-9 (su kien + log + hook) dung chung o AC-1 va AC-3, R-4/R-5/R-6 dung chung AC-2/AC-3 — theo luat APOS mot criterion can test phai thuoc dung MOT package, tach Multi-WP se buoc tach requirements/AC bang goal revise; Solo WP-MAIN tranh duoc van de nay (tien le GOAL-007/008/009/010: Solo).",
    "computePaymentSummary (D22/D25) va state machine don/webhook/hoan tien cua GOAL-005/006/007 de vo neu Worker sua nham khi moc hook: hook CHI THEM tao job trong transaction hien co, KHONG doi ket qua tra ve, KHONG doi thu tu cap nhat, KHONG doi dieu kien no-op D24; test khoa 370 test GOAL-001..010 phai xanh nguyen, khong sua.",
    "event_key UNIQUE de tao trung neu 2 job cung event_key chay song song: runner chay TUAN TU (1 job tai 1 thoi diem trong cung tien trinh) + tao job kiem tra event_key da co trong transaction; scan dedupe them period_key trong transaction — Worker khong duoc chay job song song de 'nhanh hon'.",
    "Backoff phai dung cong thuc 60 x 2^(attempts-1) giay theo attempts SAU khi fail (+60s lan 1, +120s lan 2, lan 3 -> failed); test KHONG cho that (dat next_run_at truc tiep / now gia lap) — neu Worker dung setTimeout/cho that thi test cham va gate timeout.",
    "FakeEmailAdapter.failNext() CHI dung trong test: route production khong bao gio goi; neu lot vao production path thi gui that co the fail co chu dich — Tester chung minh bang test + Worker ghi ro trong D29.",
    "RAM thap tren VM (free co luc ~125-130MB, GOAL-009/010): gate cham (52-64 phut) + vitest timeout flake le — neu gap timeout le, chay lai rieng file do truoc khi ket luan (bai hoc GOAL-009/010); kiem tra ps aux | grep tsx + free -m va don tien trinh sot sau VM restart truoc khi ket luan test do do code; CHK-2 da khai timeoutMs 1200000 (20 phut) NGAY TU v1 trong goal-011.json (bai hoc GOAL-010, issue #89) nen khong can revise chi de sua timeout.",
    "brief-011.md + goal-011.json DA commit rieng tren main — KHONG dua 2 file nay vao paths cua package (gate APOS-SCOPE se chan neu Worker dong toi chung) va KHONG dua vao commit package; khong can dependency moi nen khong co exception needs-human cho package.json. Khong co file .github/workflows/ trong repo (gh token thieu scope workflow).",
    "Goal show bao 'khong co khoa test (setup v2 khong khai tests.paths)' — khac GOAL-010: KHONG co buoc tests submit khoa rieng; test moi nam trong commit package va gate (L0 tsc, L1 vitest, L2 acceptance, CHK-1/CHK-2) quyet dinh. Tester viet test truoc tren stub, Worker viet code tren commit chua baseCommit, submit WP-MAIN mot lan.",
    "Token tuan 83% luc propose (reset 30/11 05:28 +07); user da chot 28/11 01:13: cu chay tiep, tu dung o 100% neu cham, resume sau reset, khong dong vao 2B token them."
  ],
  "baseCommit": "438289187fa69a9b09bf9b26a9043555222c8e79",
  "sourceSha256": "dcd5c9ddf3714a95a1a3daca2652daed34e5448d13c14a9d9c7c3ce621a7c955",
  "rationale": "Goal lien mach mot mien thong bao + job: schema + service + runner + scan + routes + RBAC + audit + test + scripts + docs chia se cung DB/app/audit log va phu thuoc lan nhau (AC-1 hook dung transitionOrderTx cua GOAL-005 va webhook/refund cua GOAL-006; AC-2 scan dung stock cua GOAL-004 va promotion cua GOAL-009; AC-3 dung RBAC/audit cua GOAL-002; AC-4 cham cung file rbac.ts/app.ts/db.ts/check/demo); tach WP se chi them chi phi tich hop va buoc tach requirements dung chung qua goal revise, trong khi Solo da chung minh hieu qua o GOAL-001..010 (dac biet GOAL-009 Solo 4 AC, 47 test, gate xanh; GOAL-010 Solo 4 AC, 37 test, gate xanh).",
  "sharedPaths": [],
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
  ],
  "entries": [
    "GET /api/notification-preferences",
    "PATCH /api/notification-preferences",
    "GET /api/notifications",
    "GET /api/notifications/:id",
    "GET /api/jobs",
    "GET /api/jobs/:id",
    "POST /api/jobs/run",
    "POST /api/jobs/:id/retry",
    "src/jobs.ts: processDueJobs(db, now)",
    "src/jobs.ts: recoverRunningJobs (khoi phuc job running ve pending khi server start; ten ham cu the do Tester dinh trong stub)",
    "src/jobs.ts: scheduler scans (low-stock-scan, promo-expiry-scan; ten ham cu the do Tester dinh trong stub)",
    "src/notifications.ts: notification service (tao job send-notification, gui qua FakeEmailAdapter, mau email D29; ten ham cu the do Tester dinh trong stub)",
    "src/adapters/index.ts: FakeEmailAdapter.send(to, subject, body)",
    "src/adapters/index.ts: FakeEmailAdapter.failNext()",
    "src/rbac.ts: can()",
    "src/orders.ts: transitionOrderTx",
    "src/payments.ts: computePaymentSummary(db, orderId)"
  ],
  "acceptanceMapping": [
    {
      "acceptanceId": "AC-1",
      "verification": "WP-MAIN: moi su kien trong danh muc R-1 sinh thong bao — order.confirmed/order.completed/order.cancelled, payment.paid/payment.failed/payment.refunded, shipment.shipped/shipment.delivered/shipment.failed, return.requested/return.approved/return.rejected/return.received, stock.low, promotion.expiring; nguoi nhan theo bang yeu cau 1 brief-011 (don/thanh toan/giao/tra -> email khach neu co customer_id + email + owner; thanh toan/hoan tien -> them accountant; tra hang -> them sales chi nhanh don; ton thap -> warehouse duoc gan kho + manager; ma sap het han -> owner + manager); nguoi nhan la user thi kiem tra preferences (tat -> khong tao job, khong tao notification); nguoi nhan la khach (email) thi luon gui neu co email; gui = FakeEmailAdapter.send (deterministic messageId, simulated: true), log vao bang notifications append-only (org_id, event_key UNIQUE, event_type, channel='email', recipient_user_id nullable, recipient_email snapshot, subject, body theo mau D29, status sent/failed, error nullable, message_id, created_at); event_key = ${event_type}:${entity}:${detail}; gui lai cung event_key -> khong tao ban ghi moi (no-op 200 / tra ve ban ghi da co); hook transitionOrderTx (confirmed/completed/cancelled), webhook paid/failed, refund tao, shipment doi trang thai, return duyet/tu choi/nhan — tao job send-notification trong CUNG transaction voi cap nhat trang thai goc khi co the; gui lai cung trang thai (no-op D24) thi KHONG tao job moi; don khong co customer_id hoac khach khong co email -> chi gui cho owner (khong loi); GET /api/notifications?status=senttt -> 400, PATCH preferences voi event_type la -> 400; hook KHONG doi hanh vi da khoa GOAL-005/006/007; khong chua thong tin the; khong chua PII thua ngoai email dich da snapshot."
    },
    {
      "acceptanceId": "AC-2",
      "verification": "WP-MAIN: bang jobs (migration 015): id, type in send-notification/low-stock-scan/promo-expiry-scan, payload JSON, status in pending/running/done/failed, attempts, max_attempts = 3, next_run_at (ISO UTC), last_error, created_at, updated_at; runner processDueJobs(db, now) lay job pending co next_run_at <= now theo created_at, chay TUAN TU tung job, moi job trong transaction rieng (running -> done/failed/pending-lai); retry: job fail -> attempts+1, pending lai voi next_run_at = now + 60 x 2^(attempts-1) giay (+60s, +120s); het 3 lan -> failed + last_error + audit job-failed; FakeEmailAdapter.failNext() static mot lan nhu D23, CHI dung trong test; scheduler setInterval 60 phut/loai scan khi server chay that, dedupe theo period_key = ngay Asia/Ho_Chi_Minh (da co job scan cung loai + cung period_key o pending/running/done thi khong tao them, kiem tra trong transaction); low-stock-scan: moi cap (variant, warehouse) co available < min_stock -> 1 job stock.low, event_key stock.low:variant:<id>:warehouse:<id>:<YYYY-MM-DD +07>, nguoi nhan warehouse duoc gan kho + manager, noi dung ghi SKU/ten/kho/available/min_stock/shortage; promo-expiry-scan: promotion active co valid_to trong 3 ngay toi (theo Asia/Ho_Chi_Minh; da het han thi khong nhac) -> 1 job promotion.expiring, event_key promotion.expiring:<promotion_id>:<YYYY-MM-DD valid_to>, nguoi nhan owner + manager, noi dung code/valid_to/used_count/usage_limit; khoi dong server dua job running ve pending (attempts giu nguyen, next_run_at = now); scan lai cung ngay khong tao job trung."
    },
    {
      "acceptanceId": "AC-3",
      "verification": "WP-MAIN: bang notification_preferences (migration 015): user_id, event_type, enabled, UNIQUE(user_id, event_type); thieu dong = BAT (khong seed dong mac dinh); tat loai nao thi khong gui loai do cho nguoi do; API GET/PATCH /api/notification-preferences (tu xem/sua cua minh; owner/manager sua cho user trong org; sua cua nguoi khac voi vai khac -> 403; event_type la -> 400); API GET /api/notifications?event_type=&status=&from=&to= + GET /api/notifications/:id; GET /api/jobs?status=&type= + GET /api/jobs/:id; POST /api/jobs/run (chay ngay job due, tra {processed, done, failed}); POST /api/jobs/:id/retry (failed -> pending, attempts 0, next_run_at now, last_error NULL + audit job-retried; chua failed -> 400); RBAC mo rong can() them 4 actions view-notifications / manage-notification-preferences / view-jobs / run-jobs theo ma tran brief-011 yeu cau 11 (owner/manager toan org; sales chi thong bao chi nhanh minh, xem job -> 403; warehouse chi thong bao stock.low kho duoc gan + job low-stock-scan, chay job -> 403; accountant xem thong bao payment/refund toan org chi xem, chay job -> 403; ngoai org -> 403); audit log: gui that bai cuoi (notification-failed, detail {event_key, event_type, recipient_user_id, error}, KHONG noi dung email, KHONG email khach) + job failed cuoi (job-failed, {job_id, job_type, last_error}) + retry tay (job-retried, {job_id, job_type}); gui thanh cong KHONG ghi audit; thong bao khong gan chi nhanh thi sales khong thay; audit xem theo luat GOAL-002."
    },
    {
      "acceptanceId": "AC-4",
      "verification": "WP-MAIN: test moi (vitest + supertest, file moi tests/notifications-acceptance.test.ts) chung minh toan bo hanh vi AC-1..AC-3 (hook su kien, khong trung event_key, preferences, retry/backoff khong cho that, scan ton thap/ma het han + dedupe theo ngay, khoi phuc job running khi start, RBAC 403, audit that bai); du lieu GIA LAP hoan toan (2 org, 2 chi nhanh, 2 kho, 2 kenh tro len); KHONG sua 370 test da khoa GOAL-001..010; seed KHONG them user/san pham/kho moi (giu nguyen 2 user, 2 san pham, 2 kho + muc ton mau); email chi qua FakeEmailAdapter (simulated: true); secret qua bien moi truong, check.sh van quet secret; scripts/check.sh va scripts/demo.sh duoc MO RONG them buoc thong bao/job (tao don 250.000d kenh counter -> xac nhan -> hoan tat -> thu tien 100.000d -> chay job due -> notification order.completed + payment.paid sent, gui lai cung event khong trung -> tao cap ton thap -> chay low-stock-scan -> notification stock.low dung kho -> tao ma sap het han trong 2 ngay -> chay promo-expiry-scan -> notification promotion.expiring -> job fail gia lap -> retry tay -> sent -> RBAC 403: sales xem job, warehouse chay job), giu cac buoc GOAL-001..010 xanh, tu chay duoc, tu don dep, in PASS/FAIL tung buoc; docs/RBAC.md bo sung ma tran thong bao/job; docs/DECISIONS.md them D29; README.md/docs/SETUP.md cap nhat endpoint thong bao/job, khop lenh da chay that; CHK-2 timeoutMs 1200000 (20 phut) da co tu v1 trong goal-011.json."
    }
  ],
  "verificationStrategy": "Tester viet tests/notifications-acceptance.test.ts (file moi) goi entries da khai + stub ham moi trong src/notifications.ts / src/jobs.ts va stub routes 501 trong src/app.ts cho 8 endpoint moi (can() mac dinh false cho 4 action moi nen test RBAC do dung ly do; computePaymentSummary da co tu GOAL-006, test doi chieu dung ham that qua GET /api/orders/:id/payments; processDueJobs + scan test truc tiep qua import voi now gia lap, khong cho that; khoi phuc job running test bang cach update truc tiep DB roi goi ham khoi phuc). Luu y: setup v2 khong khai tests.paths nen goal show bao 'khong co khoa test' — KHONG co buoc tests submit khoa rieng nhu GOAL-010; test moi nam trong commit package, Worker viet code tren commit chua baseCommit, chay ./scripts/check.sh va ./scripts/demo.sh local truoc khi submit; gate APOS (L0 tsc, L1 vitest, L2 acceptance, L3 integration, CHK-1, CHK-2 voi timeoutMs 1200000) quyet dinh xanh/do cho package WP-MAIN submit."
}
```
