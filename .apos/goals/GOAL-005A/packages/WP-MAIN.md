# WP-MAIN v1: OmniFlow adopt yeu cau mo coi R-19 (GOAL-004): 3 luong tu dong theo vong doi don — xac nhan giu hang nguyen tu, huy giai phong dung so da giu, hoan tat release + out trong 1 transaction — duoc kiem chung lai bang test khoa moi tren code GOAL-005 da co (khong them tinh nang); check/demo van xanh; docs ghi chu goal bookkeeping ngoai 12 goal chinh; inbox sach sau close

```json
{
  "id": "WP-MAIN",
  "goalId": "GOAL-005A",
  "goalVersion": 1,
  "version": 1,
  "owner": "lead",
  "outcome": "OmniFlow adopt yeu cau mo coi R-19 (GOAL-004): 3 luong tu dong theo vong doi don — xac nhan giu hang nguyen tu, huy giai phong dung so da giu, hoan tat release + out trong 1 transaction — duoc kiem chung lai bang test khoa moi tren code GOAL-005 da co (khong them tinh nang); check/demo van xanh; docs ghi chu goal bookkeeping ngoai 12 goal chinh; inbox sach sau close",
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
  "dependencies": [],
  "interfaces": [
    "GOAL-005A@v1"
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Adopt R-19 + kiem chung 3 luong tu dong theo vong doi don (AC-1): xac nhan don tu dong giu hang nguyen tu moi dong (thieu ton -> 400, khong giu dong nao); huy don tu confirmed/processing tu dong giai phong dung so da giu; hoan tat don tu dong release + out trong 1 transaction (on_hand giam dung, reserved ve 0); tao don van o draft, khong giu hang — hanh vi da co tu GOAL-005 (src/orders.ts transitionOrderTx + src/stock.ts applyMovement), goal nay chi adopt va kiem chung, khong them tinh nang",
      "goalAcceptanceId": "AC-1",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-2",
      "text": "Test khoa moi + checks xanh + docs bookkeeping (AC-2): test moi chung minh 3 luong AC-1 (xanh ngay tren code hien co neu code da dung, hoac do truoc/xanh sau neu test phoi ra loi can sua toi thieu); check.sh/demo.sh van xanh, giu cac buoc GOAL-001..005 xanh; docs ROADMAP ghi chu GOAL-005A ngoai 12 goal chinh + DECISIONS D21 ghi adopt R-19; inbox sach sau close",
      "goalAcceptanceId": "AC-2",
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
    ".gitignore"
  ],
  "stubPaths": [
    "src/orders.ts",
    "src/stock.ts",
    "src/app.ts"
  ]
}
```
