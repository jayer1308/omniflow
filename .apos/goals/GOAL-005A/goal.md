# GOAL-005A v2: OmniFlow adopt yeu cau mo coi R-19 (GOAL-004): 3 luong tu dong theo vong doi don — xac nhan giu hang nguyen tu, huy giai phong dung so da giu, hoan tat release + out trong 1 transaction — duoc kiem chung lai bang test khoa moi tren code GOAL-005 da co (khong them tinh nang); check/demo van xanh; docs ghi chu goal bookkeeping ngoai 12 goal chinh; inbox sach sau close

Status: testing

```json
{
  "id": "GOAL-005A",
  "version": 2,
  "outcome": "OmniFlow adopt yeu cau mo coi R-19 (GOAL-004): 3 luong tu dong theo vong doi don — xac nhan giu hang nguyen tu, huy giai phong dung so da giu, hoan tat release + out trong 1 transaction — duoc kiem chung lai bang test khoa moi tren code GOAL-005 da co (khong them tinh nang); check/demo van xanh; docs ghi chu goal bookkeeping ngoai 12 goal chinh; inbox sach sau close",
  "source": {
    "path": "brief-005a.md",
    "sha256": "aaabc3ca1558c1858e3a32fcebc9c7b74c9c5c032dad97b902aae38ce39792c5",
    "capturedAt": "2026-11-26T21:07:47.244Z",
    "origin": "human"
  },
  "requirements": [
    {
      "id": "R-19",
      "sourceSpan": "dòng 65",
      "adopts": {
        "sourceSha256": "a83e40111118d17ac74d1e1049134daca6958f7e46aa5126a7cf8b22f3884579",
        "requirementId": "R-19"
      },
      "text": "Đơn hàng (GOAL-005): không có luồng giữ hàng tự động khi tạo đơn, không có commit giữ hàng → xuất kho khi giao hàng, không có giải phóng giữ hàng tự động khi hủy đơn — các API reserve/release ở goal này là thao tác trực tiếp, GOAL-005 sẽ gọi chúng.",
      "disposition": "acceptance"
    },
    {
      "id": "R-1",
      "sourceSpan": "dòng 70",
      "text": "Test khóa mới (vitest + supertest, thêm vào file test MỚI — KHÔNG sửa test đã khóa của GOAL-001..005, KHÔNG sửa code nghiệp vụ trừ khi test mới phơi ra lỗi thì sửa tối thiểu trong src/orders.ts / src/stock.ts và ghi rõ): chứng minh xác nhận đơn giữ đủ mọi dòng (reserved tăng đúng, on_hand không đổi) và thiếu tồn → 400 insufficient_stock, không giữ dòng nào, đơn ở lại draft; hoàn tất đơn đã giữ → reserved về 0, on_hand trừ đúng, available cuối đúng, có đủ 2 movement release + out cùng reference mã đơn; hủy đơn khi đang xử lý → reserved về 0, on_hand không đổi, available về như trước khi xác nhận; hủy từ draft chỉ đổi trạng thái, không động kho. Test dùng dữ liệu giả lập (2 org, 2 kho trở lên trong cùng org, 2 biến thể trở lên).",
      "disposition": "acceptance"
    },
    {
      "id": "R-2",
      "sourceSpan": "dòng 84",
      "text": "scripts/check.sh (CHK-1) và scripts/demo.sh (CHK-2) vẫn xanh sau goal; các bước GOAL-001..005 giữ nguyên xanh. Được mở rộng tối thiểu nếu cần (ví dụ thêm một bước demo chạy lại vòng đời đơn tạo → xác nhận → xử lý → hoàn tất / hủy), không bắt buộc.",
      "disposition": "acceptance"
    },
    {
      "id": "R-3",
      "sourceSpan": "dòng 88",
      "text": "Docs: docs/ROADMAP.md ghi chú GOAL-005A là goal bookkeeping ngoài 12 goal chính (adopt R-19 mồ côi của GOAL-004, không thêm tính năng); docs/DECISIONS.md thêm D21 ghi chú adopt R-19 + xác nhận 3 luồng đã có từ GOAL-005 (không quyết định kiến trúc mới); README.md/docs/SETUP.md cập nhật nếu có gì đổi (không đổi thì ghi rõ không đổi). Dữ liệu GIẢ LẬP hoàn toàn; không commit credential thật; check.sh vẫn quét secret. Không có file .github/workflows/ trong repo (CI chờ user cấp scope workflow). Không claim VPS, không claim deploy production (local-only, D9).",
      "disposition": "acceptance"
    },
    {
      "id": "R-4",
      "sourceSpan": "dòng 100",
      "text": "Mọi tính năng mới trên đơn/kho: không endpoint mới, không migration mới, không thay đổi state machine, snapshot giá, idempotency hay chống bán quá tồn (đã có ở GOAL-005).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Không có tính năng mới trong goal bookkeeping này — chỉ adopt + kiểm chứng hành vi đã có"
    },
    {
      "id": "R-5",
      "sourceSpan": "dòng 103",
      "text": "Thanh toán/hoàn tiền (GOAL-006), giao hàng/trả hàng (GOAL-007), khách hàng + CRM (GOAL-008), khuyến mãi (GOAL-009), báo cáo/đối soát (GOAL-010), thông báo (GOAL-011), UI tổng quan (GOAL-012).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Thuộc GOAL-006..012, không làm trong GOAL-005A"
    },
    {
      "id": "R-6",
      "sourceSpan": "dòng 106",
      "text": "Deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user cấp scope workflow).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Ngoài phạm vi, local-only; CI chờ user cấp scope workflow"
    }
  ],
  "scope": [
    "docs/",
    "src/",
    "scripts/",
    "tests/",
    "README.md",
    "brief-005a.md",
    "goal-005a.json",
    ".gitignore"
  ],
  "exclusions": [
    "Mọi tính năng mới trên đơn/kho: không endpoint mới, không migration mới, không thay đổi state machine, snapshot giá, idempotency hay chống bán quá tồn (đã có ở GOAL-005).",
    "Thanh toán/hoàn tiền (GOAL-006), giao hàng/trả hàng (GOAL-007), khách hàng + CRM (GOAL-008), khuyến mãi (GOAL-009), báo cáo/đối soát (GOAL-010), thông báo (GOAL-011), UI tổng quan (GOAL-012).",
    "Deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user cấp scope workflow)."
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Adopt R-19 + kiem chung 3 luong tu dong theo vong doi don (AC-1): xac nhan don tu dong giu hang nguyen tu moi dong (thieu ton -> 400, khong giu dong nao); huy don tu confirmed/processing tu dong giai phong dung so da giu; hoan tat don tu dong release + out trong 1 transaction (on_hand giam dung, reserved ve 0); tao don van o draft, khong giu hang — hanh vi da co tu GOAL-005 (src/orders.ts transitionOrderTx + src/stock.ts applyMovement), goal nay chi adopt va kiem chung, khong them tinh nang",
      "requirementIds": [
        "R-19"
      ],
      "examples": [
        {
          "input": "POST /api/orders/:id/confirm du/thieu ton (test moi)",
          "expected": "xac nhan don giu 10: reserved 10, on_hand khong doi; thieu ton -> 400 insufficient_stock, reserved khong doi, don o lai draft"
        },
        {
          "input": "confirm -> process -> complete, doc stock_levels + stock_movements (test moi)",
          "expected": "hoan tat don da giu 10: reserved ve 0, on_hand tru 10, available cuoi dung; 2 movement release + out cung reference ma don"
        },
        {
          "input": "huy don tu processing va tu draft (test moi)",
          "expected": "xac nhan giu 10 -> xu ly -> huy -> reserved ve 0, on_hand khong doi, available ve nhu truoc khi xac nhan; huy tu draft chi doi trang thai"
        }
      ],
      "boundaries": [
        "tao don o draft, KHONG giu hang, KHONG tru kho (da co GOAL-005; goal nay chi kiem chung, khong sua luong tao don)",
        "xac nhan giu hang nguyen tu moi dong trong 1 transaction BEGIN IMMEDIATE; dong nao thieu ton -> 400 insufficient_stock, khong giu dong nao, don o lai draft",
        "hoan tat = release + out trong CUNG MOT transaction, KHONG them loai movement moi",
        "huy tu confirmed/processing giai phong dung so da giu; huy tu draft chi doi trang thai, khong dong kho"
      ],
      "prohibited": [
        "khong duoc them endpoint moi, migration moi, hay doi state machine don",
        "khong duoc hoan tat bang 1 movement out duy nhat (se de reserved treo)",
        "khong duoc de xac nhan giu duoc mot nua khi dong sau thieu ton",
        "khong duoc de huy don khong giai phong hang da giu"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ],
      "proof": "stays-green"
    },
    {
      "id": "AC-2",
      "text": "Test khoa moi + checks xanh + docs bookkeeping (AC-2): test moi chung minh 3 luong AC-1 (xanh ngay tren code hien co neu code da dung, hoac do truoc/xanh sau neu test phoi ra loi can sua toi thieu); check.sh/demo.sh van xanh, giu cac buoc GOAL-001..005 xanh; docs ROADMAP ghi chu GOAL-005A ngoai 12 goal chinh + DECISIONS D21 ghi adopt R-19; inbox sach sau close",
      "requirementIds": [
        "R-1",
        "R-2",
        "R-3"
      ],
      "examples": [
        {
          "input": "them file test moi, chay vitest",
          "expected": "file test moi (vd tests/orders-005a-acceptance.test.ts) chua test 3 luong AC-1, chay xanh; khong co test da khoa nao bi sua"
        },
        {
          "input": "./scripts/check.sh; ./scripts/demo.sh",
          "expected": "./scripts/check.sh exit 0 va ./scripts/demo.sh in PASS tung buoc, gom cac buoc GOAL-001..005"
        },
        {
          "input": "doc ROADMAP/DECISIONS sau goal; apos inbox sau close",
          "expected": "docs/ROADMAP.md ghi chu GOAL-005A ngoai 12 goal chinh; docs/DECISIONS.md co D21 ghi adopt R-19; inbox sach sau khi goal close"
        }
      ],
      "boundaries": [
        "test moi them vao file test moi, KHONG sua test da khoa cua GOAL-001..005",
        "du lieu test la gia lap (2 org, 2 kho tro len trong cung org, 2 bien the tro len)",
        "RBAC don KHONG doi: khong sua src/rbac.ts hay ma tran don GOAL-005",
        "docs chi ghi chu goal bookkeeping ngoai 12 goal chinh, khong claim tinh nang moi"
      ],
      "prohibited": [
        "khong duoc sua test da khoa cua GOAL-001..005",
        "khong duoc commit bi mat/credential that",
        "khong duoc claim CI/VPS/deploy khi chua co",
        "khong duoc sua ma tran RBAC don hay src/rbac.ts"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ],
      "proof": "stays-green"
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
    "GOAL-004",
    "GOAL-005"
  ],
  "priority": 3
}
```
