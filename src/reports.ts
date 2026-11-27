import type { DatabaseSync } from 'node:sqlite';

/**
 * Bao cao + doi soat (GOAL-010) — STUB cua Tester.
 * Moi ham thuan tinh tu bang da co (orders/order_items/order_events,
 * payments/refunds, stock_levels/stock_movements, promotion_usages,
 * customer_points, products/product_variants/categories); KHONG tao bang
 * tong hop moi, KHONG luu cot tong rieng, KHONG cache. Worker implement
 * dung chu ky nay; test khoa goi truc tiep cac ham nay va qua HTTP.
 *
 * Quy uoc ngay: from/to la ngay Asia/Ho_Chi_Minh (YYYY-MM-DD); loc trong
 * DB bang khoang UTC [from 00:00 +07, ngay sau to 00:00 +07). Mac dinh la
 * thang hien tai (tu ngay 1 toi hom nay, theo Asia/Ho_Chi_Minh). Tien la
 * so nguyen dong.
 */

export interface ReportRange {
  from: string;
  to: string;
}

/**
 * Khoang bao cao: from/to truyen vao (YYYY-MM-DD) hoac mac dinh thang hien
 * tai theo Asia/Ho_Chi_Minh; from > to hoac dinh dang ngay sai -> throw.
 */
export function reportRange(from?: string, to?: string, now?: Date): ReportRange {
  void from;
  void to;
  void now;
  throw new Error('not implemented');
}

/** Khoang UTC [startUtc, endUtc) tuong ung from/to theo Asia/Ho_Chi_Minh. */
export function completedUtcRange(from: string, to: string): { startUtc: string; endUtc: string } {
  void from;
  void to;
  throw new Error('not implemented');
}

/**
 * Phan bo diem/ma cua mot don cho mot dong san pham theo ti le
 * line_total/total cua don (D28). Tra ve phan diem va phan ma (nguyen dong)
 * cua dong do; tong cac dong khop points_discount/promo_discount cua don.
 */
export function allocateDiscounts(
  lineTotal: number,
  orderTotal: number,
  pointsDiscount: number,
  promoDiscount: number,
): { points: number; promo: number } {
  void lineTotal;
  void orderTotal;
  void pointsDiscount;
  void promoDiscount;
  throw new Error('not implemented');
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

/**
 * Doanh thu chi tinh don status 'completed'; thoi gian don la created_at
 * cua order_events co to_status='completed'. gross = Σ orders.total,
 * net = Σ (total − points_discount − promo_discount); tien da thu/hoan/
 * con phai thu = Σ paid_total/refunded_total/outstanding theo
 * computePaymentSummary cua tung don completed trong ky (tinh theo don,
 * khong theo ngay thu). totals bang tong cac rows.
 */
export function computeRevenueReport(db: DatabaseSync, opts: RevenueReportOptions): RevenueReport {
  void db;
  void opts;
  throw new Error('not implemented');
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
  void db;
  void opts;
  throw new Error('not implemented');
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
 * Doi soat 3 mat, chi doc: (a) kho — Σ qty_change / Σ reserved_change cua
 * MOI movement tu dau so voi stock_levels hien tai; (b) don–kho — moi dong
 * order_items cua don completed trong ky phai co movement out (reference =
 * ma don, qty_change = −so luong) kem release tuong ung; (c) don–tien —
 * dung lai computePaymentSummary (outstanding > 0 'chua thu du', < 0
 * 'thu thua', severity 'info'; payment_status 'refunded' ma refunded_total
 * lech tong refund completed -> severity 'error').
 */
export function computeReconciliationReport(
  db: DatabaseSync,
  opts: ReconciliationOptions,
): ReconciliationReport {
  void db;
  void opts;
  throw new Error('not implemented');
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
 * trong ky (theo created_at cua usage). */
export function computePromotionsReport(
  db: DatabaseSync,
  opts: PromotionsReportOptions,
): PromotionReportRow[] {
  void db;
  void opts;
  throw new Error('not implemented');
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
  void db;
  void opts;
  throw new Error('not implemented');
}
