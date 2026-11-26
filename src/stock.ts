/**
 * Kho / ton (GOAL-004) — STUB cho Tester.
 * Worker se dien logic that: so hoc ton (available = on_hand - reserved),
 * helper giao dich BEGIN IMMEDIATE + idempotency trong transaction.
 * Moi ham hien tai deu nem "not implemented" de test acceptance DO dung ly do.
 */
import type { DatabaseSync } from 'node:sqlite';

export type StockMovementType =
  | 'in'
  | 'out'
  | 'adjust'
  | 'count'
  | 'transfer_in'
  | 'transfer_out'
  | 'reserve'
  | 'release';

/** Mot dong ton cua mot bien the trong mot kho (available la so tinh duoc). */
export interface StockLevelRow {
  warehouse_id: number;
  variant_id: number;
  on_hand: number;
  reserved: number;
  available: number;
  low_stock: boolean;
}

export interface ApplyMovementInput {
  warehouse_id: number;
  variant_id: number;
  type: StockMovementType;
  /** Phan thay doi cua ton thuc te, co dau (nhap +, xuat -, giu hang 0). */
  qty_change: number;
  /** Phan thay doi cua ton giu, co dau (mac dinh 0). */
  reserved_change?: number;
  reason: string;
  reference?: string | null;
}

/**
 * Doc muc ton hien tai cua mot bien the trong mot kho; tra null khi chua co
 * dong ton nao. available = on_hand - reserved; low_stock khi
 * available < products.min_stock.
 */
export function stockLevel(
  _db: DatabaseSync,
  _orgId: number,
  _warehouseId: number,
  _variantId: number,
): StockLevelRow | null {
  throw new Error('not implemented');
}

/**
 * Ap dung mot bien dong ton trong transaction BEGIN IMMEDIATE: cap nhat
 * stock_levels (tao dong neu chua co), ghi 1 dong stock_movements append-only
 * (qty_change + reserved_change, on_hand_after/reserved_after, reason,
 * reference, actor), tra muc ton moi. Nem loi khi vi pham bat bien
 * (on_hand < 0, reserved < 0, reserved > on_hand) va khong ghi gi.
 */
export function applyMovement(
  _db: DatabaseSync,
  _orgId: number,
  _actorId: number,
  _input: ApplyMovementInput,
): StockLevelRow {
  throw new Error('not implemented');
}

/**
 * Idempotency cho thao tac ton: kiem tra key + thuc thi + ghi key nam trong
 * CUNG MOT transaction BEGIN IMMEDIATE (ten mien key la
 * `stock:<loai thao tac>:<key>`, do tang route dat). Gui lai cung key + cung
 * loai + cung org tra dung ket qua da luu kem replayed: true, khong thuc
 * thi lai. Key khac nhau thi thuc thi binh thuong.
 */
export function withStockIdempotency<T>(
  _db: DatabaseSync,
  _orgId: number,
  _key: string,
  _execute: () => T,
): { replayed: boolean; result: T } {
  throw new Error('not implemented');
}
