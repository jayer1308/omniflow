# WP-MAIN v1: OmniFlow RBAC: 5 vai owner/manager/sales/warehouse/accountant voi ma tran quyen vai x thao tac x pham vi (docs/RBAC.md); moi/khoa/thu hoi nhan vien, khoa vo hieu session ngay, thu hoi la cuoi cung; doi vai/pham vi/mat khau theo ma tran; quan ly chi nhanh; audit_log thao tac nhay cam co API/trang xem trong org; test 403 ngoai org/ngoai branch/sai vai; check/demo mo rong buoc RBAC van xanh

```json
{
  "id": "WP-MAIN",
  "goalId": "GOAL-002",
  "goalVersion": 1,
  "version": 1,
  "owner": "lead",
  "outcome": "OmniFlow RBAC: 5 vai owner/manager/sales/warehouse/accountant voi ma tran quyen vai x thao tac x pham vi (docs/RBAC.md); moi/khoa/thu hoi nhan vien, khoa vo hieu session ngay, thu hoi la cuoi cung; doi vai/pham vi/mat khau theo ma tran; quan ly chi nhanh; audit_log thao tac nhay cam co API/trang xem trong org; test 403 ngoai org/ngoai branch/sai vai; check/demo mo rong buoc RBAC van xanh",
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
  "dependencies": [],
  "interfaces": [
    "GOAL-002@v1"
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "5 vai + ma tran quyen (AC-1): migration 007 mo rong role CHECK sang 5 vai (staff cu remap thanh sales), them status active/locked/revoked + branch_id nullable + warehouse_id chuan bi, helper can() + middleware requireRole/requireScope, docs/RBAC.md day du",
      "goalAcceptanceId": "AC-1",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-2",
      "text": "Moi/khoa/thu hoi + doi vai/pham vi/mat khau (AC-2): owner/manager moi nhan vien theo ma tran, khoa vo hieu session ngay lap tuc, thu hoi la cuoi cung, doi vai/doi pham vi/doi mat khau theo ma tran, owner tao chi nhanh, danh sach nhan vien loc theo pham vi",
      "goalAcceptanceId": "AC-2",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-3",
      "text": "Nhat ky thao tac nhay cam (AC-3): moi thao tac moi/khoa/thu hoi/doi vai/doi pham vi/doi mat khau/tao chi nhanh deu ghi audit_log (ai/luc nao/thay doi gi), co API + trang xem log chi trong org/pham vi cua minh",
      "goalAcceptanceId": "AC-3",
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-4",
      "text": "Chan truy cap ngoai pham vi + checks mo rong xanh (AC-4): test 403 cho ngoai org, ngoai branch, sai vai (qua HTTP + truc tiep helper can()), du lieu gia lap, check.sh/demo.sh mo rong buoc RBAC va giu cac buoc GOAL-001 xanh, khong co workflow CI/VPS",
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
    "views/**",
    "public/**",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vitest.config.*",
    "README.md",
    "docs/**",
    ".gitignore"
  ],
  "stubPaths": [
    "src/rbac.ts",
    "src/app.ts",
    "src/db.ts",
    "src/auth.ts",
    "src/seed.ts",
    "src/tenant.ts"
  ]
}
```
