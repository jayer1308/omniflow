# GOAL-012 v1: solo-direct

Mot package WP-MAIN duy nhat xay toan bo UI tong quan + van hanh trong mot lan: 4 views moi views/dashboard.ejs, views/dashboard-shipments.ejs, views/dashboard-customers.ejs, views/dashboard-notifications.ejs + views/ops-backup.ejs (EJS tieng Viet, dung chung public/style.css, mobile-first, link/button focus duoc bang ban phim); mo rong views/audit-log.ejs them loc/phân trang; routes moi trong src/app.ts: GET /dashboard (doanh thu hom nay + thang nay qua computeRevenueReport GOAL-010, chi don completed, theo Asia/Ho_Chi_Minh; don cho xu ly draft/confirmed/processing dem tu bang orders; ton thap dem tu logic low-stock GOAL-004; thong bao chua doc theo dinh nghia D30 — notification status sent ma user chua mo trang thong bao/job, khong them cot DB moi neu tranh duoc), GET /dashboard/shipments (shipments requested/shipped/in_transit kem ma van don + carrier + trang thai, returns requested kem ma don + ly do, returns received gan nhat 5 ban ghi, link sang chi tiet don — du lieu GOAL-007), GET /dashboard/customers (khach VIP theo luat GOAL-008, tong diem da doi trong thang redeemed x 100d, khach moi trong thang — du lieu GOAL-008), GET /dashboard/notifications (thong bao moi nhat 10 ban ghi theo event_type/status, job failed kem link retry tay qua API GOAL-011 — du lieu GOAL-011); mo rong GET /health tra {status, db, version, uptime_seconds} — db: 'ok' khi query SELECT 1 thanh cong, version doc tu package.json (khong hard-code), uptime_seconds tu luc process start (so nguyen >= 0), DB loi -> status: 'error' + 503, GIU {status: 'ok'} khi DB ok; GET /ops/backup (EJS, owner-only) hien thi sao luu gan nhat (ten file + thoi gian + kich thuoc, hoac 'chua co sao luu'); POST /api/ops/backup (owner-only) CHI goi scripts/backup.sh, tra {file, size, created_at}; POST /api/ops/restore (owner-only, body {file, confirm: true}) CHI goi scripts/restore.sh (thieu/sai confirm -> 400, file khong ton tai -> 404, file ngoai thu muc backup -> 400); KHONG viet logic sao luu moi; mo rong GET /audit-log (da co): them loc actor=/action=/from=/to= + phan trang page/limit (mac dinh page 1, limit 20 toi da 100), loc sai gia tri -> 400, giu hanh vi cu (owner/manager only, ngoai vai -> 403; API GET /api/audit-log giu nguyen); mo rong src/rbac.ts them 3 actions view-dashboard / view-ops / run-backup theo dung ma tran brief-012 yeu cau 10 (owner/manager toan org; sales chi dashboard chi nhanh minh, xem van hanh -> 403; warehouse chi phan ton kho/giao hang thuoc kho duoc gan, xem doanh thu -> 403, xem van hanh -> 403; accountant xem dashboard doanh thu/bao cao toan org chi xem, chay backup/restore -> 403), moi endpoint qua requireAuth + can(); GIU NGUYEN computePaymentSummary logic D25, state machine don, gia hieu dung, luat diem/ma, hanh vi bao cao/thong bao da khoa GOAL-005..011; so tien hien thi dung dinh dang Viet (vd 250.000d); trang thai rong hien 0/empty dung nghia, loi service -> trang loi 500 khong lo stack trace; test moi file moi tests/dashboard-acceptance.test.ts (vitest + supertest) chung minh AC-1..AC-3, KHONG sua 404 test da khoa GOAL-001..011; mo rong scripts/check.sh + scripts/demo.sh them buoc dashboard/van hanh (mo dashboard -> doanh thu hom nay/thang nay khop API bao cao -> don cho xu ly dung so -> ton thap dung so -> thong bao chua doc -> man hinh giao/tra co don dang giao -> man hinh khach co VIP -> man hinh thong bao co job failed + retry -> health tra du field -> backup qua API -> doi du lieu -> restore qua API -> du lieu ve dung -> audit loc theo actor/action + phan trang -> RBAC 403: sales xem dashboard toan org, warehouse xem doanh thu, accountant chay backup), giu cac buoc GOAL-001..011 xanh; docs RBAC/D30/ROADMAP/README/SETUP cap nhat (D30: nguon so lieu dashboard + dinh nghia 'chua doc' + health/backup/audit mo rong; ROADMAP danh dau 12 goal chinh + GOAL-005A da dong — roadmap hoan tat).

```json
{
  "id": "GOAL-012",
  "version": 1,
  "goalId": "GOAL-012",
  "goalVersion": 1,
  "mode": "solo-direct",
  "approach": "Mot package WP-MAIN duy nhat xay toan bo UI tong quan + van hanh trong mot lan: 4 views moi views/dashboard.ejs, views/dashboard-shipments.ejs, views/dashboard-customers.ejs, views/dashboard-notifications.ejs + views/ops-backup.ejs (EJS tieng Viet, dung chung public/style.css, mobile-first, link/button focus duoc bang ban phim); mo rong views/audit-log.ejs them loc/phân trang; routes moi trong src/app.ts: GET /dashboard (doanh thu hom nay + thang nay qua computeRevenueReport GOAL-010, chi don completed, theo Asia/Ho_Chi_Minh; don cho xu ly draft/confirmed/processing dem tu bang orders; ton thap dem tu logic low-stock GOAL-004; thong bao chua doc theo dinh nghia D30 — notification status sent ma user chua mo trang thong bao/job, khong them cot DB moi neu tranh duoc), GET /dashboard/shipments (shipments requested/shipped/in_transit kem ma van don + carrier + trang thai, returns requested kem ma don + ly do, returns received gan nhat 5 ban ghi, link sang chi tiet don — du lieu GOAL-007), GET /dashboard/customers (khach VIP theo luat GOAL-008, tong diem da doi trong thang redeemed x 100d, khach moi trong thang — du lieu GOAL-008), GET /dashboard/notifications (thong bao moi nhat 10 ban ghi theo event_type/status, job failed kem link retry tay qua API GOAL-011 — du lieu GOAL-011); mo rong GET /health tra {status, db, version, uptime_seconds} — db: 'ok' khi query SELECT 1 thanh cong, version doc tu package.json (khong hard-code), uptime_seconds tu luc process start (so nguyen >= 0), DB loi -> status: 'error' + 503, GIU {status: 'ok'} khi DB ok; GET /ops/backup (EJS, owner-only) hien thi sao luu gan nhat (ten file + thoi gian + kich thuoc, hoac 'chua co sao luu'); POST /api/ops/backup (owner-only) CHI goi scripts/backup.sh, tra {file, size, created_at}; POST /api/ops/restore (owner-only, body {file, confirm: true}) CHI goi scripts/restore.sh (thieu/sai confirm -> 400, file khong ton tai -> 404, file ngoai thu muc backup -> 400); KHONG viet logic sao luu moi; mo rong GET /audit-log (da co): them loc actor=/action=/from=/to= + phan trang page/limit (mac dinh page 1, limit 20 toi da 100), loc sai gia tri -> 400, giu hanh vi cu (owner/manager only, ngoai vai -> 403; API GET /api/audit-log giu nguyen); mo rong src/rbac.ts them 3 actions view-dashboard / view-ops / run-backup theo dung ma tran brief-012 yeu cau 10 (owner/manager toan org; sales chi dashboard chi nhanh minh, xem van hanh -> 403; warehouse chi phan ton kho/giao hang thuoc kho duoc gan, xem doanh thu -> 403, xem van hanh -> 403; accountant xem dashboard doanh thu/bao cao toan org chi xem, chay backup/restore -> 403), moi endpoint qua requireAuth + can(); GIU NGUYEN computePaymentSummary logic D25, state machine don, gia hieu dung, luat diem/ma, hanh vi bao cao/thong bao da khoa GOAL-005..011; so tien hien thi dung dinh dang Viet (vd 250.000d); trang thai rong hien 0/empty dung nghia, loi service -> trang loi 500 khong lo stack trace; test moi file moi tests/dashboard-acceptance.test.ts (vitest + supertest) chung minh AC-1..AC-3, KHONG sua 404 test da khoa GOAL-001..011; mo rong scripts/check.sh + scripts/demo.sh them buoc dashboard/van hanh (mo dashboard -> doanh thu hom nay/thang nay khop API bao cao -> don cho xu ly dung so -> ton thap dung so -> thong bao chua doc -> man hinh giao/tra co don dang giao -> man hinh khach co VIP -> man hinh thong bao co job failed + retry -> health tra du field -> backup qua API -> doi du lieu -> restore qua API -> du lieu ve dung -> audit loc theo actor/action + phan trang -> RBAC 403: sales xem dashboard toan org, warehouse xem doanh thu, accountant chay backup), giu cac buoc GOAL-001..011 xanh; docs RBAC/D30/ROADMAP/README/SETUP cap nhat (D30: nguon so lieu dashboard + dinh nghia 'chua doc' + health/backup/audit mo rong; ROADMAP danh dau 12 goal chinh + GOAL-005A da dong — roadmap hoan tat).",
  "risks": [
    "Requirements R-11 (test moi) dung chung o AC-1 va AC-4, R-9 dung chung AC-1 — theo luat APOS mot criterion can test phai thuoc dung MOT package, tach Multi-WP se buoc tach requirements/AC bang goal revise; Solo WP-MAIN tranh duoc van de nay (tien le GOAL-007/008/009/010/011: Solo).",
    "Dashboard PHAI dung lai computeRevenueReport (GOAL-010) + logic low-stock GOAL-004, KHONG tinh lai bang SQL rieng: neu Worker tinh rieng thi so lech API bao cao va test so sanh truc tiep (R-9) se do — Tester chung minh bang test so sanh dashboard voi GET /api/reports/revenue cung khoang, GET /api/stock/low-stock, GET /api/orders loc theo trang thai.",
    "Dinh nghia 'chua doc' (D30) chua co trong code: Worker phai ghi ro vao D30 truoc khi code (notification sent ma user chua mo trang thong bao/job; khong them cot DB moi neu tranh duoc — dung created_at + lan xem cuoi neu can); neu can cot moi thi phai la migration moi tuan tu, khong sua migration cu.",
    "Backup/restore CHI bọc scripts/backup.sh + restore.sh: Worker khong duoc viet logic sao luu moi; restore phai chan path traversal (file ngoai thu muc backup -> 400) va yeu cau confirm: true; test backup -> doi du lieu -> restore -> dung trang thai phai chay tren DB test rieng, khong cham DB that.",
    "Health mo rong GIU {status: 'ok'} khi DB ok: test khoa GOAL-001 van xanh; version doc tu package.json, khong hard-code (neu hard-code thi doi version package se lech).",
    "RAM thap tren VM (free co luc ~125-161MB, GOAL-009/010/011): gate cham (52-64 phut) + vitest timeout flake le — neu gap timeout le, chay lai rieng file do truoc khi ket luan (bai hoc GOAL-009/010/011); kiem tra ps aux | grep tsx + free -m va don tien trinh sot sau VM restart truoc khi ket luan test do do code; CHK-2 da khai timeoutMs 1200000 (20 phut) NGAY TU v1 trong goal-012.json (bai hoc GOAL-010, issue #89) nen khong can revise chi de sua timeout.",
    "Gate do o npm ci do tai binary bcrypt qua egress proxy (bai hoc GOAL-011, issue #92): neu gap, chay close voi npm_config_build_from_source=true (cache headers node-gyp da seed san ~/.cache/node-gyp/24.22.1/ voi --no-same-owner + installVersion = 11); kiem tra cache con khong truoc khi dung, mat thi seed lai.",
    "VM restart co the giet gate/close giua chung (bai hoc GOAL-003/005/008/010/011): neu close bi giet, kiem tra event log APOS xem da co event merge-authorized chua — chua co thi retry voi --merge-to an toan, da co thi chay close tron khong --merge-to (issue #79).",
    "brief-012.md + goal-012.json DA commit rieng tren main — KHONG dua 2 file nay vao paths cua package (gate APOS-SCOPE se chan neu Worker dong toi chung) va KHONG dua vao commit package; khong can dependency moi nen khong co exception needs-human cho package.json. Khong co file .github/workflows/ trong repo (gh token thieu scope workflow).",
    "Goal show bao 'khong co khoa test (setup v2 khong khai tests.paths)' — khac GOAL-010: KHONG co buoc tests submit khoa rieng; test moi nam trong commit package va gate (L0 tsc, L1 vitest, L2 acceptance, CHK-1/CHK-2) quyet dinh. Tester viet test truoc tren stub, Worker viet code tren commit chua baseCommit, submit WP-MAIN mot lan.",
    "Token tuan 89% luc propose (reset 30/11 05:28 +07); user da chot 28/11 01:13: cu chay tiep, tu dung o 100% neu cham, resume sau reset, khong dong vao 2B token them. Sau khi GOAL-012 dong, inbox PHAI sach hoan toan (khong con notice mo coi nao) — day la goal cuoi, khong con goal sau de don; 5 entry loai tru R-21..R-25 trong goal-012.json xu ly 4 notice thong bao + R-20 cua GOAL-008."
  ],
  "baseCommit": "346d38dfe1b52415091a3eb9b7bd302c4f45318c",
  "sourceSha256": "de29ff727927decf86e3802cac0961960d3b7dbf116b19b074eb0763e5959463",
  "rationale": "Goal lien mach mot mien UI/van hanh: 5 views + routes + RBAC + health/backup/audit + test + scripts + docs chia se cung app.ts/rbac.ts/views/audit log va phu thuoc lan nhau (AC-1 dashboard dung computeRevenueReport GOAL-010 + low-stock GOAL-004 + notifications GOAL-011; AC-2 dung scripts GOAL-001; AC-3 dung RBAC GOAL-002; AC-4 cham cung file app.ts/rbac.ts/check/demo); tach WP se chi them chi phi tich hop va buoc tach requirements dung chung (R-9, R-11) qua goal revise, trong khi Solo da chung minh hieu qua o GOAL-001..011 (dac biet GOAL-010/011 Solo 4 AC, gate xanh).",
  "sharedPaths": [],
  "paths": [
    "src/**",
    "tests/**",
    "views/**",
    "public/**",
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
    "GET /dashboard",
    "GET /dashboard/shipments",
    "GET /dashboard/customers",
    "GET /dashboard/notifications",
    "GET /ops/backup",
    "POST /api/ops/backup",
    "POST /api/ops/restore",
    "GET /health",
    "GET /audit-log",
    "GET /api/audit-log",
    "GET /api/reports/revenue",
    "GET /api/stock/low-stock",
    "GET /api/orders",
    "POST /api/jobs/:id/retry",
    "src/rbac.ts: can()",
    "src/rbac.ts: view-dashboard / view-ops / run-backup actions",
    "src/reports.ts: computeRevenueReport(db, opts)",
    "src/reports.ts: computeStockReport(db, opts)",
    "src/reports.ts: computeReconciliationReport(db, opts)",
    "src/payments.ts: computePaymentSummary(db, orderId)"
  ],
  "acceptanceMapping": [
    {
      "acceptanceId": "AC-1",
      "verification": "WP-MAIN: GET /dashboard (EJS, requireAuth) hien thi doanh thu hom nay + thang nay qua computeRevenueReport (chi don completed, theo Asia/Ho_Chi_Minh), don cho xu ly theo tung trang thai draft/confirmed/processing, so cap ton thap (available < min_stock), so thong bao chua doc (dinh nghia D30); so doanh thu KHOP GET /api/reports/revenue cung khoang (test so sanh truc tiep), so ton thap KHOP GET /api/stock/low-stock, so don cho xu ly KHOP GET /api/orders loc theo trang thai; so tien dinh dang Viet (vd 250.000d). GET /dashboard/shipments (EJS) hien thi don dang giao (shipments requested/shipped/in_transit kem ma van don + carrier + trang thai), tra cho duyet (returns requested kem ma don + ly do), tra vua nhan gan nhat (5 ban ghi), link sang chi tiet don. GET /dashboard/customers (EJS) hien thi khach VIP (segment VIP theo luat GOAL-008), tong diem da doi trong thang (redeemed x 100d), khach moi trong thang. GET /dashboard/notifications (EJS) hien thi thong bao moi nhat (10 ban ghi, theo event_type/status), job failed kem link retry tay qua API GOAL-011. KHONG tinh lai doanh thu/ton bang SQL rieng; KHONG doi hanh vi da khoa GOAL-005..011."
    },
    {
      "acceptanceId": "AC-2",
      "verification": "WP-MAIN: GET /health tra {status, db, version, uptime_seconds}; DB ok -> db: 'ok', status: 'ok', version = package.json (khong hard-code), uptime_seconds so nguyen >= 0; DB loi -> status: 'error' + 503; GIU hanh vi cu (status ok khi DB ok). GET /ops/backup (EJS, owner-only) hien thi sao luu gan nhat (ten file + thoi gian + kich thuoc, hoac 'chua co sao luu'). POST /api/ops/backup (owner-only) tao file backup bang scripts/backup.sh, tra {file, size, created_at}; POST /api/ops/restore (owner-only, body {file, confirm: true}) khoi phuc bang scripts/restore.sh — thieu/sai confirm -> 400, file khong ton tai -> 404, file ngoai thu muc backup -> 400; KHONG viet logic sao luu moi. Mo rong GET /audit-log: loc actor=/action=/from=/to= + phan trang page/limit (mac dinh page 1, limit 20 toi da 100); loc sai gia tri -> 400; phan trang dung (total/page/limit); giu hanh vi cu (owner/manager only, ngoai vai -> 403); API GET /api/audit-log giu nguyen."
    },
    {
      "acceptanceId": "AC-3",
      "verification": "WP-MAIN: cac man hinh moi dung chung public/style.css, tieng Viet, mobile-first, dong nhat voi man hinh da co; viewport 360px khong vo layout; luong chinh (xem dashboard -> xem chi tiet -> quay lai) dung duoc bang ban phim (link/button focus duoc, khong chi onclick); khi chua co du lieu hien thi 0/empty dung nghia, khong crash; loi service -> trang loi 500 khong lo stack trace. RBAC: mo rong can() them 3 actions view-dashboard / view-ops / run-backup theo ma tran brief-012 yeu cau 10 (owner/manager toan org; sales chi dashboard chi nhanh minh, xem dashboard toan org -> 403, xem van hanh -> 403; warehouse chi phan ton kho/giao hang thuoc kho duoc gan, xem doanh thu -> 403, xem van hanh -> 403; accountant xem dashboard doanh thu/bao cao toan org chi xem, chay backup/restore -> 403; user org A xem dashboard org B -> 403). Moi endpoint qua requireAuth + can()."
    },
    {
      "acceptanceId": "AC-4",
      "verification": "WP-MAIN: test moi (vitest + supertest, file moi tests/dashboard-acceptance.test.ts) chung minh toan bo hanh vi AC-1..AC-3 (dashboard dung so so voi API, man hinh giao/tra/khach/thong bao dung du lieu, health mo rong, backup/restore qua API — tao -> doi du lieu -> restore -> dung trang thai, audit loc/phan trang, RBAC 403 theo ma tran, trang thai rong/loi); du lieu GIA LAP hoan toan (2 org, 2 chi nhanh, 2 kho, 2 kenh tro len); KHONG sua 404 test da khoa GOAL-001..011; seed KHONG them user/san pham/kho moi (giu nguyen 2 user, 2 san pham, 2 kho + muc ton mau); secret qua bien moi truong, check.sh van quet secret; scripts/check.sh va scripts/demo.sh duoc MO RONG them buoc dashboard/van hanh (mo dashboard -> doanh thu hom nay/thang nay khop API bao cao -> don cho xu ly dung so -> ton thap dung so -> thong bao chua doc -> man hinh giao/tra co don dang giao -> man hinh khach co VIP -> man hinh thong bao co job failed + retry -> health tra du field -> backup qua API -> doi du lieu -> restore qua API -> du lieu ve dung -> audit loc theo actor/action + phan trang -> RBAC 403: sales xem dashboard toan org, warehouse xem doanh thu, accountant chay backup), giu cac buoc GOAL-001..011 xanh, tu chay duoc, tu don dep, in PASS/FAIL tung buoc; docs/RBAC.md bo sung ma tran dashboard/van hanh; docs/DECISIONS.md them D30; README.md/docs/SETUP.md cap nhat man hinh/endpoint moi, khop lenh da chay that; docs/ROADMAP.md danh dau 12 goal chinh + GOAL-005A da dong (roadmap hoan tat); khong co file .github/workflows/; CHK-2 timeoutMs 1200000 (20 phut) da co tu v1 trong goal-012.json."
    }
  ],
  "verificationStrategy": "Tester viet tests/dashboard-acceptance.test.ts (file moi) goi entries da khai + stub routes 501 trong src/app.ts cho 7 endpoint moi (GET /dashboard, /dashboard/shipments, /dashboard/customers, /dashboard/notifications, GET /ops/backup, POST /api/ops/backup, POST /api/ops/restore) va stub can() mac dinh false cho 3 action moi (view-dashboard/view-ops/run-backup) nen test RBAC do dung ly do; computeRevenueReport/computeStockReport da co tu GOAL-010, test doi chieu dung ham that qua GET /api/reports/revenue + GET /api/stock/low-stock; backup/restore test tren DB test rieng (tao backup -> doi du lieu -> restore -> dung trang thai). Luu y: setup v2 khong khai tests.paths nen goal show bao 'khong co khoa test' — KHONG co buoc tests submit khoa rieng nhu GOAL-010; test moi nam trong commit package, Worker viet code tren commit chua baseCommit, chay ./scripts/check.sh va ./scripts/demo.sh local truoc khi submit; gate APOS (L0 tsc, L1 vitest, L2 acceptance, L3 integration, CHK-1, CHK-2 voi timeoutMs 1200000) quyet dinh xanh/do cho package WP-MAIN submit."
}
```
