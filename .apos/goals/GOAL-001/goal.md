# GOAL-001 v2: OmniFlow nền tảng: repo + APOS setup approved; khung Express+SQLite chạy được (health, migration, seed giả lập); auth session + bcrypt với 2 vai nền; đa tenant + idempotency ở mức khung; adapter fake payment/shipping/email; docs vận hành + backup/restore; check/demo xanh

Status: verified

```json
{
  "id": "GOAL-001",
  "version": 2,
  "outcome": "OmniFlow nền tảng: repo + APOS setup approved; khung Express+SQLite chạy được (health, migration, seed giả lập); auth session + bcrypt với 2 vai nền; đa tenant + idempotency ở mức khung; adapter fake payment/shipping/email; docs vận hành + backup/restore; check/demo xanh",
  "source": {
    "path": "brief-001.md",
    "sha256": "9dac8187fa4b9104c132bfc757a9445438701b81232a182d1dde5b9ab7bb4860",
    "capturedAt": "2026-11-26T14:52:31.659Z",
    "origin": "human"
  },
  "requirements": [
    {
      "id": "R-1",
      "sourceSpan": "dòng 15",
      "text": "Repo public jayer1308/omniflow, branch main, git identity local jayer1308 <m813082003@gmail.com>.",
      "disposition": "acceptance"
    },
    {
      "id": "R-2",
      "sourceSpan": "dòng 17",
      "text": "apos init trong repo: .apos/project.yaml, role skills, managed block trong AGENTS.md.",
      "disposition": "acceptance"
    },
    {
      "id": "R-3",
      "sourceSpan": "dòng 19",
      "text": "Setup APOS: setup draft với stack typescript, sửa nếu cần, commit, setup probe pass, rồi approve bằng quyền Human delegate cho OmniFlow.",
      "disposition": "acceptance"
    },
    {
      "id": "R-4",
      "sourceSpan": "dòng 21",
      "text": "App khởi động được: npm install rồi npm start chạy server; endpoint GET /health trả {\"status\":\"ok\"}.",
      "disposition": "acceptance"
    },
    {
      "id": "R-5",
      "sourceSpan": "dòng 23",
      "text": "Migration chạy theo thứ tự, tạo đủ bảng: orgs, branches, users, sessions, audit_log, idempotency_keys. Mọi bảng nghiệp vụ có org_id.",
      "disposition": "acceptance"
    },
    {
      "id": "R-6",
      "sourceSpan": "dòng 25",
      "text": "Seed dữ liệu GIẢ LẬP tối thiểu: 1 doanh nghiệp, 1 chi nhánh, 1 tài khoản chủ doanh nghiệp + 1 nhân viên. Mật khẩu cấp qua biến môi trường/script seed, không commit mật khẩu thật.",
      "disposition": "acceptance"
    },
    {
      "id": "R-7",
      "sourceSpan": "dòng 28",
      "text": "Auth: đăng nhập/đăng xuất bằng session + bcrypt; sai mật khẩu bị từ chối; session hết hạn thì phải đăng nhập lại.",
      "disposition": "acceptance"
    },
    {
      "id": "R-8",
      "sourceSpan": "dòng 30",
      "text": "Hai vai cơ bản ở mức nền: chủ doanh nghiệp (owner) và nhân viên (staff); route chỉ dành cho owner thì staff bị chặn (401/403), có test chứng minh. RBAC đầy đủ 5 vai là GOAL-002.",
      "disposition": "acceptance"
    },
    {
      "id": "R-9",
      "sourceSpan": "dòng 33",
      "text": "Đa tenant ở mức khung: middleware gắn org_id/branch_id của user đang đăng nhập vào request; mọi query nghiệp vụ qua scope này; truy cập dữ liệu ngoài org bị từ chối, có test chứng minh.",
      "disposition": "acceptance"
    },
    {
      "id": "R-10",
      "sourceSpan": "dòng 36",
      "text": "Adapter interface cho thanh toán, vận chuyển, email (src/adapters/) với bản fake xác định (deterministic) chạy local, trả kết quả giả lập rõ ràng là giả lập. Không kết nối cổng thật.",
      "disposition": "acceptance"
    },
    {
      "id": "R-11",
      "sourceSpan": "dòng 39",
      "text": "Idempotency: helper + bảng idempotency_keys (key duy nhất); gửi lại cùng key trả kết quả đã lưu, không thực thi lại. Có test chứng minh.",
      "disposition": "acceptance"
    },
    {
      "id": "R-12",
      "sourceSpan": "dòng 41",
      "text": "Docs: README.md + docs/SETUP.md (cài đặt, chạy local, chạy test, sao lưu/khôi phục); script sao lưu tạo file backup, khôi phục từ file backup đưa dữ liệu về đúng trạng thái, có test/script chứng minh.",
      "disposition": "acceptance"
    },
    {
      "id": "R-13",
      "sourceSpan": "dòng 44",
      "text": "scripts/check.sh (CHK-1) và scripts/demo.sh (CHK-2) tự chạy được: tự build, tự chạy test, tự start/stop server trên port riêng, dọn dẹp sau khi chạy; in PASS/FAIL từng bước; không dựa vào server/DB chạy sẵn.",
      "disposition": "acceptance"
    },
    {
      "id": "R-14",
      "sourceSpan": "dòng 47",
      "text": "docs/ROADMAP.md và docs/DECISIONS.md có mặt trong repo, ghi đúng các quyết định D1–D10.",
      "disposition": "acceptance"
    },
    {
      "id": "R-15",
      "sourceSpan": "dòng 49",
      "text": "Không có file .github/workflows/ trong repo lúc đầu (gh token thiếu scope workflow — CI là follow-up sau khi user cấp scope). Không claim VPS, không claim deploy production.",
      "disposition": "acceptance"
    },
    {
      "id": "R-16",
      "sourceSpan": "dòng 51",
      "text": "Không commit bí mật/credential: check.sh kiểm tra bằng grep các mẫu thường gặp (password/token/secret trong code, trừ placeholder và test fixture ghi rõ là giả).",
      "disposition": "acceptance"
    },
    {
      "id": "R-17",
      "sourceSpan": "dòng 55",
      "text": "Nghiệp vụ sản phẩm/giá/CSV (GOAL-003), kho (GOAL-004), đơn hàng (GOAL-005).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Ngoài phạm vi GOAL-001 theo brief"
    },
    {
      "id": "R-18",
      "sourceSpan": "dòng 56",
      "text": "RBAC đầy đủ 5 vai, mời/khóa/thu hồi nhân viên, phân quyền theo chi nhánh/kho (GOAL-002).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Ngoài phạm vi GOAL-001 theo brief"
    },
    {
      "id": "R-19",
      "sourceSpan": "dòng 57",
      "text": "Tích hợp cổng thanh toán/vận chuyển/email thật — chỉ dùng fake (GOAL-006/007/011 gắn adapter thật sau nếu có).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Ngoài phạm vi GOAL-001 theo brief"
    },
    {
      "id": "R-20",
      "sourceSpan": "dòng 58",
      "text": "Deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user cấp scope workflow).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Ngoài phạm vi GOAL-001 theo brief"
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
    "brief-001.md",
    "goal-001.json",
    ".gitignore"
  ],
  "exclusions": [
    "Nghiệp vụ sản phẩm/giá/CSV (GOAL-003), kho (GOAL-004), đơn hàng (GOAL-005)",
    "RBAC đầy đủ 5 vai, mời/khóa/thu hồi nhân viên (GOAL-002)",
    "Tích hợp cổng thanh toán/vận chuyển/email thật — chỉ fake",
    "Deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user cấp scope workflow)"
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Khung app chạy được (AC-1): npm start khởi động server, GET /health trả ok, migration tạo đủ bảng, seed giả lập tối thiểu chạy được",
      "requirementIds": [
        "R-4",
        "R-5",
        "R-6"
      ],
      "examples": [
        {
          "input": "khởi động server trên port riêng rồi curl /health",
          "expected": "npm start chạy server, GET /health trả {\"status\":\"ok\"}"
        },
        {
          "input": "mở DB sqlite mới rồi chạy migration",
          "expected": "migration tạo đủ 6 bảng orgs/branches/users/sessions/audit_log/idempotency_keys"
        },
        {
          "input": "chạy npm run seed rồi đăng nhập",
          "expected": "seed tạo 1 org + 1 branch + 2 user, đăng nhập được bằng tài khoản seed"
        }
      ],
      "boundaries": [
        "chỉ khung app chạy được, chưa có nghiệp vụ sản phẩm/kho/đơn",
        "seed chỉ có org/branch/user, không seed sản phẩm hay đơn hàng"
      ],
      "prohibited": [
        "không được claim app chạy khi chưa chạy thật npm start",
        "không được seed dữ liệu thật của khách hàng"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-2",
      "text": "Auth + 2 vai nền (AC-2): session + bcrypt, đăng nhập/đăng xuất đúng, staff bị chặn ở route owner-only",
      "requirementIds": [
        "R-7",
        "R-8"
      ],
      "examples": [
        {
          "input": "POST /login đúng/sai mật khẩu",
          "expected": "đăng nhập đúng mật khẩu được session, sai mật khẩu bị từ chối"
        },
        {
          "input": "đăng nhập staff rồi gọi route owner-only",
          "expected": "staff gọi route chỉ dành cho owner bị 401/403"
        },
        {
          "input": "logout rồi gọi lại API với cookie cũ",
          "expected": "đăng xuất xong session cũ không dùng được nữa"
        }
      ],
      "boundaries": [
        "chỉ 2 vai owner/staff ở mức nền, RBAC đầy đủ 5 vai là GOAL-002",
        "mật khẩu seed cấp ngoài repo, không commit mật khẩu thật"
      ],
      "prohibited": [
        "không được lưu mật khẩu dạng plain text",
        "không được để staff vượt quyền owner"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-3",
      "text": "Đa tenant + idempotency ở mức khung (AC-3): middleware scope org/branch, truy cập ngoài org bị từ chối, gửi lại cùng key không thực thi lại",
      "requirementIds": [
        "R-9",
        "R-11"
      ],
      "examples": [
        {
          "input": "test scope: tạo 2 org, user org A truy cập resource org B",
          "expected": "user org A query dữ liệu org B bị từ chối"
        },
        {
          "input": "test idempotency: gọi 2 lần cùng key rồi đếm số lần thực thi",
          "expected": "gửi lại cùng idempotency key trả kết quả cũ, chỉ thực thi một lần"
        }
      ],
      "boundaries": [
        "đa tenant ở mức khung: scope + test từ chối truy cập ngoài org",
        "quản trị org/branch đầy đủ là GOAL-002"
      ],
      "prohibited": [
        "không được query nghiệp vụ mà không qua scope org",
        "không được thực thi lại khi trùng idempotency key"
      ],
      "checkIds": [
        "CHK-1"
      ]
    },
    {
      "id": "AC-4",
      "text": "Adapter fake (AC-4): interface payment/shipping/email + bản fake xác định chạy local",
      "requirementIds": [
        "R-10"
      ],
      "examples": [
        {
          "input": "gọi adapter thanh toán fake 2 lần cùng input",
          "expected": "fake payment adapter trả kết quả giả lập xác định cho cùng input"
        },
        {
          "input": "đọc src/adapters/ + test interface",
          "expected": "fake shipping/email adapter có interface giống adapter thật sẽ gắn sau"
        }
      ],
      "boundaries": [
        "chỉ bản fake, không kết nối cổng thật",
        "kết quả fake phải ghi rõ là giả lập"
      ],
      "prohibited": [
        "không được kết nối cổng thanh toán/vận chuyển/email thật",
        "không được dùng tiền thật hay dữ liệu thật"
      ],
      "checkIds": [
        "CHK-1"
      ]
    },
    {
      "id": "AC-5",
      "text": "Docs + sao lưu/khôi phục + không lộ bí mật (AC-5): README + SETUP.md đúng lệnh thật, backup/restore chạy được, không commit credential",
      "requirementIds": [
        "R-12",
        "R-16"
      ],
      "examples": [
        {
          "input": "backup → xóa/sửa dữ liệu → restore → so sánh",
          "expected": "script backup tạo file, restore từ file đưa dữ liệu về đúng trạng thái"
        },
        {
          "input": "./scripts/check.sh bước secret-scan",
          "expected": "grep không thấy credential thật trong code (trừ placeholder/fixture giả)"
        }
      ],
      "boundaries": [
        "docs phải khớp lệnh đã chạy thật",
        "không claim VPS/deploy/CI khi chưa có"
      ],
      "prohibited": [
        "không được commit bí mật/credential thật",
        "không được ghi docs sai với lệnh thực tế"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-6",
      "text": "APOS setup + scripts + docs (AC-6): apos init + setup probe pass + approved, check.sh/demo.sh tự chạy xanh, ROADMAP/DECISIONS có mặt",
      "requirementIds": [
        "R-1",
        "R-2",
        "R-3",
        "R-13",
        "R-14",
        "R-15"
      ],
      "examples": [
        {
          "input": "./scripts/check.sh",
          "expected": "./scripts/check.sh exit 0"
        },
        {
          "input": "./scripts/demo.sh",
          "expected": "./scripts/demo.sh in PASS từng bước"
        },
        {
          "input": "đọc 2 file docs",
          "expected": "docs/ROADMAP.md và docs/DECISIONS.md có mặt với đủ nội dung"
        }
      ],
      "boundaries": [
        "setup probe phải pass trước khi approve",
        "không đưa file workflow CI vào repo lúc đầu (thiếu scope workflow)"
      ],
      "prohibited": [
        "không được skip im lặng khi toolchain thiếu",
        "không được claim CI/VPS khi chưa có"
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
  "dependencies": [],
  "priority": 1
}
```
