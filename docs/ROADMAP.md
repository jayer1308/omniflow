# OmniFlow — Roadmap

Dự án dài hạn, kiểm tra APOS ở quy mô lớn. Mỗi giai đoạn là 1 Goal APOS riêng,
duyệt/select/close qua quy trình APOS thật. Mọi Goal dùng dữ liệu GIẢ LẬP;
không tiền thật, không tài khoản thanh toán thật, không dịch vụ trả phí.

Quy ước đặt tên: GOAL-001..GOAL-012 dưới đây. Appetite mặc định M/480/3 cho mỗi Goal
(trừ khi ghi khác) — đặt dư cho thời gian chờ phê duyệt vì APOS tính wall-clock từ lúc select.

## Giai đoạn

| Goal | Tên | Phụ thuộc | Giá trị bàn giao |
|---|---|---|---|
| GOAL-001 | Nền tảng (M) | — | Repo + APOS setup approved; khung Express+SQLite chạy được; auth + 2 vai nền; đa tenant ở mức khung; adapter fake (payment/shipping/email); docs vận hành; seed giả lập tối thiểu |
| GOAL-002 | Doanh nghiệp, chi nhánh, người dùng + RBAC (M) | 001 | Mời/khóa/thu hồi nhân viên; 5 vai (chủ, quản lý, bán hàng, kho, kế toán); phân quyền theo thao tác + phạm vi chi nhánh/kho; nhật ký thao tác nhạy cảm; test truy cập ngoài phạm vi |
| GOAL-003 | Sản phẩm, giá, CSV (M) | 001 | Sản phẩm + biến thể + SKU + mã vạch; giá theo kênh/chi nhánh + lịch sử giá; import/export CSV có kiểm tra từng dòng + xem trước; không trùng SKU trong doanh nghiệp |
| GOAL-004 | Kho đa kho + tồn giữ/có thể bán (L) | 001, 003 | Nhiều kho; nhập/xuất/điều chỉnh/kiểm kê/chuyển kho; tồn thực tế / tồn giữ / tồn có thể bán; lịch sử biến động; cảnh báo tồn thấp; chống race + idempotency; chính sách tồn âm |
| GOAL-005 | Đơn hàng đa kênh + vòng đời (L) | 003, 004 | Tạo đơn tại quầy + API; vòng đời nháp → xác nhận → xử lý → hoàn tất/hủy; giữ/giải phóng hàng + xuất kho theo vòng đời; chống xử lý lặp; tìm kiếm/lọc/phân trang + lịch sử đơn; test đồng thời + hủy khi đang xử lý |
| GOAL-006 | Thanh toán + hoàn tiền (M) | 005 | Tiền mặt + chuyển khoản; adapter cổng thanh toán (fake local); trạng thái yêu cầu/đã trả/thất bại/hoàn tiền; webhook trễ/lặp/sai thứ tự; không ghi nhận 2 lần; đối soát + lịch sử giao dịch; không lưu thông tin thẻ |
| GOAL-007 | Giao hàng + trả hàng (M) | 005, 006 | Yêu cầu giao + gán đơn vị vận chuyển (adapter fake); cập nhật giao hàng lặp/sai thứ tự; trả hàng duyệt/từ chối, nhận hàng trả, hoàn tiền; phân biệt hàng bán lại được vs hàng hỏng; đối chiếu đơn/thanh toán/kho sau trả |
| GOAL-008 | Khách hàng + CRM (M) | 005 | Hồ sơ + địa chỉ + lịch sử đơn; hợp nhất hồ sơ trùng (có xác nhận); ghi chú + lịch sử chăm sóc; chính sách truy cập/xuất/xóa dữ liệu cá nhân; không đưa PII nhạy cảm vào log |
| GOAL-009 | Khuyến mãi (M) | 003, 005 | Mã giảm giá + chương trình theo điều kiện; giới hạn thời gian/số lần/sản phẩm/kênh; thứ tự khi nhiều khuyến mãi; chống vượt giới hạn đồng thời; bằng chứng giá + khuyến mãi tại thời điểm đặt đơn |
| GOAL-010 | Báo cáo + đối soát (M) | 005, 006, 007 | Doanh thu/số đơn/hoàn tiền/sản phẩm bán chạy theo thời gian; báo cáo tồn + biến động + cảnh báo; đối soát đơn–thanh toán–hoàn tiền–giao hàng; định nghĩa chỉ số + múi giờ + cách xử lý đơn hủy/trả; xuất CSV; test đối chiếu dữ liệu mẫu đã biết |
| GOAL-011 | Thông báo + công việc nền (M) | 005 | Thông báo đơn mới/tồn thấp/giao thất bại; adapter email fake local; retry có giới hạn + theo dõi lỗi + tránh gửi trùng; kiểm tra/xử lý job nền thất bại |
| GOAL-012 | UI tổng quan + polish + vận hành (M) | 002–011 | Màn hình tổng quan/sản phẩm/kho/đơn/khách/báo cáo; trạng thái tải/rỗng/lỗi/xác nhận; dùng được bằng bàn phím cho luồng chính; dữ liệu mẫu + hướng dẫn tự trải nghiệm; docs API + migration + sao lưu/khôi phục + nâng cấp dependency |

## Ghi chú

- Local-only: dự án chỉ làm local. Không có VPS, không deploy production trong phạm vi này.
  Không hỏi thêm về VPS.
- CI (GitHub Actions): gh token jayer1308 THIẾU scope `workflow` nên push chứa
  `.github/workflows/*.yml` sẽ bị từ chối. Vì vậy repo KHÔNG có file workflow lúc đầu;
  CI là follow-up sau khi user cấp scope (ghi rõ trong DECISIONS.md D8).
- Mỗi Goal: brief + goal.json riêng, checks tự chạy được (`scripts/check.sh`, `scripts/demo.sh`),
  gate xanh mới verified; Human (được ủy quyền cho Muse trong dự án OmniFlow) duyệt/select/close.
- Nguồn sự thật trạng thái: đơn hàng → thanh toán → kho → giao hàng → hoàn tiền → báo cáo.
  Xem `docs/DECISIONS.md` cho các quyết định kiến trúc và trade-off.
