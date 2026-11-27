/**
 * Don hang da kenh + vong doi (GOAL-005, xem docs/DECISIONS.md D19).
 * - State machine: draft -> confirmed -> processing -> completed /
 *   cancelled (chuyen sai -> 400).
 * - Ma don DH-YYYYMMDD-NNNN, so thu tu trong ngay theo tung org, tinh
 *   trong cung transaction tao don.
 * - Gia snapshot tai thoi diem dat: resolve bang resolveEffectivePrice()
 *   (fallback 8 buoc, D20) theo channel + branch_id cua don.
 * - Giu/giai phong/xuat kho qua applyMovement trong transaction BEGIN
 *   IMMEDIATE; hoan tat = release + out trong CUNG MOT transaction
 *   (KHONG them loai movement moi).
 * - Idempotency: route boc createOrderTx/transitionOrderTx bang
 *   withStockIdempotency (ten mien order:create:<key> /
 *   order:<hanh dong>:<key>); moi ham Tx o day PHAI chay trong mot
 *   transaction (runStockTransaction/withStockIdempotency) — goi truc
 *   tiep ngoai transaction se ghi le te khi loi giua chung.
 *
 * Loi nghiep vu nem ra la Error co ma o dau message, route map sang HTTP:
 * 'bad_request' -> 400, 'not_found' -> 404, 'forbidden' -> 403,
 * 'insufficient_stock' -> 400 (kem code insufficient_stock),
 * 'invalid_stock' -> 400 (tu applyMovement).
 */
import type { DatabaseSync } from 'node:sqlite';
import { resolveEffectivePrice } from './products.js';
import { can, type Actor } from './rbac.js';
import { applyMovement } from './stock.js';

export type OrderStatus = 'draft' | 'confirmed' | 'processing' | 'completed' | 'cancelled';

/** Trang thai dich den hop le cho tung trang thai hien tai (state machine). */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

export type OrderAction = 'confirm' | 'process' | 'complete' | 'cancel';

const ACTION_TO_STATUS: Record<OrderAction, OrderStatus> = {
  confirm: 'confirmed',
  process: 'processing',
  complete: 'completed',
  cancel: 'cancelled',
};

const ORDER_STATUSES: OrderStatus[] = ['draft', 'confirmed', 'processing', 'completed', 'cancelled'];
const ORDER_CHANNELS = ['counter', 'web', 'api'] as const;

export interface OrderRow {
  id: number;
  org_id: number;
  branch_id: number;
  warehouse_id: number;
  code: string;
  channel: string;
  customer_name: string | null;
  /** GOAL-008: khách gắn với đơn (NULL = đơn không gắn khách, như trước). */
  customer_id: number | null;
  /** GOAL-008: tiền đã trừ bằng điểm đổi (mặc định 0). */
  points_discount: number;
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

/** Don day du tra cho client: don kem items + events (cu nhat truoc). */
export interface OrderDetail extends OrderRow {
  items: OrderItemRow[];
  events: OrderEventRow[];
}

export interface OrderCreateItemInput {
  variant_id: number;
  qty: number;
}

export interface OrderCreateInput {
  branch_id?: unknown;
  warehouse_id?: unknown;
  channel?: unknown;
  customer_name?: unknown;
  /** GOAL-008: id khách gắn với đơn (optional, không gửi thì như trước). */
  customer_id?: unknown;
  items?: unknown;
}

export interface OrderListQuery {
  status?: unknown;
  channel?: unknown;
  code?: unknown;
  customer_name?: unknown;
  branch_id?: unknown;
  warehouse_id?: unknown;
  limit?: unknown;
  offset?: unknown;
}

/**
 * true khi chuyen tu `from` sang `to` la chuyen doi hop le duy nhat theo
 * state machine (draft -> confirmed/cancelled, confirmed -> processing/
 * cancelled, processing -> completed/cancelled).
 */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return (ORDER_TRANSITIONS[from] as OrderStatus[]).includes(to);
}

/** Tien to ngay cua ma don: DH-YYYYMMDD (gio dia phuong). */
function dayPrefix(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `DH-${y}${m}${d}`;
}

/**
 * Ma don doc duoc dang DH-YYYYMMDD-NNNN (NNNN la so thu tu trong ngay cua
 * org, 4 chu so, dem tu 1; vd ngay 2026-11-27, don thu 3 -> DH-20261127-0003).
 */
export function formatOrderCode(date: Date, seq: number): string {
  return `${dayPrefix(date)}-${String(seq).padStart(4, '0')}`;
}

function bad(message: string): Error {
  return new Error(`bad_request: ${message}`);
}

function notFound(message: string): Error {
  return new Error(`not_found: ${message}`);
}

function forbidden(message: string): Error {
  return new Error(`forbidden: ${message}`);
}

interface VariantRow {
  id: number;
  org_id: number;
  product_id: number;
  sku: string;
  name: string;
  price_override: number | null;
}

interface ProductRow {
  id: number;
  org_id: number;
  price: number;
  status: string;
}

function loadOrder(db: DatabaseSync, orderId: number): OrderRow {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as
    | OrderRow
    | undefined;
  if (!order) throw notFound('không tìm thấy đơn hàng');
  return order;
}

function loadOrderItems(db: DatabaseSync, orderId: number): OrderItemRow[] {
  return db
    .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id')
    .all(orderId) as unknown as OrderItemRow[];
}

function loadOrderEvents(db: DatabaseSync, orderId: number): OrderEventRow[] {
  // Lich su tra theo thu tu thoi gian tang dan (cu nhat truoc) — D19.
  return db
    .prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY id')
    .all(orderId) as unknown as OrderEventRow[];
}

/** Don kem items + events, doc tu DB (khong kiem tra quyen o day). */
export function orderDetail(db: DatabaseSync, orderId: number): OrderDetail {
  const order = loadOrder(db, orderId);
  return { ...order, items: loadOrderItems(db, orderId), events: loadOrderEvents(db, orderId) };
}

function insertOrderEvent(
  db: DatabaseSync,
  orderId: number,
  fromStatus: OrderStatus | null,
  toStatus: OrderStatus,
  actorId: number,
  note: string | null,
): void {
  db.prepare(
    'INSERT INTO order_events (order_id, from_status, to_status, actor_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(orderId, fromStatus, toStatus, actorId, note, new Date().toISOString());
}

/** Ghi audit_log cho thao tac don (lop ghi nhan rieng, khac order_events). */
function writeOrderAudit(
  db: DatabaseSync,
  orgId: number,
  actorId: number,
  action: string,
  order: OrderRow,
  fromStatus: OrderStatus | null,
  toStatus: OrderStatus,
): void {
  db.prepare(
    'INSERT INTO audit_log (org_id, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(
    orgId,
    actorId,
    action,
    JSON.stringify({
      target_order_id: order.id,
      order_code: order.code,
      from_status: fromStatus,
      to_status: toStatus,
      total: order.total,
    }),
    new Date().toISOString(),
  );
}

/**
 * Tao don trong transaction (route boc bang withStockIdempotency khi co key,
 * runStockTransaction khi khong). Don moi o draft, KHONG giu hang, KHONG
 * tru kho; total do server tinh tu gia snapshot, khong tin client.
 */
export function createOrderTx(db: DatabaseSync, actor: Actor, body: OrderCreateInput): OrderDetail {
  const orgId = actor.orgId;
  const channel = body.channel;
  if (typeof channel !== 'string' || !(ORDER_CHANNELS as readonly string[]).includes(channel)) {
    throw bad('channel phải thuộc counter/web/api');
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw bad('items phải là mảng không rỗng');
  }
  const seen = new Set<number>();
  const lines: OrderCreateItemInput[] = [];
  for (const raw of body.items as unknown[]) {
    if (typeof raw !== 'object' || raw === null) throw bad('dòng đơn không hợp lệ');
    const variantId = (raw as { variant_id?: unknown }).variant_id;
    const qty = (raw as { qty?: unknown }).qty;
    if (typeof variantId !== 'number' || !Number.isInteger(variantId)) {
      throw bad('variant_id không hợp lệ');
    }
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty <= 0) {
      throw bad('qty phải là số nguyên > 0');
    }
    if (seen.has(variantId)) throw bad('trùng biến thể trong cùng một đơn');
    seen.add(variantId);
    lines.push({ variant_id: variantId, qty });
  }
  // Chi nhanh cua don: user co chi nhanh thi don thuoc chi nhanh do (body
  // gui branch_id khac -> 403); user toan org thi body PHAI co branch_id.
  let branchId: number;
  const bodyBranch = body.branch_id;
  if (actor.branchId !== null) {
    if (bodyBranch !== undefined && bodyBranch !== null) {
      if (
        typeof bodyBranch !== 'number' ||
        !Number.isInteger(bodyBranch) ||
        bodyBranch !== actor.branchId
      ) {
        throw forbidden('branch_id khác chi nhánh của bạn');
      }
    }
    branchId = actor.branchId;
  } else {
    if (typeof bodyBranch !== 'number' || !Number.isInteger(bodyBranch)) {
      throw bad('branch_id bắt buộc với user toàn org');
    }
    const branch = db.prepare('SELECT org_id FROM branches WHERE id = ?').get(bodyBranch) as
      | { org_id: number }
      | undefined;
    if (!branch) throw notFound('không tìm thấy chi nhánh');
    if (branch.org_id !== orgId) throw forbidden('chi nhánh không thuộc doanh nghiệp của bạn');
    branchId = bodyBranch;
  }
  // Kho xuat hang: phai ton tai trong org (404/403), khong co kho mac dinh.
  const warehouseId = body.warehouse_id;
  if (typeof warehouseId !== 'number' || !Number.isInteger(warehouseId)) {
    throw bad('warehouse_id không hợp lệ');
  }
  const warehouse = db.prepare('SELECT org_id, status FROM warehouses WHERE id = ?').get(
    warehouseId,
  ) as { org_id: number; status: string } | undefined;
  if (!warehouse) throw notFound('không tìm thấy kho');
  if (warehouse.org_id !== orgId) throw forbidden('kho không thuộc doanh nghiệp của bạn');
  if (!can(actor, 'create-order', { orgId, branchId, warehouseId })) {
    throw forbidden('bạn không được phép tạo đơn');
  }
  if (warehouse.status !== 'active') throw bad('kho không hoạt động, không tạo đơn được');
  // GOAL-008: customer_id optional — có gửi thì khách phải tồn tại trong
  // org (không tồn tại -> 404, ngoài org -> 403, khách merged -> 400);
  // không gửi thì đơn không gắn khách như trước.
  let customerId: number | null = null;
  if (body.customer_id !== undefined && body.customer_id !== null) {
    if (typeof body.customer_id !== 'number' || !Number.isInteger(body.customer_id)) {
      throw bad('customer_id không hợp lệ');
    }
    const customer = db
      .prepare('SELECT org_id, status FROM customers WHERE id = ?')
      .get(body.customer_id) as { org_id: number; status: string } | undefined;
    if (!customer) throw notFound('không tìm thấy khách hàng');
    if (customer.org_id !== orgId) throw forbidden('khách hàng không thuộc doanh nghiệp của bạn');
    if (customer.status === 'merged') throw bad('khách hàng đã hợp nhất, không tạo đơn mới được');
    customerId = body.customer_id;
  }
  // Giai quyet gia tung dong + kiem tra bien the/san pham.
  const customerName =
    typeof body.customer_name === 'string' ? body.customer_name : null;
  const priced: { variant: VariantRow; product: ProductRow; price: number; source: string }[] = [];
  for (const line of lines) {
    const variant = db
      .prepare('SELECT * FROM product_variants WHERE id = ?')
      .get(line.variant_id) as VariantRow | undefined;
    if (!variant) throw notFound('không tìm thấy biến thể');
    if (variant.org_id !== orgId) throw forbidden('biến thể không thuộc doanh nghiệp của bạn');
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(variant.product_id) as
      | ProductRow
      | undefined;
    if (!product) throw notFound('không tìm thấy sản phẩm');
    if (product.status === 'discontinued') {
      throw bad('sản phẩm đã ngừng kinh doanh, không tạo đơn được');
    }
    const resolved = resolveEffectivePrice(db, {
      productId: product.id,
      basePrice: product.price,
      variantId: variant.id,
      variantOverride: variant.price_override,
      channel,
      branchId,
    });
    priced.push({ variant, product, price: resolved.price, source: resolved.source });
  }
  // Ma don: so thu tu trong ngay cua org, dem trong cung transaction.
  const now = new Date();
  const prefix = dayPrefix(now);
  const countRow = db
    .prepare('SELECT COUNT(*) AS c FROM orders WHERE org_id = ? AND code LIKE ?')
    .get(orgId, `${prefix}-%`) as { c: number };
  const code = formatOrderCode(now, countRow.c + 1);
  const total = priced.reduce((sum, p, i) => sum + p.price * lines[i].qty, 0);
  const nowIso = now.toISOString();
  const orderId = Number(
    db
      .prepare(
        `INSERT INTO orders (org_id, branch_id, warehouse_id, code, channel, customer_name,
          customer_id, status, total, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
      )
      .run(orgId, branchId, warehouseId, code, channel, customerName, customerId, total, actor.id, nowIso, nowIso)
      .lastInsertRowid,
  );
  priced.forEach((p, i) => {
    db.prepare(
      `INSERT INTO order_items (order_id, variant_id, product_id, sku, name, unit_price,
        price_source, qty, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      orderId,
      p.variant.id,
      p.product.id,
      p.variant.sku,
      p.variant.name,
      p.price,
      p.source,
      lines[i].qty,
      p.price * lines[i].qty,
    );
  });
  insertOrderEvent(db, orderId, null, 'draft', actor.id, null);
  const created = loadOrder(db, orderId);
  writeOrderAudit(db, orgId, actor.id, 'create-order', created, null, 'draft');
  return orderDetail(db, orderId);
}

/**
 * Chuyen trang thai don trong transaction (route boc bang
 * withStockIdempotency khi co key, runStockTransaction khi khong).
 * - confirm: giu hang nguyen tu moi dong (thieu ton -> 400
 *   insufficient_stock, rollback toan bo, don o lai draft).
 * - cancel tu confirmed/processing: giai phong dung so da giu; tu draft:
 *   chi doi trang thai.
 * - complete tu processing: moi dong release + out trong CUNG transaction.
 * - process: chi doi trang thai, khong dong kho.
 * Chuyen sai -> 400, khong doi gi, khong ghi event, khong dong kho.
 */
export function transitionOrderTx(
  db: DatabaseSync,
  actor: Actor,
  orderId: number,
  action: OrderAction,
  note: string | null,
): OrderDetail {
  const order = loadOrder(db, orderId);
  if (order.org_id !== actor.orgId) throw forbidden('đơn không thuộc doanh nghiệp của bạn');
  const to = ACTION_TO_STATUS[action];
  if (!can(actor, `${action}-order`, {
    orgId: actor.orgId,
    branchId: order.branch_id,
    warehouseId: order.warehouse_id,
  })) {
    throw forbidden('bạn không được phép thực hiện thao tác này trên đơn');
  }
  if (!canTransition(order.status, to)) {
    throw bad(`không thể chuyển đơn từ ${order.status} sang ${to}`);
  }
  const items = loadOrderItems(db, orderId);
  const nowIso = new Date().toISOString();
  if (action === 'confirm') {
    const warehouse = db
      .prepare('SELECT status FROM warehouses WHERE id = ?')
      .get(order.warehouse_id) as { status: string } | undefined;
    if (!warehouse || warehouse.status !== 'active') {
      throw bad('kho không hoạt động, không xác nhận được đơn');
    }
    for (const item of items) {
      applyMovement(db, actor.orgId, actor.id, {
        warehouse_id: order.warehouse_id,
        variant_id: item.variant_id,
        type: 'reserve',
        qty_change: 0,
        reserved_change: item.qty,
        reason: `giữ hàng cho đơn ${order.code}`,
        reference: order.code,
      });
    }
  } else if (action === 'cancel') {
    if (order.status === 'confirmed' || order.status === 'processing') {
      for (const item of items) {
        applyMovement(db, actor.orgId, actor.id, {
          warehouse_id: order.warehouse_id,
          variant_id: item.variant_id,
          type: 'release',
          qty_change: 0,
          reserved_change: -item.qty,
          reason: `giải phóng hàng đơn ${order.code} đã hủy`,
          reference: order.code,
        });
      }
    }
  } else if (action === 'complete') {
    for (const item of items) {
      // Giai phong giu truoc roi moi xuat: 'out' yeu cau qty <= available
      // va KHONG tru reserved (D17) — xuat truc tiep se de reserved treo.
      applyMovement(db, actor.orgId, actor.id, {
        warehouse_id: order.warehouse_id,
        variant_id: item.variant_id,
        type: 'release',
        qty_change: 0,
        reserved_change: -item.qty,
        reason: `xuất kho cho đơn ${order.code} hoàn tất`,
        reference: order.code,
      });
      applyMovement(db, actor.orgId, actor.id, {
        warehouse_id: order.warehouse_id,
        variant_id: item.variant_id,
        type: 'out',
        qty_change: -item.qty,
        reserved_change: 0,
        reason: `xuất kho cho đơn ${order.code} hoàn tất`,
        reference: order.code,
      });
    }
  }
  db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(
    to,
    nowIso,
    orderId,
  );
  insertOrderEvent(db, orderId, order.status, to, actor.id, note);
  const updated = loadOrder(db, orderId);
  writeOrderAudit(db, actor.orgId, actor.id, `${action}-order`, updated, order.status, to);
  return orderDetail(db, orderId);
}

/** Doc chi tiet don: org + vai + pham vi chi nhanh/kho (403 khi sai). */
export function getOrderDetail(db: DatabaseSync, actor: Actor, orderId: number): OrderDetail {
  const order = loadOrder(db, orderId);
  if (order.org_id !== actor.orgId) throw forbidden('đơn không thuộc doanh nghiệp của bạn');
  if (
    !can(actor, 'view-orders', {
      orgId: actor.orgId,
      branchId: order.branch_id,
      warehouseId: order.warehouse_id,
    })
  ) {
    throw forbidden('bạn không được phép xem đơn này');
  }
  return orderDetail(db, orderId);
}

function parseListInt(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/**
 * Danh sach don cua org, moi nhat truoc; loc theo status/channel/code/
 * customer_name (chuoi con, khong phan biet hoa thuong)/branch_id/
 * warehouse_id; limit mac dinh 20 toi da 100, offset mac dinh 0; kem
 * tong so de phan trang. Loc them theo pham vi vai: sales chi chi nhanh
 * minh, warehouse chi kho duoc gan (warehouse_id NULL = moi kho).
 */
export function listOrders(
  db: DatabaseSync,
  actor: Actor,
  query: OrderListQuery,
): { orders: OrderRow[]; total: number } {
  const orgId = actor.orgId;
  const status = typeof query.status === 'string' && query.status !== '' ? query.status : undefined;
  if (status !== undefined && !(ORDER_STATUSES as string[]).includes(status)) {
    throw bad('status không hợp lệ');
  }
  const channel =
    typeof query.channel === 'string' && query.channel !== '' ? query.channel : undefined;
  if (channel !== undefined && !(ORDER_CHANNELS as readonly string[]).includes(channel)) {
    throw bad('channel không hợp lệ');
  }
  const code = typeof query.code === 'string' && query.code !== '' ? query.code : undefined;
  const customerName =
    typeof query.customer_name === 'string' && query.customer_name !== ''
      ? query.customer_name
      : undefined;
  let branchFilter: number | null = null;
  if (query.branch_id !== undefined) {
    const n = parseListInt(query.branch_id);
    if (n === null) throw bad('branch_id không hợp lệ');
    const branch = db.prepare('SELECT org_id FROM branches WHERE id = ?').get(n) as
      | { org_id: number }
      | undefined;
    if (!branch) throw notFound('không tìm thấy chi nhánh');
    if (branch.org_id !== orgId) throw forbidden('chi nhánh không thuộc doanh nghiệp của bạn');
    branchFilter = n;
  }
  let warehouseFilter: number | null = null;
  if (query.warehouse_id !== undefined) {
    const n = parseListInt(query.warehouse_id);
    if (n === null) throw bad('warehouse_id không hợp lệ');
    const warehouse = db.prepare('SELECT org_id FROM warehouses WHERE id = ?').get(n) as
      | { org_id: number }
      | undefined;
    if (!warehouse) throw notFound('không tìm thấy kho');
    if (warehouse.org_id !== orgId) throw forbidden('kho không thuộc doanh nghiệp của bạn');
    warehouseFilter = n;
  }
  // Gate vai: muc tieu la bo loc nguoi dung xin (mac dinh ve pham vi cua
  // chinh actor) — sales xin chi nhanh khac / warehouse xin kho khac -> 403.
  if (
    !can(actor, 'view-orders', {
      orgId,
      branchId: branchFilter ?? actor.branchId ?? null,
      warehouseId: warehouseFilter ?? actor.warehouseId ?? null,
    })
  ) {
    throw forbidden('bạn không được phép xem danh sách đơn này');
  }
  let where = 'WHERE org_id = ?';
  const params: (number | string)[] = [orgId];
  if (actor.role === 'sales' && actor.branchId !== null) {
    where += ' AND branch_id = ?';
    params.push(actor.branchId);
  }
  if (actor.role === 'warehouse' && actor.warehouseId !== null && actor.warehouseId !== undefined) {
    where += ' AND warehouse_id = ?';
    params.push(actor.warehouseId);
  }
  if (branchFilter !== null) {
    where += ' AND branch_id = ?';
    params.push(branchFilter);
  }
  if (warehouseFilter !== null) {
    where += ' AND warehouse_id = ?';
    params.push(warehouseFilter);
  }
  if (status !== undefined) {
    where += ' AND status = ?';
    params.push(status);
  }
  if (channel !== undefined) {
    where += ' AND channel = ?';
    params.push(channel);
  }
  if (code !== undefined) {
    where += ' AND code LIKE ?';
    params.push(`%${code}%`);
  }
  if (customerName !== undefined) {
    where += ' AND customer_name LIKE ?';
    params.push(`%${customerName}%`);
  }
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM orders ${where}`)
    .get(...params) as { c: number };
  const limitRaw = parseListInt(query.limit);
  const limit = limitRaw === null ? 20 : Math.min(100, Math.max(0, limitRaw));
  const offsetRaw = parseListInt(query.offset);
  const offset = offsetRaw === null ? 0 : Math.max(0, offsetRaw);
  const orders = db
    .prepare(`SELECT * FROM orders ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as unknown as OrderRow[];
  return { orders, total: totalRow.c };
}
