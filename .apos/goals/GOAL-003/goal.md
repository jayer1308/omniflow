# GOAL-003 v1: OmniFlow san pham/gia/CSV: san pham + bien the (SKU duy nhat trong org, barcode duy nhat neu co) + danh muc/thuoc tinh/anh metadata; gia chuan + gia rieng theo kenh/chi nhanh voi fallback 8 buoc + lich su gia append-only; CSV preview bao loi tung dong + import atomic toan bo hoac khong + export dung du lieu org; RBAC san pham/gia/CSV theo ma tran + audit log; check/demo mo rong buoc san pham/gia/CSV van xanh

Status: testing

```json
{
  "id": "GOAL-003",
  "version": 1,
  "outcome": "OmniFlow san pham/gia/CSV: san pham + bien the (SKU duy nhat trong org, barcode duy nhat neu co) + danh muc/thuoc tinh/anh metadata; gia chuan + gia rieng theo kenh/chi nhanh voi fallback 8 buoc + lich su gia append-only; CSV preview bao loi tung dong + import atomic toan bo hoac khong + export dung du lieu org; RBAC san pham/gia/CSV theo ma tran + audit log; check/demo mo rong buoc san pham/gia/CSV van xanh",
  "source": {
    "path": "brief-003.md",
    "sha256": "10fec14e3d59239f7649fdf2b46cc84f894042c46d11e7b3fa07ba65a91a357d",
    "capturedAt": "2026-11-26T15:44:40.456Z",
    "origin": "human"
  },
  "requirements": [
    {
      "id": "R-1",
      "sourceSpan": "dòng 119",
      "text": "Migration 008 tạo bảng products (org_id NOT NULL FK tới orgs, code, name, unit, price INTEGER >= 0 giá bán chuẩn số nguyên đồng D10, min_stock INTEGER DEFAULT 0 >= 0, status CHECK ('active','discontinued') DEFAULT 'active', category_id NULL FK, created_at/updated_at): UNIQUE(org_id, code); tên bắt buộc; giá âm hoặc không nguyên → 400; min_stock âm → 400. Migration chạy tuần tự sau 001–007, giữ dữ liệu cũ, không vỡ 38 test đã khóa.",
      "disposition": "acceptance"
    },
    {
      "id": "R-2",
      "sourceSpan": "dòng 129",
      "text": "Migration 008 tạo bảng product_variants (org_id NOT NULL FK, product_id NOT NULL FK tới products, sku TEXT NOT NULL, name TEXT NOT NULL, barcode TEXT NULL, price_override INTEGER NULL >= 0): UNIQUE(org_id, sku) và UNIQUE(org_id, barcode); trùng SKU → 409, trùng barcode → 409, lỗi rõ ràng, không ghi đè lặng lẽ; tạo biến thể cho sản phẩm ngoài org hoặc không tồn tại → 403/404. Biến thể không tồn tại độc lập khỏi sản phẩm cha.",
      "disposition": "acceptance"
    },
    {
      "id": "R-3",
      "sourceSpan": "dòng 139",
      "text": "Migration 008 tạo bảng categories (org_id NOT NULL FK, name TEXT NOT NULL, parent_id NULL FK tự tham chiếu tối đa 1 cấp cha), product_attributes (product_id NOT NULL FK, key TEXT NOT NULL, value TEXT NOT NULL, key rỗng → 400), product_images (product_id NOT NULL FK, url TEXT NOT NULL chỉ metadata/đường dẫn, alt_text NULL, sort_order DEFAULT 0). Danh mục cha phải cùng org (khác org → 403); thuộc tính/ảnh gắn vào sản phẩm ngoài org → 403. Không có endpoint upload file thật.",
      "disposition": "acceptance"
    },
    {
      "id": "R-4",
      "sourceSpan": "dòng 148",
      "text": "API CRUD sản phẩm: POST /api/products tạo (201), GET /api/products liệt kê (lọc theo org, lọc status/category_id, tìm theo code/name, phân trang limit/offset), GET /api/products/:id chi tiết (kèm biến thể, thuộc tính, ảnh, danh mục), PATCH /api/products/:id sửa. Ngừng kinh doanh: PATCH /api/products/:id/status {status: discontinued} — KHÔNG có endpoint DELETE sản phẩm; sản phẩm ngừng kinh doanh vẫn đọc được, vẫn xuất CSV khi lọc đúng trạng thái, nhưng không cho tạo biến thể mới và không cho đổi giá mới (→ 400, trừ mở bán lại thành active). Mọi response không lộ dữ liệu org khác.",
      "disposition": "acceptance"
    },
    {
      "id": "R-5",
      "sourceSpan": "dòng 160",
      "text": "API biến thể + danh mục + thuộc tính + ảnh: POST /api/products/:id/variants tạo (201; SKU/barcode trùng → 409), GET /api/products/:id/variants, PATCH /api/products/:id/variants/:variantId sửa; POST/GET/PATCH /api/categories; POST /api/products/:id/attributes + DELETE attributes/:attrId; POST /api/products/:id/images (chỉ nhận url + alt_text, KHÔNG nhận file upload) + DELETE images/:imageId. Validate: SKU rỗng → 400; barcode trùng → 409; price_override âm hoặc không nguyên → 400.",
      "disposition": "acceptance"
    },
    {
      "id": "R-6",
      "sourceSpan": "dòng 172",
      "text": "Giá theo kênh/chi nhánh: bảng product_prices (org_id NOT NULL FK, product_id NOT NULL FK, variant_id NULL FK — NULL = áp cho cả sản phẩm, channel TEXT NOT NULL trong danh mục kênh cho phép, branch_id NULL FK — NULL = mọi chi nhánh, price INTEGER >= 0, UNIQUE(org_id, product_id, variant_id, channel, branch_id)). API: POST /api/products/:id/prices đặt giá riêng (kèm reason bắt buộc), GET /api/products/:id/prices, GET /api/products/:id/price?channel=&branch_id=&variant_id= trả giá bán hiệu dụng theo fallback 8 bước kèm trường source. Đổi giá chuẩn (PATCH /api/products/:id đổi price) cũng phải kèm reason (thiếu → 400) và ghi lịch sử.",
      "disposition": "acceptance"
    },
    {
      "id": "R-7",
      "sourceSpan": "dòng 189",
      "text": "Lịch sử giá append-only: bảng price_history (org_id, product_id, variant_id NULL, scope, channel NULL, branch_id NULL, old_price INTEGER NULL, new_price INTEGER NOT NULL, changed_by FK tới users, reason TEXT NOT NULL, created_at): mọi lần đổi giá đều INSERT một dòng; KHÔNG có API UPDATE/DELETE lịch sử (→ 404/405); GET /api/products/:id/price-history trả mới nhất trước, lọc theo org, chỉ vai được phép mới xem. Đổi giá mà giá mới bằng giá cũ → 400 (ghi rõ trong docs/PRICING.md).",
      "disposition": "acceptance"
    },
    {
      "id": "R-8",
      "sourceSpan": "dòng 202",
      "text": "CSV import có xem trước + báo lỗi từng dòng: POST /api/products/import/preview nhận file CSV (multipart file, text/csv, UTF-8) và trả kết quả dry-run KHÔNG ghi dòng nào: {valid, errors: [{line, reason}], summary} — mỗi dòng lỗi nêu rõ số dòng (header là dòng 1) + lý do. Cột bắt buộc: code, name, price, unit; cột optional: min_stock, status (active/discontinued), category, barcode. Mã trùng nhau trong cùng file → lỗi cả hai dòng trùng. Header thiếu cột bắt buộc → 400 toàn file.",
      "disposition": "acceptance"
    },
    {
      "id": "R-9",
      "sourceSpan": "dòng 213",
      "text": "CSV import atomic (toàn bộ hoặc không): POST /api/products/import nhận cùng định dạng file như preview; validate TẤT CẢ các dòng trước (không fail-fast ở dòng lỗi đầu — báo hết mọi dòng lỗi trong một lần chạy); một dòng lỗi → 422 kèm danh sách lỗi từng dòng và KHÔNG ghi dòng nào (transaction rollback); không lỗi → ghi tất cả trong một transaction, trả 201 kèm {imported: n}; trùng mã/SKU với DB → lỗi dòng đó (422 theo dòng); import ghi audit log một dòng (số lượng, tên file). Giới hạn 1000 dòng/file (vượt → 400).",
      "disposition": "acceptance"
    },
    {
      "id": "R-10",
      "sourceSpan": "dòng 223",
      "text": "CSV export đúng dữ liệu hiện tại: GET /api/products/export trả file CSV (UTF-8, header đúng các cột import: code, name, price, unit, min_stock, status, category, barcode) của đúng org người gọi; hỗ trợ lọc ?status=&category_id=; xuất rỗng vẫn trả header + 0 dòng, không lỗi; dữ liệu xuất ra import lại được (round-trip: export → import preview báo trùng mã với DB, chứng minh dữ liệu khớp nhau).",
      "disposition": "acceptance"
    },
    {
      "id": "R-11",
      "sourceSpan": "dòng 232",
      "text": "RBAC sản phẩm/giá/CSV: mở rộng helper can() ở src/rbac.ts thêm actions create-product, update-product, discontinue-product, manage-category, change-price, view-price-history, import-csv, export-csv theo đúng ma trận trong brief; mọi endpoint sản phẩm/giá/CSV qua requireRole + can() (vai sai → 403, ngoài org → 403, xem giá riêng chi nhánh khác → 403). Test chứng minh từng ô cấm trong ma trận (ít nhất: sales đổi giá → 403, warehouse tạo sản phẩm → 403, sales ngừng kinh doanh → 403, accountant xem lịch sử giá được nhưng warehouse → 403, sales import CSV → 403, user org A đọc/xem/sửa sản phẩm org B → 403).",
      "disposition": "acceptance"
    },
    {
      "id": "R-12",
      "sourceSpan": "dòng 242",
      "text": "Audit log cho sản phẩm/giá/CSV: ghi vào audit_log đã có MỌI thao tác tạo/sửa sản phẩm, tạo/sửa biến thể, tạo/sửa danh mục, ngừng kinh doanh/mở bán lại, đổi giá (chuẩn/riêng/override), nhập CSV (một dòng log với số lượng + tên file); mỗi bản ghi có user_id người thực hiện, created_at, action + detail JSON (target_product_id và before/after, KHÔNG chứa dữ liệu nhạy cảm); xem log theo luật GOAL-002 (GET /api/audit-log: owner toàn org, manager trong phạm vi, các vai khác → 403).",
      "disposition": "acceptance"
    },
    {
      "id": "R-13",
      "sourceSpan": "dòng 250",
      "text": "Test mới (vitest + supertest, thêm vào file test mới — KHÔNG sửa 38 test đã khóa của GOAL-001/GOAL-002): chứng minh SKU trùng trong org → 409 (và SKU giống nhau ở org khác thì ĐƯỢC), barcode trùng trong org → 409, ngừng kinh doanh giữ lại sản phẩm + lịch sử giá (đọc lại được, tạo biến thể mới → 400), thứ tự fallback giá 8 bước (mỗi bước một case), lịch sử giá append-only (đổi giá 2 lần → 2 dòng, không có API sửa/xóa), CSV preview báo lỗi từng dòng mà không ghi dòng nào, CSV import atomic (1 dòng lỗi → 0 dòng được ghi; file sạch → ghi đủ), export khớp dữ liệu hiện tại + lọc theo org, RBAC 403 theo ma trận. Test dùng dữ liệu giả lập (2 org, 2 chi nhánh trở lên trong cùng org).",
      "disposition": "acceptance"
    },
    {
      "id": "R-14",
      "sourceSpan": "dòng 261",
      "text": "Dữ liệu GIẢ LẬP hoàn toàn; mật khẩu seed qua biến môi trường (như GOAL-001/GOAL-002: OMNIFLOW_SEED_*_PASSWORD), không commit credential thật; check.sh vẫn quét secret (grep như GOAL-001); seed mở rộng thêm vài sản phẩm + biến thể + giá mẫu (giữ 2 user để test khóa vẫn xanh).",
      "disposition": "acceptance"
    },
    {
      "id": "R-15",
      "sourceSpan": "dòng 266",
      "text": "scripts/check.sh (CHK-1) và scripts/demo.sh (CHK-2) được MỞ RỘNG trong goal này: thêm bước sản phẩm/giá/CSV vào smoke/demo (tạo sản phẩm → tạo biến thể → trùng SKU 409 → đặt giá riêng + kiểm tra fallback → xem lịch sử giá → preview CSV có dòng lỗi (không ghi) → import CSV lỗi (0 dòng được ghi) → import CSV sạch → export khớp → RBAC 403: sales đổi giá, warehouse tạo sản phẩm, ngoài org), giữ tất cả bước GOAL-001/GOAL-002 xanh (health, login, owner-only, idempotency, backup/restore, RBAC người dùng). Cả 2 script tự chạy được, tự dọn dẹp, in PASS/FAIL từng bước.",
      "disposition": "acceptance"
    },
    {
      "id": "R-16",
      "sourceSpan": "dòng 275",
      "text": "Docs: docs/RBAC.md bổ sung ma trận sản phẩm/giá/CSV + mô hình phạm vi giá theo chi nhánh; docs/PRICING.md mới (quy tắc fallback 8 bước + ví dụ từng bước + hành vi đổi giá trùng + lịch sử giá append-only); docs/DECISIONS.md thêm D15 (mô hình sản phẩm/biến thể/SKU/barcode + giá fallback + CSV atomic + sản phẩm cấp org) và D16 (CSV chỉ nhập sản phẩm gốc, không nhập biến thể; ảnh chỉ metadata, chưa upload thật); README.md/docs/SETUP.md cập nhật endpoint và vai mới, khớp lệnh đã chạy thật. Không có file .github/workflows/ trong repo. Không claim VPS, không claim deploy production (local-only, D9).",
      "disposition": "acceptance"
    },
    {
      "id": "R-17",
      "sourceSpan": "dòng 289",
      "text": "Nghiệp vụ kho đa kho (GOAL-004): min_stock ở goal này chỉ là trường ngưỡng để GOAL-004 dùng cảnh báo tồn thấp; không có số lượng tồn, không có bảng warehouses, không nhập/xuất/điều chỉnh/kiểm kê/chuyển kho, không có tồn giữ/có thể bán.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Ngoài phạm vi GOAL-003 theo brief"
    },
    {
      "id": "R-18",
      "sourceSpan": "dòng 293",
      "text": "Đơn hàng (GOAL-005), thanh toán/hoàn tiền (GOAL-006), khuyến mãi (GOAL-009): giá riêng theo kênh/chi nhánh KHÔNG phải khuyến mãi — không mã giảm giá, không chương trình giảm giá theo điều kiện/thời gian, không bằng chứng giá tại thời điểm đặt đơn.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Ngoài phạm vi GOAL-003 theo brief"
    },
    {
      "id": "R-19",
      "sourceSpan": "dòng 297",
      "text": "Upload ảnh thật (lưu file, resize, CDN), đa chi nhánh cho 1 user (bảng user_scopes), quên mật khẩu / đặt lại mật khẩu qua email, bắt buộc đổi mật khẩu lần đầu, đăng nhập SSO/OAuth — là follow-up, không làm trong goal này.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Ngoài phạm vi GOAL-003 theo brief"
    },
    {
      "id": "R-20",
      "sourceSpan": "dòng 301",
      "text": "Deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user cấp scope workflow).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Ngoài phạm vi GOAL-003 theo brief"
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
    "brief-003.md",
    "goal-003.json",
    ".gitignore"
  ],
  "exclusions": [
    "Nghiep vu kho da kho (GOAL-004): min_stock chi la truong nguong cho canh bao ton thap, khong co so luong ton/bang warehouses/nhap-xuat/kho",
    "Don hang (GOAL-005), thanh toan/hoan tien (GOAL-006), khuyen mai (GOAL-009) — gia rieng theo kenh/chi nhanh khong phai khuyen mai",
    "Upload anh that (luu file/resize/CDN), da chi nhanh cho 1 user (bang user_scopes), quen mat khau / dat lai mat khau qua email, bat buoc doi mat khau lan dau, SSO/OAuth",
    "Deploy production/VPS (ngoai pham vi, local-only), CI workflow (cho user cap scope workflow)"
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "San pham + bien the + danh muc (AC-1): migration 008 tao products (code/name/unit/gia chuan so nguyen dong/min_stock/status), product_variants (SKU duy nhat trong org, barcode duy nhat neu co, price_override), categories + product_attributes + product_images metadata; CRUD san pham/bien the/danh muc/thuoc tinh/anh, ngung kinh doanh giu lich su, khong xoa cung",
      "requirementIds": [
        "R-1",
        "R-2",
        "R-3",
        "R-4",
        "R-5"
      ],
      "examples": [
        {
          "input": "mo DB moi, chay migration 001-008 roi seed",
          "expected": "migration 008 tao products/product_variants/categories/product_attributes/product_images; UNIQUE bat trung SKU/ma/barcode"
        },
        {
          "input": "tao san pham roi ngung kinh doanh, doc lai + tao bien the",
          "expected": "POST /api/products tao san pham 201; PATCH status discontinued giu row, doc lai duoc, tao bien the moi bi 400"
        },
        {
          "input": "tao 2 bien the cung SKU trong 1 org, roi tao SKU do o org khac",
          "expected": "trung SKU trong org bi 409 voi loi ro rang; SKU giong nhau o org khac thi DUOC"
        }
      ],
      "boundaries": [
        "san pham la cap org (khong co branch_id); pham vi chi nhanh chi gate gia rieng theo chi nhanh",
        "SKU duy nhat trong org (UNIQUE org_id, sku); ma san pham duy nhat trong org; barcode duy nhat trong org neu co",
        "khong co endpoint DELETE san pham / bien the; ngung kinh doanh giu lai san pham + lich su",
        "anh chi la metadata/duong dan, khong co endpoint upload file that"
      ],
      "prohibited": [
        "khong duoc ghi de lang le khi trung SKU/ma/barcode",
        "khong duoc them endpoint DELETE (xoa cung) san pham hoac bien the",
        "khong duoc them endpoint upload file anh that",
        "khong duoc gan branch_id cho bang products"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-2",
      "text": "Gia theo kenh/chi nhanh + lich su gia (AC-2): bang product_prices (variant NULL = ap cho ca san pham, channel trong danh muc cho phep, branch NULL = moi chi nhanh), API dat/xem gia rieng, gia hieu dung theo fallback 8 buoc kem source, doi gia bat buoc reason, price_history append-only",
      "requirementIds": [
        "R-6",
        "R-7"
      ],
      "examples": [
        {
          "input": "dat gia rieng kenh+chi nhanh, kenh, chi nhanh roi hoi gia hieu dung tung to hop",
          "expected": "GET /api/products/:id/price?channel=web&branch_id=2 tra gia hieu dung dung thu tu fallback kem truong source"
        },
        {
          "input": "PATCH gia san pham 2 lan roi GET /api/products/:id/price-history",
          "expected": "doi gia chuan 2 lan -> price_history co 2 dong (old->new, ai, luc nao, ly do)"
        },
        {
          "input": "POST /api/products/:id/prices thieu reason, kenh la; PATCH/DELETE price-history",
          "expected": "doi gia thieu reason bi 400; kenh la bi 400; goi sua/xoa lich su gia bi 404/405"
        }
      ],
      "boundaries": [
        "gia luu so nguyen dong (D10), khong float; gia am hoac khong nguyen -> 400",
        "fallback 8 buoc theo docs/PRICING.md; khong co gia rieng -> gia chuan",
        "doi gia bat buoc co reason (thieu -> 400); gia moi trung gia hien tai -> 400",
        "price_history chi INSERT, khong co API UPDATE/DELETE"
      ],
      "prohibited": [
        "khong duoc luu gia bang float",
        "khong duoc doi gia khong ghi lich su hoac khong co ly do",
        "khong duoc cho API sua/xoa lich su gia",
        "khong duoc tao 2 dong product_prices cho cung mot to hop (variant/channel/branch)"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-3",
      "text": "CSV preview/import/export (AC-3): preview dry-run bao loi tung dong (so dong + ly do), import atomic toan bo hoac khong (1 dong loi -> 422, 0 dong duoc ghi), export CSV dung du lieu hien tai cua org (loc theo org/status/category), round-trip export->preview khop",
      "requirementIds": [
        "R-8",
        "R-9",
        "R-10"
      ],
      "examples": [
        {
          "input": "POST /api/products/import/preview voi file CSV co dong thieu name + dong gia am",
          "expected": "preview file co 2 dong loi tra errors [{line, reason}] cho ca 2 dong va khong ghi dong nao"
        },
        {
          "input": "POST /api/products/import voi file co 1 dong loi trong 3 dong",
          "expected": "import file co 1 dong loi tra 422, so san pham truoc/sau bang nhau (0 dong duoc ghi)"
        },
        {
          "input": "POST /api/products/import file sach roi GET /api/products/export",
          "expected": "import file sach tra 201 {imported: n}; export tra CSV khop du lieu hien tai, loc theo org/status"
        },
        {
          "input": "lay file export dem preview lai",
          "expected": "export -> import preview bao trung ma voi DB (round-trip khop du lieu)"
        }
      ],
      "boundaries": [
        "CSV import chi nhap san pham goc (1 dong = 1 san pham); bien the chi tao qua API",
        "preview la dry-run, khong ghi dong nao; import atomic: 1 dong loi -> 0 dong duoc ghi",
        "gioi han 1000 dong/file (vuot -> 400); header thieu cot bat buoc -> 400 toan file",
        "export chi du lieu org nguoi goi; org rong van tra header + 0 dong"
      ],
      "prohibited": [
        "khong duoc fail-fast o dong loi dau tien (phai bao het moi dong loi)",
        "khong duoc ghi mot phan khi import co dong loi",
        "khong duoc nhap bien the qua CSV trong goal nay",
        "khong duoc de export lan du lieu org khac"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-4",
      "text": "RBAC + audit + checks mo rong xanh (AC-4): mo rong can() voi 8 actions moi theo ma tran san pham/gia/CSV (vai sai -> 403, ngoai org -> 403, sai chi nhanh gia rieng -> 403), audit_log tao/sua/doi gia/import CSV, test 403 theo ma tran, du lieu gia lap, check.sh/demo.sh mo rong buoc san pham/gia/CSV va giu cac buoc GOAL-001/GOAL-002 xanh, docs RBAC/PRICING/D15/D16, khong co workflow CI/VPS",
      "requirementIds": [
        "R-11",
        "R-12",
        "R-13",
        "R-14",
        "R-15",
        "R-16"
      ],
      "examples": [
        {
          "input": "goi tung endpoint cam theo tung vai sai",
          "expected": "sales doi gia bi 403; warehouse tao san pham bi 403; sales ngung kinh doanh bi 403; sales import CSV bi 403"
        },
        {
          "input": "GET price-history + GET/PATCH product theo tung vai/org",
          "expected": "accountant xem lich su gia duoc, warehouse bi 403; user org A doc/sua san pham org B bi 403"
        },
        {
          "input": "thuc hien cac thao tac roi doc bang audit_log / GET /api/audit-log",
          "expected": "sau tao/sua/doi gia/import CSV, audit_log co ban ghi voi actor, created_at, action, detail target_product_id + before/after"
        },
        {
          "input": "./scripts/check.sh; ./scripts/demo.sh",
          "expected": "./scripts/check.sh exit 0 va ./scripts/demo.sh in PASS tung buoc, gom buoc san pham/gia/CSV moi"
        },
        {
          "input": "./scripts/check.sh buoc secret-scan",
          "expected": "grep khong thay credential that trong code (tru placeholder/fixture gia)"
        }
      ],
      "boundaries": [
        "test moi them vao file test moi, KHONG sua 38 test da khoa cua GOAL-001/GOAL-002",
        "du lieu test la gia lap (2 org, 2 chi nhanh tro len trong cung org)",
        "gia rieng theo chi nhanh: user chi nhanh A khong xem/duoc gia chi nhanh B"
      ],
      "prohibited": [
        "khong duoc sua 38 test da khoa cua GOAL-001/GOAL-002",
        "khong duoc commit bi mat/credential that",
        "khong duoc claim CI/VPS/deploy khi chua co",
        "khong duoc de endpoint san pham/gia/CSV nao bo qua kiem tra vai + pham vi"
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
    "GOAL-002"
  ],
  "priority": 3
}
```
