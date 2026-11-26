/**
 * Kho / tồn (GOAL-004, xem docs/DECISIONS.md D17).
 * Số học tồn: available = on_hand - reserved (số tính được, không lưu cột).
 * Mọi biến động chạy trong transaction BEGIN IMMEDIATE + bất biến ép bằng
 * CHECK ở schema (on_hand >= 0, reserved >= 0, reserved <= on_hand).
 * Idempotency cho kho: kiểm tra key + thực thi + ghi key nằm trong CÙNG
 * MỘT transaction (không dùng withIdempotency của GOAL-001 một cách ngây
 * thơ — nó kiểm tra key ngoài transaction nên 2 yêu cầu cùng key chạy
 * đồng thời có thể cùng lọt qua).
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

/** Một dòng tồn của một biến thể trong một kho (available là số tính được). */
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
  /** Phần thay đổi của tồn thực tế, có dấu (nhập +, xuất -, giữ hàng 0). */
  qty_change: number;
  /** Phần thay đổi của tồn giữ, có dấu (mặc định 0). */
  reserved_change?: number;
  reason: string;
  reference?: string | null;
}

/**
 * Chạy fn trong một transaction BEGIN IMMEDIATE. Nếu db đang ở trong một
 * transaction kho rồi (gọi lồng nhau: withStockIdempotency -> applyMovement)
 * thì chạy thẳng fn, không mở transaction mới — node:sqlite là đồng bộ, một
 * tiến trình, nên cờ module-level này đủ để nhận biết transaction lồng nhau.
 */
const inStockTx = new WeakSet<object>();

export function runStockTransaction<T>(db: DatabaseSync, fn: () => T): T {
  if (inStockTx.has(db)) return fn();
  db.exec('BEGIN IMMEDIATE');
  inStockTx.add(db);
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Đã rollback / transaction đã mất: bỏ qua, lỗi gốc mới quan trọng.
    }
    throw err;
  } finally {
    inStockTx.delete(db);
  }
}

/** Ngưỡng tồn thấp của biến thể = products.min_stock (D15, cấp sản phẩm). */
function minStockOf(db: DatabaseSync, variantId: number): number {
  const row = db
    .prepare(
      `SELECT p.min_stock AS min_stock FROM product_variants v
       JOIN products p ON p.id = v.product_id WHERE v.id = ?`,
    )
    .get(variantId) as { min_stock: number } | undefined;
  return row ? row.min_stock : 0;
}

function toLevelRow(
  db: DatabaseSync,
  warehouseId: number,
  variantId: number,
  onHand: number,
  reserved: number,
): StockLevelRow {
  const available = onHand - reserved;
  return {
    warehouse_id: warehouseId,
    variant_id: variantId,
    on_hand: onHand,
    reserved,
    available,
    low_stock: available < minStockOf(db, variantId),
  };
}

/**
 * Đọc mức tồn hiện tại của một biến thể trong một kho; trả null khi chưa có
 * dòng tồn nào. available = on_hand - reserved; low_stock khi
 * available < products.min_stock.
 */
export function stockLevel(
  db: DatabaseSync,
  orgId: number,
  warehouseId: number,
  variantId: number,
): StockLevelRow | null {
  const row = db
    .prepare(
      'SELECT on_hand, reserved FROM stock_levels WHERE org_id = ? AND warehouse_id = ? AND variant_id = ?',
    )
    .get(orgId, warehouseId, variantId) as { on_hand: number; reserved: number } | undefined;
  if (!row) return null;
  return toLevelRow(db, warehouseId, variantId, row.on_hand, row.reserved);
}

/**
 * Áp dụng một biến động tồn trong transaction BEGIN IMMEDIATE: cập nhật
 * stock_levels (tạo dòng nếu chưa có), ghi 1 dòng stock_movements append-only
 * (qty_change + reserved_change, on_hand_after/reserved_after, reason,
 * reference, actor), trả mức tồn mới. Ném lỗi khi vi phạm bất biến
 * (on_hand < 0, reserved < 0, reserved > on_hand, xuất/giữ vượt available)
 * và không ghi gì (transaction rollback).
 *
 * Quy tắc theo loại (D17 — chính sách không tồn âm):
 * - 'out'/'transfer_out': qty_change < 0, |qty_change| <= available.
 * - 'reserve': qty_change = 0, 0 < reserved_change <= available.
 * - 'release': qty_change = 0, reserved_change < 0, |reserved_change| <= reserved.
 * - 'in'/'transfer_in': qty_change > 0. 'adjust': qty_change != 0.
 * - 'count': đặt on_hand tuyệt đối qua qty_change, không dưới reserved.
 * Lỗi ném ra có mã ở đầu message: 'insufficient_stock' | 'invalid_stock'.
 */
export function applyMovement(
  db: DatabaseSync,
  orgId: number,
  actorId: number,
  input: ApplyMovementInput,
): StockLevelRow {
  return runStockTransaction(db, () => {
    const qtyChange = input.qty_change;
    const reservedChange = input.reserved_change ?? 0;
    if (!Number.isInteger(qtyChange) || !Number.isInteger(reservedChange)) {
      throw new Error('invalid_stock: qty_change và reserved_change phải là số nguyên');
    }
    if (typeof input.reason !== 'string' || input.reason.trim().length === 0) {
      throw new Error('invalid_stock: reason bắt buộc');
    }
    const warehouse = db
      .prepare('SELECT org_id FROM warehouses WHERE id = ?')
      .get(input.warehouse_id) as { org_id: number } | undefined;
    if (!warehouse) throw new Error('not_found: không tìm thấy kho');
    if (warehouse.org_id !== orgId) throw new Error('not_found: kho ngoài doanh nghiệp');
    const variant = db
      .prepare('SELECT org_id FROM product_variants WHERE id = ?')
      .get(input.variant_id) as { org_id: number } | undefined;
    if (!variant) throw new Error('not_found: không tìm thấy biến thể');
    if (variant.org_id !== orgId) throw new Error('not_found: biến thể ngoài doanh nghiệp');
    const current = stockLevel(db, orgId, input.warehouse_id, input.variant_id);
    const oldOnHand = current ? current.on_hand : 0;
    const oldReserved = current ? current.reserved : 0;
    const available = oldOnHand - oldReserved;
    switch (input.type) {
      case 'out':
      case 'transfer_out':
        if (qtyChange >= 0) throw new Error('invalid_stock: xuất/chuyển kho phải có qty_change âm');
        if (-qtyChange > available) {
          throw new Error(
            `insufficient_stock: chỉ còn ${available} có thể bán, yêu cầu ${-qtyChange}`,
          );
        }
        break;
      case 'reserve':
        if (qtyChange !== 0) throw new Error('invalid_stock: giữ hàng không đổi tồn thực tế');
        if (reservedChange <= 0) throw new Error('invalid_stock: giữ hàng phải có qty > 0');
        if (reservedChange > available) {
          throw new Error(
            `insufficient_stock: chỉ còn ${available} có thể bán, yêu cầu giữ ${reservedChange}`,
          );
        }
        break;
      case 'release':
        if (qtyChange !== 0) throw new Error('invalid_stock: giải phóng không đổi tồn thực tế');
        if (reservedChange >= 0) throw new Error('invalid_stock: giải phóng phải có qty > 0');
        if (-reservedChange > oldReserved) {
          throw new Error(
            `invalid_stock: chỉ còn ${oldReserved} đang giữ, yêu cầu giải phóng ${-reservedChange}`,
          );
        }
        break;
      case 'in':
      case 'transfer_in':
        if (qtyChange <= 0) throw new Error('invalid_stock: nhập/chuyển vào phải có qty > 0');
        break;
      case 'adjust':
        if (qtyChange === 0) throw new Error('invalid_stock: điều chỉnh phải có qty_change khác 0');
        break;
      case 'count':
        // qty_change = counted_qty - on_hand cũ; kiểm tra ở bất biến chung.
        break;
      default:
        throw new Error('invalid_stock: loại biến động không hợp lệ');
    }
    const newOnHand = oldOnHand + qtyChange;
    const newReserved = oldReserved + reservedChange;
    if (newOnHand < 0) throw new Error('invalid_stock: on_hand không được âm');
    if (newReserved < 0) throw new Error('invalid_stock: reserved không được âm');
    if (newReserved > newOnHand) {
      throw new Error('invalid_stock: reserved không được vượt on_hand');
    }
    const now = new Date().toISOString();
    if (current) {
      db.prepare(
        'UPDATE stock_levels SET on_hand = ?, reserved = ?, updated_at = ? WHERE org_id = ? AND warehouse_id = ? AND variant_id = ?',
      ).run(newOnHand, newReserved, now, orgId, input.warehouse_id, input.variant_id);
    } else {
      db.prepare(
        'INSERT INTO stock_levels (org_id, warehouse_id, variant_id, on_hand, reserved, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(orgId, input.warehouse_id, input.variant_id, newOnHand, newReserved, now);
    }
    db.prepare(
      `INSERT INTO stock_movements
        (org_id, warehouse_id, variant_id, type, qty_change, reserved_change,
         on_hand_after, reserved_after, reason, reference, actor_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      orgId,
      input.warehouse_id,
      input.variant_id,
      input.type,
      qtyChange,
      reservedChange,
      newOnHand,
      newReserved,
      input.reason.trim(),
      input.reference ?? null,
      actorId,
      now,
    );
    return toLevelRow(db, input.warehouse_id, input.variant_id, newOnHand, newReserved);
  });
}

/**
 * Idempotency cho thao tác tồn: kiểm tra key + thực thi + ghi key nằm trong
 * CÙNG MỘT transaction BEGIN IMMEDIATE (tên miền key là
 * `stock:<loại thao tác>:<key>`, do tầng route đặt). Gửi lại cùng key + cùng
 * loại + cùng org trả đúng kết quả đã lưu kèm replayed: true, không thực
 * thi lại. Key khác nhau thì thực thi bình thường. Kết quả được lưu dạng
 * JSON nên replay trả đúng nội dung cũ (kể cả khi execute trả chuỗi).
 * Nếu execute ném lỗi, transaction rollback — không ghi key, không ghi gì.
 */
export function withStockIdempotency<T>(
  db: DatabaseSync,
  orgId: number,
  key: string,
  execute: () => T,
): { replayed: boolean; result: T } {
  return runStockTransaction(db, () => {
    const row = db
      .prepare('SELECT response FROM idempotency_keys WHERE org_id = ? AND key = ?')
      .get(orgId, key) as { response: string } | undefined;
    if (row) return { replayed: true, result: JSON.parse(row.response) as T };
    const result = execute();
    db.prepare(
      'INSERT INTO idempotency_keys (org_id, key, response, created_at) VALUES (?, ?, ?, ?)',
    ).run(orgId, key, JSON.stringify(result), new Date().toISOString());
    return { replayed: false, result };
  });
}
