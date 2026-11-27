# GOAL-009 v1: OmniFlow co nghiep vu khuyen mai tren don hang GOAL-005: ma giam gia (UNIQUE theo org, chuan hoa UPPERCASE) loai % co cap hoac so tien co dinh, dieu kien ap dung (tong toi thieu, kenh, chi nhanh, thoi gian hieu luc, gioi han dung tong + moi khach); ap ma vao don draft (tinh lai tong sau giam, ghi ro ma + so tien giam tren don); luat chong giam voi diem GOAL-008 theo MOT luat duy nhat (tong giam = min(C + P, total), khong phu thuoc thu tu ap); huy don co ma thi hoan luot dung, tra hang/hoan tien thi KHONG; doi soat tru ca diem lan ma (outstanding = total - points_discount - promo_discount - paid_total), payment_status giu logic D22; lich su dung ma append-only; RBAC theo ma tran khuyen mai + audit log day du; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc khuyen mai moi; yeu cau R-18 cua GOAL-007 duoc loai tru co ly do (out-of-scope)

Status: closed

```json
{
  "id": "GOAL-009",
  "version": 1,
  "outcome": "OmniFlow co nghiep vu khuyen mai tren don hang GOAL-005: ma giam gia (UNIQUE theo org, chuan hoa UPPERCASE) loai % co cap hoac so tien co dinh, dieu kien ap dung (tong toi thieu, kenh, chi nhanh, thoi gian hieu luc, gioi han dung tong + moi khach); ap ma vao don draft (tinh lai tong sau giam, ghi ro ma + so tien giam tren don); luat chong giam voi diem GOAL-008 theo MOT luat duy nhat (tong giam = min(C + P, total), khong phu thuoc thu tu ap); huy don co ma thi hoan luot dung, tra hang/hoan tien thi KHONG; doi soat tru ca diem lan ma (outstanding = total - points_discount - promo_discount - paid_total), payment_status giu logic D22; lich su dung ma append-only; RBAC theo ma tran khuyen mai + audit log day du; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc khuyen mai moi; yeu cau R-18 cua GOAL-007 duoc loai tru co ly do (out-of-scope)",
  "source": {
    "path": "brief-009.md",
    "sha256": "53b60a14c7ebe698576b7162fbd1c6a420efea47cc1ef98d85af41a58aff4ed7",
    "capturedAt": "2026-11-27T07:21:05.243Z",
    "origin": "PM brief GOAL-009 (coordinator, theo uy quyen OmniFlow 26/11 21:47)"
  },
  "requirements": [
    {
      "id": "R-1",
      "sourceSpan": "dòng 152–178",
      "text": "Migration 014 tạo 2 bảng khuyến mãi + lịch sử dùng mã + mở rộng bảng đơn: promotions (org_id NOT NULL FK tới orgs, code TEXT NOT NULL — chuẩn hóa UPPERCASE + trim khi tạo, UNIQUE theo org UNIQUE(org_id, code), type TEXT NOT NULL CHECK IN ('percent','fixed'), value INTEGER NOT NULL CHECK > 0, cap INTEGER NULL CHECK > 0 — chỉ có ý nghĩa với loại percent, min_order_total INTEGER NOT NULL DEFAULT 0 CHECK >= 0, channels TEXT NULL — JSON mảng kênh con của counter/web/api, NULL = mọi kênh, branch_id INTEGER NULL FK tới branches — NULL = mọi chi nhánh, valid_from/valid_to TEXT NULL ISO 8601 — NULL = không giới hạn, usage_limit INTEGER NULL CHECK > 0 — NULL = không giới hạn tổng, per_customer_limit INTEGER NULL CHECK > 0 — NULL = không giới hạn mỗi khách, status TEXT NOT NULL DEFAULT 'active' CHECK IN ('active','locked'), created_at/updated_at); promotion_usages append-only (promotion_id NOT NULL FK tới promotions, order_id NOT NULL FK tới orders, customer_id INTEGER NULL FK tới customers — NULL khi đơn không gắn khách, discount_amount INTEGER NOT NULL CHECK > 0, status TEXT NOT NULL DEFAULT 'used' CHECK IN ('used','released'), released_at TEXT NULL, release_reason TEXT NULL, created_at; chỉ INSERT + chuyển trạng thái used → released khi hủy đơn, KHÔNG có API DELETE usage); ALTER TABLE orders ADD COLUMN promotion_id INTEGER NULL REFERENCES promotions(id) + ALTER TABLE orders ADD COLUMN promo_discount INTEGER NOT NULL DEFAULT 0 CHECK (promo_discount >= 0) — đơn cũ giữ NULL/0, hành vi đơn cũ không đổi; orders.total là tổng snapshot gốc (GOAL-005), KHÔNG bị sửa khi áp mã.",
      "disposition": "acceptance"
    },
    {
      "id": "R-2",
      "sourceSpan": "dòng 179–204",
      "text": "API tạo/sửa/khóa/xem mã giảm giá: POST /api/promotions nhận {code, type, value, cap?, min_order_total?, channels?, branch_id?, valid_from?, valid_to?, usage_limit?, per_customer_limit?} — code trống/quá 50 ký tự → 400; code chuẩn hóa UPPERCASE + trim, trùng mã trong org → 409; type ngoài percent/fixed → 400; percent thì value phải là số nguyên 1..100, fixed thì value nguyên > 0; cap chỉ đi với percent (cap <= 0 → 400; gửi cap với fixed → 400); min_order_total < 0 → 400; channels rỗng hoặc có kênh lạ → 400; branch_id không tồn tại → 404, ngoài org → 403; valid_from/valid_to sai định dạng ISO hoặc valid_from >= valid_to → 400; usage_limit/per_customer_limit <= 0 → 400; thành công → 201, trả mã đã tạo. PATCH /api/promotions/:id nhận {value?, cap?, min_order_total?, channels?, branch_id?, valid_from?, valid_to?, usage_limit?, per_customer_limit?, status?} — mã không tồn tại → 404, ngoài org → 403; gửi code trong body → 400 (mã không đổi sau khi tạo); mọi luật validate như khi tạo; status chỉ nhận active/locked; thành công → 200, trả mã đã cập nhật. GET /api/promotions?name=&code=&status=&channel=&branch_id=&limit=&offset= trả danh sách mã của org (mới nhất trước; code tìm theo chuỗi con; status lạ → 400; channel lạ → 400; branch_id không tồn tại → 404, ngoài org → 403; limit mặc định 20 tối đa 100, offset mặc định 0, kèm tổng số). GET /api/promotions/:id trả mã kèm tóm tắt dùng {used_count, usage_limit, per_customer_limit} (used_count = số usage status 'used'). Mọi API đọc lọc theo org + phạm vi vai; ngoài org → 403; mã không tồn tại → 404.",
      "disposition": "acceptance"
    },
    {
      "id": "R-3",
      "sourceSpan": "dòng 205–226",
      "text": "API áp mã vào đơn nháp + mọi điều kiện áp dụng: POST /api/orders/:id/promotion nhận {code, idempotency_key?} — đơn không tồn tại → 404, ngoài org → 403; đơn không ở draft → 400; đơn đã có mã (promotion_id khác NULL) → 400 (một đơn chỉ áp một mã); mã không tồn tại trong org → 404; mã locked → 400; kênh của đơn không nằm trong channels của mã → 400; chi nhánh của đơn khác branch_id của mã → 400; ngoài thời gian hiệu lực → 400; tổng đơn gốc < min_order_total → 400; tổng lượt đã dùng (status 'used') >= usage_limit → 400; lượt đã dùng của khách trên đơn (đơn có customer_id) >= per_customer_limit → 400; thành công → 201, trong CÙNG MỘT transaction BEGIN IMMEDIATE: ghi 1 dòng promotion_usages (status 'used', discount_amount = số tiền giảm đã tính, customer_id = customer_id của đơn, NULL khi đơn không gắn khách) + cập nhật orders.promotion_id + orders.promo_discount + 1 audit log, trả đơn kèm {promotion: {id, code, type, value}, promo_discount}. Mọi kiểm tra giới hạn dùng + ghi usage + cập nhật đơn nằm trong cùng transaction. Không có endpoint gỡ mã trong goal này.",
      "disposition": "acceptance"
    },
    {
      "id": "R-4",
      "sourceSpan": "dòng 227–240",
      "text": "Tính số tiền giảm: % có cap, cố định, tổng tối thiểu — tính trên orders.total gốc (snapshot GOAL-005, CHƯA trừ điểm): loại percent → floor(total × value / 100), rồi min với cap (khi cap có giá trị) và min với phần còn lại sau điểm (total − points_discount); loại fixed → min(value, total − points_discount). promo_discount luôn >= 0 và không bao giờ làm tổng sau giảm âm: promo_discount + points_discount <= total. Ví dụ: đơn 250.000đ, mã 10% cap 20.000đ → giảm 20.000đ; đơn 50.000đ, mã fixed 100.000đ → giảm 50.000đ; đơn 30.000đ, mã min_order_total 50.000đ → 400. Tính giảm là hàm thuần ở service, không tin client gửi số tiền giảm.",
      "disposition": "acceptance"
    },
    {
      "id": "R-5",
      "sourceSpan": "dòng 241–262",
      "text": "Luật chồng giảm với điểm GOAL-008 (MỘT luật duy nhất, không phụ thuộc thứ tự): % giảm giá tính trên tổng đơn GỐC (không trừ điểm trước), rồi cắt ở cap và ở phần còn lại sau điểm; đổi điểm cắt ở phần còn lại sau mã. Gọi C = số tiền giảm của mã tính theo yêu cầu 4 TRƯỚC khi cắt ở phần còn lại (percent: min(floor(total × value / 100), cap); fixed: value), P = số điểm muốn đổi × 100. Tổng giảm cuối = min(C + P, total). Khi áp mã trước: promo_discount = min(C, total − points_discount hiện tại), rồi đổi điểm sau đó bị cắt ở total − promo_discount. Khi đổi điểm trước: points_discount = min(P, total), rồi áp mã sau đó bị cắt ở total − points_discount. Hai chiều cho cùng tổng giảm cuối min(C + P, total) — test khóa cả hai chiều trên cùng một bộ số liệu và trường hợp bão hòa (tổng giảm = tổng đơn). Đổi điểm trên đơn đã có mã vẫn đi qua đúng luật cắt ở phần còn lại sau mã (sửa tối thiểu ở src/customers.ts redeem: discount = min(points × 100, order_total − promo_discount), không đổi hành vi khi đơn chưa có mã). Không được đổi luật chồng giảm thành tính % trên tổng đã trừ điểm.",
      "disposition": "acceptance"
    },
    {
      "id": "R-6",
      "sourceSpan": "dòng 263–276",
      "text": "Giới hạn dùng tổng + mỗi khách + chống vượt giới hạn đồng thời: tổng lượt dùng = số dòng promotion_usages status 'used' của mã đó (không tính dòng 'released'); lượt mỗi khách = số dòng 'used' của mã đó với customer_id đó (đơn không gắn khách thì KHÔNG tính vào giới hạn mỗi khách — chỉ tính vào giới hạn tổng). Áp mã khi đã đủ giới hạn → 400, không ghi usage, không đổi đơn. Chống vượt giới hạn đồng thời: mọi kiểm tra giới hạn + ghi usage + cập nhật đơn chạy trong CÙNG MỘT transaction BEGIN IMMEDIATE (dùng withStockIdempotency); test đồng thời chứng minh bất biến (10 lần áp cùng mã giới hạn 5 lượt cùng lúc → đúng 5 thành công, 5 lần còn lại 400, tổng used_count = 5). App một tiến trình (D1), bảo vệ race chỉ có ý nghĩa trong một process; đa process ngoài phạm vi, ghi rõ trong DECISIONS.md.",
      "disposition": "acceptance"
    },
    {
      "id": "R-7",
      "sourceSpan": "dòng 277–289",
      "text": "Hủy đơn có mã thì hoàn lượt dùng; trả hàng/hoàn tiền thì KHÔNG: hủy đơn (transitionOrderTx cancel — GOAL-005) mà đơn đang có mã: trong CÙNG MỘT transaction với đổi trạng thái đơn, dòng promotion_usages của đơn đó chuyển status 'used' → 'released' (released_at = thời điểm hủy, release_reason = mã đơn đã hủy), đồng thời orders.promo_discount về 0 và orders.promotion_id về NULL. Lượt dùng đã giải phóng không còn tính vào giới hạn (khách dùng lại được mã đó, kể cả giới hạn mỗi khách). Hủy đơn không có mã thì không động gì tới bảng usages. Trả hàng/hoàn tiền (GOAL-007): usage GIỮ NGUYÊN 'used' — mã đã dùng thật khi đặt đơn, số tiền hoàn tính theo snapshot giá (D25), không hoàn lượt dùng, không trừ lại promo_discount. Hoàn tiền trực tiếp (GOAL-006) cũng không động tới usage.",
      "disposition": "acceptance"
    },
    {
      "id": "R-8",
      "sourceSpan": "dòng 290–304",
      "text": "Đối soát sau giảm + tích điểm tính trên tổng gốc: computePaymentSummary (src/payments.ts, D22) mở rộng: outstanding = order_total − points_discount − promo_discount − paid_total (âm nghĩa là thừa, như D22); payment_status GIỮ NGUYÊN logic D22 trên (paid_total, refunded_total, order_total) — như GOAL-008 đã làm với points_discount: đơn đổi điểm/mã hết tổng mà chưa trả đồng nào vẫn 'unpaid'; đơn đã trả đủ phần còn phải trả sau giảm nhưng chưa bằng tổng gốc thì vẫn 'partially_paid' theo logic D22 (đây là hành vi đã khóa của GOAL-006/007/008 — KHÔNG đổi trong goal này; GOAL-010 đối soát tổng hợp có thể xem lại ngữ nghĩa payment_status với tests revise nếu cần). Tích điểm GOAL-008 tính trên order_total gốc, KHÔNG trừ promo_discount (như D26 đã chốt không trừ points_discount): đơn 250.000đ áp mã 10% vẫn tích 25 điểm khi completed.",
      "disposition": "acceptance"
    },
    {
      "id": "R-9",
      "sourceSpan": "dòng 305–319",
      "text": "RBAC khuyến mãi: mở rộng helper can() ở src/rbac.ts thêm actions create-promotion, update-promotion, apply-promotion, view-promotions theo đúng ma trận: tạo/sửa/khóa mã: chỉ owner/manager (warehouse/sales/accountant → 403); áp mã: owner/manager toàn org, sales chỉ đơn thuộc chi nhánh mình (warehouse/accountant → 403); xem mã: owner/manager/accountant toàn org, sales chỉ mã có branch_id NULL (mọi chi nhánh) hoặc đúng chi nhánh mình (warehouse → 403); mọi endpoint khuyến mãi qua requireRole + can() (vai sai → 403, ngoài org → 403, sai chi nhánh → 403). Test chứng minh từng ô cấm trong ma trận (ít nhất: warehouse tạo mã → 403, sales sửa mã → 403, accountant áp mã → 403, sales áp mã cho đơn ngoài chi nhánh → 403, warehouse xem mã → 403, user org A đọc mã org B → 403, sales xem mã giới hạn chi nhánh khác → 403).",
      "disposition": "acceptance"
    },
    {
      "id": "R-10",
      "sourceSpan": "dòng 320–336",
      "text": "Audit log cho khuyến mãi: ghi vào audit_log đã có MỌI thao tác tạo/sửa/khóa mã + áp mã + hoàn lượt dùng khi hủy đơn (hủy đơn đã ghi audit cancel-order ở GOAL-005 — audit hoàn lượt dùng ghi kèm trong cùng detail đó hoặc 1 audit riêng 'promotion-usage-released', ghi rõ trong D27); mỗi bản ghi có user_id người thực hiện, created_at, action + detail JSON (target_promotion_id, promotion_code, target_order_id/order_code khi áp mã, discount khi áp mã, KHÔNG chứa thông tin thẻ); xem log theo luật GOAL-002 (GET /api/audit-log: owner toàn org, manager trong phạm vi, các vai khác → 403). promotion_usages là lịch sử dùng mã chi tiết; audit_log là lớp ghi nhận thao tác nhạy cảm theo chuẩn GOAL-002 — cả hai đều phải có, không thay nhau. Lịch sử dùng mã: usages ghi đủ mọi lần áp mã thành công (kể cả gửi lại cùng key thì KHÔNG ghi dòng mới); test: tạo mã → áp mã → hủy đơn → áp lại: usages đúng thứ tự thời gian, đủ các bước, dòng cũ chuyển 'released', không có dòng thừa.",
      "disposition": "acceptance"
    },
    {
      "id": "R-11",
      "sourceSpan": "dòng 337–351",
      "text": "Idempotency + chống ghi nhận 2 lần cho tạo mã + áp mã: tạo mã và áp mã đều nhận Idempotency-Key (header) hoặc idempotency_key (body); server dùng withStockIdempotency (GOAL-004) với tên miền key promotion:create:<key> / promotion:apply:<key>; gửi lại cùng key + cùng loại + cùng org → trả đúng response đã lưu kèm replayed: true, KHÔNG tạo mã mới, KHÔNG ghi usage mới, KHÔNG trừ lượt dùng lần nữa (promo_discount của đơn không đổi — test chứng minh). Key khác nhau thì thực thi bình thường (nhưng một đơn chỉ áp 1 mã — lần 2 khác key → 400). Thiếu key thì vẫn thực thi (không bắt buộc) nhưng không có bảo vệ gửi lại. Mọi tạo/áp trong BEGIN IMMEDIATE + UNIQUE(org_id, code) ở DB; test chứng minh áp mã đồng thời → chỉ 1 lần thực thi. App một tiến trình (D1), bảo vệ race chỉ có ý nghĩa trong một process; đa process ngoài phạm vi, ghi rõ trong DECISIONS.md.",
      "disposition": "acceptance"
    },
    {
      "id": "R-12",
      "sourceSpan": "dòng 352–370",
      "text": "Test mới (vitest + supertest, thêm vào file test mới — KHÔNG sửa 286 test đã khóa của GOAL-001..008): chứng minh tạo/sửa/khóa mã đúng luật (code trống → 400, trùng mã trong org → 409, percent value ngoài 1..100 → 400, cap với fixed → 400, valid_from >= valid_to → 400, mã khóa không áp được → 400, sửa code → 400), áp mã đúng điều kiện (đủ tổng tối thiểu, đúng kênh, đúng chi nhánh, trong thời gian hiệu lực, còn lượt dùng) và sai điều kiện (mỗi điều kiện sai → 400 với lý do riêng; đơn không draft → 400; áp mã lần 2 → 400), tính giảm đúng số (%, cap, cố định, cắt ở tổng đơn, cắt ở phần còn lại sau điểm), chồng giảm đúng luật yêu cầu 5 (cả hai chiều áp mã/đổi điểm, cả trường hợp bão hòa tổng giảm = tổng đơn), giới hạn dùng (hết lượt tổng → 400, hết lượt mỗi khách → 400, đơn không gắn khách chỉ tính giới hạn tổng, áp đồng thời → đúng giới hạn), hủy đơn hoàn lượt dùng (usage chuyển 'released', promo_discount về 0, dùng lại được; trả hàng/hoàn tiền không hoàn lượt), đối soát (outstanding trừ cả điểm lẫn mã; payment_status giữ logic D22; tích điểm tính trên tổng gốc), idempotency (gửi lại cùng key → replayed: true, không ghi usage mới), RBAC 403 theo ma trận (yêu cầu 9). Test dùng dữ liệu giả lập (2 org, 2 mã trở lên trong cùng org).",
      "disposition": "acceptance"
    },
    {
      "id": "R-13",
      "sourceSpan": "dòng 371–376",
      "text": "Dữ liệu GIẢ LẬP hoàn toàn; mật khẩu seed + secret qua biến môi trường (như GOAL-001..008: OMNIFLOW_SEED_*_PASSWORD), không commit credential thật; check.sh vẫn quét secret (grep như GOAL-001); seed KHÔNG cần thêm mã mẫu (demo tự tạo) — nhưng giữ nguyên 2 user, 2 sản phẩm, 2 kho + mức tồn mẫu để test khóa vẫn xanh.",
      "disposition": "acceptance"
    },
    {
      "id": "R-14",
      "sourceSpan": "dòng 377–398",
      "text": "scripts/check.sh (CHK-1) và scripts/demo.sh (CHK-2) được MỞ RỘNG trong goal này: thêm bước khuyến mãi vào smoke/demo (tạo mã 10% cap 20.000đ → trùng mã 409 → tạo mã fixed 50.000đ → tạo đơn 250.000đ → áp mã 10% (giảm 20.000đ do cap) → áp lại 400 → áp mã hết hạn 400 → áp mã sai kênh 400 → đổi điểm trừ tiền đơn đã có mã (tổng giảm = mã + điểm, không vượt tổng) → xác nhận → xử lý → hoàn tất → thu tiền (outstanding = tổng − điểm − mã − đã trả) → hủy đơn có mã khác (usage released, dùng lại được) → idempotency gửi lại không ghi usage mới → RBAC 403: warehouse tạo mã, sales áp mã ngoài chi nhánh, warehouse xem mã), giữ tất cả bước GOAL-001..008 xanh (health, login, owner-only, idempotency, backup/restore, RBAC người dùng, sản phẩm/giá/CSV, kho, đơn, thanh toán, giao/trả, khách/CRM). Cả 2 script tự chạy được, tự dọn dẹp, in PASS/FAIL từng bước. Docs: docs/RBAC.md bổ sung ma trận khuyến mãi (bảng ở trên) + docs/DECISIONS.md thêm D27 (mô hình khuyến mãi: mã + loại giảm + điều kiện + giới hạn dùng + luật chồng giảm không phụ thuộc thứ tự + hủy đơn hoàn lượt dùng + outstanding trừ mã nhưng payment_status giữ logic D22 + tích điểm trên tổng gốc); README.md/docs/SETUP.md cập nhật endpoint khuyến mãi, khớp lệnh đã chạy thật. Không có file .github/workflows/ trong repo (gh token thiếu scope workflow — CI là follow-up sau khi user cấp scope). Không claim VPS, không claim deploy production (local-only, D9).",
      "disposition": "acceptance"
    },
    {
      "id": "R-15",
      "sourceSpan": "dòng 399–408",
      "text": "Ranh giới: không gỡ mã, mã không đổi, giá snapshot không đổi — không có endpoint gỡ mã khỏi đơn trong goal này (muốn đổi mã thì hủy đơn rồi tạo đơn mới — ghi rõ trong docs); mã (code) không đổi sau khi tạo (PATCH gửi code → 400); áp mã không đổi orders.total snapshot, không đổi order_items (giá từng dòng giữ nguyên GOAL-005), không ghi lịch sử giá mới (khuyến mãi không phải giá — D15); tích điểm tính trên tổng gốc (yêu cầu 8). Không lưu thông tin thẻ ở bất kỳ đâu (DB, API, log, audit_log, promotion_usages).",
      "disposition": "acceptance"
    },
    {
      "id": "R-16",
      "sourceSpan": "dòng 409–413",
      "text": "Báo cáo/đối soát tổng hợp (GOAL-010): không tổng hợp doanh thu theo thời gian, không đối soát lô (chỉ đối soát từng đơn — yêu cầu 8, và lịch sử dùng mã từng lần — yêu cầu 10).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "deferred",
        "to": "GOAL-010"
      },
      "exclusionReason": "Thuộc GOAL-010, không làm trong GOAL-009"
    },
    {
      "id": "R-17",
      "sourceSpan": "dòng 414–418",
      "text": "Thông báo (GOAL-011): không gửi email/SMS cho khách khi áp mã hay khi mã sắp hết hạn (chỉ audit log + lịch sử dùng mã).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "deferred",
        "to": "GOAL-011"
      },
      "exclusionReason": "Thuộc GOAL-011, không làm trong GOAL-009"
    },
    {
      "id": "R-18",
      "sourceSpan": "dòng 419–422",
      "text": "UI tổng quan (GOAL-012): không thêm màn hình khuyến mãi.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "deferred",
        "to": "GOAL-012"
      },
      "exclusionReason": "Thuộc GOAL-012, không làm trong GOAL-009"
    },
    {
      "id": "R-19",
      "sourceSpan": "dòng 423–429",
      "text": "Đơn vị vận chuyển thật / giao hàng thật, tài khoản hãng vận chuyển, cổng thanh toán thật — ngoài phạm vi vĩnh viễn của dự án giả lập này; deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user cấp scope workflow).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Ngoài phạm vi vĩnh viễn của dự án giả lập này; deploy/VPS ngoài phạm vi local-only (D9); CI chờ user cấp scope workflow"
    },
    {
      "id": "R-20",
      "sourceSpan": "dòng 483–486 (brief-007.md)",
      "adopts": {
        "sourceSha256": "5586ce9122656edcbd73a2cf609470e1e354ef85fb39ffeb00c70cec04c7f906",
        "requirementId": "R-18"
      },
      "text": "Khách hàng + CRM (GOAL-008): không có bảng khách hàng, không lịch sử giao/trả theo khách; thông báo (GOAL-011): không gửi email khi giao hàng/trả hàng (chỉ audit log + lịch sử giao/trả); UI tổng quan (GOAL-012): không thêm màn hình giao/trả.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "R-18 gộp 3 phạm vi — CRM đã xong ở GOAL-008 (requirements riêng R-1..R-15), thông báo là yêu cầu riêng của GOAL-011, UI tổng quan là yêu cầu riêng của GOAL-012; adopt cả R-18 vào GOAL-009 (khuyến mãi) sẽ nhận sai phạm vi. Toàn bộ phạm vi mà R-18 nhắc tới đã hoặc sẽ được sở hữu bởi requirements riêng của từng goal (008 đã xong, 011/012 sẽ có brief riêng); không còn yêu cầu nào chưa được sở hữu."
    }
  ],
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
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Ma giam gia + schema (AC-1): migration 014 tao 2 bang promotions/promotion_usages + ALTER TABLE orders them promotion_id INTEGER NULL FK toi promotions va promo_discount INTEGER NOT NULL DEFAULT 0 CHECK >= 0 (don cu giu NULL/0); promotions co org_id NOT NULL FK, code TEXT NOT NULL chuan hoa UPPERCASE + trim, UNIQUE(org_id, code), type CHECK IN ('percent','fixed'), value INTEGER CHECK > 0, cap INTEGER NULL CHECK > 0 (chi percent), min_order_total INTEGER NOT NULL DEFAULT 0 CHECK >= 0, channels TEXT NULL (JSON mang kenh, NULL = moi kenh), branch_id NULL FK (NULL = moi chi nhanh), valid_from/valid_to TEXT NULL ISO 8601, usage_limit/per_customer_limit INTEGER NULL CHECK > 0 (NULL = khong gioi han), status CHECK IN ('active','locked') mac dinh 'active'; promotion_usages append-only (promotion_id/order_id NOT NULL FK, customer_id NULL FK, discount_amount INTEGER CHECK > 0, status CHECK IN ('used','released') mac dinh 'used', released_at/released_reason NULL); POST /api/promotions tao ma (code trong/qua 50 ky tu -> 400, trung ma trong org -> 409, percent value ngoai 1..100 -> 400, cap voi fixed -> 400, valid_from >= valid_to -> 400, branch ngoai org -> 403) -> 201; PATCH /api/promotions/:id sua ma (gui code -> 400, ma khong ton tai -> 404, ngoai org -> 403, moi luat validate nhu khi tao; status chi active/locked) -> 200; GET /api/promotions (loc code/status/channel/branch_id, phan trang limit/offset) + GET /api/promotions/:id kem {used_count, usage_limit, per_customer_limit}; moi API loc theo org + pham vi vai",
      "requirementIds": [
        "R-1",
        "R-2",
        "R-13"
      ],
      "examples": [
        {
          "input": "POST /api/promotions {code: 'SALE10', type: 'percent', value: 10, cap: 20000} (test moi)",
          "expected": "201, tra ma da tao kem status 'active'"
        },
        {
          "input": "POST /api/promotions trung code trong org (test moi)",
          "expected": "409, khong tao ma moi"
        },
        {
          "input": "POST /api/promotions {type: 'percent', value: 150} vuot 1..100; {type: 'fixed', cap: 10000} cap voi fixed; valid_from >= valid_to (test moi)",
          "expected": "400"
        },
        {
          "input": "PATCH /api/promotions/:id {code: 'KHAC'} doi code (test moi)",
          "expected": "400"
        },
        {
          "input": "PATCH /api/promotions/:id {status: 'locked'} (test moi)",
          "expected": "200, status 'locked'; ap ma bi khoa -> 400"
        },
        {
          "input": "GET /api/promotions/:id (test moi)",
          "expected": "200, tra ma kem {used_count, usage_limit, per_customer_limit}"
        }
      ],
      "boundaries": [
        "migration 014 chay tuan tu sau 001-013, giu du lieu cu, 286 test da khoa cua GOAL-001..008 van xanh",
        "don cu giu promotion_id NULL + promo_discount 0, hanh vi don cu khong doi; orders.total la tong snapshot goc, KHONG bi sua khi ap ma",
        "code chuan hoa UPPERCASE + trim; code khong doi sau khi tao (PATCH gui code -> 400)",
        "khong co endpoint go ma khoi don trong goal nay"
      ],
      "prohibited": [
        "khong duoc sua test da khoa cua GOAL-001..008; khong duoc doi hanh vi don cu (state machine, snapshot gia, giu/xuat kho)",
        "khong duoc de code trung trong org; khong duoc cho cap di voi loai fixed",
        "khong duoc co endpoint DELETE vinh vien cho ma (chi khoa bang status 'locked')"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-2",
      "text": "Ap ma + dieu kien + tinh giam + gioi han dung (AC-2): POST /api/orders/:id/promotion {code, idempotency_key?} — don khong ton tai -> 404, ngoai org -> 403; don khong o draft -> 400; don da co ma -> 400; ma khong ton tai -> 404; ma locked -> 400; sai kenh/chi nhanh -> 400; ngoai thoi gian hieu luc -> 400; tong don goc < min_order_total -> 400; het luot tong/moi khach -> 400; thanh cong -> 201, trong CUNG MOT transaction BEGIN IMMEDIATE: ghi 1 dong promotion_usages (status 'used', discount_amount = so tien giam, customer_id = customer_id cua don) + cap nhat orders.promotion_id + promo_discount + 1 audit log, tra don kem {promotion: {id, code, type, value}, promo_discount}; tinh giam tren tong goc: percent -> floor(total x value / 100) roi min voi cap va phan con lai sau diem, fixed -> min(value, total - points_discount), promo_discount + points_discount <= total; gioi han dung: tong luot = so usage 'used' cua ma, luot moi khach = so usage 'used' cua ma voi customer_id do (don khong gan khach chi tinh gioi han tong)",
      "requirementIds": [
        "R-3",
        "R-4",
        "R-6"
      ],
      "examples": [
        {
          "input": "don draft 250.000d -> POST /api/orders/:id/promotion {code: 'SALE10'} (ma 10% cap 20.000d) -> promo_discount 20.000d (test moi)",
          "expected": "201, tra don kem {promotion: {id, code, type, value}, promo_discount}"
        },
        {
          "input": "ap ma cho don da xac nhan; ap ma lan 2 cung don; ap ma locked; ap ma het han; ap ma sai kenh; ap ma sai chi nhanh; tong don < min_order_total; het luot tong; het luot moi khach (test moi)",
          "expected": "400"
        },
        {
          "input": "don 250.000d, ma 10% cap 20.000d (test moi)",
          "expected": "giam 20.000d (10% = 25.000d, cat o cap)"
        },
        {
          "input": "don 50.000d, ma fixed 100.000d (test moi)",
          "expected": "giam 50.000d (cat o tong don)"
        },
        {
          "input": "10 lan ap cung ma gioi han 5 luot dong thoi (test moi)",
          "expected": "dung 5 thanh cong, 5 lan con lai 400, used_count = 5"
        },
        {
          "input": "POST ap ma 2 lan cung Idempotency-Key (test moi, xem AC-4)",
          "expected": "gui lai tra dung response da luu kem replayed: true, khong ghi usage moi"
        }
      ],
      "boundaries": [
        "ap ma chi tren don draft; mot don chi ap 1 ma; khong co endpoint go ma trong goal nay",
        "tinh giam la ham thuan o service, khong tin client gui so tien giam",
        "gioi han dung: tong luot = so usage 'used' cua ma; luot moi khach chi tinh khi don co customer_id; don khong gan khach chi tinh gioi han tong",
        "moi kiem tra gioi han + ghi usage + cap nhat don trong CUNG MOT transaction BEGIN IMMEDIATE"
      ],
      "prohibited": [
        "khong duoc ap ma cho don khong phai draft; khong duoc de tong giam vuot tong don (promo_discount + points_discount <= total)",
        "khong duoc dung withIdempotency cua GOAL-001 cho ap ma — bat buoc dung withStockIdempotency trong cung transaction BEGIN IMMEDIATE",
        "khong duoc de 2 yeu cau ap cung ma dong thoi cung lot qua gioi han"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-3",
      "text": "Chong giam + huy don hoan luot + doi soat (AC-3): luat chong giam MOT luat duy nhat: % tinh tren tong goc, tong giam cuoi = min(C + P, total) voi C = so giam cua ma truoc khi cat o phan con lai (percent: min(floor(total x value / 100), cap); fixed: value), P = diem doi x 100 — ket qua nhu nhau du ap ma truoc hay doi diem truoc (test ca hai chieu + truong hop bao hoa); doi diem tren don da co ma bi cat o total - promo_discount (sua toi thieu o redeem, khong doi hanh vi khi don chua co ma); huy don co ma trong CUNG MOT transaction voi doi trang thai: usage chuyen 'used' -> 'released' (released_at + release_reason = ma don da huy), orders.promo_discount ve 0, promotion_id ve NULL — luot dung giai phong, dung lai duoc; tra hang/hoan tien KHONG hoan luot dung; computePaymentSummary mo rong: outstanding = order_total - points_discount - promo_discount - paid_total, payment_status GIU NGUYEN logic D22; tich diem tinh tren order_total goc, KHONG tru promo_discount",
      "requirementIds": [
        "R-5",
        "R-7",
        "R-8",
        "R-15"
      ],
      "examples": [
        {
          "input": "ma 20% khong cap + 200 diem tren don 100.000d, ap theo 2 thu tu (test moi)",
          "expected": "ma truoc: ma 20.000d + diem 20.000d; diem truoc: diem 20.000d + ma 20.000d; tong giam 40.000d ca hai chieu"
        },
        {
          "input": "ma 50% + 900 diem tren don 100.000d, ap theo 2 thu tu (test moi)",
          "expected": "tong giam 100.000d ca hai chieu, outstanding 0"
        },
        {
          "input": "doi diem tren don da co ma (test moi)",
          "expected": "discount doi diem = min(diem x 100, total - promo_discount)"
        },
        {
          "input": "huy don co ma (test moi)",
          "expected": "200, usage chuyen 'released', promo_discount ve 0, promotion_id ve NULL; ap lai ma do duoc"
        },
        {
          "input": "tra hang/hoan tien don co ma (test moi)",
          "expected": "usage GIU NGUYEN 'used'"
        },
        {
          "input": "don 250.000d, ma giam 20.000d, doi diem 1.000d, tra 100.000d -> outstanding 129.000d (test moi)",
          "expected": "outstanding = total - points_discount - promo_discount - paid_total; payment_status giu logic D22"
        },
        {
          "input": "don completed 250.000d ap ma 10% -> tich diem (test moi)",
          "expected": "25 diem (tinh tren 250.000d goc, khong tru ma)"
        }
      ],
      "boundaries": [
        "luat chong giam MOT luat duy nhat, khong phu thuoc thu tu ap; tong giam cuoi = min(C + P, total)",
        "huy don hoan luot dung trong CUNG MOT transaction voi doi trang thai; tra hang/hoan tien KHONG hoan luot dung",
        "payment_status GIU NGUYEN logic D22 (chi outstanding tru them promo_discount); tich diem tinh tren order_total goc, KHONG tru promo_discount",
        "khong duoc doi hanh vi computePaymentSummary cua GOAL-006/007/008 (partially_refunded chi khi co return da hoan tien; don doi diem het tong chua tra van 'unpaid')"
      ],
      "prohibited": [
        "khong duoc doi luat chong giam thanh tinh % tren tong da tru diem",
        "khong duoc hoan luot dung khi tra hang/hoan tien; khong duoc doi payment_status theo promo_discount (chi outstanding tru discount)",
        "khong duoc sua test da khoa cua GOAL-006/007/008 ve payment_status"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-4",
      "text": "RBAC + audit + idempotency + test/checks/docs (AC-4): mo rong helper can() o src/rbac.ts them 4 actions create-promotion, update-promotion, apply-promotion, view-promotions theo dung ma tran khuyen mai (tao/sua/khoa: chi owner/manager; ap ma: owner/manager toan org, sales chi don thuoc chi nhanh minh; xem: owner/manager/accountant toan org, sales chi ma branch_id NULL hoac dung chi nhanh minh, warehouse 403); moi endpoint khuyen mai qua requireRole + can() (vai sai/sai chi nhanh/ngoai org -> 403); audit_log ghi MOI thao tac tao/sua/khoa ma, ap ma, hoan luot dung khi huy don; promotion_usages ghi du moi lan ap ma thanh cong (gui lai cung key thi KHONG ghi dong moi); idempotency dung withStockIdempotency voi ten mien promotion:create:<key> / promotion:apply:<key>, gui lai tra replayed: true khong tao ma/usage moi; test moi (vitest + supertest, file moi) chung minh toan bo hanh vi AC-1..AC-3 + RBAC 403; du lieu GIA LAP hoan toan, secret qua bien moi truong, check.sh van quet secret; scripts/check.sh va scripts/demo.sh duoc MO RONG them buoc khuyen mai, giu cac buoc GOAL-001..008 xanh, tu chay duoc, tu don dep, in PASS/FAIL tung buoc; docs RBAC/DECISIONS(D27)/README/SETUP cap nhat",
      "requirementIds": [
        "R-9",
        "R-10",
        "R-11",
        "R-12",
        "R-13",
        "R-14"
      ],
      "examples": [
        {
          "input": "test RBAC theo tung o cam trong ma tran khuyen mai (test moi)",
          "expected": "403: warehouse tao ma; sales sua ma; accountant ap ma; sales ap ma cho don ngoai chi nhanh; warehouse xem ma; user org A doc ma org B; sales xem ma gioi han chi nhanh khac"
        },
        {
          "input": "thuc hien cac thao tac khuyen mai roi doc audit_log (test moi)",
          "expected": "moi thao tac tao/sua/khoa ma, ap ma, hoan luot dung khi huy don deu ghi audit_log voi user_id nguoi thuc hien, created_at, action + detail JSON (target_promotion_id, promotion_code, target_order_id/order_code khi ap ma, discount khi ap ma, KHONG chua thong tin the)"
        },
        {
          "input": "tao ma -> ap ma -> huy don -> ap lai, doc promotion_usages (test moi)",
          "expected": "ledger dung thu tu thoi gian, du cac buoc, khong co dong thua (gui lai cung key khong ghi dong moi)"
        },
        {
          "input": "./scripts/check.sh; ./scripts/demo.sh",
          "expected": "./scripts/check.sh exit 0 va ./scripts/demo.sh in PASS tung buoc, gom cac buoc GOAL-001..008 xanh + buoc khuyen mai moi"
        },
        {
          "input": "doc RBAC/DECISIONS/README/SETUP sau goal",
          "expected": "docs/RBAC.md bo sung ma tran khuyen mai; docs/DECISIONS.md them D27; README.md/docs/SETUP.md cap nhat endpoint khuyen mai, khop lenh da chay that"
        }
      ],
      "boundaries": [
        "xem audit log theo luat GOAL-002 (GET /api/audit-log: owner toan org, manager trong pham vi, cac vai khac -> 403); promotion_usages la lich su chi tiet, audit_log la lop ghi nhan thao tac nhay cam — ca hai deu phai co, khong thay nhau",
        "seed KHONG them ma mau (demo tu tao) — giu nguyen 2 user, 2 san pham, 2 kho + muc ton mau de test khoa van xanh",
        "test moi them vao file test moi, KHONG sua 286 test da khoa cua GOAL-001..008; du lieu test gia lap (2 org, 2 ma tro len trong cung org)",
        "khong duoc claim VPS, deploy production hay cong thanh toan that; khong duoc luu thong tin the o bat ky dau (DB, API, log, audit_log, promotion_usages)"
      ],
      "prohibited": [
        "khong duoc sua test da khoa cua GOAL-001..008; khong duoc commit secret/credential that; khong duoc commit file .github/workflows/ (CI cho user cap scope workflow)",
        "khong duoc claim VPS, deploy production hay cong thanh toan that; khong duoc luu thong tin the o bat ky dau (DB, API, log, audit_log, promotion_usages)"
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
    "GOAL-003",
    "GOAL-005"
  ],
  "priority": 3
}
```
