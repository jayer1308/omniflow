# OmniFlow — brief GOAL-005A: Adopt yêu cầu mồ côi R-19 (luồng giữ/xuất/giải phóng tự động theo vòng đời đơn)

## Bối cảnh (vấn đề)

`apos inbox` có 1 notice `orphan-requirement`: yêu cầu R-19 của GOAL-004
(source `brief-004.md`, sha256
`a83e40111118d17ac74d1e1049134daca6958f7e46aa5126a7cf8b22f3884579`) đã
defer sang GOAL-005 nhưng `goal-005.json` không khai adopts, nên GOAL-005
đóng mà APOS chưa merge R-19. GOAL-004 và GOAL-005 đều đã closed, vì vậy
cách xử lý theo notice là một Goal mới adopt R-19. GOAL-005A là Goal đó:
một Goal NHỎ, ngoài 12 Goal chính của roadmap (`docs/ROADMAP.md`),
chỉ để adopt về mặt sổ sách + kiểm chứng lại luồng mà R-19 mô tả.

R-19 nguyên văn (GOAL-004, disposition excluded/deferred to GOAL-005;
`brief-004.md` dòng 329):

> Đơn hàng (GOAL-005): không có luồng giữ hàng tự động khi tạo đơn, không
> có commit giữ hàng → xuất kho khi giao hàng, không có giải phóng giữ hàng
> tự động khi hủy đơn — các API reserve/release ở goal này là thao tác trực
> tiếp, GOAL-005 sẽ gọi chúng.

## Điểm xuất phát (hành vi đã có — KHÔNG thêm tính năng mới)

Hành vi R-19 mô tả ĐÃ được GOAL-005 implement đầy đủ và khóa test
(38 test đơn trong `tests/orders-acceptance.test.ts`). Goal này chỉ adopt
+ kiểm chứng lại bằng test khóa mới, không viết lại nghiệp vụ:

- Tạo đơn (`POST /api/orders`, `src/orders.ts` `createOrderTx`): đơn mới ở
  `draft`, KHÔNG giữ hàng, KHÔNG trừ kho.
- Xác nhận đơn (`POST /api/orders/:id/confirm`,
  `transitionOrderTx`): giữ hàng nguyên tử mọi dòng bằng `applyMovement`
  loại `reserve` (`reference` = mã đơn, `reason` = "giữ hàng cho đơn
  `<mã>`") trong 1 transaction `BEGIN IMMEDIATE`; dòng nào thiếu tồn →
  400 `insufficient_stock`, không giữ dòng nào, đơn ở lại `draft`.
- Hủy đơn (`POST /api/orders/:id/cancel`): hủy từ `confirmed`/`processing`
  giải phóng đúng số đã giữ bằng `applyMovement` loại `release` cùng
  transaction đổi trạng thái; hủy từ `draft` chỉ đổi trạng thái.
- Hoàn tất đơn (`POST /api/orders/:id/complete`): mỗi dòng `release` rồi
  `out` trong CÙNG MỘT transaction (vì `out` yêu cầu `qty <= available`
  và KHÔNG trừ `reserved` — D17); không thêm loại movement mới.
- Số học tồn (`src/stock.ts` `applyMovement`): `available = on_hand -
  reserved`, ép bằng CHECK ở DB (`on_hand >= 0`, `reserved >= 0`,
  `reserved <= on_hand`).

## Kết quả mong muốn

Cuối goal, R-19 được APOS ghi nhận là đã adopt (inbox sạch sau khi goal
close), và có một file test khóa mới chứng minh lại cả 3 luồng tự động
(xác nhận → giữ, hoàn tất → giải phóng + xuất, hủy → giải phóng) trên
code hiện có, với `check.sh`/`demo.sh` vẫn xanh. Không có hành vi mới
nào, không endpoint mới, không migration mới.

## Ma trận quyền (không đổi)

Dùng lại nguyên ma trận đơn của GOAL-005 (`brief-005.md`, `docs/RBAC.md`):
tạo/xác nhận/hủy đơn — owner, manager được; sales được đúng chi nhánh
của mình; warehouse, accountant không (403). Xử lý/hoàn tất đơn — owner,
manager được; warehouse được chỉ đơn có `warehouse_id` trong phạm vi của
mình; sales, accountant không (403). Xem đơn — owner/manager/accountant
toàn org (accountant chỉ xem); sales chỉ chi nhánh mình; warehouse chỉ
kho trong phạm vi. Goal này KHÔNG sửa `src/rbac.ts` hay ma trận.

## Yêu cầu

1. Adopt R-19: yêu cầu R-19 (nguyên văn ở trên, nguồn `brief-004.md`
   sha256 `a83e40111118d17ac74d1e1049134daca6958f7e46aa5126a7cf8b22f3884579`)
   được adopt trong Goal này với disposition acceptance; `goal-005a.json`
   khai `adopts` đúng source + requirement id đó. Sau khi tạo goal,
   `goal show GOAL-005A` phải hiển thị R-19 đã adopt đúng nguồn.
2. Test khóa mới (vitest + supertest, thêm vào file test MỚI —
   KHÔNG sửa test đã khóa của GOAL-001..005, KHÔNG sửa code nghiệp vụ
   trừ khi test mới phơi ra lỗi thì sửa tối thiểu trong `src/orders.ts` /
   `src/stock.ts` và ghi rõ): chứng minh xác nhận đơn giữ đủ mọi dòng
   (reserved tăng đúng, on_hand không đổi) và thiếu tồn → 400
   `insufficient_stock`, không giữ dòng nào, đơn ở lại draft; hoàn tất
   đơn đã giữ → reserved về 0, on_hand trừ đúng, available cuối đúng,
   có đủ 2 movement release + out cùng reference mã đơn; hủy đơn khi
   đang xử lý → reserved về 0, on_hand không đổi, available về như trước
   khi xác nhận; hủy từ draft chỉ đổi trạng thái, không động kho. Test
   dùng dữ liệu giả lập (2 org, 2 kho trở lên trong cùng org, 2 biến thể
   trở lên). Test mới phải đỏ trước khi có code sửa (nếu có sửa) và xanh
   sau — nếu code hiện có đã đúng thì test mới xanh ngay trên code hiện
   có (ghi rõ điều này trong báo cáo verify, không bịa lỗi để sửa).
3. `scripts/check.sh` (CHK-1) và `scripts/demo.sh` (CHK-2) vẫn xanh sau
   goal; các bước GOAL-001..005 giữ nguyên xanh. Được mở rộng tối thiểu
   nếu cần (ví dụ thêm một bước demo chạy lại vòng đời đơn
   tạo → xác nhận → xử lý → hoàn tất / hủy), không bắt buộc.
4. Docs: `docs/ROADMAP.md` ghi chú GOAL-005A là goal bookkeeping ngoài
   12 goal chính (adopt R-19 mồ côi của GOAL-004, không thêm tính năng);
   `docs/DECISIONS.md` thêm D21 ghi chú adopt R-19 + xác nhận 3 luồng
   đã có từ GOAL-005 (không quyết định kiến trúc mới);
   `README.md`/`docs/SETUP.md` cập nhật nếu có gì đổi (không đổi thì
   ghi rõ không đổi). Dữ liệu GIẢ LẬP hoàn toàn; không commit credential
   thật; `check.sh` vẫn quét secret. Không có file
   `.github/workflows/` trong repo (CI chờ user cấp scope `workflow`).
   Không claim VPS, không claim deploy production (local-only, D9).

## Ngoài phạm vi (không làm trong GOAL-005A)

5. Mọi tính năng mới trên đơn/kho: không endpoint mới, không migration
   mới, không thay đổi state machine, snapshot giá, idempotency hay
   chống bán quá tồn (đã có ở GOAL-005).
6. Thanh toán/hoàn tiền (GOAL-006), giao hàng/trả hàng (GOAL-007), khách
   hàng + CRM (GOAL-008), khuyến mãi (GOAL-009), báo cáo/đối soát
   (GOAL-010), thông báo (GOAL-011), UI tổng quan (GOAL-012).
7. Deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ
   user cấp scope `workflow`).

## Rationale: 1 package Solo, 2 tiêu chí

Goal này là Solo WP-MAIN: chỉ một package duy nhất, vì toàn bộ công việc
là test + docs (+ sửa tối thiểu nếu test phơi lỗi) trên code đã có, không
có gì để tách. Viết 2 tiêu chí AC-1 (hành vi 3 luồng) và AC-2 (test +
checks + docs) — cả 2 cùng thuộc WP-MAIN, tránh bài học Lead dead-end
khi một tiêu chí thuộc 2 package (mỗi tiêu chí ở đây chỉ thuộc đúng một
package duy nhất là WP-MAIN).

## Đề xuất appetite

Size S, appetite 120 phút, 2 lần thử (Human delegate duyệt ở gate A).
Đặt dư một chút so với công việc test + docs vì APOS tính wall-clock từ
lúc select — bài học DRAK GOAL-002.

## Lưu ý về inbox

Notice orphan R-19 chỉ sạch sau khi GOAL-005A close (APOS merge R-19 khi
goal adopt đóng). Ngay sau `goal create`, `inbox` VẪN còn notice — đó là
trạng thái đúng, không phải lỗi.
