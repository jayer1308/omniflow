# WP-MAIN v1: OmniFlow co UI tong quan + van hanh: dashboard (doanh thu hom nay/thang nay, don cho xu ly, ton thap, thong bao chua doc — so lieu tu service da co, khop API bao cao GOAL-010), man hinh giao/tra tong quan, man hinh khach/diem tong quan, man hinh thong bao/job tong quan; health check mo rong (DB, version, uptime); trang sao luu/khoi phuc qua dung co che GOAL-001; trang nhat ky audit co loc/phan trang; EJS tieng Viet mobile-first dong nhat, dung duoc bang ban phim; RBAC theo ma tran dashboard/van hanh + audit log day du; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc dashboard/van hanh moi (CHK-2 timeoutMs 20 phut tu v1); 4 yeu cau mo coi thong bao + R-20 cua GOAL-008 duoc loai tru co ly do (out-of-scope); inbox sach hoan toan sau khi dong — goal cuoi cua roadmap

```json
{
  "id": "WP-MAIN",
  "goalId": "GOAL-012",
  "goalVersion": 1,
  "version": 1,
  "owner": "lead",
  "outcome": "OmniFlow co UI tong quan + van hanh: dashboard (doanh thu hom nay/thang nay, don cho xu ly, ton thap, thong bao chua doc — so lieu tu service da co, khop API bao cao GOAL-010), man hinh giao/tra tong quan, man hinh khach/diem tong quan, man hinh thong bao/job tong quan; health check mo rong (DB, version, uptime); trang sao luu/khoi phuc qua dung co che GOAL-001; trang nhat ky audit co loc/phan trang; EJS tieng Viet mobile-first dong nhat, dung duoc bang ban phim; RBAC theo ma tran dashboard/van hanh + audit log day du; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc dashboard/van hanh moi (CHK-2 timeoutMs 20 phut tu v1); 4 yeu cau mo coi thong bao + R-20 cua GOAL-008 duoc loai tru co ly do (out-of-scope); inbox sach hoan toan sau khi dong — goal cuoi cua roadmap",
  "scope": [
    "docs/",
    "src/",
    "scripts/",
    "tests/",
    "views/",
    "public/",
    "README.md",
    "brief-012.md",
    "goal-012.json",
    ".gitignore"
  ],
  "exclusions": [
    "Nghiep vu moi ngoai dashboard/van hanh (khong them loai don/thanh toan/khuyen mai/khach moi); khong doi logic tinh da khoa (computePaymentSummary, state machine don, gia hieu dung, luat diem/ma) — thuoc cac goal truoc, khong lam trong GOAL-012.",
    "Dich vu that (email/SMS/push that, cong thanh toan that, don vi van chuyen that) — ngoai pham vi vinh vien cua du an gia lap nay; deploy production/VPS (ngoai pham vi, local-only), CI workflow (cho user cap scope workflow).",
    "Yeu cau R-20 cua GOAL-006, R-19 cua GOAL-008, R-17 cua GOAL-009 va R-14 cua GOAL-010 duoc loai tru co ly do (out-of-scope) trong goal nay — xem requirement R-21/R-22/R-23/R-24; chung chi la cau phu dinh pham vi thong bao cua goal goc, toan bo pham vi thong bao da duoc so huu boi requirements rieng R-1..R-15 cua GOAL-011; adopt vao GOAL-012 (UI/van hanh) se nhan sai pham vi.",
    "Yeu cau R-20 cua GOAL-008 duoc loai tru co ly do (out-of-scope) trong goal nay — xem requirement R-25; R-20 chi la cau phu dinh pham vi cua GOAL-008 (noi GOAL-008 khong lam man hinh khach/CRM), pham vi man hinh khach/diem tong quan da duoc so huu boi requirements rieng R-3 cua GOAL-012."
  ],
  "dependencies": [],
  "interfaces": [
    "GOAL-012@v1"
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Dashboard + man hinh tong quan (AC-1): GET /dashboard (EJS): doanh thu hom nay + thang nay (qua computeRevenueReport GOAL-010, chi don completed, theo Asia/Ho_Chi_Minh), don cho xu ly theo tung trang thai draft/confirmed/processing, so cap ton thap (available < min_stock, GOAL-004), so thong bao chua doc (dinh nghia D30). GET /dashboard/shipments (EJS): don dang giao (shipments requested/shipped/in_transit kem ma van don + carrier + trang thai), tra cho duyet (returns requested kem ma don + ly do), tra vua nhan gan nhat (5 ban ghi), link sang chi tiet don — du lieu GOAL-007. GET /dashboard/customers (EJS): khach VIP (segment VIP theo luat GOAL-008), tong diem da doi trong thang (redeemed x 100d), khach moi trong thang — du lieu GOAL-008. GET /dashboard/notifications (EJS): thong bao moi nhat (10 ban ghi, theo event_type/status), job failed can chu y kem link retry tay qua API GOAL-011 — du lieu GOAL-011. So dashboard PHAI khop so API bao cao GOAL-010 cung khoang (test so sanh truc tiep). So tien hien thi dung dinh dang Viet (vd 250.000d).",
      "goalAcceptanceId": "AC-1",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-2",
      "text": "Van hanh: health + sao luu/khoi phuc + audit (AC-2): GET /health mo rong tra {status, db, version, uptime_seconds} — db: 'ok' khi query SELECT 1 thanh cong, version doc tu package.json (khong hard-code), uptime_seconds tu luc process start (so nguyen >= 0); DB loi -> status: 'error' + 503. GET /ops/backup (EJS, owner-only) hien thi trang thai sao luu gan nhat (ten file + thoi gian + kich thuoc, hoac 'chua co sao luu'); POST /api/ops/backup (owner-only) tao file backup bang scripts/backup.sh, tra {file, size, created_at}; POST /api/ops/restore (owner-only, body {file, confirm: true}) khoi phuc bang scripts/restore.sh. Mo rong GET /audit-log (EJS, da co): them loc actor=/action=/from=/to= + phan trang page/limit (mac dinh page 1, limit 20 toi da 100); loc sai gia tri -> 400; giu hanh vi cu (owner/manager only, ngoai vai -> 403).",
      "goalAcceptanceId": "AC-2",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-3",
      "text": "EJS + RBAC (AC-3): cac man hinh moi dung chung public/style.css, tieng Viet, mobile-first, dong nhat voi man hinh da co; viewport 360px khong vo layout; luong chinh (xem dashboard -> xem chi tiet -> quay lai) dung duoc bang ban phim. RBAC: mo rong can() them 3 actions view-dashboard / view-ops / run-backup theo ma tran brief-012.md yeu cau 10 (owner/manager toan org; sales chi dashboard chi nhanh minh, xem van hanh -> 403; warehouse chi phan ton kho/giao hang thuoc kho duoc gan, xem doanh thu -> 403, xem van hanh -> 403; accountant xem dashboard doanh thu/bao cao toan org chi xem, chay backup/restore -> 403). Moi endpoint qua requireAuth + can() (vai sai/sai chi nhanh/kho/ngoai org -> 403).",
      "goalAcceptanceId": "AC-3",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-4",
      "text": "Test + checks/docs + du lieu gia lap (AC-4): test moi (vitest + supertest, file moi) chung minh toan bo hanh vi AC-1..AC-3 (dashboard dung so so voi API, man hinh giao/tra/khach/thong bao dung du lieu, health mo rong, backup/restore qua API, audit loc/phan trang, RBAC 403, trang thai rong/loi); du lieu GIA LAP hoan toan, secret qua bien moi truong, check.sh van quet secret; scripts/check.sh va scripts/demo.sh duoc MO RONG them buoc dashboard/van hanh (mo dashboard -> doanh thu hom nay/thang nay khop API bao cao -> don cho xu ly dung so -> ton thap dung so -> thong bao chua doc -> man hinh giao/tra co don dang giao -> man hinh khach co VIP -> man hinh thong bao co job failed + retry -> health tra du field -> backup qua API -> doi du lieu -> restore qua API -> du lieu ve dung -> audit loc theo actor/action + phan trang -> RBAC 403: sales xem dashboard toan org, warehouse xem doanh thu, accountant chay backup), giu cac buoc GOAL-001..011 xanh, tu chay duoc, tu don dep, in PASS/FAIL tung buoc; docs RBAC/DECISIONS(D30)/ROADMAP/README/SETUP cap nhat.",
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
  ]
}
```
