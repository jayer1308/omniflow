# GOAL-003: mức bảo đảm

```
GOAL-003  setup v2
  Tiêu chí           4   máy chứng minh 4 · anh xác nhận tay 0
  Test đã khoá       L2 45
  Kiểm kê / phạm vi  bật
  Lớp khâu submit    WP-MAIN: L0 tsc ✓ · L1 vitest ✓ · L2 vitest-acceptance ✓
  Lớp khâu đóng      L0 tsc ✓ · L1 vitest ✓ · L2 vitest-acceptance ✓ · L3 vitest-integration ✓
  Ngoại lệ           needs-human WP-MAIN (agent:lead): Them dependency csv-parse/csv-stringify (parse CSV: BOM, dau phay trong ten, dong trong — theo rui ro brief R-8/R-9) + multer (multipart file upload cho import/preview) + @types/multer (dev); chi thay package.json/package-lock.json, khong doi logic ngoai pham vi goal
  Agent duyệt thay   1 chỗ: needs-human WP-MAIN (agent:lead)
  Chỉ có mã thoát    app.L0.tsc
  Giới hạn           xác nhận Human chỉ chống duyệt nhầm, chưa phải ranh giới bảo mật; --by agent:<x> là tự khai; APOS chứng minh code đạt tiêu chí đã duyệt, không chứng minh tiêu chí hay bộ test là đủ (README.md, mục "What the evidence does not prove")
```
