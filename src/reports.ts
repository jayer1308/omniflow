import type { DatabaseSync } from 'node:sqlite';
import { computePaymentSummary } from './payments.js';

/**
 * Bao cao + doi soat (GOAL-010, xem docs/DECISIONS.md D28).
 * Moi ham thuan tinh tu bang da co (orders/order_items/order_events,
 * payments/refunds, stock_levels/stock_movements, promotion_usages,
 * customer_points, products/product_variants/categories); KHONG tao bang
 * tong hop moi, KHONG luu cot tong rieng, KHONG cache. Moi lan goi tinh
 * lai tu du lieu goc.
 *
 * Quy uoc ngay: from/to la ngay Asia/Ho_Chi_Minh (YYYY-MM-DD); loc trong
 * DB bang khoang UTC [from 00:00 +07, ngay sau to 00:00 +07). Mac dinh la
 * thang hien tai (tu ngay 1 toi hom nay, theo Asia/Ho_Chi_Minh). Tien la
 * so nguyen dong.
 */

const HCM_TIME_ZONE = 'Asia/Ho_Chi_Minh';

function bad(message: string): Error {
  return new Error(`bad_request: ${message}`);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseDateStr(value: string): { year: number; month: number; day: number } | null {
  const m = DATE_RE.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

const hcmDayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: HCM_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Ngay YYYY-MM-DD theo Asia/Ho_Chi_Minh cua mot thoi diem. */
function hcmDate(d: Date): string {
  return hcmDayFmt.format(d);
}

/** Chuyen timestamp luu trong DB (ISO UTC hoac 'YYYY-MM-DD HH:MM:SS' UTC)
 * thanh Date (UTC). */
function sqlTsToDate(ts: string): Date {
  if (ts.includes('T')) return new Date(ts);
  return new Date(`${ts.replace(' ', 'T')}Z`);
}

export interface ReportRange {
  from: string;
  to: string;
}

/**
 * Khoang bao cao: from/to truyen vao (YYYY-MM-DD) hoac mac dinh thang hien
 * tai theo Asia/Ho_Chi_Minh; from > to hoac dinh dang ngay sai -> throw.
 */
export function reportRange(from?: string, to?: string, now?: Date): ReportRange {
  const ref = now ?? new Date();
  const today = hcmDate(ref);
  const first = `${today.slice(0, 7)}-01`;
  const fromStr = from ?? first;
  const toStr = to ?? today;
  if (parseDateStr(fromStr) === null || parseDateStr(toStr) === null) {
    throw bad('ngày phải có định dạng YYYY-MM-DD hợp lệ');
  }
  if (fromStr > toStr) throw bad('from phải <= to');
  return { from: fromStr, to: toStr };
}

/** Khoang UTC [startUtc, endUtc) tuong ung from/to theo Asia/Ho_Chi_Minh. */
export function completedUtcRange(from: string, to: string): { startUtc: string; endUtc: string } {
  const start = new Date(`${from}T00:00:00+07:00`);
  const endBase = new Date(`${to}T00:00:00+07:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(endBase.getTime())) {
    throw bad('ngày phải có định dạng YYYY-MM-DD hợp lệ');
  }
  const end = new Date(endBase.getTime() + 24 * 60 * 60 * 1000);
  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
}

/**
 * Phan bo diem/ma cua mot don cho mot dong san pham theo ti le
 * line_total/total cua don (D28). Tra ve phan diem va phan ma (nguyen dong)
 * cua dong do; tong cac dong khop points_discount/promo_discount cua don
 * khi phan bo bang allocateProportional (lam tron xuong tung dong roi chia
 * phan du cho dong co phan le lon nhat).
 */
export function allocateDiscounts(
  lineTotal: number,
  orderTotal: number,
  pointsDiscount: number,
  promoDiscount: number,
): { points: number; promo: number } {
  if (orderTotal <= 0 || lineTotal <= 0) return { points: 0, promo: 0 };
  return {
    points: Math.floor((lineTotal * pointsDiscount) / orderTotal),
    promo: Math.floor((lineTotal * promoDiscount) / orderTotal),
  };
}

/**
 * Phan bo mot so tien (nguyen dong) cho cac dong theo ti le line_total /
 * total, dam bao tong cac phan bang dung so tien goc: lam tron xuong tung
 * dong (nhu allocateDiscounts) roi chia phan du (+1 dong) cho cac dong co
 * phan le lon nhat.
 */
function allocateProportional(lineTotals: number[], total: number, amount: number): number[] {
  const out = new Array<number>(lineTotals.length).fill(0);
  if (lineTotals.length === 0 || total <= 0 || amount <= 0) return out;
  const fracs: { i: number; frac: number }[] = [];
  let sum = 0;
  for (let i = 0; i < lineTotals.length; i++) {
    const exact = (lineTotals[i] * amount) / total;
    const fl = Math.floor(exact);
    out[i] = fl;
    sum += fl;
    fracs.push({ i, frac: exact - fl });
  }
  let remainder = amount - sum;
  fracs.sort((a, b) => b.frac - a.frac || a.i - b.i);
  let k = 0;
  while (remainder > 0 && fracs.length > 0) {
    out[fracs[k % fracs.length].i] += 1;
    remainder -= 1;
    k += 1;
  }
  return out;
}

export interface RevenueTotals {
  gross_revenue: number;
  net_revenue: number;
  order_count: number;
  paid_total: number;
  refunded_total: number;
  outstanding_total: number;
  points_discount_total: number;
  promo_discount_total: number;
}

export interface RevenueRow extends RevenueTotals {
  key: string;
  label: string;
}

export interface RevenueReport {
  from: string;
  to: string;
  timezone: 'Asia/Ho_Chi_Minh';
  totals: RevenueTotals;
  rows: RevenueRow[];
}

export interface RevenueReportOptions {
  from?: string;
  to?: string;
  channel?: string;
  branchId?: number;
  groupBy?: string;
  now?: Date;
}

interface CompletedOrderRow {
  id: number;
  code: string;
  branch_id: number;
  channel: string;
  total: number;
  points_discount: number;
  promo_discount: number;
  warehouse_id: number;
  /** 'YYYY-MM-DD HH:MM:SS' UTC (dang datetime() cua SQLite). */
  completed_at: string;
}

/** Don completed trong ky: thoi gian don la created_at som nhat cua
 * order_events co to_status='completed' (luu UTC), loc theo khoang UTC
 * tuong ung from/to theo Asia/Ho_Chi_Minh. */
function completedOrders(
  db: DatabaseSync,
  range: ReportRange,
  channel?: string,
  branchId?: number,
): CompletedOrderRow[] {
  const { startUtc, endUtc } = completedUtcRange(range.from, range.to);
  const where = [
    "o.status = 'completed'",
    'datetime(e.created_at) >= datetime(?)',
    'datetime(e.created_at) < datetime(?)',
  ];
  const params: (string | number)[] = [startUtc, endUtc];
  if (channel !== undefined) {
    where.push('o.channel = ?');
    params.push(channel);
  }
  if (branchId !== undefined) {
    where.push('o.branch_id = ?');
    params.push(branchId);
  }
  return db
    .prepare(
      `SELECT o.id AS id, o.code AS code, o.branch_id AS branch_id, o.channel AS channel,
              o.total AS total, o.points_discount AS points_discount, o.promo_discount AS promo_discount,
              o.warehouse_id AS warehouse_id, MIN(datetime(e.created_at)) AS completed_at
       FROM orders o
       JOIN order_events e ON e.order_id = o.id AND e.to_status = 'completed'
       WHERE ${where.join(' AND ')}
       GROUP BY o.id ORDER BY completed_at, o.id`,
    )
    .all(...params) as unknown as CompletedOrderRow[];
}

function zeroTotals(): RevenueTotals {
  return {
    gross_revenue: 0,
    net_revenue: 0,
    order_count: 0,
    paid_total: 0,
    refunded_total: 0,
    outstanding_total: 0,
    points_discount_total: 0,
    promo_discount_total: 0,
  };
}

/**
 * Doanh thu chi tinh don status 'completed'; thoi gian don la created_at
 * cua order_events co to_status='completed'. gross = Σ orders.total,
 * net = Σ (total − points_discount − promo_discount); tien da thu/hoan/
 * con phai thu = Σ paid_total/refunded_total/outstanding theo
 * computePaymentSummary cua tung don completed trong ky (tinh theo don,
 * khong theo ngay thu). totals bang tong cac rows (rieng order_count o
 * nhom product/category la so don khac nhau moi dong — mot don co nhieu
 * dong san pham thi dem o nhieu dong, xem D28).
 */
export function computeRevenueReport(db: DatabaseSync, opts: RevenueReportOptions): RevenueReport {
  const range = reportRange(opts.from, opts.to, opts.now);
  const channel = opts.channel;
  if (channel !== undefined && channel !== 'counter' && channel !== 'web' && channel !== 'api') {
    throw bad(`kênh không hợp lệ: ${channel}`);
  }
  const groupBy = opts.groupBy ?? 'day';
  if (!['day', 'month', 'channel', 'branch', 'product', 'category'].includes(groupBy)) {
    throw bad(`group_by không hợp lệ: ${groupBy}`);
  }
  const orders = completedOrders(db, range, channel, opts.branchId);
  const totals = zeroTotals();
  totals.order_count = orders.length;

  interface Agg {
    key: string;
    label: string;
    values: RevenueTotals;
    orderIds: Set<number>;
  }
  const groups = new Map<string, Agg>();
  function aggFor(key: string, label: string): Agg {
    let g = groups.get(key);
    if (!g) {
      g = { key, label, values: zeroTotals(), orderIds: new Set<number>() };
      groups.set(key, g);
    }
    return g;
  }

  const branchNames = new Map<number, string>();
  for (const b of db.prepare('SELECT id, name FROM branches').all() as { id: number; name: string }[]) {
    branchNames.set(b.id, b.name);
  }

  if (groupBy === 'product' || groupBy === 'category') {
    // Phan bo theo dong san pham: moi dong lay line_total, diem/ma/da thu/
    // hoan phan bo theo ti le line_total/total (D28); outstanding cua dong
    // = gross − diem − ma − da thu, de tong cac dong khop totals.
    const orderIds = orders.map((o) => o.id);
    const linesByOrder = new Map<number, {
      variant_id: number;
      line_total: number;
      product_name: string;
      category_id: number | null;
      category_name: string | null;
    }[]>();
    if (orderIds.length > 0) {
      const placeholders = orderIds.map(() => '?').join(',');
      const lines = db
        .prepare(
          `SELECT oi.order_id AS order_id, oi.variant_id AS variant_id,
                  oi.line_total AS line_total, p.name AS product_name,
                  p.category_id AS category_id, c.name AS category_name
           FROM order_items oi
           JOIN product_variants v ON v.id = oi.variant_id
           JOIN products p ON p.id = oi.product_id
           LEFT JOIN categories c ON c.id = p.category_id
           WHERE oi.order_id IN (${placeholders})
           ORDER BY oi.order_id, oi.id`,
        )
        .all(...orderIds) as {
        order_id: number;
        variant_id: number;
        line_total: number;
        product_name: string;
        category_id: number | null;
        category_name: string | null;
      }[];
      for (const line of lines) {
        const list = linesByOrder.get(line.order_id) ?? [];
        list.push(line);
        linesByOrder.set(line.order_id, list);
      }
    }
    for (const order of orders) {
      const summary = computePaymentSummary(db, order.id);
      totals.gross_revenue += order.total;
      totals.net_revenue += order.total - order.points_discount - order.promo_discount;
      totals.paid_total += summary.paid_total;
      totals.refunded_total += summary.refunded_total;
      totals.outstanding_total += summary.outstanding;
      totals.points_discount_total += order.points_discount;
      totals.promo_discount_total += order.promo_discount;
      const lines = linesByOrder.get(order.id) ?? [];
      const lineTotals = lines.map((l) => l.line_total);
      const allocPoints = allocateProportional(lineTotals, order.total, order.points_discount);
      const allocPromo = allocateProportional(lineTotals, order.total, order.promo_discount);
      const allocPaid = allocateProportional(lineTotals, order.total, summary.paid_total);
      const allocRefunded = allocateProportional(lineTotals, order.total, summary.refunded_total);
      lines.forEach((line, i) => {
        const key =
          groupBy === 'product' ? String(line.variant_id) : String(line.category_id ?? 'uncategorized');
        const label =
          groupBy === 'product'
            ? line.product_name
            : (line.category_name ?? 'Chưa phân loại');
        const g = aggFor(key, label);
        g.values.gross_revenue += line.line_total;
        g.values.net_revenue += line.line_total - allocPoints[i] - allocPromo[i];
        g.values.paid_total += allocPaid[i];
        g.values.refunded_total += allocRefunded[i];
        g.values.outstanding_total +=
          line.line_total - allocPoints[i] - allocPromo[i] - allocPaid[i];
        g.values.points_discount_total += allocPoints[i];
        g.values.promo_discount_total += allocPromo[i];
        g.orderIds.add(order.id);
      });
    }
  } else {
    for (const order of orders) {
      const summary = computePaymentSummary(db, order.id);
      totals.gross_revenue += order.total;
      totals.net_revenue += order.total - order.points_discount - order.promo_discount;
      totals.paid_total += summary.paid_total;
      totals.refunded_total += summary.refunded_total;
      totals.outstanding_total += summary.outstanding;
      totals.points_discount_total += order.points_discount;
      totals.promo_discount_total += order.promo_discount;
      const completedDay = hcmDate(sqlTsToDate(order.completed_at));
      let key: string;
      let label: string;
      if (groupBy === 'day') {
        key = completedDay;
        label = completedDay;
      } else if (groupBy === 'month') {
        key = completedDay.slice(0, 7);
        label = key;
      } else if (groupBy === 'channel') {
        key = order.channel;
        label = order.channel;
      } else {
        key = String(order.branch_id);
        label = branchNames.get(order.branch_id) ?? `Chi nhánh ${order.branch_id}`;
      }
      const g = aggFor(key, label);
      g.values.gross_revenue += order.total;
      g.values.net_revenue += order.total - order.points_discount - order.promo_discount;
      g.values.paid_total += summary.paid_total;
      g.values.refunded_total += summary.refunded_total;
      g.values.outstanding_total += summary.outstanding;
      g.values.points_discount_total += order.points_discount;
      g.values.promo_discount_total += order.promo_discount;
      g.orderIds.add(order.id);
    }
  }

  const rows: RevenueRow[] = [...groups.values()]
    .map((g) => ({ key: g.key, label: g.label, ...g.values, order_count: g.orderIds.size }))
    .sort((a, b) => {
      const an = Number(a.key);
      const bn = Number(b.key);
      if (Number.isInteger(an) && Number.isInteger(bn)) return an - bn;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
  return { from: range.from, to: range.to, timezone: 'Asia/Ho_Chi_Minh', totals, rows };
}

export interface ReportStockLevel {
  variant_id: number;
  sku: string;
  product_name: string;
  warehouse_id: number;
  warehouse_name: string;
  on_hand: number;
  reserved: number;
  available: number;
}

export interface ReportMovementSummary {
  type: string;
  count: number;
  qty_total: number;
}

export interface ReportLowStock extends ReportStockLevel {
  min_stock: number;
  shortage: number;
}

export interface StockReport {
  levels: ReportStockLevel[];
  movements: ReportMovementSummary[];
  low_stock: ReportLowStock[];
}

export interface StockReportOptions {
  warehouseId?: number;
  variantId?: number;
  from?: string;
  to?: string;
  now?: Date;
}

/** Ton tai thoi diem goi (tu stock_levels) + bien dong trong ky (tu
 * stock_movements); low_stock = cap co available < products.min_stock. */
export function computeStockReport(db: DatabaseSync, opts: StockReportOptions): StockReport {
  const range = reportRange(opts.from, opts.to, opts.now);
  const { startUtc, endUtc } = completedUtcRange(range.from, range.to);
  const levelWhere: string[] = [];
  const levelParams: (string | number)[] = [];
  if (opts.warehouseId !== undefined) {
    levelWhere.push('sl.warehouse_id = ?');
    levelParams.push(opts.warehouseId);
  }
  if (opts.variantId !== undefined) {
    levelWhere.push('sl.variant_id = ?');
    levelParams.push(opts.variantId);
  }
  const levelSql = `SELECT sl.variant_id AS variant_id, v.sku AS sku, p.name AS product_name,
        sl.warehouse_id AS warehouse_id, w.name AS warehouse_name,
        sl.on_hand AS on_hand, sl.reserved AS reserved, p.min_stock AS min_stock
     FROM stock_levels sl
     JOIN product_variants v ON v.id = sl.variant_id
     JOIN products p ON p.id = v.product_id
     JOIN warehouses w ON w.id = sl.warehouse_id
     ${levelWhere.length > 0 ? `WHERE ${levelWhere.join(' AND ')}` : ''}
     ORDER BY sl.warehouse_id, sl.variant_id`;
  const levelRows = db.prepare(levelSql).all(...levelParams) as {
    variant_id: number;
    sku: string;
    product_name: string;
    warehouse_id: number;
    warehouse_name: string;
    on_hand: number;
    reserved: number;
    min_stock: number;
  }[];
  const levels: ReportStockLevel[] = levelRows.map((r) => ({
    variant_id: r.variant_id,
    sku: r.sku,
    product_name: r.product_name,
    warehouse_id: r.warehouse_id,
    warehouse_name: r.warehouse_name,
    on_hand: r.on_hand,
    reserved: r.reserved,
    available: r.on_hand - r.reserved,
  }));
  const low_stock: ReportLowStock[] = levelRows
    .filter((r) => r.on_hand - r.reserved < r.min_stock)
    .map((r) => ({
      variant_id: r.variant_id,
      sku: r.sku,
      product_name: r.product_name,
      warehouse_id: r.warehouse_id,
      warehouse_name: r.warehouse_name,
      on_hand: r.on_hand,
      reserved: r.reserved,
      available: r.on_hand - r.reserved,
      min_stock: r.min_stock,
      shortage: r.min_stock - (r.on_hand - r.reserved),
    }));
  const moveWhere = ['datetime(created_at) >= datetime(?)', 'datetime(created_at) < datetime(?)'];
  const moveParams: (string | number)[] = [startUtc, endUtc];
  if (opts.warehouseId !== undefined) {
    moveWhere.push('warehouse_id = ?');
    moveParams.push(opts.warehouseId);
  }
  if (opts.variantId !== undefined) {
    moveWhere.push('variant_id = ?');
    moveParams.push(opts.variantId);
  }
  const movements = db
    .prepare(
      `SELECT type AS type, COUNT(*) AS count, COALESCE(SUM(qty_change), 0) AS qty_total
       FROM stock_movements WHERE ${moveWhere.join(' AND ')}
       GROUP BY type ORDER BY type`,
    )
    .all(...moveParams) as unknown as ReportMovementSummary[];
  return { levels, movements, low_stock };
}

export interface ReconciliationMismatch {
  kind: 'stock-level' | 'order-stock' | 'order-payment';
  severity: 'info' | 'error';
  order_code: string | null;
  variant_id: number | null;
  warehouse_id: number | null;
  expected: number | null;
  actual: number | null;
  difference: number | null;
  expected_qty: number | null;
  actual_qty: number | null;
  note: string;
}

export interface ReconciliationReport {
  from: string;
  to: string;
  timezone: 'Asia/Ho_Chi_Minh';
  summary: { checked_orders: number; checked_stock_pairs: number; mismatch_count: number };
  mismatches: ReconciliationMismatch[];
}

export interface ReconciliationOptions {
  from?: string;
  to?: string;
  branchId?: number;
  now?: Date;
}

/**
 * Doi soat 3 mat, chi doc: (a) kho — ton ky vong = muc goc (baseline) +
 * Σ qty_change / Σ reserved_change cua MOI movement tu dau, so voi
 * stock_levels hien tai (chi kiem tra cap co it nhat 1 movement: cap seed
 * chi co stock_levels ma khong co movement nao khong tinh la lech).
 * Baseline lay tu movement dau tien cua cap: on_hand_after − qty_change
 * (movement nao cung ghi muc sau khi ap dung, nen baseline khoi phuc
 * dung ca khi cap co muc seed truoc khi co movement — vd cap seed 20
 * roi xuat 2: ky vong 18, khong phai −2); cap bat dau tu 0 thi baseline
 * = 0, cong thuc rut gon ve Σ thuan theo brief R-4; (b) don–kho — moi
 * dong order_items cua don completed trong ky phai co movement out
 * (reference = ma don, qty_change = −so luong) kem release tuong ung;
 * (c) don–tien — dung lai computePaymentSummary (outstanding > 0
 * 'chua thu du', < 0 'thu thua', severity 'info'; payment_status
 * 'refunded' ma refunded_total lech tong refund completed ->
 * severity 'error').
 */
export function computeReconciliationReport(
  db: DatabaseSync,
  opts: ReconciliationOptions,
): ReconciliationReport {
  const range = reportRange(opts.from, opts.to, opts.now);
  const mismatches: ReconciliationMismatch[] = [];

  // (a) Kho: ky vong = baseline + Σ qty_change / Σ reserved_change cua
  // MOI movement cua cap tu dau; baseline = on_hand_after − qty_change
  // cua movement dau tien (xem ghi chu o docstring ham). So voi
  // stock_levels hien tai (thieu dong = 0).
  const pairs = db
    .prepare(
      `SELECT variant_id AS variant_id, warehouse_id AS warehouse_id,
              COALESCE(SUM(qty_change), 0) AS sum_qty,
              COALESCE(SUM(reserved_change), 0) AS sum_res,
              MIN(id) AS first_id
       FROM stock_movements
       GROUP BY variant_id, warehouse_id
       ORDER BY warehouse_id, variant_id`,
    )
    .all() as {
    variant_id: number;
    warehouse_id: number;
    sum_qty: number;
    sum_res: number;
    first_id: number;
  }[];
  for (const pair of pairs) {
    const first = db
      .prepare(
        'SELECT qty_change, reserved_change, on_hand_after, reserved_after FROM stock_movements WHERE id = ?',
      )
      .get(pair.first_id) as {
      qty_change: number;
      reserved_change: number;
      on_hand_after: number;
      reserved_after: number;
    };
    const expOn = first.on_hand_after - first.qty_change + pair.sum_qty;
    const expRes = first.reserved_after - first.reserved_change + pair.sum_res;
    const level = db
      .prepare('SELECT on_hand, reserved FROM stock_levels WHERE variant_id = ? AND warehouse_id = ?')
      .get(pair.variant_id, pair.warehouse_id) as { on_hand: number; reserved: number } | undefined;
    const actualOn = level ? level.on_hand : 0;
    const actualRes = level ? level.reserved : 0;
    if (expOn !== actualOn) {
      mismatches.push({
        kind: 'stock-level',
        severity: 'error',
        order_code: null,
        variant_id: pair.variant_id,
        warehouse_id: pair.warehouse_id,
        expected: expOn,
        actual: actualOn,
        difference: actualOn - expOn,
        expected_qty: null,
        actual_qty: null,
        note: `Tồn thực tế lệch so với tổng biến động: kỳ vọng ${expOn}, thực tế ${actualOn}`,
      });
    } else if (expRes !== actualRes) {
      mismatches.push({
        kind: 'stock-level',
        severity: 'error',
        order_code: null,
        variant_id: pair.variant_id,
        warehouse_id: pair.warehouse_id,
        expected: expRes,
        actual: actualRes,
        difference: actualRes - expRes,
        expected_qty: null,
        actual_qty: null,
        note: `Tồn giữ lệch so với tổng biến động: kỳ vọng ${expRes}, thực tế ${actualRes}`,
      });
    }
  }
  const checkedStockPairs = pairs.length;

  // (b) Don–kho + (c) Don–tien: chi don completed trong ky (loc chi nhanh
  // khi co branchId; mat kho (a) luon doi soat toan org).
  const orders = completedOrders(db, range, undefined, opts.branchId);
  for (const order of orders) {
    const items = db
      .prepare('SELECT variant_id, qty FROM order_items WHERE order_id = ? ORDER BY id')
      .all(order.id) as { variant_id: number; qty: number }[];
    for (const item of items) {
      const outRow = db
        .prepare(
          `SELECT COALESCE(SUM(qty_change), 0) AS s FROM stock_movements
           WHERE type = 'out' AND reference = ? AND variant_id = ? AND warehouse_id = ?`,
        )
        .get(order.code, item.variant_id, order.warehouse_id) as { s: number };
      if (outRow.s !== -item.qty) {
        mismatches.push({
          kind: 'order-stock',
          severity: 'error',
          order_code: order.code,
          variant_id: item.variant_id,
          warehouse_id: order.warehouse_id,
          expected: null,
          actual: null,
          difference: null,
          expected_qty: -item.qty,
          actual_qty: outRow.s,
          note: `Thiếu/sai movement xuất kho cho đơn ${order.code}: kỳ vọng xuất ${item.qty}, thực tế ${-outRow.s}`,
        });
      } else {
        const relRow = db
          .prepare(
            `SELECT COALESCE(SUM(reserved_change), 0) AS s FROM stock_movements
             WHERE type = 'release' AND reference = ? AND variant_id = ? AND warehouse_id = ?`,
          )
          .get(order.code, item.variant_id, order.warehouse_id) as { s: number };
        if (relRow.s !== -item.qty) {
          mismatches.push({
            kind: 'order-stock',
            severity: 'error',
            order_code: order.code,
            variant_id: item.variant_id,
            warehouse_id: order.warehouse_id,
            expected: null,
            actual: null,
            difference: null,
            expected_qty: -item.qty,
            actual_qty: relRow.s,
            note: `Thiếu/sai movement giải phóng giữ cho đơn ${order.code}: kỳ vọng giải phóng ${item.qty}, thực tế ${-relRow.s}`,
          });
        }
      }
    }
    const summary = computePaymentSummary(db, order.id);
    const netDue = order.total - order.points_discount - order.promo_discount;
    if (summary.outstanding > 0) {
      mismatches.push({
        kind: 'order-payment',
        severity: 'info',
        order_code: order.code,
        variant_id: null,
        warehouse_id: null,
        expected: netDue,
        actual: summary.paid_total,
        difference: summary.paid_total - netDue,
        expected_qty: null,
        actual_qty: null,
        note: `chưa thu đủ ${summary.outstanding}đ (payment_status: ${summary.payment_status})`,
      });
    } else if (summary.outstanding < 0) {
      mismatches.push({
        kind: 'order-payment',
        severity: 'info',
        order_code: order.code,
        variant_id: null,
        warehouse_id: null,
        expected: netDue,
        actual: summary.paid_total,
        difference: summary.paid_total - netDue,
        expected_qty: null,
        actual_qty: null,
        note: `thu thừa ${-summary.outstanding}đ (payment_status: ${summary.payment_status})`,
      });
    }
    if (summary.payment_status === 'refunded') {
      const refundSum = db
        .prepare(
          `SELECT COALESCE(SUM(r.amount), 0) AS s FROM refunds r
           JOIN payments p ON p.id = r.payment_id
           WHERE p.order_id = ? AND r.status = 'completed'`,
        )
        .get(order.id) as { s: number };
      if (summary.refunded_total !== refundSum.s) {
        mismatches.push({
          kind: 'order-payment',
          severity: 'error',
          order_code: order.code,
          variant_id: null,
          warehouse_id: null,
          expected: refundSum.s,
          actual: summary.refunded_total,
          difference: summary.refunded_total - refundSum.s,
          expected_qty: null,
          actual_qty: null,
          note: `tiền hoàn lệch so với tổng refund đã hoàn: kỳ vọng ${refundSum.s}, thực tế ${summary.refunded_total}`,
        });
      }
    }
  }

  return {
    from: range.from,
    to: range.to,
    timezone: 'Asia/Ho_Chi_Minh',
    summary: {
      checked_orders: orders.length,
      checked_stock_pairs: checkedStockPairs,
      mismatch_count: mismatches.length,
    },
    mismatches,
  };
}

export interface PromotionReportRow {
  code: string;
  promotion_id: number;
  used_count: number;
  released_count: number;
  total_discount: number;
  order_count: number;
}

export interface PromotionsReportOptions {
  from?: string;
  to?: string;
  code?: string;
  now?: Date;
}

/** Bao cao khuyen mai da dung theo tung ma; ma chua dung trong ky van hien
 * voi cac so 0. total_discount = Σ discount_amount cua usage 'used' tao
 * trong ky (theo created_at cua usage). used/released_count dem theo
 * trang thai HIEN TAI cua usage tao trong ky. */
export function computePromotionsReport(
  db: DatabaseSync,
  opts: PromotionsReportOptions,
): PromotionReportRow[] {
  const range = reportRange(opts.from, opts.to, opts.now);
  const { startUtc, endUtc } = completedUtcRange(range.from, range.to);
  let promos: { id: number; code: string }[];
  if (opts.code !== undefined && opts.code.length > 0) {
    const like = `%${opts.code.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    promos = db
      .prepare("SELECT id, code FROM promotions WHERE code LIKE ? ESCAPE '\\' ORDER BY id")
      .all(like) as { id: number; code: string }[];
  } else {
    promos = db.prepare('SELECT id, code FROM promotions ORDER BY id').all() as {
      id: number;
      code: string;
    }[];
  }
  return promos.map((promo) => {
    const byStatus = db
      .prepare(
        `SELECT status AS status, COUNT(*) AS c, COALESCE(SUM(discount_amount), 0) AS s
         FROM promotion_usages
         WHERE promotion_id = ? AND datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)
         GROUP BY status`,
      )
      .all(promo.id, startUtc, endUtc) as { status: string; c: number; s: number }[];
    const orderRow = db
      .prepare(
        `SELECT COUNT(DISTINCT order_id) AS o FROM promotion_usages
         WHERE promotion_id = ? AND datetime(created_at) >= datetime(?) AND datetime(created_at) < datetime(?)`,
      )
      .get(promo.id, startUtc, endUtc) as { o: number };
    let usedCount = 0;
    let releasedCount = 0;
    let totalDiscount = 0;
    for (const row of byStatus) {
      if (row.status === 'used') {
        usedCount = row.c;
        totalDiscount = row.s;
      } else if (row.status === 'released') {
        releasedCount = row.c;
      }
    }
    return {
      code: promo.code,
      promotion_id: promo.id,
      used_count: usedCount,
      released_count: releasedCount,
      total_discount: totalDiscount,
      order_count: orderRow.o,
    };
  });
}

export interface PointsReportRow {
  customer_id: number;
  customer_name: string;
  earned: number;
  redeemed: number;
  redeemed_amount: number;
}

export interface PointsReport {
  totals: { earned_total: number; redeemed_total: number; redeemed_amount: number };
  rows: PointsReportRow[];
}

export interface PointsReportOptions {
  from?: string;
  to?: string;
  now?: Date;
}

/** Bao cao diem: earned/redeemed tu ledger customer_points trong ky;
 * redeemed_amount = redeemed_total × 100d (D26); diem tich tren tong goc. */
export function computePointsReport(db: DatabaseSync, opts: PointsReportOptions): PointsReport {
  const range = reportRange(opts.from, opts.to, opts.now);
  const { startUtc, endUtc } = completedUtcRange(range.from, range.to);
  const rows = db
    .prepare(
      `SELECT cp.customer_id AS customer_id, c.name AS customer_name,
              COALESCE(SUM(CASE WHEN cp.type = 'earn' THEN cp.points ELSE 0 END), 0) AS earned,
              COALESCE(SUM(CASE WHEN cp.type = 'redeem' THEN cp.points ELSE 0 END), 0) AS redeemed
       FROM customer_points cp
       JOIN customers c ON c.id = cp.customer_id
       WHERE datetime(cp.created_at) >= datetime(?) AND datetime(cp.created_at) < datetime(?)
       GROUP BY cp.customer_id ORDER BY cp.customer_id`,
    )
    .all(startUtc, endUtc) as {
    customer_id: number;
    customer_name: string;
    earned: number;
    redeemed: number;
  }[];
  const reportRows: PointsReportRow[] = rows.map((r) => ({
    customer_id: r.customer_id,
    customer_name: r.customer_name,
    earned: r.earned,
    redeemed: r.redeemed,
    redeemed_amount: r.redeemed * 100,
  }));
  const earnedTotal = reportRows.reduce((s, r) => s + r.earned, 0);
  const redeemedTotal = reportRows.reduce((s, r) => s + r.redeemed, 0);
  return {
    totals: {
      earned_total: earnedTotal,
      redeemed_total: redeemedTotal,
      redeemed_amount: redeemedTotal * 100,
    },
    rows: reportRows,
  };
}
