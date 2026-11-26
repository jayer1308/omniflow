/**
 * Don hang da kenh + vong doi (GOAL-005) — STUB cho Tester.
 * Worker se dien logic that: state machine, ma don DH-YYYYMMDD-NNNN,
 * snapshot gia, giu/giai phong/xuat kho qua applyMovement +
 * withStockIdempotency trong transaction BEGIN IMMEDIATE.
 * Moi ham hien tai deu nem "not implemented" de test acceptance DO dung ly do.
 */

export type OrderStatus = 'draft' | 'confirmed' | 'processing' | 'completed' | 'cancelled';

/** Trang thai dich den hop le cho tung trang thai hien tai (state machine). */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export interface OrderRow {
  id: number;
  org_id: number;
  branch_id: number;
  warehouse_id: number;
  code: string;
  channel: string;
  customer_name: string | null;
  status: OrderStatus;
  total: number;
  created_by: number;
  created_at: string;
  updated_at: string;
}

export interface OrderItemRow {
  id: number;
  order_id: number;
  variant_id: number;
  product_id: number;
  sku: string;
  name: string;
  unit_price: number;
  price_source: string;
  qty: number;
  line_total: number;
}

export interface OrderEventRow {
  id: number;
  order_id: number;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  actor_id: number;
  note: string | null;
  created_at: string;
}

/**
 * true khi chuyen tu `from` sang `to` la chuyen doi hop le duy nhat theo
 * state machine (draft -> confirmed/processing... xem ORDER_TRANSITIONS).
 */
export function canTransition(_from: OrderStatus, _to: OrderStatus): boolean {
  throw new Error('not implemented');
}

/**
 * Ma don doc duoc dang DH-YYYYMMDD-NNNN (NNNN la so thu tu trong ngay cua
 * org, 4 chu so, dem tu 1; vd ngay 2026-11-27, don thu 3 -> DH-20261127-0003).
 */
export function formatOrderCode(_date: Date, _seq: number): string {
  throw new Error('not implemented');
}
