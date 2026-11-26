# GOAL-001: mức bảo đảm

```
BẢO ĐẢM THẤP: repo chưa có test nền (app.L1, app.L2, app.L3)
GOAL-001  setup v1
  Tiêu chí           6   máy chứng minh 6 · anh xác nhận tay 0
  Test đã khoá       L2 15 · L3 2
  Kiểm kê / phạm vi  bật
  Lớp khâu submit    WP-MAIN: L0 tsc ✓ · L1 vitest ✓ · L2 vitest-acceptance ✓
  Lớp khâu đóng      L0 tsc ✓ · L1 vitest ✓ · L2 vitest-acceptance ✓ · L3 vitest-integration ✓
  Ngoại lệ           needs-human WP-MAIN (agent:coordinator): tsconfig.json moi la can thiet cho L0 tsc --noEmit: repo luc dau chua co tsconfig, Worker tao moi de typecheck; chi khai strict + include src, khong sua cau hinh bao mat; tests-infra WP-MAIN (agent:coordinator): tsconfig.json moi thuoc ha tang test (L0 chay tsc theo tsconfig); noi dung chi khai strict + include src, khong lam yeu test
  Agent duyệt thay   2 chỗ: needs-human WP-MAIN (agent:coordinator); tests-infra WP-MAIN (agent:coordinator)
  Chỉ có mã thoát    app.L0.tsc
  Giới hạn           xác nhận Human chỉ chống duyệt nhầm, chưa phải ranh giới bảo mật; --by agent:<x> là tự khai; APOS chứng minh code đạt tiêu chí đã duyệt, không chứng minh tiêu chí hay bộ test là đủ (README.md, mục "What the evidence does not prove")
```
