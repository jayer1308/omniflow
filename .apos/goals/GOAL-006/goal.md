# GOAL-006 v1: OmniFlow co nghiep vu thanh toan + hoan tien tren don hang GOAL-005: ghi nhan thu tien mat/chuyen khoan (paid ngay) va qua cong fake (requested roi webhook chot, dung mot lan du webhook tre/lap/sai thu tu); hoan tien bang ban ghi rieng, khong bao gio hoan vuot so da tra; idempotency trong transaction cho tao payment + hoan tien; doi soat don-thanh toan tung don + lich su giao dich append-only; RBAC theo ma tran thanh toan + audit log day du; KHONG luu thong tin the; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc thanh toan moi

Status: closed

```json
{
  "id": "GOAL-006",
  "version": 1,
  "outcome": "OmniFlow co nghiep vu thanh toan + hoan tien tren don hang GOAL-005: ghi nhan thu tien mat/chuyen khoan (paid ngay) va qua cong fake (requested roi webhook chot, dung mot lan du webhook tre/lap/sai thu tu); hoan tien bang ban ghi rieng, khong bao gio hoan vuot so da tra; idempotency trong transaction cho tao payment + hoan tien; doi soat don-thanh toan tung don + lich su giao dich append-only; RBAC theo ma tran thanh toan + audit log day du; KHONG luu thong tin the; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc thanh toan moi",
  "source": {
    "path": "brief-006.md",
    "sha256": "d3721a8812fccf7a526b1aebe77d2422a5001c1990065724601563c638fc6eb1",
    "capturedAt": "2026-11-27T00:19:25.461Z",
    "origin": "human"
  },
  "requirements": [
    {
      "id": "R-1",
      "sourceSpan": "dòng 186–195",
      "text": "Migration 011 tao bang payments (org_id NOT NULL FK toi orgs, branch_id NOT NULL FK toi branches, order_id NOT NULL FK toi orders, method TEXT NOT NULL CHECK IN ('cash','bank_transfer','gateway'), amount INTEGER NOT NULL CHECK > 0, currency TEXT NOT NULL DEFAULT 'VND' — chi VND trong goal nay, status TEXT NOT NULL DEFAULT 'requested' CHECK IN ('requested','paid','failed','refunded','partially_refunded'), gateway_reference TEXT NULL UNIQUE khi co gia tri, received_by NOT NULL FK toi users, received_at/created_at/updated_at): migration chay tuan tu sau 001–010, giu du lieu cu, khong vo 173 test da khoa. Khong co endpoint DELETE payment.",
      "disposition": "acceptance"
    },
    {
      "id": "R-2",
      "sourceSpan": "dòng 196–203",
      "text": "Migration 011 (tiep) tao bang refunds (payment_id NOT NULL FK toi payments, amount INTEGER NOT NULL CHECK > 0, reason TEXT NOT NULL, status TEXT NOT NULL CHECK IN ('requested','completed','failed'), created_by NOT NULL FK toi users, created_at) va bang payment_events append-only (payment_id NOT NULL FK toi payments, event_type TEXT NOT NULL, actor_id FK toi users NULL khi la webhook, detail TEXT NULL, created_at): chi INSERT, khong co API UPDATE/DELETE lich su (goi sua/xoa -> 404/405).",
      "disposition": "acceptance"
    },
    {
      "id": "R-3",
      "sourceSpan": "dòng 204–210",
      "text": "API tao payment: POST /api/orders/:id/payments nhan {method, amount, idempotency_key?} — method la -> 400; amount khong nguyen hoac <= 0 -> 400; don khong ton tai -> 404, ngoai org -> 403; don cancelled -> 400; cash/bank_transfer -> 201 voi payment 'paid' ngay; gateway -> 201 voi payment 'requested' + gateway_reference tu adapter da sua (duy nhat theo giao dich); thanh cong tra payment kem events (moi tao) + order_summary doi soat.",
      "disposition": "acceptance"
    },
    {
      "id": "R-4",
      "sourceSpan": "dòng 211–220",
      "text": "API webhook gia lap: POST /api/payments/webhook nhan {gateway_reference, status: 'paid' | 'failed', amount} + header X-Fake-Signature — sai/thieu chu ky -> 401; thieu secret o moi truong thi endpoint webhook tra 503 (khong bao gio chap nhan webhook khong chu ky), server van chay cac route khac; reference khong ton tai -> 404; amount webhook khac amount payment -> 400 (khong chot sai so); paid lan 2 -> 200 + duplicate: true, khong doi gi, ghi event webhook_duplicate_ignored; failed sau paid -> 200, bo qua, khong doi paid; failed roi paid -> paid chot binh thuong; webhook paid cho payment requested -> paid + event paid + audit log. Secret webhook qua bien moi truong OMNIFLOW_WEBHOOK_SECRET, khong commit secret that; check.sh van quet secret (grep nhu GOAL-001).",
      "disposition": "acceptance"
    },
    {
      "id": "R-5",
      "sourceSpan": "dòng 221–228",
      "text": "API hoan tien: POST /api/payments/:id/refunds nhan {amount, reason, idempotency_key?} — reason trong -> 400; amount <= 0 -> 400; payment khong ton tai -> 404, ngoai org -> 403; payment chua paid (con requested/failed) -> 400; tong hoan vuot so da tra -> 400, khong tao refund nao; thanh cong -> 201, refund completed ngay (adapter fake), payment cap nhat refunded (hoan du) hoac partially_refunded (hoan mot phan), ghi event refund_completed + audit log, tra refund kem payment da cap nhat + order_summary.",
      "disposition": "acceptance"
    },
    {
      "id": "R-6",
      "sourceSpan": "dòng 229–236",
      "text": "API doc + doi soat: GET /api/orders/:id/payments tra danh sach payment cua don (moi nhat truoc, kem refunds + events tung payment) + tom tat order_total/paid_total/refunded_total/outstanding/payment_status (unpaid/partially_paid/paid/overpaid/refunded); GET /api/payments/:id tra 1 payment kem refunds + events. Moi API doc loc theo org + pham vi vai (sales chi chi nhanh minh, warehouse chi kho duoc gan); ngoai org -> 403; don/payment khong ton tai -> 404.",
      "disposition": "acceptance"
    },
    {
      "id": "R-7",
      "sourceSpan": "dòng 237–246",
      "text": "Idempotency cho payment: tao payment + hoan tien deu nhan Idempotency-Key (header) hoac idempotency_key (body); server dung withStockIdempotency (GOAL-004) voi ten mien key payment:create:<key> / payment:refund:<key>; gui lai cung key + cung loai + cung org -> tra dung response da luu kem replayed: true, KHONG tao payment/refund moi (so payment, tong da tra, tong hoan khong doi). Key khac nhau thi thuc thi binh thuong. Thieu key thi van thuc thi (khong bat buoc) nhung khong co bao ve gui lai. Webhook chong trung bang gateway_reference UNIQUE, khong dung key client.",
      "disposition": "acceptance"
    },
    {
      "id": "R-8",
      "sourceSpan": "dòng 247–254",
      "text": "Chong ghi nhan 2 lan: moi tao payment/hoan tien/webhook chot deu trong BEGIN IMMEDIATE + UNIQUE(gateway_reference) o DB; test chung minh: gui dong thoi 2 webhook paid cung reference -> chi 1 lan chot, lan con lai duplicate: true, tong da tra chi tinh 1 lan; tao payment dong thoi cung idempotency key -> chi 1 payment; hoan tien dong thoi 2 lan vuot so da tra -> chi 1 lan thanh cong, lan con lai 400. App mot tien trinh (D1), bao ve race chi co y nghia trong mot process; da process ngoai pham vi, ghi ro trong DECISIONS.md.",
      "disposition": "acceptance"
    },
    {
      "id": "R-9",
      "sourceSpan": "dòng 255–262",
      "text": "Lich su giao dich: payment_events ghi du moi lan tao/chot/that bai/hoan/webhook (ke ca webhook trung — event webhook_duplicate_ignored); GET /api/orders/:id/payments tra events theo thu tu thoi gian tang dan (cu nhat truoc, nhu order_events D19); test: thu tien mat -> webhook paid -> hoan mot phan -> hoan not -> payment_status chuyen paid -> partially_refunded -> refunded, paid_total ve 0, outstanding ve bang order_total.",
      "disposition": "acceptance"
    },
    {
      "id": "R-10",
      "sourceSpan": "dòng 263–270",
      "text": "RBAC thanh toan: mo rong helper can() o src/rbac.ts them actions create-payment, refund-payment, view-payments theo dung ma tran o brief (ghi nhan thu tien: owner/manager/sales dung chi nhanh/accountant toan org, warehouse 403; hoan tien: owner/manager/accountant, sales/warehouse 403; xem: owner/manager/accountant toan org, sales chi chi nhanh minh, warehouse chi xem don co warehouse_id trong pham vi); moi endpoint payment qua requireRole + can() (vai sai -> 403, ngoai org -> 403, sai chi nhanh -> 403) — webhook la ngoai le duy nhat, xac thuc bang chu ky. Test chung minh tung o cam trong ma tran (it nhat: warehouse tao payment -> 403, sales hoan tien -> 403, sales xem payment don ngoai chi nhanh -> 403, user org A doc payment org B -> 403, webhook sai chu ky -> 401).",
      "disposition": "acceptance"
    },
    {
      "id": "R-11",
      "sourceSpan": "dòng 271–280",
      "text": "Audit log cho thanh toan: ghi vao audit_log da co MOI thao tac tao payment, webhook chot/that bai, hoan tien; moi ban ghi co user_id nguoi thuc hien (NULL + ghi ro webhook khi la webhook), created_at, action + detail JSON (target_payment_id, order_id, order_code, method, amount, gateway_reference, KHONG chua du lieu nhay cam, KHONG chua thong tin the); xem log theo luat GOAL-002 (GET /api/audit-log: owner toan org, manager trong pham vi, cac vai khac -> 403). payment_events la lich su giao dich chi tiet; audit_log la lop ghi nhan thao tac nhay cam theo chuan GOAL-002 — ca hai deu phai co, khong thay nhau.",
      "disposition": "acceptance"
    },
    {
      "id": "R-12",
      "sourceSpan": "dòng 281–295",
      "text": "Test moi (vitest + supertest, them vao file test moi — KHONG sua 173 test da khoa cua GOAL-001..005A): chung minh thu tien mat/chuyen khoan thanh paid ngay, thu qua cong tao requested + reference duy nhat (2 don cung so tien khong trung reference), webhook paid chot 1 lan + gui lap duplicate: true khong doi tong, webhook failed sau paid bi bo qua, webhook sai thu tu van chot khi paid toi, webhook sai chu ky -> 401, webhook sai so tien -> 400, hoan tien dung so + hoan vuot -> 400 + hoan mot phan/hoan du doi status dung, don da huy khong thu tien duoc -> 400, idempotency (tao lai cung key -> cung payment, khong tao moi; hoan lai cung key -> replayed: true), race (webhook dong thoi cung reference -> chi 1 lan chot; hoan dong thoi vuot so da tra -> chi 1 thanh cong), doi soat (paid/refund/outstanding/overpaid/refunded dung so hoc), RBAC 403 theo ma tran (yeu cau 10), khong co field the/CVV trong DB/API/log (test quet chung minh). Test dung du lieu gia lap (2 org, 2 don tro len trong cung org).",
      "disposition": "acceptance"
    },
    {
      "id": "R-13",
      "sourceSpan": "dòng 296–301",
      "text": "Du lieu GIA LAP hoan toan; mat khau seed + secret webhook qua bien moi truong (nhu GOAL-001..005: OMNIFLOW_SEED_*_PASSWORD, OMNIFLOW_WEBHOOK_SECRET), khong commit credential that; check.sh van quet secret (grep nhu GOAL-001); seed KHONG can them payment mau (demo tu tao payment) — nhung giu nguyen 2 user, 2 san pham, 2 kho + muc ton mau de test khoa van xanh.",
      "disposition": "acceptance"
    },
    {
      "id": "R-14",
      "sourceSpan": "dòng 302–310",
      "text": "scripts/check.sh (CHK-1) va scripts/demo.sh (CHK-2) duoc MO RONG trong goal nay: them buoc thanh toan vao smoke/demo (tao don -> thu tien mat mot phan -> thu qua cong -> webhook paid chot -> webhook lap bi bo qua -> hoan mot phan -> doi soat dung so -> idempotency gui lai khong tao payment moi -> RBAC 403: warehouse tao payment, sales hoan tien, webhook sai chu ky 401), giu tat ca buoc GOAL-001..005A xanh (health, login, owner-only, idempotency, backup/restore, RBAC nguoi dung, san pham/gia/CSV, kho, don + adopt R-19). Ca 2 script tu chay duoc, tu don dep, in PASS/FAIL tung buoc.",
      "disposition": "acceptance"
    },
    {
      "id": "R-15",
      "sourceSpan": "dòng 311–320",
      "text": "Docs: docs/RBAC.md bo sung ma tran thanh toan + mo hinh pham vi payment (theo chi nhanh cua don); docs/DECISIONS.md them D22 (mo hinh payment/refund: trang thai, hoan tien rieng bang, webhook chong trung bang reference UNIQUE, idempotency trong transaction, doi soat tinh o service) va D23 neu co quyet dinh sua adapter reference duy nhat theo giao dich + co che gia lap loi (Lead ghi); README.md/docs/SETUP.md cap nhat endpoint payment/webhook, khop lenh da chay that. Khong co file .github/workflows/ trong repo (gh token thieu scope workflow — CI la follow-up sau khi user cap scope). Khong claim VPS, khong claim deploy production (local-only, D9).",
      "disposition": "acceptance"
    },
    {
      "id": "R-16",
      "sourceSpan": "dòng 324–326",
      "text": "Giao hàng/trả hàng (GOAL-007): không yêu cầu giao, không gán đơn vị vận chuyển, không trả hàng nhập lại kho — hoàn tiền ở đây chỉ là trả lại tiền, chưa phải xử lý hàng trả.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "deferred",
        "to": "GOAL-007"
      },
      "exclusionReason": "Thuộc GOAL-007, không làm trong GOAL-006"
    },
    {
      "id": "R-17",
      "sourceSpan": "dòng 327–328",
      "text": "Khách hàng + CRM (GOAL-008): không có bảng khách hàng, không lưu phương thức thanh toán của khách, không lịch sử thanh toán theo khách.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "deferred",
        "to": "GOAL-008"
      },
      "exclusionReason": "Thuộc GOAL-008, không làm trong GOAL-006"
    },
    {
      "id": "R-18",
      "sourceSpan": "dòng 329–330",
      "text": "Khuyến mãi (GOAL-009): không mã giảm giá — số tiền thu chỉ đối soát với tổng đơn GOAL-005 đã snapshot.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "deferred",
        "to": "GOAL-009"
      },
      "exclusionReason": "Thuộc GOAL-009, không làm trong GOAL-006"
    },
    {
      "id": "R-19",
      "sourceSpan": "dòng 331–332",
      "text": "Báo cáo/đối soát tổng hợp (GOAL-010): không tổng hợp doanh thu theo thời gian, không đối soát lô (chỉ đối soát từng đơn — yêu cầu 6).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "deferred",
        "to": "GOAL-010"
      },
      "exclusionReason": "Thuộc GOAL-010, không làm trong GOAL-006"
    },
    {
      "id": "R-20",
      "sourceSpan": "dòng 333–334",
      "text": "Thông báo (GOAL-011): không gửi email khi nhận được tiền hay hoàn tiền (chỉ audit log + lịch sử giao dịch).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "deferred",
        "to": "GOAL-011"
      },
      "exclusionReason": "Thuộc GOAL-011, không làm trong GOAL-006"
    },
    {
      "id": "R-21",
      "sourceSpan": "dòng 335–336",
      "text": "Cổng thanh toán thật, tài khoản merchant, lưu thông tin thẻ, PCI — ngoài phạm vi vĩnh viễn của dự án giả lập này.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Ngoài phạm vi vĩnh viễn của dự án giả lập này"
    },
    {
      "id": "R-22",
      "sourceSpan": "dòng 337–338",
      "text": "Deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user cấp scope workflow).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Deploy/VPS ngoài phạm vi local-only (D9); CI chờ user cấp scope workflow, không có Goal CI nào được lên lịch"
    }
  ],
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
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Thu tien + adapter + schema thanh toan (AC-1): migration 011 tao 3 bang payments/refunds/payment_events; POST /api/orders/:id/payments tao payment — cash/bank_transfer thanh 'paid' ngay, gateway tao 'requested' + gateway_reference duy nhat theo giao dich; FakePaymentAdapter.charge() mo rong nhan ma dinh danh giao dich (ma don + payment id) de reference duy nhat ma van deterministic, giu simulated: true, them refund() + co che gia lap loi chi dung trong test; idempotency tao payment dung withStockIdempotency (ten mien payment:create:<key>) trong cung transaction BEGIN IMMEDIATE, gui lai tra replayed: true khong tao moi; moi tao payment/webhook chot trong BEGIN IMMEDIATE + UNIQUE(gateway_reference) chong ghi nhan 2 lan (phia tao payment)",
      "requirementIds": [
        "R-1",
        "R-2",
        "R-3",
        "R-7",
        "R-8",
        "R-12"
      ],
      "examples": [
        {
          "input": "POST /api/orders/:id/payments {method: 'cash' | 'bank_transfer', amount} (test moi)",
          "expected": "201, payment status 'paid' ngay, 1 event 'paid' + 1 audit log, kem order_summary doi soat"
        },
        {
          "input": "POST /api/orders/:id/payments {method: 'gateway', amount} cho 2 don khac nhau, cung amount (test moi)",
          "expected": "201, payment status 'requested' + gateway_reference tu adapter da sua; 2 don cung so tien co reference khac nhau"
        },
        {
          "input": "goi FakePaymentAdapter.charge() 2 lan cung amount khac ma don; goi refund() (test moi)",
          "expected": "charge() nhan them ma dinh danh giao dich (ma don + payment id), cung input -> cung reference, khac giao dich -> khac reference, giu simulated: true; refund(payment, amount) tra FAKE-REF-<hash> deterministic; failNext()/co che gia lap loi chi dung trong test, khong lot ra production path (ghi ro trong DECISIONS)"
        },
        {
          "input": "POST tao payment 2 lan cung Idempotency-Key / idempotency_key (test moi)",
          "expected": "gui lai cung key + cung loai + cung org -> tra dung response da luu kem replayed: true, KHONG tao payment moi; so payment va tong da tra khong doi; thieu key van thuc thi nhung khong co bao ve gui lai"
        },
        {
          "input": "POST /api/orders/:id/payments voi input sai (test moi)",
          "expected": "400 khi method la, amount khong nguyen hoac <= 0; 404 khi don khong ton tai, 403 khi ngoai org; 400 khi don cancelled"
        }
      ],
      "boundaries": [
        "migration 011 chay tuan tu sau 001-010, giu du lieu cu, 173 test da khoa cua GOAL-001..005A van xanh",
        "don draft van thu duoc (dat coc truoc khi xac nhan); don cancelled -> 400, khong thu tien don da huy",
        "branch_id cua payment = branch_id cua don (khong lay tu body)",
        "tra thua (tong paid > tong don) duoc phep ghi nhan nhung phai hien ro la thua trong doi soat (AC-3), khong tu dong chan",
        "sua adapter truoc khi viet test webhook: UNIQUE(gateway_reference) khong duoc chan nham lan thu thu hai cung so tien"
      ],
      "prohibited": [
        "khong duoc dung withIdempotency cua GOAL-001 (kiem tra key ngoai transaction, co khe race) cho tao payment/hoan tien — bat buoc dung withStockIdempotency trong cung transaction BEGIN IMMEDIATE",
        "khong duoc co endpoint DELETE payment; khong duoc luu thong tin the (khong field so the/CVV trong DB, API hay log)",
        "khong duoc doi state machine don GOAL-005; khong duoc de 2 lan thu cung so tien cho 2 don trung gateway_reference"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-2",
      "text": "Webhook gia lap chot dung mot lan (AC-2): POST /api/payments/webhook nhan {gateway_reference, status: 'paid' | 'failed', amount} + header X-Fake-Signature, secret qua bien moi truong OMNIFLOW_WEBHOOK_SECRET (khong commit secret that); sai/thieu chu ky -> 401, thieu secret -> 503; reference khong ton tai -> 404; amount khac -> 400; 'paid' lan 2 -> 200 + duplicate: true, ghi event webhook_duplicate_ignored, khong doi gi; 'failed' sau 'paid' -> 200, bo qua, khong doi 'paid'; 'failed' truoc roi 'paid' sau -> 'paid' van chot binh thuong; webhook 'paid' cho payment 'requested' -> 'paid' + event 'paid' + audit log; moi webhook deu ghi event",
      "requirementIds": [
        "R-4",
        "R-8",
        "R-12"
      ],
      "examples": [
        {
          "input": "POST /api/payments/webhook {gateway_reference, status: 'paid', amount} dung chu ky (test moi)",
          "expected": "200, payment requested -> paid + event 'paid' + audit log"
        },
        {
          "input": "gui dong thoi 2 webhook 'paid' cung reference; gui lai webhook 'paid' cho payment da paid (test moi)",
          "expected": "200 + duplicate: true, khong doi gi, ghi event 'webhook_duplicate_ignored', tong da tra chi tinh 1 lan"
        },
        {
          "input": "webhook 'failed' toi sau khi payment da 'paid' (test moi)",
          "expected": "200, bo qua, ghi event, KHONG doi 'paid' thanh 'failed'"
        },
        {
          "input": "webhook 'failed' truoc roi 'paid' sau — sai thu tu (test moi)",
          "expected": "'paid' sau van chot binh thuong (payment -> paid)"
        },
        {
          "input": "webhook sai chu ky, sai reference, sai so tien (test moi)",
          "expected": "sai/thieu chu ky -> 401; reference khong ton tai -> 404; amount webhook khac amount payment -> 400 (khong chot sai so)"
        }
      ],
      "boundaries": [
        "webhook KHONG yeu cau session dang nhap; xac thuc duy nhat bang chu ky gia lap header X-Fake-Signature = sha256(gateway_reference:status:amount + secret tu OMNIFLOW_WEBHOOK_SECRET)",
        "thieu secret o moi truong thi endpoint webhook tra 503 (khong bao gio chap nhan webhook khong chu ky), server van chay cac route khac; check.sh/demo.sh dat secret gia cho test",
        "moi webhook deu ghi event (ke ca ban trung) de doi soat thay duoc; app mot tien trinh (D1) nen bao ve race chi co y nghia trong mot process, da process ngoai pham vi (ghi ro trong DECISIONS.md)"
      ],
      "prohibited": [
        "khong bao gio chap nhan webhook khong chu ky / sai chu ky",
        "webhook khong duoc tao payment moi; webhook 'failed' muon khong duoc lat 'paid' thanh 'failed'",
        "khong duoc dung idempotency key cua client cho webhook — chong trung cua webhook bang gateway_reference UNIQUE"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-3",
      "text": "Hoan tien + doi soat + lich su giao dich (AC-3): POST /api/payments/:id/refunds nhan {amount, reason, idempotency_key?} — reason bat buoc, amount > 0, payment phai 'paid', tong hoan khong vuot so da tra (kiem tra trong BEGIN IMMEDIATE), thanh cong -> 201 refund 'completed' ngay, payment doi 'refunded'/'partially_refunded', ghi event refund_completed + audit log; idempotency hoan tien ten mien payment:refund:<key> qua withStockIdempotency, gui lai tra replayed: true; GET /api/orders/:id/payments tra danh sach payment (moi nhat truoc, kem refunds + events tung payment) + tom tat doi soat order_total/paid_total/refunded_total/outstanding/payment_status (unpaid/partially_paid/paid/overpaid/refunded); GET /api/payments/:id tra 1 payment kem refunds + events; payment_events ghi du moi lan tao/chot/that bai/hoan/webhook ke ca trung",
      "requirementIds": [
        "R-5",
        "R-6",
        "R-7",
        "R-8",
        "R-9",
        "R-12"
      ],
      "examples": [
        {
          "input": "POST /api/payments/:id/refunds {amount, reason, idempotency_key?} (test moi)",
          "expected": "201, refund 'completed' ngay (adapter fake), payment cap nhat 'refunded' (hoan du) hoac 'partially_refunded' (hoan mot phan), ghi event 'refund_completed' + audit log, tra refund kem payment da cap nhat + order_summary"
        },
        {
          "input": "POST /api/payments/:id/refunds voi input sai / hoan vuot (test moi)",
          "expected": "400, khong tao refund nao: reason trong, amount <= 0, payment chua 'paid' (con requested/failed), tong hoan vuot so da tra, payment khong ton tai -> 404, ngoai org -> 403"
        },
        {
          "input": "2 request hoan tien dong thoi cung vuot so da tra; gui lai cung Idempotency-Key ten mien payment:refund:<key> (test moi)",
          "expected": "hoan dong thoi 2 lan vuot so da tra -> chi 1 lan thanh cong, lan con lai 400; gui lai cung key hoan tien -> replayed: true, khong tao refund moi"
        },
        {
          "input": "GET /api/orders/:id/payments va GET /api/payments/:id (test moi)",
          "expected": "order_total / paid_total (tong payment 'paid' tru tong refund 'completed') / refunded_total / outstanding (order_total - paid_total, am nghia la thua, hien ro) / payment_status (unpaid / partially_paid / paid / overpaid / refunded); case tra thua va hoan du co so hoc dung"
        },
        {
          "input": "luong day du tren 1 payment (test moi)",
          "expected": "thu tien mat -> webhook paid -> hoan mot phan -> hoan not: payment_status chuyen paid -> partially_refunded -> refunded, paid_total ve 0, outstanding ve bang order_total; events ghi du moi lan tao/chot/that bai/hoan/webhook (ke ca webhook trung)"
        }
      ],
      "boundaries": [
        "hoan tien KHONG doi trang thai don GOAL-005 (state machine don giu nguyen; tra hang/nhap lai kho la GOAL-007); chi cap nhat status cua payment: hoan du -> 'refunded', hoan mot phan -> 'partially_refunded'",
        "tong hoan tich luy cua mot payment khong bao gio vuot so da tra: tinh tong hoan hien tai + amount moi trong cung BEGIN IMMEDIATE roi moi insert (DB CHECK don gian khong lam duoc)",
        "payment_events append-only: chi INSERT, khong co API UPDATE/DELETE lich su (goi sua/xoa -> 404/405); events tra theo thu tu thoi gian tang dan (cu nhat truoc, nhu order_events D19); payments tra moi nhat truoc",
        "don cancelled van xem duoc lich su thanh toan/hoan cua no (doi soat sau huy); tom tat doi soat tinh o service tu bang payments/refunds, khong luu cot tong rieng"
      ],
      "prohibited": [
        "khong duoc sua payment goc khi hoan tien (hoan tien la ban ghi refunds rieng); khong duoc hoan vuot so da tra; khong duoc giau so thua (outstanding am phai hien ro)",
        "khong duoc doi trang thai don khi hoan tien; khong duoc sua/xoa payment_events"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-4",
      "text": "RBAC + audit + khong luu the + test/checks/docs (AC-4): mo rong helper can() o src/rbac.ts them actions create-payment, refund-payment, view-payments theo dung ma tran thanh toan (ghi nhan thu tien: owner/manager/sales dung chi nhanh/accountant toan org, warehouse 403; hoan tien: owner/manager/accountant, sales/warehouse 403; xem: owner/manager/accountant toan org, sales chi chi nhanh minh, warehouse chi xem don co warehouse_id trong pham vi); moi endpoint payment qua requireRole + can() (vai sai/sai chi nhanh/ngoai org -> 403), webhook la ngoai le duy nhat; audit_log ghi MOI thao tac tao payment, webhook chot/that bai, hoan tien; test moi (vitest + supertest, file moi) chung minh toan bo hanh vi AC-1..AC-3 + RBAC 403 + khong co field the/CVV; du lieu GIA LAP hoan toan, secret qua bien moi truong, check.sh van quet secret; scripts/check.sh va scripts/demo.sh duoc MO RONG them buoc thanh toan, giu cac buoc GOAL-001..005A xanh, tu chay duoc, tu don dep, in PASS/FAIL tung buoc; docs RBAC/DECISIONS/README/SETUP cap nhat",
      "requirementIds": [
        "R-10",
        "R-11",
        "R-12",
        "R-13",
        "R-14",
        "R-15"
      ],
      "examples": [
        {
          "input": "test RBAC theo tung o cam trong ma tran thanh toan (test moi)",
          "expected": "403: warehouse tao payment; sales hoan tien; sales xem payment don ngoai chi nhanh minh; user org A doc payment org B; warehouse khong duoc tao payment hay hoan tien du dung kho; 401: webhook sai chu ky"
        },
        {
          "input": "thuc hien cac thao tac payment roi doc audit_log (test moi)",
          "expected": "moi thao tac tao payment, webhook chot/that bai, hoan tien deu ghi audit_log voi user_id nguoi thuc hien (NULL + ghi ro 'webhook' khi la webhook), created_at, action + detail JSON (target_payment_id, order_id, order_code, method, amount, gateway_reference, KHONG chua du lieu nhay cam, KHONG chua thong tin the)"
        },
        {
          "input": "test quet schema/API/log tim truong the/CVV (test moi)",
          "expected": "test quet chung minh khong co field the/CVV trong DB, API hay log"
        },
        {
          "input": "./scripts/check.sh; ./scripts/demo.sh",
          "expected": "./scripts/check.sh exit 0 va ./scripts/demo.sh in PASS tung buoc, gom cac buoc GOAL-001..005A xanh + buoc thanh toan moi"
        },
        {
          "input": "doc RBAC/DECISIONS/README/SETUP sau goal",
          "expected": "docs/RBAC.md bo sung ma tran thanh toan + mo hinh pham vi payment (theo chi nhanh cua don); docs/DECISIONS.md them D22 (mo hinh payment/refund) va D23 neu co quyet dinh sua adapter reference duy nhat + co che gia lap loi; README.md/docs/SETUP.md cap nhat endpoint payment/webhook, khop lenh da chay that"
        }
      ],
      "boundaries": [
        "webhook la ngoai le duy nhat cua ma tran RBAC (xac thuc bang chu ky, khong qua requireRole/can())",
        "xem audit log theo luat GOAL-002 (GET /api/audit-log: owner toan org, manager trong pham vi, cac vai khac -> 403); payment_events la lich su giao dich chi tiet, audit_log la lop ghi nhan thao tac nhay cam — ca hai deu phai co, khong thay nhau",
        "seed KHONG them payment mau (demo tu tao payment) — giu nguyen 2 user, 2 san pham, 2 kho + muc ton mau de test khoa van xanh",
        "test moi them vao file test moi, KHONG sua 173 test da khoa cua GOAL-001..005A; du lieu test gia lap (2 org, 2 don tro len trong cung org)"
      ],
      "prohibited": [
        "khong duoc sua test da khoa cua GOAL-001..005A; khong duoc commit secret/credential that; khong duoc commit file .github/workflows/ (CI cho user cap scope workflow)",
        "khong duoc claim VPS, deploy production hay cong thanh toan that; khong duoc luu thong tin the o bat ky dau (DB, API, log, audit_log, payment_events)"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    }
  ],
  "checks": [
    {
      "id": "CHK-1",
      "kind": "command",
      "command": "./scripts/check.sh",
      "expect": "pass",
      "runs": 1,
      "timeoutMs": 600000,
      "env": {}
    },
    {
      "id": "CHK-2",
      "kind": "command",
      "command": "./scripts/demo.sh",
      "expect": "pass",
      "runs": 1,
      "timeoutMs": 600000,
      "env": {}
    }
  ],
  "dependencies": [
    "GOAL-005"
  ],
  "priority": 3
}
```
