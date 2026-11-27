# GOAL-011 v1: OmniFlow co nghiep vu thong bao + cong viec nen: gui thong bao qua adapter email fake khi don xac nhan/hoan tat/huy, thanh toan paid/failed, hoan tien, giao shipped/delivered/failed, tra hang duyet/tu choi/nhan, ton kho thap, khuyen mai sap het han (log append-only, event_key UNIQUE chong gui trung, cai dat nhan theo nguoi dung); hang doi job trong tien trinh (send-notification/low-stock-scan/promo-expiry-scan, retry toi da 3 lan + backoff 60s/120s, job lap theo lich 60 phut co dedupe theo ngay, khoi phuc job do dang khi khoi dong, chay tay + retry tay qua API); RBAC theo ma tran thong bao/job + audit log chi cho that bai/retry tay; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc thong bao/job moi (CHK-2 timeoutMs 20 phut tu v1); 4 yeu cau mo coi bao cao (R-19 GOAL-006, R-17 GOAL-007, R-18 GOAL-008, R-16 GOAL-009) duoc loai tru co ly do (out-of-scope)

Status: verified

```json
{
  "id": "GOAL-011",
  "version": 1,
  "outcome": "OmniFlow co nghiep vu thong bao + cong viec nen: gui thong bao qua adapter email fake khi don xac nhan/hoan tat/huy, thanh toan paid/failed, hoan tien, giao shipped/delivered/failed, tra hang duyet/tu choi/nhan, ton kho thap, khuyen mai sap het han (log append-only, event_key UNIQUE chong gui trung, cai dat nhan theo nguoi dung); hang doi job trong tien trinh (send-notification/low-stock-scan/promo-expiry-scan, retry toi da 3 lan + backoff 60s/120s, job lap theo lich 60 phut co dedupe theo ngay, khoi phuc job do dang khi khoi dong, chay tay + retry tay qua API); RBAC theo ma tran thong bao/job + audit log chi cho that bai/retry tay; du lieu GIA LAP hoan toan, local-only; check.sh/demo.sh xanh ke ca buoc thong bao/job moi (CHK-2 timeoutMs 20 phut tu v1); 4 yeu cau mo coi bao cao (R-19 GOAL-006, R-17 GOAL-007, R-18 GOAL-008, R-16 GOAL-009) duoc loai tru co ly do (out-of-scope)",
  "source": {
    "path": "brief-011.md",
    "sha256": "dcd5c9ddf3714a95a1a3daca2652daed34e5448d13c14a9d9c7c3ce621a7c955",
    "capturedAt": "2026-11-27T18:18:40.699Z",
    "origin": "human"
  },
  "requirements": [
    {
      "id": "R-1",
      "sourceSpan": "dòng 165–178",
      "text": "Danh mục sự kiện thông báo: các sự kiện sau PHẢI sinh thông báo (mỗi sự kiện có event_type cố định, ghi trong D29): đơn hàng — order.confirmed, order.completed, order.cancelled; thanh toán — payment.paid, payment.failed, payment.refunded; giao hàng — shipment.shipped, shipment.delivered, shipment.failed; trả hàng — return.requested, return.approved, return.rejected, return.received; tồn kho — stock.low; khuyến mãi — promotion.expiring. Người nhận mặc định theo từng loại: đơn/thanh toán/giao/trả → email khách (nếu đơn có customer_id và khách có email) + owner của org; thanh toán/hoàn tiền → thêm accountant; trả hàng → thêm sales của chi nhánh đơn; tồn thấp → user warehouse được gán kho đó + manager; mã sắp hết hạn → owner + manager. Người nhận là user thì kiểm tra cài đặt nhận (yêu cầu 3); người nhận là khách (email) thì luôn gửi nếu có email (khách không có cài đặt nhận).",
      "disposition": "acceptance"
    },
    {
      "id": "R-2",
      "sourceSpan": "dòng 179–199",
      "text": "Gửi qua FakeEmailAdapter + log append-only: bảng notifications (migration 015): org_id, event_key UNIQUE (chống gửi trùng), event_type, channel = 'email', recipient_user_id nullable, recipient_email (email đích tại thời điểm gửi — snapshot, không join lại), subject, body, status ∈ sent/failed, error nullable, message_id (từ adapter), created_at. Gửi = gọi FakeEmailAdapter.send(to, subject, body) (deterministic messageId, simulated: true), ghi log trong cùng transaction với cập nhật trạng thái job. KHÔNG gửi email thật, KHÔNG kết nối dịch vụ email thật. event_key định dạng ${event_type}:${entity}:${detail}, ví dụ order.confirmed:DH-20261128-0001, payment.paid:DH-20261128-0001, shipment.delivered:DH-20261128-0001, stock.low:variant:12:warehouse:3:2026-11-28 (ngày theo Asia/Ho_Chi_Minh — tối đa 1 lần/ngày/cặp, không spam), promotion.expiring:7:2026-11-30 (1 lần/mã/ngày hết hạn). Gửi lại cùng event_key → KHÔNG tạo bản ghi mới (trả về bản ghi đã có / no-op 200). Nội dung email (subject/body) theo mẫu cố định từng loại (ghi mẫu trong D29, gồm mã đơn / số tiền / tên sản phẩm / kho / mã khuyến mãi tùy loại — không chứa thông tin thẻ, không chứa PII thừa ngoài email đích đã snapshot).",
      "disposition": "acceptance"
    },
    {
      "id": "R-3",
      "sourceSpan": "dòng 200–209",
      "text": "Cài đặt nhận thông báo theo người dùng: bảng notification_preferences (migration 015): user_id, event_type, enabled (0/1), UNIQUE(user_id, event_type). Mặc định mọi loại đều BẬT (thiếu dòng = bật — không seed dòng mặc định). Tắt loại nào thì sự kiện loại đó KHÔNG gửi cho người đó (job send-notification cho người đã tắt thì bỏ qua ngay, KHÔNG tạo notification, KHÔNG tính là failed; test chứng minh). API GET/PATCH /api/notification-preferences (xem chính mình; owner/manager sửa cho user trong org). PATCH sai event_type → 400; user ngoài org → 403/404.",
      "disposition": "acceptance"
    },
    {
      "id": "R-4",
      "sourceSpan": "dòng 210–227",
      "text": "Hàng đợi job nền trong tiến trình: bảng jobs (migration 015): id, type ∈ send-notification/low-stock-scan/promo-expiry-scan, payload JSON (chuỗi JSON: với send-notification gồm event_key, event_type, to_user_id/to_email, subject, body; với scan gồm period_key), status ∈ pending/running/done/failed, attempts (đã thử, mặc định 0), max_attempts (mặc định 3), next_run_at (ISO UTC, mặc định now), last_error nullable, created_at, updated_at. Runner: hàm processDueJobs(db, now) — lấy job pending có next_run_at <= now theo created_at, chạy TUẦN TỰ từng job (1 job tại 1 thời điểm trong cùng tiến trình — tránh race trên SQLite), mỗi job trong transaction riêng (đổi status running → done/failed/pending-lại + ghi log trong cùng transaction). Job được tạo khi: sự kiện xảy ra (send-notification — trong cùng transaction với cập nhật trạng thái gốc khi có thể), scheduler tick (scan), hoặc gọi tay API. Khôi phục khi khởi động: server start đưa mọi job running về pending (tiến trình cũ đã chết — attempts giữ nguyên, next_run_at = now), test được bằng cách update trực tiếp DB rồi gọi hàm khởi động.",
      "disposition": "acceptance"
    },
    {
      "id": "R-5",
      "sourceSpan": "dòng 228–239",
      "text": "Retry có giới hạn + backoff: max_attempts = 3 (chốt, ghi trong D29). Job fail → attempts + 1, status về pending với next_run_at = now + backoff: lần thử 1 fail → +60s, lần 2 fail → +120s, lần 3 fail → status failed + last_error ghi rõ + audit log action job-failed. Backoff tính bằng công thức 60 × 2^(attempts-1) giây (attempts = số lần đã thử sau khi fail). Test KHÔNG chờ thật: test đặt next_run_at trực tiếp / gọi processDueJobs với now giả lập, assert attempts/next_run_at/status sau từng lần fail. Cơ chế giả lập lỗi gửi: mở rộng FakeEmailAdapter với failNext() static một lần như D23 (failNext() của payment) — CHỈ dùng trong test, route production không bao giờ gọi; ghi rõ trong D29.",
      "disposition": "acceptance"
    },
    {
      "id": "R-6",
      "sourceSpan": "dòng 240–253",
      "text": "Job lặp theo lịch trong tiến trình: scheduler chạy bằng setInterval khi server chạy thật (60 phút/lần cho mỗi loại scan — chốt chu kỳ trong D29; KHÔNG chạy trong test trừ khi bật cờ tường minh). Scheduler tạo job scan theo khóa dedupe: mỗi loại scan có period_key = ngày hiện tại theo Asia/Ho_Chi_Minh (YYYY-MM-DD); đã có job scan cùng loại + cùng period_key ở trạng thái pending/running/done thì KHÔNG tạo thêm (kiểm tra trong transaction — tránh trùng khi tick lặp). Job scan khi chạy sẽ quét và tạo các job send-notification tương ứng. API POST /api/jobs/run chạy ngay mọi job due (cho test + vận hành tay — không chờ lịch), trả {processed, done, failed}; POST /api/jobs/:id/retry đưa job failed về pending (attempts reset về 0, next_run_at = now, last_error = NULL) + audit log action job-retried; job chưa failed mà retry → 400.",
      "disposition": "acceptance"
    },
    {
      "id": "R-7",
      "sourceSpan": "dòng 254–265",
      "text": "Thông báo tồn thấp: job low-stock-scan quét mọi cặp (biến thể, kho) có available < products.min_stock (D17) → mỗi cặp sinh 1 job send-notification event_type stock.low, event_key stock.low:variant:<id>:warehouse:<id>:<YYYY-MM-DD +07> (tối đa 1 lần/ngày/cặp — scan lại cùng ngày không tạo thêm nhờ event_key UNIQUE + dedupe scan theo period_key). Người nhận: user warehouse được gán kho đó (theo RBAC warehouse scope GOAL-002) + manager của org (theo preferences). Nội dung ghi rõ SKU, tên sản phẩm, tên kho, available, min_stock, shortage = min_stock − available. Cặp đã đủ tồn thì không sinh thông báo; cặp hết tồn thấp (đã nhập thêm) thì ngày sau không sinh nữa (mỗi ngày tính lại từ dữ liệu gốc).",
      "disposition": "acceptance"
    },
    {
      "id": "R-8",
      "sourceSpan": "dòng 266–273",
      "text": "Thông báo mã sắp hết hạn: job promo-expiry-scan quét promotions active có valid_to trong 3 ngày tới (từ now tới now + 3 ngày, theo Asia/Ho_Chi_Minh; mã đã hết hạn thì không nhắc) → mỗi mã sinh 1 job send-notification event_type promotion.expiring, event_key promotion.expiring:<promotion_id>:<YYYY-MM-DD của valid_to> (1 lần/mã/ngày hết hạn). Người nhận: owner + manager (theo preferences). Nội dung: code, valid_to, used_count/usage_limit. Mã đã khóa/inactive thì không nhắc.",
      "disposition": "acceptance"
    },
    {
      "id": "R-9",
      "sourceSpan": "dòng 274–288",
      "text": "Hook sự kiện đơn/thanh toán/giao/trả: các điểm hook — (a) transitionOrderTx chuyển đơn sang confirmed/completed/cancelled → tạo job send-notification (order.confirmed/order.completed/order.cancelled) trong CÙNG transaction với cập nhật trạng thái đơn (sự kiện và job không lệch nhau); (b) webhook paid chốt / webhook failed (GOAL-006) → job payment.paid/payment.failed; (c) refund tạo (GOAL-006) → job payment.refunded; (d) shipment đổi trạng thái shipped/delivered/failed (GOAL-007) → job tương ứng; (e) return requested/approved/rejected/received (GOAL-007) → job tương ứng. Event_key theo yêu cầu 2 (mã đơn + trạng thái đích — gửi lại cùng trạng thái (no-op, D24) thì KHÔNG tạo job mới vì event_key đã có). Người nhận theo bảng yêu cầu 1; job chỉ tạo cho người nhận có preferences bật (kiểm tra lúc tạo job — người tắt thì không tạo job). Hook KHÔNG đổi hành vi đã khóa của GOAL-005/006/007 (state machine, webhook chống trùng, hoàn tiền) — chỉ thêm tạo job.",
      "disposition": "acceptance"
    },
    {
      "id": "R-10",
      "sourceSpan": "dòng 289–297",
      "text": "API xem thông báo + job: GET /api/notifications?event_type=&status=&from=&to= (lọc theo org của user, phân trang page/limit như đơn GOAL-005; không có filter recipient tự do — sales chỉ thấy thông báo của chi nhánh mình) + GET /api/notifications/:id (ngoài org → 403/404); GET /api/jobs?status=&type= + GET /api/jobs/:id (phân trang như trên); POST /api/jobs/run (chạy ngay job due, trả {processed, done, failed}); POST /api/jobs/:id/retry (failed -> pending, attempts 0, next_run_at now, last_error NULL + audit job-retried; chưa failed -> 400). Response list kèm total/page/limit như các list đã có.",
      "disposition": "acceptance"
    },
    {
      "id": "R-11",
      "sourceSpan": "dòng 298–314",
      "text": "RBAC xem thông báo/job theo vai + scope: mở rộng helper can() ở src/rbac.ts thêm actions view-notifications (xem notification), manage-notification-preferences (sửa preferences), view-jobs (xem job), run-jobs (chạy job tay + retry) theo đúng ma trận: owner/manager toàn org (xem + chạy job + retry); sales chỉ xem thông báo thuộc chi nhánh mình (notification gắn với đơn/kho của chi nhánh mình — thông báo không gắn chi nhánh thì sales không thấy; xem job → 403); warehouse chỉ xem thông báo stock.low của kho được gán + job low-stock-scan (xem job khác → 403, chạy job → 403); accountant xem thông báo payment/refund toàn org (chỉ xem, không chạy job). Preferences: user tự xem/sửa của mình; owner/manager sửa cho user trong org; sales/warehouse/accountant sửa của người khác → 403. Mọi endpoint qua requireRole + can() (vai sai/sai chi nhánh/kho/ngoài org → 403). Test chứng minh từng ô cấm trong ma trận (ít nhất: sales xem thông báo chi nhánh khác → 403, sales xem job → 403, warehouse xem thông báo không phải tồn kho → 403, warehouse chạy job → 403, accountant chạy job → 403, user org A đọc thông báo org B → 403).",
      "disposition": "acceptance"
    },
    {
      "id": "R-12",
      "sourceSpan": "dòng 315–326",
      "text": "Audit log cho thất bại + retry tay: ghi vào audit_log đã có: (a) gửi thông báo thất bại cuối cùng (job send-notification hết 3 lần thử → action notification-failed, detail JSON {event_key, event_type, recipient_user_id (nếu có), error} — KHÔNG chứa nội dung email đầy đủ, KHÔNG chứa email khách (PII) — chỉ id + event_key + error); (b) job failed cuối (action job-failed, detail {job_id, job_type, last_error}); (c) retry tay (action job-retried, detail {job_id, job_type}). Gửi thành công KHÔNG ghi audit (tránh nhiễu log — lịch sử gửi đã có bảng notifications). Xem log theo luật GOAL-002 (GET /api/audit-log). Test: job fail 3 lần → đúng 1 bản ghi notification-failed + 1 job-failed; gửi thành công → không tăng số bản ghi audit.",
      "disposition": "acceptance"
    },
    {
      "id": "R-13",
      "sourceSpan": "dòng 327–336",
      "text": "Test mới (vitest + supertest, thêm vào file test mới — KHÔNG sửa 370 test đã khóa của GOAL-001..010): chứng minh danh mục sự kiện + hook (đơn xác nhận/hoàn tất/hủy, webhook paid/failed, refund, giao shipped/delivered/failed, trả duyệt/từ chối/nhận → job + notification đúng người nhận), không gửi trùng (cùng event_key 2 lần → 1 bản ghi), preferences tắt → không gửi, job retry/backoff (3 lần → failed + backoff 60s/120s đúng công thức, không chờ thật), scan tồn thấp + mã sắp hết hạn (dedupe theo ngày), khôi phục job running khi khởi động, RBAC 403 theo ma trận (yêu cầu 11), audit thất bại (yêu cầu 12). Test dùng dữ liệu giả lập (2 org, 2 chi nhánh, 2 kho, 2 kênh trở lên).",
      "disposition": "acceptance"
    },
    {
      "id": "R-14",
      "sourceSpan": "dòng 337–342",
      "text": "Dữ liệu GIẢ LẬP hoàn toàn; mật khẩu seed + secret qua biến môi trường (như GOAL-001..010: OMNIFLOW_SEED_*_PASSWORD), không commit credential thật; check.sh vẫn quét secret (grep như GOAL-001); seed KHÔNG thêm user/sản phẩm/kho mới (giữ nguyên 2 user, 2 sản phẩm, 2 kho + mức tồn mẫu để test khóa vẫn xanh); email chỉ qua FakeEmailAdapter (simulated: true), không gửi email thật.",
      "disposition": "acceptance"
    },
    {
      "id": "R-15",
      "sourceSpan": "dòng 343–363",
      "text": "scripts/check.sh (CHK-1) và scripts/demo.sh (CHK-2) được MỞ RỘNG trong goal này: thêm bước thông báo/job vào smoke/demo (tạo đơn 250.000đ kênh counter → xác nhận → hoàn tất → thu tiền 100.000đ → chạy job due → notification order.completed + payment.paid đã sent, gửi lại cùng event không trùng → tạo cặp tồn thấp (đặt min_stock cao / xuất kho cho available < min_stock) → chạy low-stock-scan → thông báo stock.low đúng kho → tạo mã sắp hết hạn trong 2 ngày → chạy promo-expiry-scan → thông báo promotion.expiring → job fail giả lập → retry tay → sent → RBAC 403: sales xem job, warehouse chạy job), giữ tất cả bước GOAL-001..010 xanh (health, login, owner-only, idempotency, backup/restore, RBAC người dùng, sản phẩm/giá/CSV, kho, đơn, thanh toán, giao/trả, khách/CRM, khuyến mãi, báo cáo). Cả 2 script tự chạy được, tự dọn dẹp, in PASS/FAIL từng bước. Docs: docs/RBAC.md bổ sung ma trận thông báo/job + docs/DECISIONS.md thêm D29 (danh mục sự kiện + event_key + mẫu nội dung + job queue + retry/backoff + scheduler + dedupe + khôi phục khi khởi động + audit chỉ thất bại); README.md/docs/SETUP.md cập nhật endpoint thông báo/job, khớp lệnh đã chạy thật. Không có file .github/workflows/ trong repo (gh token thiếu scope workflow — CI là follow-up sau khi user cấp scope). Không claim VPS, không claim deploy production (local-only, D9).",
      "disposition": "acceptance"
    },
    {
      "id": "R-16",
      "sourceSpan": "dòng 366–367",
      "text": "UI tổng quan (GOAL-012): không thêm màn hình thông báo/job (chỉ API + log); màn hình tổng quan là yêu cầu riêng của GOAL-012.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "deferred",
        "to": "GOAL-012"
      },
      "exclusionReason": "Thuộc GOAL-012, không làm trong GOAL-011"
    },
    {
      "id": "R-17",
      "sourceSpan": "dòng 368–370",
      "text": "SMS / push / email thật — ngoài phạm vi vĩnh viễn của dự án giả lập này (chỉ FakeEmailAdapter, simulated: true); không tài khoản dịch vụ email thật, không API key thật.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Ngoài phạm vi vĩnh viễn của dự án giả lập này"
    },
    {
      "id": "R-18",
      "sourceSpan": "dòng 371–373",
      "text": "Redis / hàng đợi ngoài / cron hệ thống / worker process riêng — ngoài phạm vi vĩnh viễn của dự án giả lập này (chỉ job queue trong tiến trình + setInterval, xem yêu cầu 4/6); không deploy thêm process.",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "Ngoài phạm vi vĩnh viễn của dự án giả lập này"
    },
    {
      "id": "R-21",
      "sourceSpan": "dòng 331–332 (brief-006.md)",
      "adopts": {
        "sourceSha256": "d3721a8812fccf7a526b1aebe77d2422a5001c1990065724601563c638fc6eb1",
        "requirementId": "R-19"
      },
      "text": "Báo cáo/đối soát tổng hợp (GOAL-010): không tổng hợp doanh thu theo thời gian, không đối soát lô (chỉ đối soát từng đơn — yêu cầu 6).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "R-19 chỉ là câu phủ định phạm vi của GOAL-006 (nói GOAL-006 không làm báo cáo tổng hợp), không phải yêu cầu dương cần implement; toàn bộ phạm vi báo cáo đã được sở hữu bởi requirements riêng R-1..R-13 của GOAL-010 (đã implement + kiểm chứng đầy đủ, gate xanh, check/demo xanh). Adopt vào GOAL-011 (thông báo) sẽ nhận sai phạm vi."
    },
    {
      "id": "R-22",
      "sourceSpan": "dòng 479–480 (brief-007.md)",
      "adopts": {
        "sourceSha256": "5586ce9122656edcbd73a2cf609470e1e354ef85fb39ffeb00c70cec04c7f906",
        "requirementId": "R-17"
      },
      "text": "Báo cáo/đối soát tổng hợp (GOAL-010): không tổng hợp doanh thu theo thời gian, không đối soát lô (chỉ đối chiếu từng đơn sau trả — yêu cầu 8).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "R-17 chỉ là câu phủ định phạm vi của GOAL-007 (nói GOAL-007 không làm báo cáo tổng hợp), không phải yêu cầu dương cần implement; toàn bộ phạm vi báo cáo đã được sở hữu bởi requirements riêng R-1..R-13 của GOAL-010 (đã implement + kiểm chứng đầy đủ, gate xanh, check/demo xanh). Adopt vào GOAL-011 (thông báo) sẽ nhận sai phạm vi."
    },
    {
      "id": "R-23",
      "sourceSpan": "dòng 589–590 (brief-008.md)",
      "adopts": {
        "sourceSha256": "1096245ab8319996180e7a82f65599d1190491a46acc89c3efdc211a5e96cb71",
        "requirementId": "R-18"
      },
      "text": "Báo cáo/đối soát tổng hợp (GOAL-010): không tổng hợp doanh thu theo khách/thời gian, không đối soát lô (chỉ tóm tắt từng khách — yêu cầu 2, và đối soát từng đơn — D22).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "R-18 chỉ là câu phủ định phạm vi của GOAL-008 (nói GOAL-008 không làm báo cáo tổng hợp), không phải yêu cầu dương cần implement; toàn bộ phạm vi báo cáo đã được sở hữu bởi requirements riêng R-1..R-13 của GOAL-010 (đã implement + kiểm chứng đầy đủ, gate xanh, check/demo xanh). Adopt vào GOAL-011 (thông báo) sẽ nhận sai phạm vi."
    },
    {
      "id": "R-24",
      "sourceSpan": "dòng 409–412 (brief-009.md)",
      "adopts": {
        "sourceSha256": "53b60a14c7ebe698576b7162fbd1c6a420efea47cc1ef98d85af41a58aff4ed7",
        "requirementId": "R-16"
      },
      "text": "Báo cáo/đối soát tổng hợp (GOAL-010): không tổng hợp doanh thu theo thời gian, không đối soát lô (chỉ đối soát từng đơn — yêu cầu 8, và lịch sử dùng mã từng lần — yêu cầu 10).",
      "disposition": "excluded",
      "exclusion": {
        "kind": "out-of-scope"
      },
      "exclusionReason": "R-16 chỉ là câu phủ định phạm vi của GOAL-009 (nói GOAL-009 không làm báo cáo tổng hợp), không phải yêu cầu dương cần implement; toàn bộ phạm vi báo cáo đã được sở hữu bởi requirements riêng R-1..R-13 của GOAL-010 (đã implement + kiểm chứng đầy đủ, gate xanh, check/demo xanh). Adopt vào GOAL-011 (thông báo) sẽ nhận sai phạm vi."
    }
  ],
  "scope": [
    "docs/",
    "src/",
    "scripts/",
    "tests/",
    "README.md",
    "brief-011.md",
    "goal-011.json",
    ".gitignore"
  ],
  "exclusions": [
    "UI tổng quan (GOAL-012): không thêm màn hình thông báo/job (chỉ API + log) — thuộc GOAL-012, không làm trong GOAL-011.",
    "SMS / push / email thật — ngoài phạm vi vĩnh viễn của dự án giả lập này (chỉ FakeEmailAdapter, simulated: true); không tài khoản dịch vụ email thật, không API key thật.",
    "Redis / hàng đợi ngoài / cron hệ thống / worker process riêng — ngoài phạm vi vĩnh viễn (chỉ job queue trong tiến trình + setInterval); không deploy thêm process.",
    "Đơn vị vận chuyển thật / giao hàng thật, tài khoản hãng vận chuyển, cổng thanh toán thật — ngoài phạm vi vĩnh viễn của dự án giả lập này; deploy production/VPS (ngoài phạm vi, local-only), CI workflow (chờ user cấp scope workflow).",
    "Yêu cầu R-19 của GOAL-006, R-17 của GOAL-007, R-18 của GOAL-008 và R-16 của GOAL-009 được loại trừ có lý do (out-of-scope) trong goal này — xem requirement R-21/R-22/R-23/R-24; chúng chỉ là câu phủ định phạm vi báo cáo của goal gốc, toàn bộ phạm vi báo cáo đã được sở hữu bởi requirements riêng R-1..R-13 của GOAL-010; adopt vào GOAL-011 (thông báo) sẽ nhận sai phạm vi."
  ],
  "acceptance": [
    {
      "id": "AC-1",
      "text": "Su kien thong bao + gui qua FakeEmailAdapter + log + khong trung (AC-1): cac su kien PHẢI sinh thong bao — don order.confirmed/order.completed/order.cancelled; thanh toan payment.paid/payment.failed/payment.refunded; giao shipment.shipped/shipment.delivered/shipment.failed; tra return.requested/return.approved/return.rejected/return.received; ton kho stock.low; khuyen mai promotion.expiring (xem R-7/R-8). Nguoi nhan theo bang yeu cau 1 brief-011.md: don/thanh toan/giao/tra -> email khach (neu don co customer_id + khach co email) + owner; thanh toan/hoan tien -> them accountant; tra hang -> them sales cua chi nhanh don; ton thap -> warehouse duoc gan kho + manager; ma sap het han -> owner + manager. Gui = FakeEmailAdapter.send (deterministic messageId, simulated: true), log vao bang notifications append-only (org_id, event_key UNIQUE, event_type, channel='email', recipient_user_id nullable, recipient_email snapshot, subject, body theo mau D29, status sent/failed, error nullable, message_id, created_at). event_key = ${event_type}:${entity}:${detail} (vd order.completed:DH-20261128-0001, stock.low:variant:12:warehouse:3:2026-11-28, promotion.expiring:7:2026-11-30). Hook: transitionOrderTx (confirmed/completed/cancelled), webhook paid/failed, refund tao, shipment doi trang thai, return duyet/tu choi/nhan — tao job send-notification trong CUNG transaction voi cap nhat trang thai goc khi co the; gui lai cung trang thai (no-op D24) thi KHONG tao job moi (event_key da co). Nguoi nhan la user thi kiem tra preferences truoc khi tao job (tat -> khong tao job, khong tao notification).",
      "requirementIds": [
        "R-1",
        "R-2",
        "R-9"
      ],
      "examples": [
        {
          "input": "tao don -> xac nhan -> chay job due (test moi)",
          "expected": "200, job send-notification duoc tao + sau khi chay job, notifications co 1 ban ghi status sent, event_key order.confirmed:DH-..."
        },
        {
          "input": "don hoan tat -> chay job 2 lan (test moi)",
          "expected": "200, notifications chi co 1 ban ghi order.completed:DH-... du gui 2 lan"
        },
        {
          "input": "thu qua cong + webhook failed gia lap (test moi)",
          "expected": "200, webhook paid chot -> notification payment.paid sent; webhook failed -> notification payment.failed sent"
        },
        {
          "input": "giao delivered + tra duyet (test moi)",
          "expected": "200, shipment delivered + return approved -> notification tuong ung sent, dung nguoi nhan"
        },
        {
          "input": "GET /api/notifications?status=senttt (gia tri la); PATCH preferences voi event_type la (test moi)",
          "expected": "400"
        }
      ],
      "boundaries": [
        "nguoi nhan la user thi kiem tra preferences (tat -> khong tao job, khong tao notification); nguoi nhan la khach (email) thi luon gui neu co email",
        "event_key UNIQUE: gui lai cung event_key -> khong tao ban ghi moi (no-op 200 / tra ve ban ghi da co)",
        "hook KHONG doi hanh vi da khoa cua GOAL-005/006/007: state machine don, webhook chong trung, hoan tien, giao/tra giu nguyen",
        "noi dung email theo mau co dinh tung loai (D29); khong chua thong tin the; khong chua PII thua ngoai email dich da snapshot",
        "don khong co customer_id hoac khach khong co email -> chi gui cho owner (khong loi)"
      ],
      "prohibited": [
        "khong duoc gui email that, khong duoc ket noi dich vu email that",
        "khong duoc tao notification trung cho cung event_key",
        "khong duoc doi hanh vi da khoa cua GOAL-005/006/007 (state machine, webhook, hoan tien)",
        "khong duoc sua test da khoa cua GOAL-001..010; khong duoc doi hanh vi computePaymentSummary hay state machine don"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-2",
      "text": "Hang doi job + retry/backoff + scheduler + scan ton thap/ma het han (AC-2): bang jobs (migration 015): id, type ∈ send-notification/low-stock-scan/promo-expiry-scan, payload JSON, status ∈ pending/running/done/failed, attempts, max_attempts = 3, next_run_at (ISO UTC), last_error, created_at, updated_at. Runner processDueJobs(db, now): lay job pending co next_run_at <= now theo created_at, chay TUAN TU tung job, moi job trong transaction rieng (running -> done/failed/pending-lai). Retry: job fail -> attempts+1, pending lai voi next_run_at = now + 60 x 2^(attempts-1) giay (+60s, +120s); het 3 lan -> failed + last_error + audit job-failed. Co che gia lap loi gui: FakeEmailAdapter.failNext() static mot lan nhu D23, CHI dung trong test. Scheduler setInterval 60 phut/loai scan khi server chay that; dedupe theo period_key = ngay Asia/Ho_Chi_Minh (da co job scan cung loai + cung period_key o pending/running/done thi khong tao them, kiem tra trong transaction). low-stock-scan: moi cap (variant, warehouse) co available < min_stock -> 1 job stock.low, event_key stock.low:variant:<id>:warehouse:<id>:<YYYY-MM-DD +07>, nguoi nhan warehouse duoc gan kho + manager, noi dung ghi SKU/ten/kho/available/min_stock/shortage. promo-expiry-scan: promotion active co valid_to trong 3 ngay toi (theo Asia/Ho_Chi_Minh; da het han thi khong nhac) -> 1 job promotion.expiring, event_key promotion.expiring:<promotion_id>:<YYYY-MM-DD valid_to>, nguoi nhan owner + manager, noi dung code/valid_to/used_count/usage_limit. Khoi dong server dua job running ve pending (attempts giu nguyen, next_run_at = now).",
      "requirementIds": [
        "R-4",
        "R-5",
        "R-6",
        "R-7",
        "R-8"
      ],
      "examples": [
        {
          "input": "tao job send-notification -> chay job due (test moi)",
          "expected": "200, job pending -> sau processDueJobs: done; notifications co ban ghi sent"
        },
        {
          "input": "job gui voi FakeEmailAdapter.failNext() bat lien tuc (test moi)",
          "expected": "200, sau 3 lan fail: status failed, attempts 3, next_run_at lan 1 = +60s, lan 2 = +120s"
        },
        {
          "input": "chay low-stock-scan 2 lan cung ngay (test moi)",
          "expected": "200, scan lan 2 cung ngay khong tao job scan moi, khong tao notification trung"
        },
        {
          "input": "dat min_stock cao / xuat kho cho available < min_stock -> chay scan (test moi)",
          "expected": "200, cap ton thap -> 1 notification stock.low dung SKU/kho/available/min_stock/shortage"
        },
        {
          "input": "tao ma valid_to +2 ngay, ma da het han, ma inactive -> chay scan (test moi)",
          "expected": "200, ma het han trong 2 ngay -> 1 notification promotion.expiring; ma da het han / inactive -> khong co"
        },
        {
          "input": "khoi phuc job do dang khi start (test moi)",
          "expected": "200, job running (update truc tiep DB) -> sau khoi dong lai: pending"
        }
      ],
      "boundaries": [
        "runner chay TUAN TU tung job (1 job tai 1 thoi diem trong cung tien trinh); moi job trong transaction rieng",
        "backoff cong thuc 60 x 2^(attempts-1) giay; test KHONG cho that (dat next_run_at truc tiep / now gia lap)",
        "scan dedupe theo period_key = ngay hien tai Asia/Ho_Chi_Minh; scan lai cung ngay khong tao job trung",
        "job running khi server start -> ve pending (attempts giu nguyen, next_run_at = now)",
        "scheduler setInterval 60 phut/loai scan, KHONG chay trong test tru khi bat co tuong minh"
      ],
      "prohibited": [
        "khong duoc dung Redis / hang doi ngoai / cron he thong / worker process rieng",
        "khong duoc chay song song nhieu job trong cung tien trinh (race SQLite)",
        "khong duoc de scan tao job trung trong cung ngay (period_key + event_key UNIQUE)",
        "khong duoc sua test da khoa cua GOAL-001..010"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-3",
      "text": "Preferences + API + RBAC + audit (AC-3): bang notification_preferences (migration 015): user_id, event_type, enabled, UNIQUE(user_id, event_type); thieu dong = BAT. API GET/PATCH /api/notification-preferences (tu xem/sua cua minh; owner/manager sua cho user trong org; sua cua nguoi khac voi vai khac -> 403; event_type la -> 400). API GET /api/notifications?event_type=&status=&from=&to= + GET /api/notifications/:id; GET /api/jobs?status=&type= + GET /api/jobs/:id; POST /api/jobs/run (chay ngay job due, tra {processed, done, failed}); POST /api/jobs/:id/retry (failed -> pending, attempts 0, next_run_at now, last_error NULL + audit job-retried; chua failed -> 400). RBAC mo rong can() them 4 actions view-notifications / manage-notification-preferences / view-jobs / run-jobs theo ma tran brief-011.md yeu cau 11 (owner/manager toan org; sales chi thong bao chi nhanh minh, xem job -> 403; warehouse chi thong bao stock.low kho duoc gan + job low-stock-scan, chay job -> 403; accountant xem thong bao payment/refund toan org chi xem, chay job -> 403; ngoai org -> 403). Audit log: gui that bai cuoi (action notification-failed, detail {event_key, event_type, recipient_user_id, error}, KHONG noi dung email, KHONG email khach) + job failed cuoi (job-failed, {job_id, job_type, last_error}) + retry tay (job-retried, {job_id, job_type}); gui thanh cong KHONG ghi audit.",
      "requirementIds": [
        "R-3",
        "R-10",
        "R-11",
        "R-12"
      ],
      "examples": [
        {
          "input": "PATCH preferences tat loai -> don hoan tat -> chay job (test moi)",
          "expected": "200, preferences tat order.completed -> don hoan tat khong tao notification cho user do"
        },
        {
          "input": "xem list thong bao/job (test moi)",
          "expected": "200, GET /api/notifications co ban ghi + phan trang; GET /api/jobs?status=failed loc dung"
        },
        {
          "input": "chay job tay (test moi)",
          "expected": "200, POST /api/jobs/run tra {processed, done, failed} dung so job due"
        },
        {
          "input": "retry tay (test moi)",
          "expected": "200, job failed -> POST retry -> pending, attempts 0, next_run_at = now; retry job chua failed -> 400"
        },
        {
          "input": "test RBAC theo tung o cam trong ma tran thong bao/job (test moi)",
          "expected": "403: sales xem thong bao chi nhanh khac, sales xem job, warehouse xem thong bao khong phai ton kho, warehouse chay job, accountant chay job, user org A doc thong bao org B"
        },
        {
          "input": "audit that bai (test moi)",
          "expected": "audit_log co dung 1 notification-failed + 1 job-failed sau job fail 3 lan; gui thanh cong khong tang audit"
        }
      ],
      "boundaries": [
        "thieu dong preferences = BAT (khong seed dong mac dinh); tat loai nao thi khong gui loai do cho nguoi do",
        "gui thanh cong KHONG ghi audit; chi that bai cuoi + retry tay moi ghi audit",
        "detail audit KHONG chua noi dung email day du, KHONG chua email khach (PII) — chi event_key/event_type/recipient_user_id/error",
        "sales chi xem thong bao thuoc chi nhanh minh; thong bao khong gan chi nhanh thi sales khong thay",
        "audit xem theo luat GOAL-002"
      ],
      "prohibited": [
        "khong duoc ghi PII khach (phone/email/address) hay thong tin the vao audit_log",
        "khong duoc ghi audit cho gui thanh cong (chi that bai + retry tay)",
        "khong duoc sua test da khoa cua GOAL-001..010; khong duoc commit secret/credential that; khong duoc commit file .github/workflows/ (CI cho user cap scope workflow)"
      ],
      "checkIds": [
        "CHK-1",
        "CHK-2"
      ]
    },
    {
      "id": "AC-4",
      "text": "Test + checks/docs + du lieu gia lap (AC-4): test moi (vitest + supertest, file moi) chung minh toan bo hanh vi AC-1..AC-3 (hook su kien, khong trung event_key, preferences, retry/backoff khong cho that, scan ton thap/ma het han + dedupe theo ngay, khoi phuc job running khi start, RBAC 403, audit that bai); du lieu GIA LAP hoan toan, secret qua bien moi truong, check.sh van quet secret; scripts/check.sh va scripts/demo.sh duoc MO RONG them buoc thong bao/job (tao don 250.000d kenh counter -> xac nhan -> hoan tat -> thu tien 100.000d -> chay job due -> notification order.completed + payment.paid sent, gui lai cung event khong trung -> tao cap ton thap -> chay low-stock-scan -> notification stock.low dung kho -> tao ma sap het han trong 2 ngay -> chay promo-expiry-scan -> notification promotion.expiring -> job fail gia lap -> retry tay -> sent -> RBAC 403: sales xem job, warehouse chay job), giu cac buoc GOAL-001..010 xanh, tu chay duoc, tu don dep, in PASS/FAIL tung buoc; docs RBAC/DECISIONS(D29)/README/SETUP cap nhat.",
      "requirementIds": [
        "R-13",
        "R-14",
        "R-15"
      ],
      "examples": [
        {
          "input": "./scripts/check.sh; ./scripts/demo.sh",
          "expected": "./scripts/check.sh exit 0 va ./scripts/demo.sh in PASS tung buoc, gom cac buoc GOAL-001..010 xanh + buoc thong bao/job moi"
        },
        {
          "input": "doc RBAC/DECISIONS/README/SETUP sau goal",
          "expected": "docs/RBAC.md bo sung ma tran thong bao/job; docs/DECISIONS.md them D29; README.md/docs/SETUP.md cap nhat endpoint thong bao/job, khop lenh da chay that"
        }
      ],
      "boundaries": [
        "test moi them vao file test moi, KHONG sua 370 test da khoa cua GOAL-001..010; du lieu test gia lap (2 org, 2 chi nhanh, 2 kho, 2 kenh tro len)",
        "seed KHONG them user/san pham/kho moi (giu nguyen 2 user, 2 san pham, 2 kho + muc ton mau de test khoa van xanh)",
        "email chi qua FakeEmailAdapter (simulated: true); khong gui email that; khong luu thong tin the o bat ky dau (DB, API, log, audit_log)",
        "CHK-2 khai timeoutMs 1200000 (20 phut) ngay tu v1 — bai hoc GOAL-010 (timeout mac dinh APOS 10 phut, demo.sh chay rieng da 6m43s, issue #89)",
        "khong duoc claim VPS, deploy production hay cong thanh toan that"
      ],
      "prohibited": [
        "khong duoc sua test da khoa cua GOAL-001..010; khong duoc commit secret/credential that; khong duoc commit file .github/workflows/ (CI cho user cap scope workflow)",
        "khong duoc luu thong tin the o bat ky dau (DB, API, log, audit_log)",
        "khong duoc claim VPS, deploy production hay cong thanh toan that; khong duoc gui email that"
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
      "timeoutMs": 1200000,
      "env": {}
    }
  ],
  "dependencies": [
    "GOAL-005"
  ],
  "priority": 3
}
```
