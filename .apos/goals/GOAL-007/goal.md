# GOAL-007 v1: OmniFlow co nghiep vu giao hang + tra hang tren don hang GOAL-005: yeu cau giao cho don completed qua adapter fake (ma van don deterministic, phi/ETA tu quote), cap nhat trang thai giao lap la no-op khong ghi event, sai thu tu bi tu choi; tra hang duyet/tu choi co ly do, nhan hang nhap lai kho dung so ban lai duoc (hang hong khong nhap kho), hoan tien qua dung duong GOAL-006; doi chieu don-thanh toan-kho sau tra dung so; RBAC theo ma tran giao/tra + audit log day du; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc giao/tra moi; yeu cau R-20 cua GOAL-004 duoc loai tru co ly do (out-of-scope)

Status: closed

```json
{
  "id": "GOAL-007",
  "version": 1,
  "outcome": "OmniFlow co nghiep vu giao hang + tra hang tren don hang GOAL-005: yeu cau giao cho don completed qua adapter fake (ma van don deterministic, phi/ETA tu quote), cap nhat trang thai giao lap la no-op khong ghi event, sai thu tu bi tu choi; tra hang duyet/tu choi co ly do, nhan hang nhap lai kho dung so ban lai duoc (hang hong khong nhap kho), hoan tien qua dung duong GOAL-006; doi chieu don-thanh toan-kho sau tra dung so; RBAC theo ma tran giao/tra + audit log day du; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc giao/tra moi; yeu cau R-20 cua GOAL-004 duoc loai tru co ly do (out-of-scope)",
  "source": {
    "path": "brief-007.md",
    "sha256": "5586ce9122656edcbd73a2cf609470e1e354ef85fb39ffeb00c70cec04c7f906",
    "capturedAt": "2026-11-27T02:04:42.929Z",
    "origin": "human"
  },
  "requirements": [
    {
      "id": "R-1",
      "sourceSpan": "dòng 261–286",
      "text": "Migration 012 tao 5 bang giao/tra (shipments, shipment_events, returns, return_items, return_events): shipments (org_id NOT NULL FK toi orgs, order_id NOT NULL FK toi orders, carrier TEXT NOT NULL, tracking_code TEXT NOT NULL UNIQUE, destination TEXT NOT NULL, fee INTEGER NOT NULL CHECK >= 0, eta_days INTEGER NOT NULL CHECK > 0, status TEXT NOT NULL DEFAULT 'requested' CHECK IN ('requested','in_transit','delivered','failed'), created_at/updated_at); shipment_events append-only (shipment_id NOT NULL FK, event_type TEXT NOT NULL, actor_id FK toi users, detail TEXT NULL, created_at); returns (org_id NOT NULL FK, order_id NOT NULL FK, code TEXT NOT NULL UNIQUE trong org dang TH-YYYYMMDD-NNNN, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'requested' CHECK IN ('requested','approved','rejected','received','refunded'), reviewed_by/received_by FK toi users NULL cho toi khi toi buoc do, review_reason TEXT NULL, created_at/updated_at); return_items (return_id NOT NULL FK, variant_id NOT NULL FK, qty INTEGER NOT NULL CHECK > 0, condition TEXT NOT NULL CHECK IN ('resalable','damaged'), unit_price INTEGER NOT NULL CHECK >= 0 — snapshot tu order_items, UNIQUE(return_id, variant_id)); return_events append-only (return_id NOT NULL FK, event_type TEXT NOT NULL, actor_id FK toi users, detail TEXT NULL, created_at). Lich su chi INSERT, khong co API UPDATE/DELETE (goi sua/xoa -> 404/405). Migration chay tuan tu sau 001–011, giu du lieu cu, khong vo 208 test da khoa. Khong co endpoint DELETE shipment/return.",
      "disposition": "acceptance"
    },
    {
      "id": "R-2",
      "sourceSpan": "dòng 288–295",
      "text": "API yeu cau giao hang: POST /api/orders/:id/shipments nhan {carrier, destination, idempotency_key?} — carrier/destination trong -> 400; don khong ton tai -> 404, ngoai org -> 403; don chua completed -> 400; don da co shipment chua cuoi (requested/in_transit) -> 400; thanh cong -> 201, shipment requested voi fee/eta_days tu FakeShippingAdapter.quote() (khoi luong = tong so luong mat hang x 500g) + tracking_code deterministic tu adapter da mo rong, ghi 1 event created + 1 audit log, tra shipment kem events (moi tao).",
      "disposition": "acceptance"
    },
    {
      "id": "R-3",
      "sourceSpan": "dòng 297–305",
      "text": "API cap nhat trang thai giao hang: POST /api/shipments/:id/status nhan {status: 'in_transit' | 'delivered' | 'failed', reason?, idempotency_key?} — status la -> 400; shipment khong ton tai -> 404, ngoai org -> 403; chuyen sai thu tu (vi du requested -> delivered, delivered -> in_transit, bat ky chuyen nao tu delivered/failed) -> 400, khong doi gi, khong ghi event; gui lai cung trang thai hien tai -> 200, tra shipment hien tai, KHONG tao event moi, KHONG doi gi; thanh cong -> 200, shipment doi trang thai + event tuong ung + audit log. failed bat buoc co reason (ly do giao that bai).",
      "disposition": "acceptance"
    },
    {
      "id": "R-4",
      "sourceSpan": "dòng 307–317",
      "text": "API yeu cau tra hang: POST /api/orders/:id/returns nhan {items: [{variant_id, qty, condition: 'resalable' | 'damaged'}], reason, idempotency_key?} — reason trong -> 400; items rong -> 400; don khong ton tai -> 404, ngoai org -> 403; don chua completed -> 400; bien the khong thuoc don -> 400; qty khong nguyen hoac <= 0 -> 400; condition la -> 400; trung bien the trong cung yeu cau -> 400; tong so luong da yeu cau tra tich luy cua mot bien the (cong moi yeu cau tra chua bi tu choi cua don do) vuot so luong da dat -> 400; thanh cong -> 201, return requested voi ma TH-YYYYMMDD-NNNN, unit_price snapshot tu order_items (khong tin client), ghi 1 event created + 1 audit log, tra return kem items + events (moi tao).",
      "disposition": "acceptance"
    },
    {
      "id": "R-5",
      "sourceSpan": "dòng 319–325",
      "text": "API duyet/tu choi tra hang: POST /api/returns/:id/approve va POST /api/returns/:id/reject nhan {reason?, idempotency_key?} — return khong ton tai -> 404, ngoai org -> 403; chi duyet/tu choi tu requested (trang thai khac -> 400, khong doi gi); tu choi bat buoc co reason (trong -> 400); thanh cong -> 200, return doi approved hoac rejected + ghi reviewed_by/review_reason + event tuong ung + audit log.",
      "disposition": "acceptance"
    },
    {
      "id": "R-6",
      "sourceSpan": "dòng 327–337",
      "text": "API nhan hang tra + nhap lai kho: POST /api/returns/:id/receive nhan {idempotency_key?} — return khong ton tai -> 404, ngoai org -> 403; chi nhan tu approved (trang thai khac -> 400); thanh cong -> 200, trong CUNG MOT transaction BEGIN IMMEDIATE: return doi received + ghi received_by + event received, mat hang resalable nhap lai kho cua don bang applyMovement loai in (reference = ma tra TH-..., reason ghi ro nhap lai tu tra hang) — on_hand tang dung so do, 1 movement moi dong ban lai duoc; mat hang damaged KHONG nhap kho, KHONG ghi movement — chi ghi nhan trong return_items + event detail (so luong hong tung bien the). Buoc nao loi thi rollback toan bo. Khong them loai movement moi.",
      "disposition": "acceptance"
    },
    {
      "id": "R-7",
      "sourceSpan": "dòng 339–352",
      "text": "API hoan tien tra hang: POST /api/returns/:id/refund nhan {idempotency_key?} — return khong ton tai -> 404, ngoai org -> 403; chi hoan tu received (trang thai khac -> 400); so tien hoan = tong unit_price x qty tren moi mat hang cua yeu cau tra (ca ban lai duoc lan hong), tinh tu snapshot order_items; server hoan bang dung duong GOAL-006 (createRefundTx + bang refunds, cung kiem tra tong hoan khong vuot so da tra): hoan vao cac payment da paid cua don theo thu tu cu nhat truoc cho toi du so tien, moi lan hoan la mot ban ghi refunds rieng voi reason la ma tra TH-...; so tien hoan vuot so con hoan duoc cua don -> 400, khong tao refund nao, return o lai received; thanh cong -> 200, return doi refunded trong cung transaction voi cac refund, ghi event refunded (detail: so tien hoan, ma cac refund da tao) + audit log, tra return kem refunds da tao + order_summary doi soat.",
      "disposition": "acceptance"
    },
    {
      "id": "R-8",
      "sourceSpan": "dòng 354–368",
      "text": "API doc + doi chieu sau tra: GET /api/orders/:id/shipments tra danh sach shipment cua don (moi nhat truoc, kem events tung shipment) + GET /api/shipments/:id tra 1 shipment kem events; GET /api/orders/:id/returns tra danh sach return cua don (moi nhat truoc, kem items + events tung return) + GET /api/returns/:id tra 1 return kem items + events. Moi API doc loc theo org + pham vi vai (sales chi chi nhanh minh, warehouse chi kho duoc gan); ngoai org -> 403; don/shipment/return khong ton tai -> 404. Doi chieu: sau mot luot tra day du (nhan + hoan), GET /api/orders/:id/payments (GOAL-006) phai hien thi dung paid_total da tru tong refund gom refund cua tra hang, refunded_total tang dung so tien hoan, payment_status chuyen dung; GET /api/stock/levels phai hien thi dung on_hand tang dung so hang ban lai duoc da nhap lai, hang hong khong lam tang ton (test chung minh ca 3 mat don–thanh toan–kho khop nhau).",
      "disposition": "acceptance"
    },
    {
      "id": "R-9",
      "sourceSpan": "dòng 370–381",
      "text": "Idempotency cho giao/tra: yeu cau giao, cap nhat trang thai giao, yeu cau tra, duyet/tu choi, nhan hang, hoan tien tra hang deu nhan Idempotency-Key (header) hoac idempotency_key (body); server dung withStockIdempotency (GOAL-004) voi ten mien key shipment:create:<key> / shipment:update:<key> / return:create:<key> / return:review:<key> / return:receive:<key> / return:refund:<key>; gui lai cung key + cung loai + cung org -> tra dung response da luu kem replayed: true, KHONG tao shipment/return/movement/refund moi (so shipment, so return, ton kho, tong da tra, tong hoan khong doi). Key khac nhau thi thuc thi binh thuong. Thieu key thi van thuc thi (khong bat buoc) nhung khong co bao ve gui lai.",
      "disposition": "acceptance"
    },
    {
      "id": "R-10",
      "sourceSpan": "dòng 383–394",
      "text": "Chong ghi nhan 2 lan: moi tao shipment/return, moi chuyen trang thai giao/tra, moi nhan hang + hoan tien tra hang deu trong BEGIN IMMEDIATE + UNIQUE(tracking_code) / UNIQUE(code) o DB; test chung minh: gui dong thoi 2 yeu cau giao cung don -> chi 1 shipment duoc tao, lan con lai 400; cap nhat trang thai giao dong thoi (in_transit roi delivered) khong ghi nhan sai thu tu; nhan hang tra dong thoi 2 lan -> chi 1 lan nhap kho, lan con lai 400 hoac replayed: true; hoan tien tra hang dong thoi 2 lan -> chi 1 lan tao refund, lan con lai 400 hoac replayed: true. App mot tien trinh (D1), bao ve race chi co y nghia trong mot process; da process ngoai pham vi, ghi ro trong DECISIONS.md.",
      "disposition": "acceptance"
    },
    {
      "id": "R-11",
      "sourceSpan": "dòng 396–406",
      "text": "RBAC giao/tra: mo rong helper can() o src/rbac.ts them actions request-shipment, update-shipment, view-shipments, request-return, review-return, receive-return, refund-return, view-returns theo dung ma tran o brief; moi endpoint giao/tra qua requireRole + can() (vai sai -> 403, ngoai org -> 403, sai chi nhanh/kho -> 403). Test chung minh tung o cam trong ma tran (it nhat: sales yeu cau giao -> 403, accountant cap nhat trang thai giao -> 403, warehouse yeu cau tra -> 403, sales duyet tra -> 403, sales hoan tien tra hang -> 403, warehouse nhan hang tra ngoai kho duoc gan -> 403, sales xem shipment/return don ngoai chi nhanh -> 403, user org A doc shipment/return org B -> 403).",
      "disposition": "acceptance"
    },
    {
      "id": "R-12",
      "sourceSpan": "dòng 408–423",
      "text": "Audit log cho giao/tra: ghi vao audit_log da co MOI thao tac yeu cau giao, cap nhat trang thai giao, yeu cau tra, duyet/tu choi, nhan hang, hoan tien tra hang; moi ban ghi co user_id nguoi thuc hien, created_at, action + detail JSON (target_order_id, order_code, target_shipment_id/target_return_id, tracking_code/return_code, from_status/to_status, KHONG chua du lieu nhay cam, KHONG chua thong tin the); xem log theo luat GOAL-002 (GET /api/audit-log: owner toan org, manager trong pham vi, cac vai khac -> 403). shipment_events/return_events la lich su chi tiet; audit_log la lop ghi nhan thao tac nhay cam theo chuan GOAL-002 — ca hai deu phai co, khong thay nhau. Lich su giao/tra: shipment_events/return_events ghi du moi lan tao/chuyen trang thai (ke ca lan gui lai cung trang thai thi KHONG ghi event moi — xem yeu cau 3); test: yeu cau giao -> in_transit -> delivered + yeu cau tra -> duyet -> nhan -> hoan: events dung thu tu thoi gian tang dan (cu nhat truoc), du cac buoc, khong co event thua.",
      "disposition": "acceptance"
    },
    {
      "id": "R-13",
      "sourceSpan": "dòng 425–440",
      "text": "Test moi (vitest + supertest, them vao file test moi — KHONG sua 208 test da khoa cua GOAL-001..006): chung minh yeu cau giao chi cho don completed (don chua hoan tat -> 400), phi/ETA tu adapter fake + ma van don deterministic duy nhat, cap nhat trang thai lap cung trang thai khong tao event moi, cap nhat sai thu tu -> 400 khong doi gi, giao that bai la trang thai cuoi, yeu cau tra chi cho don completed + dung bien the trong don + khong vuot so da dat tich luy, duyet/tu choi dung luat (tu choi thieu ly do -> 400, duyet tu trang thai khac -> 400), nhan hang nhap lai kho dung so ban lai duoc + hang hong khong nhap kho (ton khong doi), hoan tien tra hang dung so tu snapshot gia + dung duong GOAL-006 (hoan vuot so con hoan duoc -> 400), doi chieu sau tra dung ca 3 mat (paid_total/refunded_total/payment_status + on_hand), idempotency (gui lai cung key -> replayed: true, khong tao moi), race (yeu cau giao/nhan/hoan dong thoi -> chi 1 lan thuc thi), RBAC 403 theo ma tran (yeu cau 11). Test dung du lieu gia lap (2 org, 2 don tro len trong cung org).",
      "disposition": "acceptance"
    },
    {
      "id": "R-14",
      "sourceSpan": "dòng 442–446",
      "text": "Du lieu GIA LAP hoan toan; mat khau seed + secret qua bien moi truong (nhu GOAL-001..006: OMNIFLOW_SEED_*_PASSWORD), khong commit credential that; check.sh van quet secret (grep nhu GOAL-001); seed KHONG can them shipment/return mau (demo tu tao) — nhung giu nguyen 2 user, 2 san pham, 2 kho + muc ton mau de test khoa van xanh.",
      "disposition": "acceptance"
    },
    {
      "id": "R-15",
      "sourceSpan": "dòng 448–472",
      "text": "scripts/check.sh (CHK-1) va scripts/demo.sh (CHK-2) duoc MO RONG trong goal nay: them buoc giao/tra vao smoke/demo (tao don -> xac nhan -> xu ly -> hoan tat -> thu tien -> yeu cau giao -> cap nhat in_transit -> cap nhat lap cung trang thai khong tao event -> cap nhat sai thu tu 400 -> delivered -> yeu cau tra (1 ban lai duoc + 1 hong) -> duyet -> nhan (ton tang dung so ban lai duoc, hang hong khong nhap kho) -> hoan tien -> doi soat dung so (paid_total tru refund, ton da nhap lai) -> idempotency gui lai khong tao moi -> RBAC 403: sales yeu cau giao, warehouse yeu cau tra, sales duyet tra), giu tat ca buoc GOAL-001..006 xanh (health, login, owner-only, idempotency, backup/restore, RBAC nguoi dung, san pham/gia/CSV, kho, don, thanh toan). Ca 2 script tu chay duoc, tu don dep, in PASS/FAIL tung buoc. Docs: docs/RBAC.md bo sung ma tran giao hang + tra hang (bang o brief) + mo hinh pham vi (theo chi nhanh/kho cua don); docs/DECISIONS.md them D24 (mo hinh giao hang: state machine shipment, adapter mo rong ma van don deterministic, khoi luong mac dinh tong so luong x 500g, chi giao don completed, 1 shipment chua cuoi moi don) va D25 (mo hinh tra hang: vong doi return, nhap lai kho co chon loc trong cung transaction, hoan tien dung lai duong GOAL-006 + hoan vao payment cu nhat truoc, truong hop bien hoan vuot so con hoan duoc -> 400); README.md/docs/SETUP.md cap nhat endpoint giao/tra, khop lenh da chay that. Khong co file .github/workflows/ trong repo (gh token thieu scope workflow — CI la follow-up sau khi user cap scope). Khong claim VPS, khong claim deploy production (local-only, D9).",
      "disposition": "acceptance"
    },
    {
      "id": "R-16",
      "sourceSpan": "dòng 476–477",
      "text": "Khuyến mãi (GOAL-009): không mã giảm giá — số tiền hoàn chỉ đối soát với tổng đơn GOAL-005 đã snapshot, không áp giảm giá khi trả hàng.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "deferred",
        "to": "GOAL-009"
      },
      "exclusionReason": "Thuộc GOAL-009, không làm trong GOAL-007"
    },
    {
      "id": "R-17",
      "sourceSpan": "dòng 479–481",
      "text": "Báo cáo/đối soát tổng hợp (GOAL-010): không tổng hợp doanh thu theo thời gian, không đối soát lô (chỉ đối chiếu từng đơn sau trả — yêu cầu 8).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "deferred",
        "to": "GOAL-010"
      },
      "exclusionReason": "Thuộc GOAL-010, không làm trong GOAL-007"
    },
    {
      "id": "R-18",
      "sourceSpan": "dòng 483–486",
      "text": "Khách hàng + CRM (GOAL-008): không có bảng khách hàng, không lịch sử giao/trả theo khách; thông báo (GOAL-011): không gửi email khi giao hàng/trả hàng (chỉ audit log + lịch sử giao/trả); UI tổng quan (GOAL-012): không thêm màn hình giao/trả.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "deferred",
        "to": "GOAL-008"
      },
      "exclusionReason": "Thuộc GOAL-008/011/012, không làm trong GOAL-007"
    },
    {
      "id": "R-19",
      "sourceSpan": "dòng 488–492",
      "text": "Đơn vị vận chuyển thật / giao hàng thật, tài khoản hãng vận chuyển — ngoài phạm vi vĩnh viễn của dự án giả lập này; deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user cấp scope workflow).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Ngoài phạm vi vĩnh viễn của dự án giả lập này; deploy/VPS ngoài phạm vi local-only (D9); CI chờ user cấp scope workflow"
    },
    {
      "id": "R-20",
      "sourceSpan": "dòng 333 (brief-004.md)",
      "adopts": {
        "sourceSha256": "a83e40111118d17ac74d1e1049134daca6958f7e46aa5126a7cf8b22f3884579",
        "requirementId": "R-20"
      },
      "text": "Thanh toán/hoàn tiền (GOAL-006), giao hàng/trả hàng (GOAL-007), khuyến mãi (GOAL-009): không mã giảm giá, không đối soát kho–đơn–thanh toán, không trả hàng nhập lại kho.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "R-20 gộp 3 phạm vi: thanh toán/hoàn tiền đã xong ở GOAL-006; trả hàng nhập lại kho là yêu cầu riêng của GOAL-007 (requirement riêng trong goal này); mã giảm giá là yêu cầu riêng của GOAL-009. Adopt cả R-20 vào GOAL-007 sẽ nhận sai phạm vi (gồm khuyến mãi không thuộc goal này) nên loại trừ có lý do."
    }
  ],
  "scope": [
    "docs/",
    "src/",
    "scripts/",
    "tests/",
    "README.md",
    "brief-007.md",
    "goal-007.json",
    ".gitignore"
  ],
  "exclusions": [
    "Khuyến mãi (GOAL-009), báo cáo/đối soát tổng hợp (GOAL-010), khách hàng + CRM (GOAL-008), thông báo (GOAL-011), UI tổng quan (GOAL-012) — thuộc goal sau, không làm trong GOAL-007.",
    "Đơn vị vận chuyển thật / giao hàng thật, tài khoản hãng vận chuyển — ngoài phạm vi vĩnh viễn của dự án giả lập này.",
    "Deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user cấp scope workflow).",
    "Yêu cầu R-20 của GOAL-004 được loại trừ có lý do (out-of-scope) trong goal này — xem requirement R-20; không adopt vì R-20 gộp 3 phạm vi (thanh toán GOAL-006 đã xong, trả hàng là yêu cầu riêng GOAL-007, khuyến mãi là yêu cầu riêng GOAL-009)."
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Giao hang + schema giao/tra (AC-1): migration 012 tao 5 bang shipments/shipment_events/returns/return_items/return_events; POST /api/orders/:id/shipments tao shipment — chi don completed, carrier/destination bat buoc, fee/eta tu FakeShippingAdapter.quote() (khoi luong = tong so luong x 500g), tracking_code deterministic duy nhat theo shipment, 1 shipment chua cuoi moi don; FakeShippingAdapter mo rong them ma van don deterministic (vi du trackingRef(orderCode, carrier, shipmentId) tra FAKE-TRK-<hash12>), giu simulated: true; idempotency yeu cau giao dung withStockIdempotency (ten mien shipment:create:<key>) trong cung transaction BEGIN IMMEDIATE, gui lai tra replayed: true khong tao moi; moi tao shipment trong BEGIN IMMEDIATE + UNIQUE(tracking_code) chong ghi nhan 2 lan",
      "requirementIds": [
        "R-1",
        "R-2",
        "R-9",
        "R-10",
        "R-13"
      ],
      "examples": [
        {
          "input": "POST /api/orders/:id/shipments {carrier: 'GHN-fake', destination} cho don completed (test moi)",
          "expected": "201, shipment status 'requested' voi fee/eta tu adapter fake + tracking_code deterministic duy nhat, 1 event 'created' + 1 audit log, kem events (moi tao)"
        },
        {
          "input": "POST /api/orders/:id/shipments cho don draft/confirmed/processing/cancelled (test moi)",
          "expected": "400, khong tao shipment nao"
        },
        {
          "input": "POST /api/orders/:id/shipments lan 2 khi don da co shipment requested/in_transit (test moi)",
          "expected": "400, khong tao shipment thu hai"
        },
        {
          "input": "goi FakeShippingAdapter.quote() + phuong thuc ma van don moi (test moi)",
          "expected": "quote() tra fee/eta nhu cu; trackingRef cung input -> cung ma, khac shipment -> khac ma, giu simulated: true"
        },
        {
          "input": "POST yeu cau giao 2 lan cung Idempotency-Key / idempotency_key (test moi)",
          "expected": "gui lai tra dung response da luu kem replayed: true, KHONG tao shipment moi; so shipment khong doi"
        }
      ],
      "boundaries": [
        "migration 012 chay tuan tu sau 001-011, giu du lieu cu, 208 test da khoa cua GOAL-001..006 van xanh",
        "chi don completed moi duoc yeu cau giao (hang da xuat kho o GOAL-005); don chua hoan tat -> 400",
        "moi don toi da 1 shipment dang o trang thai chua cuoi (requested/in_transit); muon giao lai thi tao shipment moi sau khi shipment cu da failed hoac delivered",
        "khoi luong mac dinh = tong so luong mat hang x 500g (san pham chua co truong can nang; khong them truong can nang trong goal nay)",
        "giao hang KHONG doi trang thai don GOAL-005 (don van completed)"
      ],
      "prohibited": [
        "khong duoc ket noi don vi van chuyen that; khong duoc co endpoint DELETE shipment/return",
        "khong duoc dung withIdempotency cua GOAL-001 (kiem tra key ngoai transaction, co khe race) cho giao/tra — bat buoc dung withStockIdempotency trong cung transaction BEGIN IMMEDIATE",
        "khong duoc de 2 lan giao cung don cung carrier trung tracking_code (digest phai co shipment id)",
        "khong duoc doi state machine don GOAL-005"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-2",
      "text": "Cap nhat trang thai giao hang lap/sai thu tu (AC-2): POST /api/shipments/:id/status nhan {status: 'in_transit' | 'delivered' | 'failed', reason?, idempotency_key?} — chi cho phep requested -> in_transit -> delivered va requested/in_transit -> failed (failed la trang thai cuoi); chuyen sai thu tu -> 400, khong doi gi, khong ghi event; gui lai cung trang thai hien tai -> 200, tra shipment hien tai, KHONG tao event moi; failed bat buoc co reason; thanh cong -> 200 + event tuong ung + audit log; moi chuyen trong BEGIN IMMEDIATE",
      "requirementIds": [
        "R-3",
        "R-9",
        "R-10",
        "R-13"
      ],
      "examples": [
        {
          "input": "POST /api/shipments/:id/status {status: 'in_transit'} roi {status: 'delivered'} (test moi)",
          "expected": "200 moi lan, shipment doi trang thai, event in_transit roi delivered theo thu tu thoi gian tang dan"
        },
        {
          "input": "POST /api/shipments/:id/status cung status hien tai 2 lan (test moi)",
          "expected": "200 ca 2 lan, lan 2 tra shipment hien tai, KHONG tao event moi, so event khong doi"
        },
        {
          "input": "POST /api/shipments/:id/status {status: 'delivered'} khi shipment dang requested; bat ky chuyen nao tu delivered/failed (test moi)",
          "expected": "400, khong doi gi, khong ghi event"
        },
        {
          "input": "POST /api/shipments/:id/status {status: 'failed'} khong co reason; {status: 'failed', reason} (test moi)",
          "expected": "thieu reason -> 400; co reason -> 200, failed la trang thai cuoi"
        },
        {
          "input": "cap nhat trang thai giao dong thoi in_transit roi delivered (test moi)",
          "expected": "khong ghi nhan sai thu tu; chi 1 lan doi trang thai thanh cong theo dung thu tu"
        }
      ],
      "boundaries": [
        "gui lai cung trang thai la no-op o muc trang thai (khac webhook GOAL-006 ghi event ca ban trung — o day cap nhat lap khong phai ban trung tu ben ngoai)",
        "failed la trang thai cuoi — muon giao lai thi tao shipment moi, khong mo lai shipment da failed",
        "shipment_events append-only: chi INSERT, khong co API UPDATE/DELETE lich su (goi sua/xoa -> 404/405); events tra theo thu tu thoi gian tang dan (cu nhat truoc, nhu order_events D19)",
        "app mot tien trinh (D1) nen bao ve race chi co y nghia trong mot process, da process ngoai pham vi (ghi ro trong DECISIONS.md)"
      ],
      "prohibited": [
        "khong duoc ghi event moi khi gui lai cung trang thai hien tai",
        "khong duoc de chuyen sai thu tu doi trang thai hoac ghi event",
        "khong duoc sua/xoa shipment_events"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-3",
      "text": "Tra hang: yeu cau/duyet/nhan/nhap lai kho/hoan tien/doi chieu (AC-3): POST /api/orders/:id/returns nhan {items: [{variant_id, qty, condition}], reason} — chi don completed, bien the phai thuoc don, tong tra tich luy moi bien the (tinh ca yeu cau chua bi tu choi) khong vuot so da dat, unit_price snapshot tu order_items, ma TH-YYYYMMDD-NNNN; duyet/tu choi chi tu requested (tu choi bat buoc co reason); nhan hang chi tu approved, trong CUNG MOT transaction: resalable nhap lai kho cua don bang applyMovement loai in (reference = ma tra), damaged KHONG nhap kho, KHONG ghi movement; hoan tien chi tu received, so tien = tong unit_price x qty (ca ban lai duoc lan hong), dung dung duong GOAL-006 (createRefundTx + bang refunds, hoan vao payment paid cu nhat truoc, vuot so con hoan duoc -> 400, return o lai received); GET shipments/returns kem items + events; doi chieu sau tra: payments summary (paid_total tru refund, payment_status dung) + stock levels (on_hand tang dung so ban lai duoc) khop nhau",
      "requirementIds": [
        "R-1",
        "R-4",
        "R-5",
        "R-6",
        "R-7",
        "R-8",
        "R-9",
        "R-10",
        "R-13"
      ],
      "examples": [
        {
          "input": "POST /api/orders/:id/returns {items: [{variant_id, qty, condition: 'resalable'}], reason} cho don completed (test moi)",
          "expected": "201, return requested voi ma TH-YYYYMMDD-NNNN, unit_price snapshot tu order_items, 1 event created + 1 audit log, kem items + events"
        },
        {
          "input": "POST /api/orders/:id/returns cho don chua completed; bien the khong thuoc don; 2 yeu cau tra gop vuot so da dat (test moi)",
          "expected": "400 moi truong hop; yeu cau thu hai vuot tong tich luy -> 400, khong tao return"
        },
        {
          "input": "POST /api/returns/:id/approve roi /reject; /reject khong reason; approve tu trang thai khac requested (test moi)",
          "expected": "approve -> 200 approved; reject sau approve -> 400; reject thieu reason -> 400; approve tu approved/received -> 400"
        },
        {
          "input": "POST /api/returns/:id/receive voi items 1 resalable + 1 damaged (test moi)",
          "expected": "200, return received; on_hand tang dung so resalable, 1 movement in moi dong resalable (reference = ma tra); damaged khong nhap kho, khong ghi movement, ton khong doi o dong do"
        },
        {
          "input": "POST /api/returns/:id/refund sau khi nhan hang (test moi)",
          "expected": "200, return refunded; so tien = tong unit_price x qty (ca resalable lan damaged); refund tao qua duong GOAL-006 (bang refunds, reason = ma tra); vuot so con hoan duoc -> 400, return o lai received"
        },
        {
          "input": "sau 1 luot tra day du: GET /api/orders/:id/payments + GET /api/stock/levels (test moi)",
          "expected": "paid_total da tru tong refund gom refund cua tra hang, refunded_total tang dung so tien hoan, payment_status chuyen dung; on_hand tang dung so ban lai duoc; ca 3 mat don-thanh toan-kho khop nhau"
        }
      ],
      "boundaries": [
        "tra hang KHONG doi trang thai don GOAL-005 (don van completed); hoan tien tra hang KHONG doi trang thai don",
        "tong tra tich luy tinh ca moi yeu cau tra chua bi tu choi (ke ca yeu cau dang cho duyet), khong chi yeu cau da nhan",
        "hoan tien tra hang tinh ca hang hong (khach tra hang thi duoc hoan tien bat ke tinh trang hang, chi khac o cho khong nhap kho)",
        "nhan hang + nhap kho trong CUNG MOT transaction BEGIN IMMEDIATE: buoc nao loi thi rollback toan bo, khong co trang thai 'da nhan nhung chua nhap kho'; khong them loai movement moi (dung lai in cua D17)",
        "return_events append-only: chi INSERT, khong co API UPDATE/DELETE lich su; events tra theo thu tu thoi gian tang dan (cu nhat truoc)"
      ],
      "prohibited": [
        "khong duoc viet lai logic hoan tien — bat buoc dung lai createRefundTx + bang refunds cua GOAL-006 (cung kiem tra tong hoan khong vuot so da tra)",
        "khong duoc nhap kho hang hong; khong duoc ghi movement cho hang hong",
        "khong duoc tin unit_price tu client (lay snapshot tu order_items)",
        "khong duoc de nhan hang dong thoi 2 lan nhap kho 2 lan; khong duoc de hoan tien tra hang dong thoi tao 2 refund",
        "khong duoc sua/xoa return_events"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-4",
      "text": "RBAC + audit + test/checks/docs (AC-4): mo rong helper can() o src/rbac.ts them 8 actions request-shipment, update-shipment, view-shipments, request-return, review-return, receive-return, refund-return, view-returns theo dung ma tran giao/tra (yeu cau giao/cap nhat: owner/manager/warehouse dung kho, sales/accountant 403; yeu cau tra: owner/manager/sales dung chi nhanh; duyet/tu choi: owner/manager; nhan hang: owner/manager/warehouse dung kho; hoan tien tra hang: owner/manager/accountant; xem: moi vai theo pham vi); moi endpoint giao/tra qua requireRole + can() (vai sai/sai chi nhanh/sai kho/ngoai org -> 403); audit_log ghi MOI thao tac giao/tra; shipment_events/return_events ghi du moi lan tao/chuyen trang thai (gui lai cung trang thai giao thi KHONG ghi event moi); test moi (vitest + supertest, file moi) chung minh toan bo hanh vi AC-1..AC-3 + RBAC 403; du lieu GIA LAP hoan toan, secret qua bien moi truong, check.sh van quet secret; scripts/check.sh va scripts/demo.sh duoc MO RONG them buoc giao/tra, giu cac buoc GOAL-001..006 xanh, tu chay duoc, tu don dep, in PASS/FAIL tung buoc; docs RBAC/DECISIONS(D24, D25)/README/SETUP cap nhat",
      "requirementIds": [
        "R-11",
        "R-12",
        "R-13",
        "R-14",
        "R-15"
      ],
      "examples": [
        {
          "input": "test RBAC theo tung o cam trong ma tran giao/tra (test moi)",
          "expected": "403: sales yeu cau giao; accountant cap nhat trang thai giao; warehouse yeu cau tra; sales duyet tra; sales hoan tien tra hang; warehouse nhan hang tra ngoai kho duoc gan; sales xem shipment/return don ngoai chi nhanh; user org A doc shipment/return org B"
        },
        {
          "input": "thuc hien cac thao tac giao/tra roi doc audit_log (test moi)",
          "expected": "moi thao tac yeu cau giao, cap nhat trang thai giao, yeu cau tra, duyet/tu choi, nhan hang, hoan tien tra hang deu ghi audit_log voi user_id nguoi thuc hien, created_at, action + detail JSON (target_order_id, order_code, target_shipment_id/target_return_id, tracking_code/return_code, from_status/to_status, KHONG chua du lieu nhay cam, KHONG chua thong tin the)"
        },
        {
          "input": "yeu cau giao -> in_transit -> delivered + yeu cau tra -> duyet -> nhan -> hoan, doc shipment_events/return_events (test moi)",
          "expected": "events dung thu tu thoi gian tang dan (cu nhat truoc), du cac buoc, khong co event thua (gui lai cung trang thai giao khong tao event moi)"
        },
        {
          "input": "./scripts/check.sh; ./scripts/demo.sh",
          "expected": "./scripts/check.sh exit 0 va ./scripts/demo.sh in PASS tung buoc, gom cac buoc GOAL-001..006 xanh + buoc giao/tra moi"
        },
        {
          "input": "doc RBAC/DECISIONS/README/SETUP sau goal",
          "expected": "docs/RBAC.md bo sung ma tran giao/tra + mo hinh pham vi (theo chi nhanh/kho cua don); docs/DECISIONS.md them D24 (mo hinh giao hang) va D25 (mo hinh tra hang); README.md/docs/SETUP.md cap nhat endpoint giao/tra, khop lenh da chay that"
        }
      ],
      "boundaries": [
        "xem audit log theo luat GOAL-002 (GET /api/audit-log: owner toan org, manager trong pham vi, cac vai khac -> 403); shipment_events/return_events la lich su chi tiet, audit_log la lop ghi nhan thao tac nhay cam — ca hai deu phai co, khong thay nhau",
        "seed KHONG them shipment/return mau (demo tu tao) — giu nguyen 2 user, 2 san pham, 2 kho + muc ton mau de test khoa van xanh",
        "test moi them vao file test moi, KHONG sua 208 test da khoa cua GOAL-001..006; du lieu test gia lap (2 org, 2 don tro len trong cung org)"
      ],
      "prohibited": [
        "khong duoc sua test da khoa cua GOAL-001..006; khong duoc commit secret/credential that; khong duoc commit file .github/workflows/ (CI cho user cap scope workflow)",
        "khong duoc claim VPS, deploy production hay don vi van chuyen that; khong duoc luu thong tin the o bat ky dau (DB, API, log, audit_log, shipment_events, return_events)"
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
    "GOAL-005",
    "GOAL-006"
  ],
  "priority": 3
}
```
