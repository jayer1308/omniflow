/**
 * Thanh toan + hoan tien (GOAL-006, xem docs/DECISIONS.md D22/D23).
 * - Doi soat don-thanh toan tinh o service tu bang payments/refunds
 *   (khong luu cot tong rieng): paid_total = tong payment da tra
 *   (status paid/partially_refunded/refunded) tru tong refund 'completed'.
 * - Chu ky webhook gia lap: sha256 hex cua
 *   `${gatewayReference}:${status}:${amount}:${secret}`.
 * - payment_events append-only, chi INSERT (khong co API sua/xoa).
 */
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type PaymentStatus =
  | 'unpaid'
  | 'partially_paid'
  | 'paid'
  | 'overpaid'
  | 'refunded'
  | 'partially_refunded';

export type PaymentRowStatus =
  | 'requested'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'partially_refunded';

export interface OrderPaymentSummary {
  order_total: number;
  paid_total: number;
  refunded_total: number;
  outstanding: number;
  payment_status: PaymentStatus;
}

export interface PaymentRow {
  id: number;
  org_id: number;
  branch_id: number;
  order_id: number;
  method: string;
  amount: number;
  currency: string;
  status: PaymentRowStatus;
  gateway_reference: string | null;
  received_by: number;
  received_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RefundRow {
  id: number;
  payment_id: number;
  amount: number;
  reason: string;
  status: string;
  created_by: number;
  created_at: string;
}

export interface PaymentEventRow {
  id: number;
  payment_id: number;
  event_type: string;
  actor_id: number | null;
  detail: string | null;
  created_at: string;
}

/** Payment day du tra cho client: payment kem refunds + events. */
export interface PaymentDetail extends PaymentRow {
  refunds: RefundRow[];
  events: PaymentEventRow[];
}

/**
 * Tom tat doi soat cua mot don: order_total (tong don GOAL-005),
 * paid_total (tong payment 'paid' tru tong refund 'completed'),
 * refunded_total, outstanding (order_total - paid_total, am nghia la thua),
 * payment_status suy ra (unpaid/partially_paid/paid/overpaid/refunded/
 * partially_refunded).
 * payment_status 'refunded' khi paid_total ve 0 sau khi da tung tra
 * (refunded_total > 0); chua tra gi thi 'unpaid'.
 * 'partially_refunded' (GOAL-007, D25) chi khi don co yeu cau tra da
 * hoan tien (returns.status = 'refunded') ma van con tien rong da tra
 * (paid_total > 0): phan biet voi hoan tien truc tiep GOAL-006 — test
 * khoa GOAL-006 giu 'partially_paid' cho hoan truc tiep mot phan (don
 * draft, khong co return), test khoa GOAL-007 doi 'partially_refunded'
 * cho hoan qua tra hang (don completed, co return da refunded). Cung
 * trang thai so hoc (0 < paid_total < order_total, refunded_total > 0)
 * nhung hai bo test khoa doi hai nhan khac nhau nen phai phan biet
 * bang nguon hoan (co return da refunded hay khong); day la sua toi
 * thieu giu ca hai bo test xanh, khong doi hanh vi doi soat GOAL-006.
 */
export function computePaymentSummary(
  db: DatabaseSync,
  orderId: number,
): OrderPaymentSummary {
  const order = db.prepare('SELECT total, points_discount, promo_discount FROM orders WHERE id = ?').get(orderId) as
    | { total: number; points_discount: number; promo_discount: number }
    | undefined;
  if (!order) throw new Error('not_found: không tìm thấy đơn hàng');
  const orderTotal = order.total;
  // GOAL-008 (D26): outstanding trừ thêm points_discount (điểm đã đổi);
  // GOAL-009 (D27): outstanding trừ thêm promo_discount (mã đã áp);
  // payment_status GIỮ NGUYÊN logic D22 trên (paid_total, refunded_total,
  // order_total) — đơn đổi điểm/mã hết tổng mà chưa trả đồng nào vẫn 'unpaid'.
  const pointsDiscount = order.points_discount ?? 0;
  const promoDiscount = order.promo_discount ?? 0;
  const paidRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS s FROM payments
       WHERE order_id = ? AND status IN ('paid', 'partially_refunded', 'refunded')`,
    )
    .get(orderId) as { s: number };
  const refundedRow = db
    .prepare(
      `SELECT COALESCE(SUM(r.amount), 0) AS s FROM refunds r
       JOIN payments p ON p.id = r.payment_id
       WHERE p.order_id = ? AND r.status = 'completed'`,
    )
    .get(orderId) as { s: number };
  const refundedTotal = refundedRow.s;
  const paidTotal = paidRow.s - refundedTotal;
  const outstanding = orderTotal - pointsDiscount - promoDiscount - paidTotal;
  const hasRefundedReturn = (
    db
      .prepare(
        "SELECT 1 AS x FROM returns WHERE order_id = ? AND status = 'refunded' LIMIT 1",
      )
      .get(orderId) as { x: number } | undefined
  ) !== undefined;
  let paymentStatus: PaymentStatus;
  if (paidTotal === 0) {
    paymentStatus = refundedTotal > 0 ? 'refunded' : 'unpaid';
  } else if (refundedTotal > 0 && hasRefundedReturn) {
    paymentStatus = 'partially_refunded';
  } else if (paidTotal < orderTotal) {
    paymentStatus = 'partially_paid';
  } else if (paidTotal === orderTotal) {
    paymentStatus = 'paid';
  } else {
    paymentStatus = 'overpaid';
  }
  return {
    order_total: orderTotal,
    paid_total: paidTotal,
    refunded_total: refundedTotal,
    outstanding,
    payment_status: paymentStatus,
  };
}

/**
 * Chu ky gia lap cho webhook: sha256 hex cua
 * `${gatewayReference}:${status}:${amount}:${secret}`.
 */
export function signWebhook(
  secret: string,
  gatewayReference: string,
  status: string,
  amount: number,
): string {
  return createHash('sha256')
    .update(`${gatewayReference}:${status}:${amount}:${secret}`)
    .digest('hex');
}

/** Ghi 1 event append-only cho payment (chi INSERT, khong sua/xoa). */
export function insertPaymentEvent(
  db: DatabaseSync,
  paymentId: number,
  eventType: string,
  actorId: number | null,
  detail: Record<string, unknown> | null,
): void {
  db.prepare(
    `INSERT INTO payment_events (payment_id, event_type, actor_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    paymentId,
    eventType,
    actorId,
    detail === null ? null : JSON.stringify(detail),
    new Date().toISOString(),
  );
}

/** Refunds cua 1 payment, cu nhat truoc. */
export function loadPaymentRefunds(db: DatabaseSync, paymentId: number): RefundRow[] {
  return db
    .prepare('SELECT * FROM refunds WHERE payment_id = ? ORDER BY id')
    .all(paymentId) as unknown as RefundRow[];
}

/** Events cua 1 payment, theo thu tu thoi gian tang dan (cu nhat truoc, D19). */
export function loadPaymentEvents(db: DatabaseSync, paymentId: number): PaymentEventRow[] {
  return db
    .prepare('SELECT * FROM payment_events WHERE payment_id = ? ORDER BY id')
    .all(paymentId) as unknown as PaymentEventRow[];
}

/** 1 payment kem refunds + events; undefined khi khong ton tai. */
export function paymentDetail(db: DatabaseSync, paymentId: number): PaymentDetail | undefined {
  const row = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as
    | PaymentRow
    | undefined;
  if (!row) return undefined;
  return {
    ...row,
    refunds: loadPaymentRefunds(db, paymentId),
    events: loadPaymentEvents(db, paymentId),
  };
}

/** Tat ca payment cua 1 don, moi nhat truoc, kem refunds + events. */
export function listOrderPayments(db: DatabaseSync, orderId: number): PaymentDetail[] {
  const rows = db
    .prepare('SELECT id FROM payments WHERE order_id = ? ORDER BY id DESC')
    .all(orderId) as { id: number }[];
  return rows.map((r) => paymentDetail(db, r.id) as PaymentDetail);
}

/** Tong refund 'completed' cua 1 payment (tinh trong transaction khi hoan). */
export function completedRefundTotal(db: DatabaseSync, paymentId: number): number {
  const row = db
    .prepare(
      "SELECT COALESCE(SUM(amount), 0) AS s FROM refunds WHERE payment_id = ? AND status = 'completed'",
    )
    .get(paymentId) as { s: number };
  return row.s;
}
