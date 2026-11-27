/**
 * Khách hàng + CRM (GOAL-008, xem docs/DECISIONS.md D26).
 * - Hồ sơ khách cấp org, chi nhánh chính branch_id NULL = chưa gán.
 * - purchase_summary / points_balance / segment tính ở service mỗi lần
 *   đọc, KHÔNG lưu cột riêng (không có cột segment, không có cột
 *   expires_at — điểm không hết hạn, không clawback khi hoàn tiền sau).
 * - Ledger điểm + ghi chú append-only (chỉ INSERT, không API sửa/xóa).
 * - Mọi hàm Tx ở đây PHẢI chạy trong một transaction (route bọc bằng
 *   runStockOp/withStockIdempotency khi có key, runStockTransaction khi
 *   không) — như createOrderTx/transitionOrderTx (GOAL-005).
 * - Lỗi nghiệp vụ ném ra là Error có mã ở đầu message, route map sang
 *   HTTP: 'bad_request' -> 400, 'not_found' -> 404, 'forbidden' -> 403,
 *   'conflict' -> 409.
 * - Audit detail chỉ chứa id + số liệu, KHÔNG bao giờ chứa phone/email/
 *   address (PII) hay thông tin thẻ.
 */
import type { DatabaseSync } from 'node:sqlite';
import { can, type Actor } from './rbac.js';
import { orderDetail } from './orders.js';

export type CustomerStatus = 'active' | 'merged';

export type Segment = 'new' | 'frequent' | 'vip' | 'dormant';

export const SEGMENTS: Segment[] = ['new', 'frequent', 'vip', 'dormant'];

export interface CustomerRow {
  id: number;
  org_id: number;
  branch_id: number | null;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  status: CustomerStatus;
  merged_into_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface PurchaseSummary {
  total_spent: number;
  order_count: number;
  last_order_at: string | null;
}

/** Khách trả cho client: row + tóm tắt mua + số dư điểm + phân khúc. */
export interface CustomerView extends CustomerRow {
  purchase_summary: PurchaseSummary;
  points_balance: number;
  segment: Segment;
}

export interface PointsLedgerRow {
  id: number;
  customer_id: number;
  org_id: number;
  type: 'earn' | 'redeem';
  points: number;
  reason: string;
  order_id: number | null;
  created_by: number;
  created_at: string;
}

export interface NoteRow {
  id: number;
  customer_id: number;
  org_id: number;
  author_id: number;
  content: string;
  created_at: string;
}

export interface CustomerCreateInput {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  address?: unknown;
  branch_id?: unknown;
}

export interface CustomerUpdateInput {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  address?: unknown;
  branch_id?: unknown;
}

export interface CustomerListQuery {
  name?: unknown;
  phone?: unknown;
  segment?: unknown;
  branch_id?: unknown;
  limit?: unknown;
  offset?: unknown;
}

export interface PageQuery {
  limit?: unknown;
  offset?: unknown;
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

function conflict(message: string): Error {
  return new Error(`conflict: ${message}`);
}

/** Ghi audit_log cho thao tác khách/CRM (detail chỉ id + số liệu, không PII). */
function audit(
  db: DatabaseSync,
  orgId: number,
  actorId: number,
  action: string,
  detail: Record<string, unknown>,
): void {
  db.prepare(
    'INSERT INTO audit_log (org_id, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(orgId, actorId, action, JSON.stringify(detail), new Date().toISOString());
}

function loadCustomer(db: DatabaseSync, id: number): CustomerRow | undefined {
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as CustomerRow | undefined;
}

/** Nạp khách + kiểm tra org (không tồn tại -> 404, ngoài org -> 403). */
export function loadCustomerForActor(
  db: DatabaseSync,
  actor: Actor,
  id: number,
): CustomerRow {
  const row = loadCustomer(db, id);
  if (!row) throw notFound('không tìm thấy khách hàng');
  if (row.org_id !== actor.orgId) throw forbidden('khách hàng không thuộc doanh nghiệp của bạn');
  return row;
}

/** Tóm tắt mua: chỉ đơn completed (total CHƯA trừ hoàn tiền — D26). */
export function purchaseSummaryFor(db: DatabaseSync, customerId: number): PurchaseSummary {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(total), 0) AS total_spent, COUNT(*) AS order_count,
              MAX(created_at) AS last_order_at
       FROM orders WHERE customer_id = ? AND status = 'completed'`,
    )
    .get(customerId) as { total_spent: number; order_count: number; last_order_at: string | null };
  return {
    total_spent: row.total_spent,
    order_count: row.order_count,
    last_order_at: row.last_order_at,
  };
}

/** Số dư điểm = tổng earn − tổng redeem, tính ở service (D26). */
export function pointsBalanceFor(db: DatabaseSync, customerId: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN type = 'earn' THEN points ELSE -points END), 0) AS balance
       FROM customer_points WHERE customer_id = ?`,
    )
    .get(customerId) as { balance: number };
  return row.balance;
}

/**
 * Phân khúc tính ở service, ưu tiên VIP → ngủ quên → thường xuyên → mới.
 * VIP: total_spent ≥ 5.000.000đ hoặc order_count ≥ 10. Ngủ quên: có ≥ 1
 * đơn hoàn tất và lần mua cuối > 90 ngày. Thường xuyên: order_count ≥ 3.
 * Còn lại: mới.
 */
export function segmentFor(summary: PurchaseSummary): Segment {
  if (summary.total_spent >= 5000000 || summary.order_count >= 10) return 'vip';
  if (summary.order_count >= 1 && summary.last_order_at !== null) {
    const raw = summary.last_order_at;
    const iso = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`;
    const last = new Date(iso).getTime();
    if (!Number.isNaN(last) && Date.now() - last > 90 * 24 * 3600 * 1000) return 'dormant';
  }
  if (summary.order_count >= 3) return 'frequent';
  return 'new';
}

/** Khách kèm tóm tắt + số dư + phân khúc (tính mới mỗi lần đọc). */
export function customerView(db: DatabaseSync, row: CustomerRow): CustomerView {
  const summary = purchaseSummaryFor(db, row.id);
  return {
    ...row,
    purchase_summary: summary,
    points_balance: pointsBalanceFor(db, row.id),
    segment: segmentFor(summary),
  };
}

/** Chuỗi optional: undefined = không gửi, null = rỗng/xóa, chuỗi đã trim. */
function optString(body: Record<string, unknown>, key: string): string | null | undefined {
  const v = body[key];
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function requireBranchInOrg(db: DatabaseSync, orgId: number, branchId: number): void {
  const branch = db.prepare('SELECT org_id FROM branches WHERE id = ?').get(branchId) as
    | { org_id: number }
    | undefined;
  if (!branch) throw notFound('không tìm thấy chi nhánh');
  if (branch.org_id !== orgId) throw forbidden('chi nhánh không thuộc doanh nghiệp của bạn');
}

/** Trùng điện thoại với khách active khác trong org? */
function phoneTaken(
  db: DatabaseSync,
  orgId: number,
  phone: string,
  excludeId?: number,
): boolean {
  const row = db
    .prepare(
      `SELECT id FROM customers WHERE org_id = ? AND phone = ? AND status = 'active' AND id != ?`,
    )
    .get(orgId, phone, excludeId ?? -1) as { id: number } | undefined;
  return row !== undefined;
}

export function createCustomerTx(
  db: DatabaseSync,
  actor: Actor,
  body: CustomerCreateInput,
): CustomerView {
  const orgId = actor.orgId;
  const rawBranch = body.branch_id;
  let requestedBranch: number | null = null;
  if (rawBranch !== undefined && rawBranch !== null) {
    if (typeof rawBranch !== 'number' || !Number.isInteger(rawBranch)) {
      throw bad('branch_id không hợp lệ');
    }
    requestedBranch = rawBranch;
  }
  // Gate vai trước: sales gửi branch_id khác chi nhánh mình -> 403.
  const targetBranch = requestedBranch ?? actor.branchId ?? null;
  if (!can(actor, 'create-customer', { orgId, branchId: targetBranch })) {
    throw forbidden('bạn không được phép tạo khách hàng');
  }
  let branchId: number | null = null;
  if (requestedBranch !== null) {
    requireBranchInOrg(db, orgId, requestedBranch);
    branchId = requestedBranch;
  } else if (actor.role === 'sales' && actor.branchId !== null) {
    // Chỉ sales không gửi branch_id thì khách thuộc chi nhánh của mình;
    // owner/manager không gửi thì khách chưa gán chi nhánh (NULL) — seed
    // user owner/manager cũng có branch_id nên không được dùng làm mặc định.
    branchId = actor.branchId;
  }
  const name = optString(body as Record<string, unknown>, 'name');
  if (name === undefined || name === null) throw bad('name bắt buộc');
  const phone = optString(body as Record<string, unknown>, 'phone') ?? null;
  const email = optString(body as Record<string, unknown>, 'email') ?? null;
  const address = optString(body as Record<string, unknown>, 'address') ?? null;
  if (phone !== null && phoneTaken(db, orgId, phone)) {
    throw conflict('số điện thoại đã tồn tại trong doanh nghiệp');
  }
  const now = new Date().toISOString();
  const id = Number(
    db
      .prepare(
        `INSERT INTO customers (org_id, branch_id, name, phone, email, address, status,
          merged_into_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?)`,
      )
      .run(orgId, branchId, name, phone, email, address, now, now).lastInsertRowid,
  );
  audit(db, orgId, actor.id, 'create-customer', { target_customer_id: id });
  return customerView(db, loadCustomer(db, id) as CustomerRow);
}

export function updateCustomerTx(
  db: DatabaseSync,
  actor: Actor,
  id: number,
  body: CustomerUpdateInput,
): CustomerView {
  const row = loadCustomerForActor(db, actor, id);
  if (!can(actor, 'update-customer', { orgId: actor.orgId, branchId: row.branch_id })) {
    throw forbidden('bạn không được phép sửa khách hàng này');
  }
  if (row.status === 'merged') throw bad('khách hàng đã hợp nhất, không sửa được');
  const input = body as Record<string, unknown>;
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  if (input.name !== undefined) {
    const name = optString(input, 'name');
    if (name === undefined || name === null) throw bad('name không được trống');
    sets.push('name = ?');
    params.push(name);
  }
  if (input.phone !== undefined) {
    const phone = optString(input, 'phone');
    if (phone !== undefined && phone !== null && phoneTaken(db, actor.orgId, phone, id)) {
      throw conflict('số điện thoại đã tồn tại trong doanh nghiệp');
    }
    sets.push('phone = ?');
    params.push(phone ?? null);
  }
  if (input.email !== undefined) {
    sets.push('email = ?');
    params.push(optString(input, 'email') ?? null);
  }
  if (input.address !== undefined) {
    sets.push('address = ?');
    params.push(optString(input, 'address') ?? null);
  }
  if (input.branch_id !== undefined && input.branch_id !== null) {
    if (typeof input.branch_id !== 'number' || !Number.isInteger(input.branch_id)) {
      throw bad('branch_id không hợp lệ');
    }
    requireBranchInOrg(db, actor.orgId, input.branch_id);
    if (
      !can(actor, 'update-customer', { orgId: actor.orgId, branchId: input.branch_id })
    ) {
      throw forbidden('bạn không được phép chuyển khách sang chi nhánh này');
    }
    sets.push('branch_id = ?');
    params.push(input.branch_id);
  } else if (input.branch_id === null) {
    sets.push('branch_id = ?');
    params.push(null);
  }
  if (sets.length > 0) {
    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    db.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  }
  audit(db, actor.orgId, actor.id, 'update-customer', { target_customer_id: id });
  return customerView(db, loadCustomer(db, id) as CustomerRow);
}

export function getCustomerView(db: DatabaseSync, actor: Actor, id: number): CustomerView {
  const row = loadCustomerForActor(db, actor, id);
  if (!can(actor, 'view-customers', { orgId: actor.orgId, branchId: row.branch_id })) {
    throw forbidden('bạn không được phép xem khách hàng này');
  }
  return customerView(db, row);
}

function parsePage(query: PageQuery): { limit: number; offset: number } {
  const parse = (v: unknown): number | null => {
    if (typeof v !== 'string') return null;
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
  };
  const limitRaw = parse(query.limit);
  const limit = limitRaw === null ? 20 : Math.min(100, Math.max(0, limitRaw));
  const offsetRaw = parse(query.offset);
  const offset = offsetRaw === null ? 0 : Math.max(0, offsetRaw);
  return { limit, offset };
}

export function listCustomers(
  db: DatabaseSync,
  actor: Actor,
  query: CustomerListQuery,
): { customers: CustomerView[]; total: number } {
  const orgId = actor.orgId;
  const name =
    typeof query.name === 'string' && query.name.trim() !== '' ? query.name.trim() : undefined;
  const phone =
    typeof query.phone === 'string' && query.phone.trim() !== '' ? query.phone.trim() : undefined;
  const segment =
    typeof query.segment === 'string' && query.segment !== '' ? query.segment : undefined;
  if (segment !== undefined && !(SEGMENTS as string[]).includes(segment)) {
    throw bad('segment không hợp lệ');
  }
  let branchFilter: number | null = null;
  if (query.branch_id !== undefined && query.branch_id !== null && query.branch_id !== '') {
    const n = typeof query.branch_id === 'string' ? Number(query.branch_id) : NaN;
    if (!Number.isInteger(n)) throw bad('branch_id không hợp lệ');
    requireBranchInOrg(db, orgId, n);
    branchFilter = n;
  }
  // Gate vai trên bộ lọc xin: sales xin chi nhánh khác -> 403.
  if (
    !can(actor, 'view-customers', {
      orgId,
      branchId: branchFilter ?? actor.branchId ?? null,
    })
  ) {
    throw forbidden('bạn không được phép xem danh sách khách này');
  }
  let where = "WHERE org_id = ? AND status = 'active'";
  const params: (number | string)[] = [orgId];
  // Sales chỉ thấy khách thuộc chi nhánh mình (khách chưa gán bị lọc).
  if (actor.role === 'sales' && actor.branchId !== null) {
    where += ' AND branch_id = ?';
    params.push(actor.branchId);
  }
  if (branchFilter !== null) {
    where += ' AND branch_id = ?';
    params.push(branchFilter);
  }
  if (name !== undefined) {
    where += ' AND name LIKE ? COLLATE NOCASE';
    params.push(`%${name}%`);
  }
  if (phone !== undefined) {
    where += ' AND phone LIKE ? COLLATE NOCASE';
    params.push(`%${phone}%`);
  }
  const rows = db
    .prepare(`SELECT * FROM customers ${where} ORDER BY id DESC`)
    .all(...params) as unknown as CustomerRow[];
  let views = rows.map((r) => customerView(db, r));
  if (segment !== undefined) {
    views = views.filter((v) => v.segment === segment);
  }
  const total = views.length;
  const { limit, offset } = parsePage(query);
  return { customers: views.slice(offset, offset + limit), total };
}

export function listCustomerOrders(
  db: DatabaseSync,
  actor: Actor,
  customerId: number,
  query: PageQuery,
): { orders: unknown[]; total: number } {
  const row = loadCustomerForActor(db, actor, customerId);
  if (!can(actor, 'view-customers', { orgId: actor.orgId, branchId: row.branch_id })) {
    throw forbidden('bạn không được phép xem khách hàng này');
  }
  const totalRow = db
    .prepare('SELECT COUNT(*) AS c FROM orders WHERE org_id = ? AND customer_id = ?')
    .get(actor.orgId, customerId) as { c: number };
  const { limit, offset } = parsePage(query);
  const ids = db
    .prepare(
      'SELECT id FROM orders WHERE org_id = ? AND customer_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
    )
    .all(actor.orgId, customerId, limit, offset) as { id: number }[];
  return { orders: ids.map((r) => orderDetail(db, r.id)), total: totalRow.c };
}

interface OrderRowLite {
  id: number;
  org_id: number;
  customer_id: number | null;
  code: string;
  status: string;
  total: number;
  points_discount: number;
}

function loadOrderLite(db: DatabaseSync, orderId: number): OrderRowLite | undefined {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as
    | OrderRowLite
    | undefined;
}

/** Tổng hoàn 'completed' của một đơn (trừ vào tổng trước khi tính điểm). */
function completedRefundTotalForOrder(db: DatabaseSync, orderId: number): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(r.amount), 0) AS s FROM refunds r
       JOIN payments p ON p.id = r.payment_id
       WHERE p.order_id = ? AND r.status = 'completed'`,
    )
    .get(orderId) as { s: number };
  return row.s;
}

export function earnPointsTx(
  db: DatabaseSync,
  actor: Actor,
  customerId: number,
  body: { order_id?: unknown },
): { customer_id: number; points_earned: number; points_balance: number; order_id: number } {
  const cust = loadCustomerForActor(db, actor, customerId);
  if (!can(actor, 'earn-points', { orgId: actor.orgId, branchId: cust.branch_id })) {
    throw forbidden('bạn không được phép tích điểm cho khách hàng này');
  }
  if (cust.status === 'merged') throw bad('khách hàng đã hợp nhất, không tích điểm được');
  if (typeof body.order_id !== 'number' || !Number.isInteger(body.order_id)) {
    throw bad('order_id không hợp lệ');
  }
  const order = loadOrderLite(db, body.order_id);
  if (!order) throw notFound('không tìm thấy đơn hàng');
  if (order.org_id !== actor.orgId) throw forbidden('đơn không thuộc doanh nghiệp của bạn');
  if (order.customer_id !== customerId) throw bad('đơn không thuộc khách hàng này');
  if (order.status !== 'completed') throw bad('chỉ tích điểm khi đơn đã hoàn tất');
  const already = db
    .prepare(
      "SELECT id FROM customer_points WHERE customer_id = ? AND order_id = ? AND type = 'earn'",
    )
    .get(customerId, order.id) as { id: number } | undefined;
  if (already) throw bad('đơn đã tích điểm rồi');
  const refunded = completedRefundTotalForOrder(db, order.id);
  const points = Math.floor((order.total - refunded) / 10000);
  if (points < 1) throw bad('tổng đơn sau hoàn dưới 10.000đ, không tích điểm');
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO customer_points (customer_id, org_id, type, points, reason, order_id, created_by, created_at)
     VALUES (?, ?, 'earn', ?, ?, ?, ?, ?)`,
  ).run(customerId, actor.orgId, points, order.code, order.id, actor.id, now);
  const balance = pointsBalanceFor(db, customerId);
  audit(db, actor.orgId, actor.id, 'earn-points', {
    target_customer_id: customerId,
    target_order_id: order.id,
    points,
  });
  return { customer_id: customerId, points_earned: points, points_balance: balance, order_id: order.id };
}

export function redeemPointsTx(
  db: DatabaseSync,
  actor: Actor,
  customerId: number,
  body: { order_id?: unknown; points?: unknown },
): {
  customer_id: number;
  points_redeemed: number;
  discount: number;
  points_balance: number;
  order_id: number;
  order_points_discount: number;
} {
  const cust = loadCustomerForActor(db, actor, customerId);
  if (!can(actor, 'redeem-points', { orgId: actor.orgId, branchId: cust.branch_id })) {
    throw forbidden('bạn không được phép đổi điểm cho khách hàng này');
  }
  if (cust.status === 'merged') throw bad('khách hàng đã hợp nhất, không đổi điểm được');
  if (typeof body.order_id !== 'number' || !Number.isInteger(body.order_id)) {
    throw bad('order_id không hợp lệ');
  }
  const order = loadOrderLite(db, body.order_id);
  if (!order) throw notFound('không tìm thấy đơn hàng');
  if (order.org_id !== actor.orgId) throw forbidden('đơn không thuộc doanh nghiệp của bạn');
  if (order.customer_id !== customerId) throw bad('đơn không thuộc khách hàng này');
  if (order.status !== 'draft') throw bad('chỉ đổi điểm cho đơn mới ở trạng thái nháp');
  const already = db
    .prepare(
      "SELECT id FROM customer_points WHERE customer_id = ? AND order_id = ? AND type = 'redeem'",
    )
    .get(customerId, order.id) as { id: number } | undefined;
  if (already || order.points_discount > 0) throw bad('đơn đã đổi điểm rồi');
  if (typeof body.points !== 'number' || !Number.isInteger(body.points) || body.points <= 0) {
    throw bad('points phải là số nguyên > 0');
  }
  const balance = pointsBalanceFor(db, customerId);
  if (body.points > balance) throw bad('số điểm đổi vượt số dư');
  const discount = Math.min(body.points * 100, order.total);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO customer_points (customer_id, org_id, type, points, reason, order_id, created_by, created_at)
     VALUES (?, ?, 'redeem', ?, ?, ?, ?, ?)`,
  ).run(customerId, actor.orgId, body.points, order.code, order.id, actor.id, now);
  db.prepare('UPDATE orders SET points_discount = ?, updated_at = ? WHERE id = ?').run(
    discount,
    now,
    order.id,
  );
  const newBalance = pointsBalanceFor(db, customerId);
  audit(db, actor.orgId, actor.id, 'redeem-points', {
    target_customer_id: customerId,
    target_order_id: order.id,
    points: body.points,
  });
  return {
    customer_id: customerId,
    points_redeemed: body.points,
    discount,
    points_balance: newBalance,
    order_id: order.id,
    order_points_discount: discount,
  };
}

export function pointsOf(
  db: DatabaseSync,
  actor: Actor,
  customerId: number,
): { balance: number; ledger: PointsLedgerRow[] } {
  const row = loadCustomerForActor(db, actor, customerId);
  if (!can(actor, 'view-customers', { orgId: actor.orgId, branchId: row.branch_id })) {
    throw forbidden('bạn không được phép xem khách hàng này');
  }
  const ledger = db
    .prepare('SELECT * FROM customer_points WHERE customer_id = ? ORDER BY id DESC')
    .all(customerId) as unknown as PointsLedgerRow[];
  return { balance: pointsBalanceFor(db, customerId), ledger };
}

export function createNoteTx(
  db: DatabaseSync,
  actor: Actor,
  customerId: number,
  body: { content?: unknown },
): { note: NoteRow } {
  const cust = loadCustomerForActor(db, actor, customerId);
  if (!can(actor, 'add-note', { orgId: actor.orgId, branchId: cust.branch_id })) {
    throw forbidden('bạn không được phép ghi chú cho khách hàng này');
  }
  if (cust.status === 'merged') throw bad('khách hàng đã hợp nhất, không ghi chú được');
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (content.length === 0) throw bad('content không được trống');
  const now = new Date().toISOString();
  const id = Number(
    db
      .prepare(
        'INSERT INTO customer_notes (customer_id, org_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(customerId, actor.orgId, actor.id, content, now).lastInsertRowid,
  );
  audit(db, actor.orgId, actor.id, 'add-note', { target_customer_id: customerId });
  const note = db.prepare('SELECT * FROM customer_notes WHERE id = ?').get(id) as unknown as NoteRow;
  return { note };
}

export function listNotes(
  db: DatabaseSync,
  actor: Actor,
  customerId: number,
  query: PageQuery,
): { notes: NoteRow[]; total: number } {
  const row = loadCustomerForActor(db, actor, customerId);
  if (!can(actor, 'view-customers', { orgId: actor.orgId, branchId: row.branch_id })) {
    throw forbidden('bạn không được phép xem khách hàng này');
  }
  const totalRow = db
    .prepare('SELECT COUNT(*) AS c FROM customer_notes WHERE customer_id = ?')
    .get(customerId) as { c: number };
  const { limit, offset } = parsePage(query);
  const notes = db
    .prepare('SELECT * FROM customer_notes WHERE customer_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(customerId, limit, offset) as unknown as NoteRow[];
  return { notes, total: totalRow.c };
}

export function mergeTx(
  db: DatabaseSync,
  actor: Actor,
  keepId: number,
  body: { source_customer_id?: unknown; confirm?: unknown },
): CustomerView {
  const keep = loadCustomerForActor(db, actor, keepId);
  if (typeof body.source_customer_id !== 'number' || !Number.isInteger(body.source_customer_id)) {
    throw bad('source_customer_id không hợp lệ');
  }
  const src = loadCustomerForActor(db, actor, body.source_customer_id);
  if (!can(actor, 'merge-customers', { orgId: actor.orgId, branchId: keep.branch_id })) {
    throw forbidden('bạn không được phép hợp nhất khách hàng');
  }
  if (body.confirm !== true) throw bad('hợp nhất cần confirm: true');
  if (keepId === src.id) throw bad('không thể hợp nhất khách hàng với chính mình');
  if (keep.status === 'merged' || src.status === 'merged') {
    throw bad('khách hàng đã hợp nhất, không hợp nhất tiếp được');
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE orders SET customer_id = ? WHERE customer_id = ?').run(keepId, src.id);
  db.prepare('UPDATE customer_points SET customer_id = ? WHERE customer_id = ?').run(keepId, src.id);
  db.prepare('UPDATE customer_notes SET customer_id = ? WHERE customer_id = ?').run(keepId, src.id);
  db.prepare(
    `UPDATE customers SET status = 'merged', merged_into_id = ?, phone = NULL, email = NULL,
     updated_at = ? WHERE id = ?`,
  ).run(keepId, now, src.id);
  audit(db, actor.orgId, actor.id, 'merge-customers', {
    target_customer_id: keepId,
    source_customer_id: src.id,
  });
  return customerView(db, loadCustomer(db, keepId) as CustomerRow);
}

export function exportCustomer(
  db: DatabaseSync,
  actor: Actor,
  customerId: number,
): {
  customer: CustomerRow;
  orders: unknown[];
  points: { balance: number; ledger: PointsLedgerRow[] };
  notes: NoteRow[];
} {
  const row = loadCustomerForActor(db, actor, customerId);
  if (!can(actor, 'export-customer', { orgId: actor.orgId, branchId: row.branch_id })) {
    throw forbidden('bạn không được phép xuất dữ liệu khách hàng này');
  }
  const orderIds = db
    .prepare('SELECT id FROM orders WHERE org_id = ? AND customer_id = ? ORDER BY id DESC')
    .all(actor.orgId, customerId) as { id: number }[];
  const points = pointsOf(db, actor, customerId);
  const notes = db
    .prepare('SELECT * FROM customer_notes WHERE customer_id = ? ORDER BY id DESC')
    .all(customerId) as unknown as NoteRow[];
  audit(db, actor.orgId, actor.id, 'export-customer', { target_customer_id: customerId });
  return {
    customer: row,
    orders: orderIds.map((r) => orderDetail(db, r.id)),
    points,
    notes,
  };
}

export function deleteCustomerTx(
  db: DatabaseSync,
  actor: Actor,
  customerId: number,
): { ok: boolean; id: number } {
  const row = loadCustomerForActor(db, actor, customerId);
  if (!can(actor, 'delete-customer', { orgId: actor.orgId, branchId: row.branch_id })) {
    throw forbidden('bạn không được phép xóa khách hàng');
  }
  if (row.status === 'merged') throw bad('khách hàng đã hợp nhất, không xóa lại được');
  const orderCount = db
    .prepare('SELECT COUNT(*) AS c FROM orders WHERE customer_id = ?')
    .get(customerId) as { c: number };
  if (orderCount.c > 0) throw bad('khách hàng đã có đơn, không xóa được');
  db.prepare('DELETE FROM customer_notes WHERE customer_id = ?').run(customerId);
  db.prepare('DELETE FROM customer_points WHERE customer_id = ?').run(customerId);
  db.prepare('DELETE FROM customers WHERE id = ?').run(customerId);
  audit(db, actor.orgId, actor.id, 'delete-customer', { target_customer_id: customerId });
  return { ok: true, id: customerId };
}
