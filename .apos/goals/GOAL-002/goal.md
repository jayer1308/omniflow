# GOAL-002 v1: OmniFlow RBAC: 5 vai owner/manager/sales/warehouse/accountant voi ma tran quyen vai x thao tac x pham vi (docs/RBAC.md); moi/khoa/thu hoi nhan vien, khoa vo hieu session ngay, thu hoi la cuoi cung; doi vai/pham vi/mat khau theo ma tran; quan ly chi nhanh; audit_log thao tac nhay cam co API/trang xem trong org; test 403 ngoai org/ngoai branch/sai vai; check/demo mo rong buoc RBAC van xanh

Status: closed

```json
{
  "id": "GOAL-002",
  "version": 1,
  "outcome": "OmniFlow RBAC: 5 vai owner/manager/sales/warehouse/accountant voi ma tran quyen vai x thao tac x pham vi (docs/RBAC.md); moi/khoa/thu hoi nhan vien, khoa vo hieu session ngay, thu hoi la cuoi cung; doi vai/pham vi/mat khau theo ma tran; quan ly chi nhanh; audit_log thao tac nhay cam co API/trang xem trong org; test 403 ngoai org/ngoai branch/sai vai; check/demo mo rong buoc RBAC van xanh",
  "source": {
    "path": "brief-002.md",
    "sha256": "80ffd1962165af883a9369d51284a397497cfb86d2d1341698d4171cd01fdeb8",
    "capturedAt": "2026-11-26T15:21:19.140Z",
    "origin": "PM subagent (coordinator)"
  },
  "requirements": [
    {
      "id": "R-1",
      "sourceSpan": "dòng 80",
      "text": "Migration 007 mở rộng users.role CHECK sang 5 vai ('owner','manager','sales','warehouse','accountant') và remap mọi row staff hiện có thành sales. Seed đổi user nhân viên thành vai sales (giữ email staff@example.local, giữ 2 user). Migration chạy tuần tự sau 001–006, giữ dữ liệu cũ, không vỡ 17 test đã khóa.",
      "disposition": "acceptance"
    },
    {
      "id": "R-2",
      "sourceSpan": "dòng 85",
      "text": "Migration 007 thêm users.status CHECK ('active','locked','revoked') mặc định 'active'; đổi users.branch_id thành nullable (NULL = toàn org); thêm users.warehouse_id INTEGER NULL (không FK, không kiểm tra tồn tại kho). Mọi user mới mặc định active.",
      "disposition": "acceptance"
    },
    {
      "id": "R-3",
      "sourceSpan": "dòng 90",
      "text": "Ma trận quyền trong docs/RBAC.md (đầy đủ từng ô) + helper phân quyền can() ở tầng service (src/rbac.ts, test được trực tiếp không qua HTTP) + middleware requireRole/requireScope trong app. Vai sai thao tác → 403; đúng vai sai phạm vi → 403; ngoài org → 403. Không query nghiệp vụ nào bỏ qua kiểm tra vai + phạm vi.",
      "disposition": "acceptance"
    },
    {
      "id": "R-4",
      "sourceSpan": "dòng 95",
      "text": "Mời nhân viên: owner/manager tạo tài khoản mới trong org của mình qua API, gán vai + branch_id/warehouse_id trong phạm vi của mình. Validate: email đúng định dạng và chưa tồn tại (trùng → 409); vai hợp lệ; manager không được mời owner/manager (→ 403); chi nhánh được gán phải thuộc org của người mời (→ 403 nếu ngoài org). Mật khẩu ban đầu do người mời cấp trong request (demo/test lấy từ biến môi trường, sinh ngẫu nhiên), chỉ lưu bcrypt hash, không lưu/ghi log mật khẩu dạng plain text, không trả mật khẩu trong response. Mọi lần mời đều ghi audit log.",
      "disposition": "acceptance"
    },
    {
      "id": "R-5",
      "sourceSpan": "dòng 104",
      "text": "Khóa nhân viên: API khóa/mở khóa. Tài khoản bị khóa đăng nhập bị từ chối rõ ràng: POST /login trả 403 với lỗi phân biệt được với sai mật khẩu (401). Session đang chạy bị vô hiệu NGAY: khi khóa phải xóa mọi session của user đó, VÀ lookupSession phải kiểm tra status (chỉ active mới có session hợp lệ). Mở khóa chỉ owner/manager theo ma trận; không được khóa chính mình; mỗi org luôn còn ít nhất 1 owner đang active (khóa/thu hồi/đổi vai chủ cuối cùng → 400/403).",
      "disposition": "acceptance"
    },
    {
      "id": "R-6",
      "sourceSpan": "dòng 112",
      "text": "Thu hồi: API thu hồi đặt status='revoked', xóa mọi session của user đó; sau thu hồi mọi đăng nhập và mọi thao tác đều bị chặn (login → 403, API → 401/403). Thu hồi là cuối cùng, không có API mở lại revoked (muốn vào lại phải mời mới). Không DELETE row user. Ghi audit log.",
      "disposition": "acceptance"
    },
    {
      "id": "R-7",
      "sourceSpan": "dòng 117",
      "text": "Đổi vai / đổi phạm vi / đổi mật khẩu người khác: API riêng cho từng thao tác. Chỉ owner được đổi vai; manager chỉ đổi phạm vi cho vai cấp dưới và phạm vi mới phải nằm trong phạm vi của mình; đổi mật khẩu người khác theo ma trận. Đổi mật khẩu của mình: mọi vai active được đổi, phải nhập đúng mật khẩu hiện tại. Mọi lần đổi đều ghi audit log (không ghi mật khẩu/hash vào log).",
      "disposition": "acceptance"
    },
    {
      "id": "R-8",
      "sourceSpan": "dòng 124",
      "text": "Quản lý chi nhánh + danh sách nhân viên: owner tạo chi nhánh mới trong org của mình (POST /api/branches, tên bắt buộc, manager và các vai khác → 403). GET /api/users liệt kê nhân viên: owner thấy toàn org, manager chỉ thấy user trong phạm vi của mình, các vai khác → 403 (chỉ xem hồ sơ của mình qua /me).",
      "disposition": "acceptance"
    },
    {
      "id": "R-9",
      "sourceSpan": "dòng 129",
      "text": "Nhật ký thao tác nhạy cảm (audit_log đã có từ GOAL-001): ghi MỌI thao tác mời, khóa, mở khóa, thu hồi, đổi vai, đổi phạm vi, đổi mật khẩu người khác, tạo chi nhánh. Mỗi bản ghi có: ai làm (user_id người thực hiện), lúc nào (created_at), thay đổi gì (action + detail JSON ghi rõ đối tượng target_user_id và before/after, KHÔNG chứa mật khẩu/hash). Có API xem log (GET /api/audit-log) + trang đơn giản liệt kê log (EJS sẵn có): owner xem toàn org, manager chỉ xem bản ghi liên quan user trong phạm vi của mình + bản ghi do mình thực hiện, các vai khác → 403.",
      "disposition": "acceptance"
    },
    {
      "id": "R-10",
      "sourceSpan": "dòng 137",
      "text": "Test chặn truy cập ngoài phạm vi: test (vitest + supertest, thêm vào test mới — KHÔNG sửa 17 test đã khóa) chứng minh: user org A truy cập dữ liệu / thao tác trên org B → 403; user đúng vai nhưng ngoài branch_id được cấp → 403; vai sai thao tác → 403 (mời/khóa/thu hồi/đổi vai/xem log/xem danh sách/tạo chi nhánh); tài khoản bị khóa dùng session cũ → 401/403; tài khoản bị thu hồi đăng nhập lại → 403. Test cả qua HTTP và trực tiếp helper can() ở tầng service (nếu helper tồn tại). Test dùng dữ liệu giả lập (2 org, 2 chi nhánh trở lên trong cùng org).",
      "disposition": "acceptance"
    },
    {
      "id": "R-11",
      "sourceSpan": "dòng 145",
      "text": "Dữ liệu GIẢ LẬP hoàn toàn; mật khẩu seed/mời qua biến môi trường (như GOAL-001: OMNIFLOW_SEED_*_PASSWORD, mật khẩu mời sinh ngẫu nhiên hoặc cấp qua env trong demo/test), không commit credential thật; check.sh vẫn quét secret (grep như GOAL-001).",
      "disposition": "acceptance"
    },
    {
      "id": "R-12",
      "sourceSpan": "dòng 149",
      "text": "scripts/check.sh (CHK-1) và scripts/demo.sh (CHK-2) được MỞ RỘNG trong goal này: thêm bước RBAC vào smoke/demo (mời → đăng nhập vai mới → khóa → session cũ bị chặn → xem audit log → truy cập ngoài phạm vi bị 403), giữ tất cả bước GOAL-001 xanh (health, login, owner-only, idempotency, backup/restore). Cả 2 script tự chạy được, tự dọn dẹp, in PASS/FAIL từng bước.",
      "disposition": "acceptance"
    },
    {
      "id": "R-13",
      "sourceSpan": "dòng 155",
      "text": "Docs: docs/RBAC.md mới (ma trận quyền đầy đủ + mô hình phạm vi + ví dụ request/response cho mời/khóa/thu hồi/xem log); docs/DECISIONS.md thêm D13 (mô hình phạm vi branch_id nullable + warehouse_id chuẩn bị) và D14 (email duy nhất toàn hệ thống, trạng thái 3 giá trị, remap staff → sales); README.md/docs/SETUP.md cập nhật endpoint và vai mới, khớp lệnh đã chạy thật.",
      "disposition": "acceptance"
    },
    {
      "id": "R-14",
      "sourceSpan": "dòng 161",
      "text": "Không có file .github/workflows/ trong repo (gh token thiếu scope workflow — CI là follow-up sau khi user cấp scope). Không claim VPS, không claim deploy production (local-only, D9).",
      "disposition": "acceptance"
    },
    {
      "id": "R-15",
      "sourceSpan": "dòng 167",
      "text": "Nghiệp vụ sản phẩm/giá/CSV (GOAL-003), kho đa kho + tồn giữ/có thể bán (GOAL-004 — lúc đó mới có bảng warehouses thật và FK cho warehouse_id), đơn hàng (GOAL-005), thanh toán/hoàn tiền (GOAL-006).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Ngoài phạm vi GOAL-002 theo brief"
    },
    {
      "id": "R-16",
      "sourceSpan": "dòng 170",
      "text": "Adapter thanh toán/vận chuyển/email thật — chỉ dùng fake đã có (GOAL-006/007/011 gắn adapter thật sau nếu có).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Ngoài phạm vi GOAL-002 theo brief"
    },
    {
      "id": "R-17",
      "sourceSpan": "dòng 172",
      "text": "Đa chi nhánh cho 1 user (bảng user_scopes), quên mật khẩu / đặt lại mật khẩu qua email, bắt buộc đổi mật khẩu lần đầu, đăng nhập SSO/OAuth — là follow-up, không làm trong goal này.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Ngoài phạm vi GOAL-002 theo brief"
    },
    {
      "id": "R-18",
      "sourceSpan": "dòng 175",
      "text": "Deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user cấp scope workflow).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Ngoài phạm vi GOAL-002 theo brief"
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
    "brief-002.md",
    "goal-002.json",
    ".gitignore"
  ],
  "exclusions": [
    "Nghiep vu san pham/gia/CSV (GOAL-003), kho da kho (GOAL-004), don hang (GOAL-005), thanh toan/hoan tien (GOAL-006)",
    "Tich hop cong thanh toan/van chuyen/email that — chi fake",
    "Da chi nhanh cho 1 user (bang user_scopes), quen mat khau / dat lai mat khau qua email, bat buoc doi mat khau lan dau, SSO/OAuth",
    "Deploy production/VPS (ngoai pham vi, local-only), CI workflow (cho user cap scope workflow)"
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "5 vai + ma tran quyen (AC-1): migration 007 mo rong role CHECK sang 5 vai (staff cu remap thanh sales), them status active/locked/revoked + branch_id nullable + warehouse_id chuan bi, helper can() + middleware requireRole/requireScope, docs/RBAC.md day du",
      "requirementIds": [
        "R-1",
        "R-2",
        "R-3",
        "R-13"
      ],
      "examples": [
        {
          "input": "mo DB moi, chay migration 001-007 roi seed",
          "expected": "migration 007 tao CHECK role 5 vai; row staff cu thanh sales; seed van 2 user"
        },
        {
          "input": "doc schema bang users sau migration 007",
          "expected": "user co status locked/revoked, branch_id NULL = toan org, warehouse_id NULL mac dinh"
        },
        {
          "input": "dang nhap sales roi goi POST /api/users/invite; doc docs/RBAC.md",
          "expected": "sales goi thao tac chi danh cho owner/manager bi 403; docs/RBAC.md co du ma tran vai x thao tac x pham vi"
        }
      ],
      "boundaries": [
        "chi 5 vai owner/manager/sales/warehouse/accountant, vai staff cu duoc remap thanh sales",
        "phu vi 1 chi nhanh hoac toan org (branch_id NULL); 1 user khong duoc cap 2 chi nhanh tro len trong goal nay",
        "warehouse_id chi la truong pham vi chuan bi, khong co bang warehouses that, khong co nghiep vu kho"
      ],
      "prohibited": [
        "khong duoc giu vai staff trong CHECK sau migration",
        "khong duoc them bang user_scopes trong goal nay",
        "khong duoc query nghiep vu ma khong qua kiem tra vai + pham vi"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-2",
      "text": "Moi/khoa/thu hoi + doi vai/pham vi/mat khau (AC-2): owner/manager moi nhan vien theo ma tran, khoa vo hieu session ngay lap tuc, thu hoi la cuoi cung, doi vai/doi pham vi/doi mat khau theo ma tran, owner tao chi nhanh, danh sach nhan vien loc theo pham vi",
      "requirementIds": [
        "R-4",
        "R-5",
        "R-6",
        "R-7",
        "R-8"
      ],
      "examples": [
        {
          "input": "POST /api/users/invite {email moi, role sales, branch_id trong org}",
          "expected": "owner moi sales moi vao chi nhanh cua minh duoc 201/tao user, dang nhap duoc bang mat khau ban dau"
        },
        {
          "input": "POST /api/users/invite voi vai/branch khong duoc phep",
          "expected": "manager moi owner hoac manager bi 403; moi email trung bi 409; moi vao chi nhanh org khac bi 403"
        },
        {
          "input": "POST /api/users/:id/lock roi login + goi /me bang session cu",
          "expected": "sau khi khoa, POST /login tra 403 phan biet voi 401 sai mat khau; session cu goi /me bi 401; mo khoa xong dang nhap lai duoc"
        },
        {
          "input": "POST /api/users/:id/revoke roi login + goi API",
          "expected": "sau khi thu hoi, login tra 403, moi API tra 401/403, row user van con trong DB"
        },
        {
          "input": "POST /api/branches + GET /api/users theo tung vai",
          "expected": "owner tao chi nhanh moi duoc; manager tao chi nhanh bi 403; GET /api/users cua manager chi tra user trong pham vi"
        }
      ],
      "boundaries": [
        "moi/khoa/thu hoi chi trong org cua nguoi thuc hien; manager chi duoc moi/khoa/thu hoi vai cap duoi trong pham vi cua minh",
        "chi owner duoc doi vai; khong duoc khoa/thu hoi chinh minh; moi org luon con it nhat 1 owner active",
        "thu hoi la cuoi cung, khong co API mo lai revoked; khong DELETE row user"
      ],
      "prohibited": [
        "khong duoc luu/ghi log mat khau dang plain text, khong tra mat khau trong response",
        "khong duoc de session cua user bi khoa tiep tuc dung duoc",
        "khong duoc de manager tu nang quyen thanh owner/manager",
        "khong duoc khoa/thu hoi chu duy nhat con lai cua org"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-3",
      "text": "Nhat ky thao tac nhay cam (AC-3): moi thao tac moi/khoa/thu hoi/doi vai/doi pham vi/doi mat khau/tao chi nhanh deu ghi audit_log (ai/luc nao/thay doi gi), co API + trang xem log chi trong org/pham vi cua minh",
      "requirementIds": [
        "R-9"
      ],
      "examples": [
        {
          "input": "moi 1 user roi khoa user do, doc bang audit_log",
          "expected": "sau khi moi + khoa 1 user, audit_log co it nhat 2 ban ghi voi actor, created_at, action, detail before/after"
        },
        {
          "input": "GET /api/audit-log theo tung vai",
          "expected": "owner GET /api/audit-log thay toan org; sales GET /api/audit-log bi 403"
        },
        {
          "input": "manager GET /api/audit-log khi co ban ghi cua user chi nhanh khac",
          "expected": "manager khong thay ban ghi log cua user ngoai pham vi cua minh"
        }
      ],
      "boundaries": [
        "chi ghi thao tac nhay cam (moi/khoa/mo khoa/thu hoi/doi vai/doi pham vi/doi mat khau nguoi khac/tao chi nhanh)",
        "detail JSON co target_user_id + before/after, KHONG chua mat khau/hash",
        "manager chi xem log lien quan user trong pham vi + log do minh thuc hien"
      ],
      "prohibited": [
        "khong duoc bo sot thao tac nhay cam khong ghi log",
        "khong duoc ghi mat khau hoac hash vao audit_log",
        "khong duoc de vai khac xem log ngoai org/pham vi cua minh"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-4",
      "text": "Chan truy cap ngoai pham vi + checks mo rong xanh (AC-4): test 403 cho ngoai org, ngoai branch, sai vai (qua HTTP + truc tiep helper can()), du lieu gia lap, check.sh/demo.sh mo rong buoc RBAC va giu cac buoc GOAL-001 xanh, khong co workflow CI/VPS",
      "requirementIds": [
        "R-10",
        "R-11",
        "R-12",
        "R-14"
      ],
      "examples": [
        {
          "input": "test HTTP: user org A goi API voi orgId/branch cua org B",
          "expected": "user org A truy cap du lieu/thao tac org B bi 403"
        },
        {
          "input": "test HTTP + truc tiep helper can() voi to hop vai/pham vi sai",
          "expected": "user dung vai nhung ngoai branch_id duoc cap bi 403; vai sai thao tac bi 403"
        },
        {
          "input": "./scripts/check.sh; ./scripts/demo.sh",
          "expected": "./scripts/check.sh exit 0 va ./scripts/demo.sh in PASS tung buoc, gom buoc RBAC moi (moi -> khoa -> session cu bi chan -> audit log -> 403 ngoai pham vi)"
        },
        {
          "input": "./scripts/check.sh buoc secret-scan",
          "expected": "grep khong thay credential that trong code (tru placeholder/fixture gia)"
        }
      ],
      "boundaries": [
        "test moi them vao file test moi, KHONG sua 17 test da khoa cua GOAL-001",
        "du lieu test la gia lap (2 org, 2 chi nhanh tro len trong cung org)",
        "o kho cua ma tran chi la dinh huong cho GOAL-003/004/005/006, khong test qua HTTP trong goal nay"
      ],
      "prohibited": [
        "khong duoc sua 17 test da khoa cua GOAL-001",
        "khong duoc commit bi mat/credential that",
        "khong duoc claim CI/VPS/deploy khi chua co"
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
    "GOAL-001"
  ],
  "priority": 2
}
```
