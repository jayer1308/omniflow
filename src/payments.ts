/**
 * Thanh toan + hoan tien (GOAL-006) — STUB cho Tester.
 * Worker se dien logic that: doi soat don-thanh toan tinh o service tu bang
 * payments/refunds (khong luu cot tong rieng), chu ky webhook gia lap.
 * Moi ham hien tai deu nem "not implemented" de test acceptance DO dung ly do.
 */
import type { DatabaseSync } from 'node:sqlite';

export type PaymentStatus = 'unpaid' | 'partially_paid' | 'paid' | 'overpaid' | 'refunded';

export interface OrderPaymentSummary {
  order_total: number;
  paid_total: number;
  refunded_total: number;
  outstanding: number;
  payment_status: PaymentStatus;
}

/**
 * Tom tat doi soat cua mot don: order_total (tong don GOAL-005),
 * paid_total (tong payment 'paid' tru tong refund 'completed'),
 * refunded_total, outstanding (order_total - paid_total, am nghia la thua),
 * payment_status suy ra (unpaid/partially_paid/paid/overpaid/refunded).
 */
export function computePaymentSummary(
  _db: DatabaseSync,
  _orderId: number,
): OrderPaymentSummary {
  throw new Error('not implemented');
}

/**
 * Chu ky gia lap cho webhook: sha256 hex cua
 * `${gatewayReference}:${status}:${amount}:${secret}`.
 */
export function signWebhook(
  _secret: string,
  _gatewayReference: string,
  _status: string,
  _amount: number,
): string {
  throw new Error('not implemented');
}
