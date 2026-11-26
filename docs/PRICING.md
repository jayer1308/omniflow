# OmniFlow — Quy tắc giá (GOAL-003)

Giá lưu bằng **số nguyên đồng** (D10), không dùng float. Giá bán chuẩn là cột
`products.price`. Giá riêng theo kênh/chi nhánh ở bảng `product_prices`
(`product_id`, `variant_id` NULL = áp cho cả sản phẩm, `channel` NULL = áp
cho mọi kênh, `branch_id` NULL = áp cho mọi chi nhánh, `price` số nguyên
đồng >= 0).

## Kênh bán cho phép

Chỉ 3 kênh: `counter` (tại quầy), `web`, `api`. Kênh lạ → **400**.
Danh sách này chốt ở D15; thêm kênh mới là quyết định riêng (Goal sau).

## Fallback 8 bước

`GET /api/products/:id/price?channel=...&branch_id=...&variant_id=...` trả
giá bán hiệu dụng kèm trường `source` nêu rõ mức giá nào đã áp dụng. Thứ tự:

| Bước | Điều kiện | `source` |
|---|---|---|
| 1 | Giá riêng của biến thể theo kênh + chi nhánh | `variant_channel_branch` |
| 2 | Giá riêng của biến thể theo kênh | `variant_channel` |
| 3 | Giá riêng của biến thể theo chi nhánh | `variant_branch` |
| 4 | Giá riêng của sản phẩm theo kênh + chi nhánh | `channel_branch` |
| 5 | Giá riêng của sản phẩm theo kênh | `channel` |
| 6 | Giá riêng của sản phẩm theo chi nhánh | `branch` |
| 7 | Giá override của biến thể (`price_override`) | `variant_override` |
| 8 | Giá bán chuẩn của sản phẩm (`products.price`) | `base` |

Không có giá riêng nào → giá chuẩn (bước 8).

Ví dụ: sản phẩm giá chuẩn 100.000đ, biến thể có `price_override` 90.000đ,
giá riêng sản phẩm theo kênh `web` là 95.000đ, giá riêng biến thể theo kênh
`web` + chi nhánh 2 là 80.000đ.

- Hỏi `channel=web&branch_id=2&variant_id=<biến thể>` → 80.000đ
  (`variant_channel_branch`, bước 1).
- Hỏi `channel=web&branch_id=1&variant_id=<biến thể>` → bước 1–4 đều không
  có (không có giá biến thể theo kênh/chi nhánh, không có giá sản phẩm
  `web` + chi nhánh 1), bước 5 (sản phẩm theo kênh `web`) có → 95.000đ
  (`channel`).
- Hỏi `channel=counter&variant_id=<biến thể>` (không chi nhánh) → bước 7:
  90.000đ (`variant_override`).
- Hỏi không kèm biến thể, `channel=counter` → 100.000đ (`base`).

## Đặt giá riêng

`POST /api/products/:id/prices` với `{variant_id?, channel?, branch_id?,
price, reason}`:

- `reason` bắt buộc (thiếu → 400).
- Phải ghi rõ kênh hoặc chi nhánh (hoặc cả hai); không ghi cả hai → 400.
- Giá phải là số nguyên đồng >= 0 (âm hoặc không nguyên → 400).
- Một tổ hợp (biến thể/kênh/chi nhánh) chỉ có **một dòng giá**: đặt lại
  cùng tổ hợp thì **ghi đè** mức cũ (UPDATE, không tạo dòng trùng) và ghi
  lịch sử. Lưu ý kỹ thuật: `UNIQUE(org_id, product_id, variant_id, channel,
  branch_id)` trên SQLite KHÔNG chặn trùng khi có NULL ở `variant_id`/
  `channel`/`branch_id` (SQLite coi NULL khác nhau), nên service kiểm tra
  trùng bằng SELECT trước khi INSERT trong cùng transaction.
- Đổi giá chuẩn (`PATCH /api/products/:id` đổi `price`) cũng phải kèm
  `reason` (thiếu → 400) và cũng ghi lịch sử.

## Đổi giá trùng giá hiện tại → 400

Đổi giá mà giá mới bằng giá hiện tại (giá chuẩn, giá riêng, override biến
thể) thì bị từ chối **400** `"Giá mới trùng giá hiện tại"` để tránh log rác
trong lịch sử giá. Muốn ghi chú mà không đổi giá thì không có thao tác riêng
— giá không đổi thì không ghi lịch sử.

## Lịch sử giá append-only

Bảng `price_history` chỉ INSERT, không có API UPDATE/DELETE (gọi sửa/xóa →
404/405). Mỗi lần đổi giá (chuẩn, riêng, override biến thể) ghi một dòng:
`product_id`, `variant_id` (NULL = cả sản phẩm), `scope` (`base` /
`variant_override` / `channel` / `branch` / `channel_branch`), `channel`,
`branch_id`, `old_price` (NULL = chưa từng có giá), `new_price`,
`changed_by` (ai đổi), `reason` (lý do bắt buộc), `created_at` (UTC).
`GET /api/products/:id/price-history` trả mới nhất trước. Xem lịch sử:
`owner`/`manager`/`accountant` được; `sales`/`warehouse` → 403.

## CSV và giá

- CSV import chỉ nhập **sản phẩm gốc** (một dòng = một sản phẩm, có giá
  chuẩn `price`); biến thể và giá riêng chỉ tạo qua API, không nhập qua CSV.
- Cột `barcode` trong CSV được chấp nhận nhưng **không tạo biến thể** nên
  giá trị này không được lưu (xem D16).
- Cột `category` trong CSV là tên danh mục: chưa có thì import **tự tạo**
  danh mục đó trong org (D15).
- Export CSV ghi giá chuẩn (`price`) của từng sản phẩm; giá riêng không nằm
  trong file export (xem lại qua `GET /api/products/:id/prices`).
