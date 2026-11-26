# GOAL-005 v1: OmniFlow don hang da kenh + vong doi: tao don tai quay + API (kenh counter/web/api) voi snapshot gia tai thoi diem dat; state machine draft -> confirmed -> processing -> completed / cancelled (chuyen sai -> 400); xac nhan giu hang nguyen tu, huy giai phong dung so da giu, hoan tat release + out trong 1 transaction; idempotency + chong ban qua ton trong transaction; tim kiem/loc/phang trang + lich su don; RBAC don theo vai + pham vi chi nhanh/kho + audit log; check/demo mo rong buoc don van xanh

Status: approved

```json
{
  "id": "GOAL-005",
  "version": 1,
  "outcome": "OmniFlow don hang da kenh + vong doi: tao don tai quay + API (kenh counter/web/api) voi snapshot gia tai thoi diem dat; state machine draft -> confirmed -> processing -> completed / cancelled (chuyen sai -> 400); xac nhan giu hang nguyen tu, huy giai phong dung so da giu, hoan tat release + out trong 1 transaction; idempotency + chong ban qua ton trong transaction; tim kiem/loc/phang trang + lich su don; RBAC don theo vai + pham vi chi nhanh/kho + audit log; check/demo mo rong buoc don van xanh",
  "source": {
    "path": "brief-005.md",
    "sha256": "ccff49ea7ca44745b64f787300f1b7bdd497ccc77471225c20dc352a1251f098",
    "capturedAt": "2026-11-26T18:37:07.628Z",
    "origin": "human"
  },
  "requirements": [
    {
      "id": "R-1",
      "sourceSpan": "dòng 165",
      "text": "Migration 010 tạo bảng orders (org_id NOT NULL FK tới orgs, branch_id NOT NULL FK tới branches, warehouse_id NOT NULL FK tới warehouses, code TEXT NOT NULL, channel TEXT NOT NULL CHECK IN ('counter','web','api'), customer_name TEXT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK IN ('draft','confirmed','processing','completed','cancelled'), total INTEGER NOT NULL DEFAULT 0 CHECK >= 0, created_by NOT NULL FK tới users, created_at/updated_at): UNIQUE(org_id, code); migration chạy tuần tự sau 001–009, giữ dữ liệu cũ, không vỡ 125 test đã khóa. Không có endpoint DELETE đơn.",
      "disposition": "acceptance"
    },
    {
      "id": "R-2",
      "sourceSpan": "dòng 171",
      "text": "Migration 010 tạo bảng order_items (order_id NOT NULL FK tới orders, variant_id NOT NULL FK tới product_variants, product_id NOT NULL FK tới products, sku TEXT NOT NULL, name TEXT NOT NULL, unit_price INTEGER NOT NULL CHECK >= 0, price_source TEXT NOT NULL, qty INTEGER NOT NULL CHECK > 0, line_total INTEGER NOT NULL CHECK >= 0): một đơn không có 2 dòng cùng biến thể (UNIQUE(order_id, variant_id)); line_total = unit_price * qty.",
      "disposition": "acceptance"
    },
    {
      "id": "R-3",
      "sourceSpan": "dòng 179",
      "text": "Migration 010 tạo bảng order_events append-only (order_id NOT NULL FK tới orders, from_status TEXT NULL, to_status TEXT NOT NULL, actor_id NOT NULL FK tới users, note TEXT NULL, created_at): chỉ INSERT, không có API UPDATE/DELETE lịch sử (gọi sửa/xóa → 404/405).",
      "disposition": "acceptance"
    },
    {
      "id": "R-4",
      "sourceSpan": "dòng 187",
      "text": "API tạo đơn: POST /api/orders nhận {branch_id?, warehouse_id, channel, customer_name?, items: [{variant_id, qty}], idempotency_key?} — channel phải thuộc counter/web/api (lạ → 400); items là mảng không rỗng (rỗng → 400); mỗi dòng qty nguyên > 0, biến thể tồn tại trong org (không tồn tại/ngoài org → 404/403), không trùng biến thể trong cùng đơn (→ 400), biến thể của sản phẩm đã ngừng kinh doanh → 400; warehouse_id phải là kho trong org và active (không tồn tại/ngoài org → 404/403, kho inactive → 400); branch_id theo luật ở quyết định mô hình; thành công → 201, trả đơn đã tạo kèm items (mỗi dòng có unit_price + price_source đã snapshot) và total (tổng các line_total, tính ở server). Tạo đơn KHÔNG giữ hàng, KHÔNG trừ kho — đơn mới ở draft, tồn không đổi. Mã đơn DH-YYYYMMDD-NNNN duy nhất trong org.",
      "disposition": "acceptance"
    },
    {
      "id": "R-5",
      "sourceSpan": "dòng 198",
      "text": "API chuyển trạng thái: POST /api/orders/:id/confirm, /process, /complete, /cancel (nhận {note?, idempotency_key?} — hủy đơn nên có note là lý do hủy). Chuyển sai → 400, không đổi gì, không ghi event, không động kho. Xác nhận: giữ hàng nguyên tử mọi dòng (dòng nào thiếu tồn → 400 insufficient_stock, không giữ dòng nào). Hủy từ confirmed/processing: giải phóng đúng số đã giữ. Hoàn tất từ processing: mỗi dòng release + out trong cùng transaction (KHÔNG thêm loại movement mới). Mọi chuyển thành công ghi 1 event + 1 audit log, trả đơn kèm items + events.",
      "disposition": "acceptance"
    },
    {
      "id": "R-6",
      "sourceSpan": "dòng 208",
      "text": "API đọc đơn: GET /api/orders?status=&channel=&code=&customer_name=&branch_id=&warehouse_id=&limit=&offset= trả danh sách đơn của org (mới nhất trước; code/customer_name tìm theo chuỗi con, không phân biệt hoa thường; limit mặc định 20, tối đa 100; offset mặc định 0; kèm tổng số để phân trang); GET /api/orders/:id trả đơn kèm items + events. Mọi API đọc lọc theo org + phạm vi vai (sales chỉ chi nhánh mình, warehouse chỉ kho được gán); ngoài org → 403; đơn không tồn tại → 404.",
      "disposition": "acceptance"
    },
    {
      "id": "R-7",
      "sourceSpan": "dòng 219",
      "text": "Idempotency cho đơn: tạo đơn + mọi chuyển trạng thái đều nhận Idempotency-Key (header) hoặc idempotency_key (body); server dùng withStockIdempotency (GOAL-004) với tên miền key order:create:<key> / order:<hành động>:<key>; gửi lại cùng key + cùng loại + cùng org → trả đúng response đã lưu kèm replayed: true, KHÔNG tạo đơn mới, KHÔNG đổi trạng thái lần nữa, KHÔNG động vào kho (số đơn, số movement, mức tồn không đổi — test chứng minh). Key khác nhau thì thực thi bình thường. Thiếu key thì vẫn thực thi (không bắt buộc) nhưng không có bảo vệ gửi lại.",
      "disposition": "acceptance"
    },
    {
      "id": "R-8",
      "sourceSpan": "dòng 227",
      "text": "Chống bán quá tồn: mọi giữ/xuất qua applyMovement trong BEGIN IMMEDIATE + CHECK ở DB (D17); test tạo nhiều đơn nháp cùng biến thể rồi xác nhận đồng thời — tổng giữ thành công <= available, các đơn vượt nhận 400 insufficient_stock, tồn cuối không âm, reserved không vượt on_hand. Test xác nhận cùng một đơn 2 lần đồng thời (khác key): chỉ 1 lần thành công, lần còn lại 400 (đơn không còn ở draft). Test gửi lại cùng idempotency key đồng thời: chỉ 1 lần thực thi.",
      "disposition": "acceptance"
    },
    {
      "id": "R-9",
      "sourceSpan": "dòng 233",
      "text": "Lịch sử đơn: order_events ghi đủ mọi lần tạo/chuyển trạng thái (from_status/to_status/actor_id/note/created_at); GET /api/orders/:id trả events theo đúng thứ tự đã chốt (ghi rõ trong docs); hủy đơn khi đang xử lý giải phóng đúng số đã giữ (test: xác nhận giữ 10 → xử lý → hủy → reserved về 0, on_hand không đổi, available về như trước khi xác nhận).",
      "disposition": "acceptance"
    },
    {
      "id": "R-10",
      "sourceSpan": "dòng 239",
      "text": "RBAC đơn: mở rộng helper can() ở src/rbac.ts thêm actions create-order, confirm-order, process-order, complete-order, cancel-order, view-orders theo đúng ma trận trong brief (kiểu Target mở rộng warehouseId đã có + branchId); mọi endpoint đơn qua requireRole + can() (vai sai → 403, ngoài org → 403, sai chi nhánh/kho → 403). Test chứng minh từng ô cấm trong ma trận (ít nhất: warehouse tạo đơn → 403, accountant xác nhận đơn → 403, sales xử lý đơn → 403, sales xác nhận đơn ngoài chi nhánh → 403, warehouse hoàn tất đơn có kho ngoài phạm vi → 403, user org A đọc đơn org B → 403).",
      "disposition": "acceptance"
    },
    {
      "id": "R-11",
      "sourceSpan": "dòng 245",
      "text": "Audit log cho đơn: ghi vào audit_log đã có MỌI thao tác tạo đơn, xác nhận/xử lý/hoàn tất/hủy; mỗi bản ghi có user_id người thực hiện, created_at, action + detail JSON (target_order_id, order_code, from_status/to_status, total, KHÔNG chứa dữ liệu nhạy cảm); xem log theo luật GOAL-002 (GET /api/audit-log: owner toàn org, manager trong phạm vi, các vai khác → 403). Lưu ý: order_events đã là lịch sử trạng thái chi tiết; audit_log là lớp ghi nhận thao tác nhạy cảm theo chuẩn GOAL-002 — cả hai đều phải có, không thay nhau.",
      "disposition": "acceptance"
    },
    {
      "id": "R-12",
      "sourceSpan": "dòng 252",
      "text": "Test mới (vitest + supertest, thêm vào file test mới — KHÔNG sửa 125 test đã khóa của GOAL-001..004): chứng minh tạo đơn đúng snapshot giá (đổi giá sau không đổi giá đơn), tạo đơn không giữ hàng, xác nhận giữ đúng số + thiếu tồn 400 không giữ dòng nào, hủy từ nháp/xác nhận/đang xử lý đúng (giải phóng đúng số), hoàn tất release+out đúng số học (reserved về 0, on_hand trừ đúng), chuyển sai → 400 (draft → completed, completed → cancelled, xác nhận 2 lần), idempotency (tạo lại cùng key → cùng mã đơn, không tạo đơn mới; chuyển trạng thái lại cùng key → replayed: true, không động kho), race (đồng thời nhiều xác nhận → tổng giữ <= available, không bán quá tồn), tìm kiếm/lọc/phân trang (theo status/channel/code/customer, limit/offset + tổng số), RBAC 403 theo ma trận (yêu cầu 10), kho inactive chặn xác nhận → 400, biến thể sản phẩm ngừng kinh doanh không tạo đơn được → 400. Test dùng dữ liệu giả lập (2 org, 2 kho trở lên trong cùng org, 2 biến thể trở lên).",
      "disposition": "acceptance"
    },
    {
      "id": "R-13",
      "sourceSpan": "dòng 302",
      "text": "Dữ liệu GIẢ LẬP hoàn toàn; mật khẩu seed qua biến môi trường (như GOAL-001..004: OMNIFLOW_SEED_*_PASSWORD), không commit credential thật; check.sh vẫn quét secret (grep như GOAL-001); seed KHÔNG cần thêm đơn mẫu (demo tự tạo đơn) — nhưng giữ nguyên 2 user, 2 sản phẩm, 2 kho + mức tồn mẫu để test khóa vẫn xanh.",
      "disposition": "acceptance"
    },
    {
      "id": "R-14",
      "sourceSpan": "dòng 307",
      "text": "scripts/check.sh (CHK-1) và scripts/demo.sh (CHK-2) được MỞ RỘNG trong goal này: thêm bước đơn vào smoke/demo (tạo đơn tại quầy → xác nhận giữ hàng → xử lý → hoàn tất xuất kho → tạo đơn khác → xác nhận → hủy khi đang xử lý giải phóng đúng → chuyển sai 400 → idempotency gửi lại không tạo đơn mới → race đồng thời không bán quá tồn → RBAC 403: warehouse tạo đơn, sales xử lý đơn, ngoài org), giữ tất cả bước GOAL-001..004 xanh (health, login, owner-only, idempotency, backup/restore, RBAC người dùng, sản phẩm/giá/CSV, kho). Cả 2 script tự chạy được, tự dọn dẹp, in PASS/FAIL từng bước.",
      "disposition": "acceptance"
    },
    {
      "id": "R-15",
      "sourceSpan": "dòng 316",
      "text": "Docs: docs/RBAC.md bổ sung ma trận đơn (bảng ở trên) + mô hình phạm vi đơn (chi nhánh + kho); docs/DECISIONS.md thêm D19 (mô hình đơn: state machine, snapshot giá, giữ/giải phóng/commit release+out, mã đơn, idempotency trong transaction, race một process) và D20 nếu có quyết định tách hàm resolve giá dùng chung (Lead ghi); README.md/docs/SETUP.md cập nhật endpoint đơn, khớp lệnh đã chạy thật. Không có file .github/workflows/ trong repo (gh token thiếu scope workflow — CI là follow-up sau khi user cấp scope). Không claim VPS, không claim deploy production (local-only, D9).",
      "disposition": "acceptance"
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
    "brief-005.md",
    "goal-005.json",
    ".gitignore"
  ],
  "exclusions": [
    "Thanh toán/hoàn tiền (GOAL-006): không thu tiền, không trạng thái thanh toán trên đơn, không webhook, không đối soát đơn–thanh toán.",
    "Giao hàng/trả hàng (GOAL-007): không yêu cầu giao, không gán đơn vị vận chuyển, không trả hàng nhập lại kho — 'hoàn tất' ở đây chỉ là xuất kho xong, chưa phải giao tới khách.",
    "Khách hàng + CRM (GOAL-008): customer_name chỉ là chuỗi tự do trên đơn, không có bảng khách hàng, không hợp nhất hồ sơ trùng, không lịch sử chăm sóc.",
    "Khuyến mãi (GOAL-009): không mã giảm giá, không chương trình theo điều kiện — giá đơn chỉ dùng giá hiệu dụng GOAL-003 đã snapshot.",
    "Báo cáo/đối soát (GOAL-010), thông báo (GOAL-011): không tổng hợp doanh thu theo đơn, không thông báo đơn mới (chỉ audit log + lịch sử đơn).",
    "Đa chi nhánh cho 1 user (bảng user_scopes), quên mật khẩu / đặt lại mật khẩu qua email, SSO/OAuth, upload ảnh thật — là follow-up, không làm trong goal này.",
    "Deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user cấp scope workflow)."
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Don + luoc do don + snapshot gia (AC-1): migration 010 tao orders (org/branch/warehouse, code DH-YYYYMMDD-NNNN duy nhat trong org, channel counter/web/api, customer_name tu do, status state machine, total nguyen dong), order_items (snapshot sku/name/unit_price/price_source, qty > 0, line_total, UNIQUE don/bien the), order_events append-only; API tao don (201, tra don kem items + total, o draft, khong giu hang), API doc don + tim kiem/loc/phang trang",
      "requirementIds": [
        "R-1",
        "R-2",
        "R-3",
        "R-4",
        "R-6"
      ],
      "examples": [
        {
          "input": "mo DB moi, chay migration 001-010 roi seed",
          "expected": "migration 010 tao orders/order_items/order_events; UNIQUE bat trung ma don trong org va trung bien the trong cung don"
        },
        {
          "input": "tao don kenh web chi nhanh Chinh cho bien the SKU-SEED-01-M",
          "expected": "POST /api/orders tao don 201 kem items da snapshot unit_price + price_source va total = tong line_total; ton khong doi sau khi tao"
        },
        {
          "input": "tao don voi cac dau vao sai tren",
          "expected": "tao don cho bien the san pham da ngung kinh doanh -> 400; kho inactive -> 400; items rong -> 400; trung bien the trong don -> 400"
        }
      ],
      "boundaries": [
        "don la cap org, co branch_id + warehouse_id bat buoc; khong co endpoint DELETE don",
        "ma don DH-YYYYMMDD-NNNN duy nhat trong org, tinh trong transaction tao don",
        "don tao o draft, KHONG giu hang, KHONG tru kho",
        "gia snapshot tai thoi diem dat don, doi gia sau khong doi gia don"
      ],
      "prohibited": [
        "khong duoc them endpoint DELETE (xoa cung) don",
        "khong duoc de tao don giu hang hoac tru kho",
        "khong duoc tin total do client gui len (server tu tinh)",
        "khong duoc lay gia hien tai thay cho gia snapshot khi doc don cu"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-2",
      "text": "Vong doi don + giu/giai phong/xuat kho (AC-2): state machine draft -> confirmed -> processing -> completed / cancelled (chuyen sai -> 400, khong ghi event, khong dong kho); xac nhan giu hang nguyen tu moi dong (thieu ton -> 400, khong giu dong nao); huy giai phong dung so da giu; hoan tat release + out trong 1 transaction; lich su don order_events append-only cho moi lan tao/chuyen trang thai",
      "requirementIds": [
        "R-5",
        "R-9"
      ],
      "examples": [
        {
          "input": "POST /api/orders/:id/confirm du/thieu ton",
          "expected": "xac nhan don giu 10: reserved 10, on_hand khong doi; thieu ton -> 400, reserved khong doi, don o lai draft"
        },
        {
          "input": "confirm -> process -> complete, doc stock_levels + stock_movements",
          "expected": "hoan tat don da giu 10: reserved ve 0, on_hand tru 10, available cuoi dung; 2 movement release + out cung reference ma don"
        },
        {
          "input": "goi cac chuyen trang thai sai va huy tu processing",
          "expected": "draft -> completed -> 400; completed -> cancelled -> 400; xac nhan 2 lan -> 400; huy khi dang xu ly giai phong dung so da giu"
        }
      ],
      "boundaries": [
        "chuyen doi hop le duy nhat: draft->confirmed, confirmed->processing, processing->completed, draft/confirmed/processing->cancelled; moi chuyen khac -> 400",
        "xac nhan giu hang nguyen tu moi dong trong 1 transaction; dong nao thieu ton -> 400 insufficient_stock, khong giu dong nao",
        "huy tu confirmed/processing giai phong dung so da giu; huy tu draft chi doi trang thai",
        "hoan tat = release + out trong CUNG MOT transaction, KHONG them loai movement moi"
      ],
      "prohibited": [
        "khong duoc cho chuyen trang thai ngoai bang chuyen doi hop le",
        "khong duoc de xac nhan giu duoc mot nua khi dong sau thieu ton",
        "khong duoc hoan tat bang 1 movement out duy nhat (se de reserved treo)",
        "khong duoc de huy don khong giai phong hang da giu"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-3",
      "text": "Idempotency + chong ban qua ton (AC-3): idempotency key cho tao don + moi chuyen trang thai qua withStockIdempotency (ten mien order:create:<key> / order:<hanh dong>:<key>, replay tra response cu kem replayed: true, kiem tra + thuc thi + ghi key trong 1 transaction BEGIN IMMEDIATE), moi giu/xuat qua applyMovement trong BEGIN IMMEDIATE + CHECK o DB, test dong thoi chung minh tong giu <= available va ton khong am",
      "requirementIds": [
        "R-7",
        "R-8"
      ],
      "examples": [
        {
          "input": "POST /api/orders 2 lan cung key",
          "expected": "tao don 2 lan cung Idempotency-Key -> cung ma don, chi 1 don duoc tao"
        },
        {
          "input": "POST /api/orders/:id/confirm 2 lan cung key",
          "expected": "xac nhan lai cung key -> replayed: true, reserved va so movement khong doi"
        },
        {
          "input": "tao 10 don nhap qty 10 roi confirm dong thoi",
          "expected": "10 don nhap cung bien the xac nhan dong thoi khi available=50: tong giu thanh cong <= 50, cac don vuot nhan 400, ton cuoi khong am"
        }
      ],
      "boundaries": [
        "key dat ten mien order:create:<key> / order:<hanh dong>:<key>; gui lai cung key + cung loai + cung org -> replayed: true, khong thuc thi lai",
        "dung withStockIdempotency (kiem tra + thuc thi + ghi key trong 1 transaction BEGIN IMMEDIATE), KHONG dung withIdempotency ngoai transaction cho don",
        "thieu key van thuc thi (khong bat buoc), nhung khong co bao ve gui lai",
        "replay tra dung response da luu ngay ca khi don da chuyen tiep sang trang thai khac"
      ],
      "prohibited": [
        "khong duoc dung withIdempotency hien tai mot cach ngay tho cho don (kiem tra key ngoai transaction)",
        "khong duoc de gui lai cung key tao 2 don hoac tru kho 2 lan",
        "khong duoc claim chong race da process (app mot tien trinh, D1)"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-4",
      "text": "RBAC + audit + checks mo rong xanh (AC-4): mo rong can() voi 6 actions don theo ma tran (vai sai -> 403, ngoai org -> 403, sai chi nhanh/kho -> 403), audit_log moi thao tac don, test 403 theo ma tran, du lieu gia lap, check.sh/demo.sh mo rong buoc don va giu cac buoc GOAL-001..004 xanh, docs RBAC/D19/D20, khong co workflow CI/VPS",
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
          "input": "goi tung endpoint cam theo tung vai/chi nhanh/kho",
          "expected": "warehouse tao don bi 403; accountant xac nhan don bi 403; sales xu ly don bi 403; sales xac nhan don ngoai chi nhanh bi 403; warehouse hoan tat don kho ngoai pham vi bi 403"
        },
        {
          "input": "thuc hien cac thao tac roi doc GET /api/audit-log",
          "expected": "sau tao/xac nhan/xu ly/hoan tat/huy, audit_log co ban ghi voi actor, created_at, action, detail target_order_id/order_code/from_status/to_status/total"
        },
        {
          "input": "./scripts/check.sh; ./scripts/demo.sh",
          "expected": "./scripts/check.sh exit 0 va ./scripts/demo.sh in PASS tung buoc, gom buoc don moi"
        },
        {
          "input": "./scripts/check.sh buoc secret-scan",
          "expected": "grep khong thay credential that trong code (tru placeholder/fixture gia)"
        }
      ],
      "boundaries": [
        "test moi them vao file test moi, KHONG sua 125 test da khoa cua GOAL-001..004",
        "du lieu test la gia lap (2 org, 2 kho tro len trong cung org, 2 bien the tro len)",
        "sales chi don thuoc chi nhanh minh; warehouse chi don co warehouse_id trong pham vi",
        "audit_log va order_events la 2 lop ghi nhan khac nhau, ca hai deu phai co"
      ],
      "prohibited": [
        "khong duoc sua 125 test da khoa cua GOAL-001..004",
        "khong duoc commit bi mat/credential that",
        "khong duoc claim CI/VPS/deploy khi chua co",
        "khong duoc de endpoint don nao bo qua kiem tra vai + pham vi chi nhanh/kho",
        "khong duoc dung audit_log thay cho order_events hoac nguoc lai"
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
    "GOAL-001",
    "GOAL-002",
    "GOAL-003",
    "GOAL-004"
  ],
  "priority": 3
}
```
