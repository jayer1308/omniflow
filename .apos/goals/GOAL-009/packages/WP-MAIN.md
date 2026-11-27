# WP-MAIN v1: OmniFlow co nghiep vu khuyen mai tren don hang GOAL-005: ma giam gia (UNIQUE theo org, chuan hoa UPPERCASE) loai % co cap hoac so tien co dinh, dieu kien ap dung (tong toi thieu, kenh, chi nhanh, thoi gian hieu luc, gioi han dung tong + moi khach); ap ma vao don draft (tinh lai tong sau giam, ghi ro ma + so tien giam tren don); luat chong giam voi diem GOAL-008 theo MOT luat duy nhat (tong giam = min(C + P, total), khong phu thuoc thu tu ap); huy don co ma thi hoan luot dung, tra hang/hoan tien thi KHONG; doi soat tru ca diem lan ma (outstanding = total - points_discount - promo_discount - paid_total), payment_status giu logic D22; lich su dung ma append-only; RBAC theo ma tran khuyen mai + audit log day du; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc khuyen mai moi; yeu cau R-18 cua GOAL-007 duoc loai tru co ly do (out-of-scope)

```json
{
  "id": "WP-MAIN",
  "goalId": "GOAL-009",
  "goalVersion": 1,
  "version": 1,
  "owner": "lead",
  "outcome": "OmniFlow co nghiep vu khuyen mai tren don hang GOAL-005: ma giam gia (UNIQUE theo org, chuan hoa UPPERCASE) loai % co cap hoac so tien co dinh, dieu kien ap dung (tong toi thieu, kenh, chi nhanh, thoi gian hieu luc, gioi han dung tong + moi khach); ap ma vao don draft (tinh lai tong sau giam, ghi ro ma + so tien giam tren don); luat chong giam voi diem GOAL-008 theo MOT luat duy nhat (tong giam = min(C + P, total), khong phu thuoc thu tu ap); huy don co ma thi hoan luot dung, tra hang/hoan tien thi KHONG; doi soat tru ca diem lan ma (outstanding = total - points_discount - promo_discount - paid_total), payment_status giu logic D22; lich su dung ma append-only; RBAC theo ma tran khuyen mai + audit log day du; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc khuyen mai moi; yeu cau R-18 cua GOAL-007 duoc loai tru co ly do (out-of-scope)",
  "scope": [
    "docs/",
    "src/",
    "scripts/",
    "tests/",
    "README.md",
    "brief-009.md",
    "goal-009.json",
    ".gitignore"
  ],
  "exclusions": [
    "Báo cáo/đối soát tổng hợp (GOAL-010), thông báo (GOAL-011), UI tổng quan (GOAL-012) — thuộc goal sau, không làm trong GOAL-009.",
    "Đơn vị vận chuyển thật / giao hàng thật, tài khoản hãng vận chuyển, cổng thanh toán thật — ngoài phạm vi vĩnh viễn của dự án giả lập này; deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user cấp scope workflow).",
    "Yêu cầu R-18 của GOAL-007 được loại trừ có lý do (out-of-scope) trong goal này — xem requirement R-20; không adopt vì R-18 gộp 3 phạm vi (CRM đã xong GOAL-008, thông báo là GOAL-011, UI là GOAL-012); adopt vào GOAL-009 sẽ nhận sai phạm vi (khuyến mãi).",
    "Không có endpoint gỡ mã khỏi đơn trong goal này (muốn đổi mã thì hủy đơn rồi tạo đơn mới); mã (code) không đổi sau khi tạo."
  ],
  "dependencies": [],
  "interfaces": [
    "GOAL-009@v1"
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Ma giam gia + schema (AC-1): migration 014 tao 2 bang promotions/promotion_usages + ALTER TABLE orders them promotion_id INTEGER NULL FK toi promotions va promo_discount INTEGER NOT NULL DEFAULT 0 CHECK >= 0 (don cu giu NULL/0); promotions co org_id NOT NULL FK, code TEXT NOT NULL chuan hoa UPPERCASE + trim, UNIQUE(org_id, code), type CHECK IN ('percent','fixed'), value INTEGER CHECK > 0, cap INTEGER NULL CHECK > 0 (chi percent), min_order_total INTEGER NOT NULL DEFAULT 0 CHECK >= 0, channels TEXT NULL (JSON mang kenh, NULL = moi kenh), branch_id NULL FK (NULL = moi chi nhanh), valid_from/valid_to TEXT NULL ISO 8601, usage_limit/per_customer_limit INTEGER NULL CHECK > 0 (NULL = khong gioi han), status CHECK IN ('active','locked') mac dinh 'active'; promotion_usages append-only (promotion_id/order_id NOT NULL FK, customer_id NULL FK, discount_amount INTEGER CHECK > 0, status CHECK IN ('used','released') mac dinh 'used', released_at/released_reason NULL); POST /api/promotions tao ma (code trong/qua 50 ky tu -> 400, trung ma trong org -> 409, percent value ngoai 1..100 -> 400, cap voi fixed -> 400, valid_from >= valid_to -> 400, branch ngoai org -> 403) -> 201; PATCH /api/promotions/:id sua ma (gui code -> 400, ma khong ton tai -> 404, ngoai org -> 403, moi luat validate nhu khi tao; status chi active/locked) -> 200; GET /api/promotions (loc code/status/channel/branch_id, phan trang limit/offset) + GET /api/promotions/:id kem {used_count, usage_limit, per_customer_limit}; moi API loc theo org + pham vi vai",
      "goalAcceptanceId": "AC-1",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-2",
      "text": "Ap ma + dieu kien + tinh giam + gioi han dung (AC-2): POST /api/orders/:id/promotion {code, idempotency_key?} — don khong ton tai -> 404, ngoai org -> 403; don khong o draft -> 400; don da co ma -> 400; ma khong ton tai -> 404; ma locked -> 400; sai kenh/chi nhanh -> 400; ngoai thoi gian hieu luc -> 400; tong don goc < min_order_total -> 400; het luot tong/moi khach -> 400; thanh cong -> 201, trong CUNG MOT transaction BEGIN IMMEDIATE: ghi 1 dong promotion_usages (status 'used', discount_amount = so tien giam, customer_id = customer_id cua don) + cap nhat orders.promotion_id + promo_discount + 1 audit log, tra don kem {promotion: {id, code, type, value}, promo_discount}; tinh giam tren tong goc: percent -> floor(total x value / 100) roi min voi cap va phan con lai sau diem, fixed -> min(value, total - points_discount), promo_discount + points_discount <= total; gioi han dung: tong luot = so usage 'used' cua ma, luot moi khach = so usage 'used' cua ma voi customer_id do (don khong gan khach chi tinh gioi han tong)",
      "goalAcceptanceId": "AC-2",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-3",
      "text": "Chong giam + huy don hoan luot + doi soat (AC-3): luat chong giam MOT luat duy nhat: % tinh tren tong goc, tong giam cuoi = min(C + P, total) voi C = so giam cua ma truoc khi cat o phan con lai (percent: min(floor(total x value / 100), cap); fixed: value), P = diem doi x 100 — ket qua nhu nhau du ap ma truoc hay doi diem truoc (test ca hai chieu + truong hop bao hoa); doi diem tren don da co ma bi cat o total - promo_discount (sua toi thieu o redeem, khong doi hanh vi khi don chua co ma); huy don co ma trong CUNG MOT transaction voi doi trang thai: usage chuyen 'used' -> 'released' (released_at + release_reason = ma don da huy), orders.promo_discount ve 0, promotion_id ve NULL — luot dung giai phong, dung lai duoc; tra hang/hoan tien KHONG hoan luot dung; computePaymentSummary mo rong: outstanding = order_total - points_discount - promo_discount - paid_total, payment_status GIU NGUYEN logic D22; tich diem tinh tren order_total goc, KHONG tru promo_discount",
      "goalAcceptanceId": "AC-3",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-4",
      "text": "RBAC + audit + idempotency + test/checks/docs (AC-4): mo rong helper can() o src/rbac.ts them 4 actions create-promotion, update-promotion, apply-promotion, view-promotions theo dung ma tran khuyen mai (tao/sua/khoa: chi owner/manager; ap ma: owner/manager toan org, sales chi don thuoc chi nhanh minh; xem: owner/manager/accountant toan org, sales chi ma branch_id NULL hoac dung chi nhanh minh, warehouse 403); moi endpoint khuyen mai qua requireRole + can() (vai sai/sai chi nhanh/ngoai org -> 403); audit_log ghi MOI thao tac tao/sua/khoa ma, ap ma, hoan luot dung khi huy don; promotion_usages ghi du moi lan ap ma thanh cong (gui lai cung key thi KHONG ghi dong moi); idempotency dung withStockIdempotency voi ten mien promotion:create:<key> / promotion:apply:<key>, gui lai tra replayed: true khong tao ma/usage moi; test moi (vitest + supertest, file moi) chung minh toan bo hanh vi AC-1..AC-3 + RBAC 403; du lieu GIA LAP hoan toan, secret qua bien moi truong, check.sh van quet secret; scripts/check.sh va scripts/demo.sh duoc MO RONG them buoc khuyen mai, giu cac buoc GOAL-001..008 xanh, tu chay duoc, tu don dep, in PASS/FAIL tung buoc; docs RBAC/DECISIONS(D27)/README/SETUP cap nhat",
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
    "brief-009.md",
    "goal-009.json",
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
    "src/adapters/index.ts",
    "src/tenant.ts",
    "src/idempotency.ts"
  ]
}
```
