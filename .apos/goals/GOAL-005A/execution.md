# GOAL-005A v2: solo-direct

Mot package WP-MAIN duy nhat adopt R-19 mo coi cua GOAL-004 va kiem chung lai 3 luong tu dong theo vong doi don bang test khoa moi tren code GOAL-005 da co, KHONG them tinh nang: Tester viet file test moi tests/orders-005a-acceptance.test.ts (vitest + supertest) chung minh xac nhan don giu hang nguyen tu moi dong trong 1 transaction (thieu ton -> 400 insufficient_stock, khong giu dong nao, don o lai draft), hoan tat don = release + out trong CUNG MOT transaction (reserved ve 0, on_hand tru dung, 2 movement release + out cung reference ma don), huy tu confirmed/processing giai phong dung so da giu (reserved ve 0, on_hand khong doi), huy tu draft chi doi trang thai khong dong kho; chi sua toi thieu src/orders.ts (transitionOrderTx) / src/stock.ts (applyMovement) neu test moi phoi ra loi; docs/ROADMAP.md ghi chu GOAL-005A ngoai 12 goal chinh + docs/DECISIONS.md them D21 adopt R-19; check.sh/demo.sh giu xanh cac buoc GOAL-001..005 (mo rong toi thieu neu can).

```json
{
  "id": "GOAL-005A",
  "version": 2,
  "goalId": "GOAL-005A",
  "goalVersion": 2,
  "mode": "solo-direct",
  "approach": "Mot package WP-MAIN duy nhat adopt R-19 mo coi cua GOAL-004 va kiem chung lai 3 luong tu dong theo vong doi don bang test khoa moi tren code GOAL-005 da co, KHONG them tinh nang: Tester viet file test moi tests/orders-005a-acceptance.test.ts (vitest + supertest) chung minh xac nhan don giu hang nguyen tu moi dong trong 1 transaction (thieu ton -> 400 insufficient_stock, khong giu dong nao, don o lai draft), hoan tat don = release + out trong CUNG MOT transaction (reserved ve 0, on_hand tru dung, 2 movement release + out cung reference ma don), huy tu confirmed/processing giai phong dung so da giu (reserved ve 0, on_hand khong doi), huy tu draft chi doi trang thai khong dong kho; chi sua toi thieu src/orders.ts (transitionOrderTx) / src/stock.ts (applyMovement) neu test moi phoi ra loi; docs/ROADMAP.md ghi chu GOAL-005A ngoai 12 goal chinh + docs/DECISIONS.md them D21 adopt R-19; check.sh/demo.sh giu xanh cac buoc GOAL-001..005 (mo rong toi thieu neu can).",
  "risks": [
    "Test moi co the do truoc tren code hien co neu GOAL-005 co loi bien (vi du hoan tat bang 1 movement out duy nhat de reserved treo, hoac xac nhan giu nua voi khi dong sau thieu ton) — khi do Worker sua toi thieu trong src/orders.ts / src/stock.ts, khong doi state machine, khong them endpoint/migration.",
    "163 test GOAL-001..005 da khoa — KHONG sua; brief-005a.md + goal-005a.json DA commit rieng tren main (6e2983f) — KHONG dua 2 file nay vao commit package va KHONG dua vao paths (gate do APOS-SCOPE, bai hoc GOAL-004/005); check.sh/demo.sh phai tu npm ci (go symlink node_modules truoc, D12) trong worktree gate sach.",
    "Khong can dependency moi (scope goal khong co package.json) nen khong co exception needs-human cho package.json.",
    "RBAC don KHONG doi: khong sua src/rbac.ts hay ma tran don GOAL-005; docs chi ghi chu bookkeeping, khong claim tinh nang moi, khong claim CI/VPS/deploy."
  ],
  "baseCommit": "5265ad2327332a12a7f371703679cb1e333f11ad",
  "sourceSha256": "aaabc3ca1558c1858e3a32fcebc9c7b74c9c5c032dad97b902aae38ce39792c5",
  "rationale": "Goal bookkeeping nho, mot mien don/kho duy nhat: hanh vi 3 luong da co san trong src/orders.ts transitionOrderTx + src/stock.ts applyMovement tu GOAL-005, chi can them file test khoa moi + ghi chu docs (D21) trong cung mot lan lam; tach WP se chi them chi phi tich hop va tao nguy co dead-end khi AC-1 va AC-2 deu can cung test moi va cung code (mot tieu chi thuoc 2 package), trong khi Solo da chung minh hieu qua o GOAL-001/002/003/004/005.",
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
    "src/orders.ts",
    "src/stock.ts",
    "src/app.ts",
    "src/auth.ts",
    "src/db.ts",
    "src/seed.ts"
  ],
  "entries": [
    "POST /api/orders",
    "POST /api/orders/:id/confirm",
    "POST /api/orders/:id/process",
    "POST /api/orders/:id/complete",
    "POST /api/orders/:id/cancel",
    "src/orders.ts: transitionOrderTx()",
    "src/stock.ts: applyMovement()"
  ],
  "acceptanceMapping": [
    {
      "acceptanceId": "AC-1",
      "verification": "WP-MAIN: test moi tests/orders-005a-acceptance.test.ts chung minh 3 luong tren code GOAL-005: xac nhan don giu 10 moi dong (reserved tang dung, on_hand khong doi) va thieu ton -> 400 insufficient_stock, reserved khong doi o CA hai dong, don o lai draft; hoan tat don da giu 10 = release + out trong CUNG MOT transaction (reserved ve 0, on_hand tru 10, available cuoi dung, 2 movement release + out cung reference ma don); huy tu processing -> reserved ve 0, on_hand khong doi, available ve nhu truoc khi xac nhan; huy tu draft chi doi trang thai, khong dong kho; tao don van o draft, KHONG giu hang; khong endpoint moi, khong migration moi, khong doi state machine"
    },
    {
      "acceptanceId": "AC-2",
      "verification": "WP-MAIN: file test moi chay xanh, khong sua test da khoa GOAL-001..005; ./scripts/check.sh (CHK-1) va ./scripts/demo.sh (CHK-2) exit 0, giu cac buoc GOAL-001..005 xanh; docs/ROADMAP.md ghi chu GOAL-005A ngoai 12 goal chinh; docs/DECISIONS.md co D21 ghi adopt R-19 + xac nhan 3 luong da co tu GOAL-005; du lieu gia lap, khong credential that, khong claim CI/VPS/deploy"
    }
  ],
  "verificationStrategy": "Tester viet file test moi tests/orders-005a-acceptance.test.ts (L2) goi entries da khai (routes confirm/process/complete/cancel + transitionOrderTx/applyMovement); Worker chi sua toi thieu src/orders.ts/src/stock.ts neu test moi do, roi chay ./scripts/check.sh va ./scripts/demo.sh local tu dau sach truoc khi submit; gate APOS (L0 tsc, L1 vitest, L2 acceptance) quyet dinh. Setup v2 khong khai tests.paths nen khong co buoc khoa test rieng — test moi duoc gate kiem tra truc tiep o package submit."
}
```
