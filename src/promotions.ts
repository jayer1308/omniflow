/**
 * Khuyen mai (GOAL-009, xem docs/DECISIONS.md D27).
 * - Ma giam gia cap org, code chuan hoa UPPERCASE + trim, UNIQUE(org_id,
 *   code); loai percent (value 1..100, cap chi percent) hoac fixed
 *   (value > 0); dieu kien ap: min_order_total, channels (NULL = moi
 *   kenh), branch_id (NULL = moi chi nhanh), valid_from/valid_to (NULL =
 *   khong gioi han), usage_limit/per_customer_limit (NULL = khong gioi
 *   han); status active/locked.
 * - Tinh giam la ham thuan calculateDiscount tren tong don GOC (snapshot
 *   GOAL-005, CHUA tru diem), cat o cap va o phan con lai sau diem.
 * - Ap ma + tao ma chay trong transaction BEGIN IMMEDIATE (route boc bang
 *   withStockIdempotency khi co key, runStockTransaction khi khong):
 *   kiem tra gioi han dung + ghi usage + cap nhat don + audit log trong
 *   CUNG MOT transaction. Moi ham Tx o day PHAI chay trong mot
 *   transaction — goi truc tiep ngoai transaction se ghi le te khi loi
 *   giua chung (nhu createOrderTx/transitionOrderTx, GOAL-005).
 * - Loi nghiep vu nem ra la Error co ma o dau message, route map sang
 *   HTTP: 'bad_request' -> 400, 'not_found' -> 404, 'forbidden' -> 403,
 *   'conflict' -> 409.
 */
import type { DatabaseSync } from 'node:sqlite';
import { can, type Actor } from './rbac.js';
import { orderDetail } from './orders.js';

export const PROMO_CHANNELS = ['counter', 'web', 'api'] as const;
export type PromoChannel = (typeof PROMO_CHANNELS)[number];
export type PromoType = 'percent' | 'fixed';
export type PromoStatus = 'active' | 'locked';

export interface DiscountInput {
  type: 'percent' | 'fixed';
  value: number;
  cap: number | null;
}

/**
 * Ham thuan tinh so tien giam tren tong don GOC (CHUA tru diem), cat o
 * cap (chi loai percent) va o phan con lai sau diem (total -
 * pointsDiscount); khong bao gio am, promo_discount + points_discount
 * <= total.
 * percent -> floor(total * value / 100) roi min voi cap (khi cap co gia
 * tri) va min voi phan con lai sau diem.
 * fixed -> min(value, total - pointsDiscount).
 */
export function calculateDiscount(
  total: number,
  promo: DiscountInput,
  pointsDiscount = 0,
): number {
  const remaining = Math.max(0, total - pointsDiscount);
  if (promo.type === 'percent') {
    const raw = Math.floor((total * promo.value) / 100);
    const capped = promo.cap !== null && promo.cap !== undefined ? Math.min(raw, promo.cap) : raw;
    return Math.max(0, Math.min(capped, remaining));
  }
  return Math.max(0, Math.min(promo.value, remaining));
}

export interface PromotionRow {
  id: number;
  org_id: number;
  code: string;
  type: PromoType;
  value: number;
  cap: number | null;
  min_order_total: number;
  channels: string | null;
  branch_id: number | null;
  valid_from: string | null;
  valid_to: string | null;
  usage_limit: number | null;
  per_customer_limit: number | null;
  status: PromoStatus;
  created_at: string;
  updated_at: string;
}

/** Ma tra cho client: channels da parse JSON (NULL = moi kenh). */
export interface PromotionView extends Omit<PromotionRow, 'channels'> {
  channels: string[] | null;
  used_count?: number;
}

export interface PromotionCreateInput {
  code?: unknown;
  type?: unknown;
  value?: unknown;
  cap?: unknown;
  min_order_total?: unknown;
  channels?: unknown;
  branch_id?: unknown;
  valid_from?: unknown;
  valid_to?: unknown;
  usage_limit?: unknown;
  per_customer_limit?: unknown;
}

export type PromotionUpdateInput = PromotionCreateInput & {
  status?: unknown;
};

export interface PromotionListQuery {
  name?: unknown;
  code?: unknown;
  status?: unknown;
  channel?: unknown;
  branch_id?: unknown;
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

/** Ghi audit_log cho thao tac khuyen mai (detail chi id + so lieu). */
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

function loadPromotion(db: DatabaseSync, id: number): PromotionRow | undefined {
  return db.prepare('SELECT * FROM promotions WHERE id = ?').get(id) as
    | PromotionRow
    | undefined;
}

function promotionView(db: DatabaseSync, row: PromotionRow, withUsedCount = false): PromotionView {
  let channels: string[] | null = null;
  if (row.channels !== null) {
    try {
      channels = JSON.parse(row.channels) as string[];
    } catch {
      channels = null;
    }
  }
  const view: PromotionView = { ...row, channels };
  if (withUsedCount) view.used_count = usedCount(db, row.id);
  return view;
}

/** So luot da dung (status 'used') cua mot ma; dong 'released' khong tinh. */
export function usedCount(db: DatabaseSync, promotionId: number): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS c FROM promotion_usages WHERE promotion_id = ? AND status = 'used'",
    )
    .get(promotionId) as { c: number };
  return row.c;
}

function perCustomerUsedCount(db: DatabaseSync, promotionId: number, customerId: number): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM promotion_usages
       WHERE promotion_id = ? AND customer_id = ? AND status = 'used'`,
    )
    .get(promotionId, customerId) as { c: number };
  return row.c;
}

/** Chi nhanh phai ton tai trong org (khong ton tai -> 404, ngoai org -> 403). */
function requireBranchInOrg(db: DatabaseSync, orgId: number, branchId: number): void {
  const branch = db.prepare('SELECT org_id FROM branches WHERE id = ?').get(branchId) as
    | { org_id: number }
    | undefined;
  if (!branch) throw notFound('không tìm thấy chi nhánh');
  if (branch.org_id !== orgId) throw forbidden('chi nhánh không thuộc doanh nghiệp của bạn');
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/** So nguyen bat buoc (co gioi han duoi/tren khi can). */
function reqInt(v: unknown, name: string, min?: number, max?: number): number {
  if (!isInt(v)) throw bad(`${name} phải là số nguyên`);
  if (min !== undefined && v < min) throw bad(`${name} phải >= ${min}`);
  if (max !== undefined && v > max) throw bad(`${name} phải <= ${max}`);
  return v;
}

/**
 * So nguyen optional: undefined = khong gui (giu nguyen / mac dinh),
 * null = xoa (ve NULL), con lai phai la so nguyen trong gioi han.
 */
function optInt(
  v: unknown,
  name: string,
  min?: number,
): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return reqInt(v, name, min);
}

function parseChannels(v: unknown): string[] | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!Array.isArray(v) || v.length === 0) {
    throw bad('channels phải là mảng kênh không rỗng');
  }
  for (const c of v as unknown[]) {
    if (typeof c !== 'string' || !(PROMO_CHANNELS as readonly string[]).includes(c)) {
      throw bad('channels chứa kênh không hợp lệ');
    }
  }
  return v as string[];
}

function parseIsoDate(v: unknown, name: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) {
    throw bad(`${name} phải là ngày giờ ISO 8601 hợp lệ`);
  }
  return v;
}

function parseBranchId(
  db: DatabaseSync,
  orgId: number,
  v: unknown,
): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (!isInt(v)) throw bad('branch_id không hợp lệ');
  requireBranchInOrg(db, orgId, v);
  return v;
}

interface NormalizedPromo {
  type: PromoType;
  value: number;
  cap: number | null;
  min_order_total: number;
  channels: string[] | null;
  branch_id: number | null;
  valid_from: string | null;
  valid_to: string | null;
  usage_limit: number | null;
  per_customer_limit: number | null;
}

/** Kiem tra value/cap theo loai ma (percent 1..100, fixed > 0, cap chi percent). */
function validateValueCap(
  type: PromoType,
  value: unknown,
  cap: number | null | undefined,
): { value: number; cap: number | null } {
  let checkedValue: number;
  if (type === 'percent') {
    checkedValue = reqInt(value, 'value', 1, 100);
  } else {
    checkedValue = reqInt(value, 'value', 1);
  }
  let checkedCap: number | null = null;
  if (cap !== undefined && cap !== null) {
    if (type !== 'percent') throw bad('cap chỉ đi với mã loại percent');
    checkedCap = reqInt(cap, 'cap', 1);
  }
  return { value: checkedValue, cap: checkedCap };
}

/** Validate day du cho tao ma (mọi truong bat buoc theo R-2). */
function validateCreate(
  db: DatabaseSync,
  orgId: number,
  body: PromotionCreateInput,
): { code: string } & NormalizedPromo {
  const rawCode = body.code;
  if (typeof rawCode !== 'string' || rawCode.trim().length === 0) {
    throw bad('code không được trống');
  }
  const code = rawCode.trim().toUpperCase();
  if (code.length > 50) throw bad('code tối đa 50 ký tự');
  const type = body.type;
  if (type !== 'percent' && type !== 'fixed') {
    throw bad("type phải thuộc percent/fixed");
  }
  const capRaw = optInt(body.cap, 'cap', 1);
  const { value, cap } = validateValueCap(type, body.value, capRaw);
  const minOrderTotal = body.min_order_total === undefined ? 0 : reqInt(body.min_order_total, 'min_order_total', 0);
  const channels = parseChannels(body.channels) ?? null;
  const branchId = parseBranchId(db, orgId, body.branch_id) ?? null;
  const validFrom = parseIsoDate(body.valid_from, 'valid_from') ?? null;
  const validTo = parseIsoDate(body.valid_to, 'valid_to') ?? null;
  if (validFrom !== null && validTo !== null && Date.parse(validFrom) >= Date.parse(validTo)) {
    throw bad('valid_from phải trước valid_to');
  }
  const usageLimit = optInt(body.usage_limit, 'usage_limit', 1) ?? null;
  const perCustomerLimit = optInt(body.per_customer_limit, 'per_customer_limit', 1) ?? null;
  return {
    code, type, value, cap, min_order_total: minOrderTotal, channels,
    branch_id: branchId, valid_from: validFrom, valid_to: validTo,
    usage_limit: usageLimit, per_customer_limit: perCustomerLimit,
  };
}

/**
 * Tao ma trong transaction (route boc bang withStockIdempotency khi co
 * key, runStockTransaction khi khong). Trung ma trong org -> 409.
 */
export function createPromotionTx(
  db: DatabaseSync,
  actor: Actor,
  body: PromotionCreateInput,
): { promotion: PromotionView } {
  const orgId = actor.orgId;
  if (!can(actor, 'create-promotion', { orgId })) {
    throw forbidden('bạn không được phép tạo mã giảm giá');
  }
  const promo = validateCreate(db, orgId, body);
  const dup = db
    .prepare('SELECT id FROM promotions WHERE org_id = ? AND code = ?')
    .get(orgId, promo.code) as { id: number } | undefined;
  if (dup) throw conflict('mã giảm giá đã tồn tại trong doanh nghiệp');
  const now = new Date().toISOString();
  let id: number;
  try {
    id = Number(
      db
        .prepare(
          `INSERT INTO promotions (org_id, code, type, value, cap, min_order_total, channels,
            branch_id, valid_from, valid_to, usage_limit, per_customer_limit, status,
            created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
        )
        .run(
          orgId, promo.code, promo.type, promo.value, promo.cap, promo.min_order_total,
          promo.channels === null ? null : JSON.stringify(promo.channels),
          promo.branch_id, promo.valid_from, promo.valid_to,
          promo.usage_limit, promo.per_customer_limit, now, now,
        ).lastInsertRowid,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE')) throw conflict('mã giảm giá đã tồn tại trong doanh nghiệp');
    throw err;
  }
  const row = loadPromotion(db, id) as PromotionRow;
  audit(db, orgId, actor.id, 'create-promotion', {
    target_promotion_id: id,
    promotion_code: promo.code,
    type: promo.type,
    value: promo.value,
  });
  return { promotion: promotionView(db, row) };
}

/**
 * Sua ma trong transaction. Gui `code` trong body -> 400 (ma khong doi
 * sau khi tao). Moi luat validate nhu khi tao, ap tren gia tri sau khi
 * gop voi ma hien tai (vd value 150 tren ma percent -> 400, cap voi ma
 * fixed -> 400, status chi active/locked).
 */
export function updatePromotionTx(
  db: DatabaseSync,
  actor: Actor,
  id: number,
  body: PromotionUpdateInput,
): { promotion: PromotionView } {
  const orgId = actor.orgId;
  const row = loadPromotion(db, id);
  if (!row) throw notFound('không tìm thấy mã giảm giá');
  if (row.org_id !== orgId) throw forbidden('mã giảm giá không thuộc doanh nghiệp của bạn');
  if (!can(actor, 'update-promotion', { orgId })) {
    throw forbidden('bạn không được phép sửa mã giảm giá');
  }
  if ((body as Record<string, unknown>).code !== undefined) {
    throw bad('code không đổi sau khi tạo — muốn mã khác thì tạo mã mới');
  }
  const input = body as Record<string, unknown>;
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  // value/cap: validate theo loai hien tai cua ma.
  if (input.value !== undefined || input.cap !== undefined) {
    const capRaw = input.cap === undefined ? row.cap : optInt(input.cap, 'cap', 1);
    const { value, cap } = validateValueCap(
      row.type,
      input.value === undefined ? row.value : input.value,
      capRaw === undefined ? row.cap : capRaw,
    );
    if (input.value !== undefined) {
      sets.push('value = ?');
      params.push(value);
    }
    if (input.cap !== undefined) {
      sets.push('cap = ?');
      params.push(cap);
    }
  }
  if (input.min_order_total !== undefined) {
    sets.push('min_order_total = ?');
    params.push(reqInt(input.min_order_total, 'min_order_total', 0));
  }
  if (input.channels !== undefined) {
    const channels = parseChannels(input.channels);
    sets.push('channels = ?');
    params.push(channels === null ? null : JSON.stringify(channels));
  }
  if (input.branch_id !== undefined) {
    const branchId = parseBranchId(db, orgId, input.branch_id);
    sets.push('branch_id = ?');
    params.push(branchId ?? null);
  }
  // valid_from/valid_to: validate tren cap sau khi gop.
  if (input.valid_from !== undefined || input.valid_to !== undefined) {
    const from =
      input.valid_from === undefined ? row.valid_from : parseIsoDate(input.valid_from, 'valid_from');
    const to =
      input.valid_to === undefined ? row.valid_to : parseIsoDate(input.valid_to, 'valid_to');
    const newFrom = from === undefined ? row.valid_from : from;
    const newTo = to === undefined ? row.valid_to : to;
    if (newFrom !== null && newTo !== null && Date.parse(newFrom) >= Date.parse(newTo)) {
      throw bad('valid_from phải trước valid_to');
    }
    if (input.valid_from !== undefined) {
      sets.push('valid_from = ?');
      params.push(newFrom);
    }
    if (input.valid_to !== undefined) {
      sets.push('valid_to = ?');
      params.push(newTo);
    }
  }
  if (input.usage_limit !== undefined) {
    const limit = optInt(input.usage_limit, 'usage_limit', 1);
    sets.push('usage_limit = ?');
    params.push(limit ?? null);
  }
  if (input.per_customer_limit !== undefined) {
    const limit = optInt(input.per_customer_limit, 'per_customer_limit', 1);
    sets.push('per_customer_limit = ?');
    params.push(limit ?? null);
  }
  if (input.status !== undefined) {
    if (input.status !== 'active' && input.status !== 'locked') {
      throw bad("status chỉ nhận active/locked");
    }
    sets.push('status = ?');
    params.push(input.status);
  }
  if (sets.length > 0) {
    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
    db.prepare(`UPDATE promotions SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
  }
  const updated = loadPromotion(db, id) as PromotionRow;
  audit(db, orgId, actor.id, 'update-promotion', {
    target_promotion_id: id,
    promotion_code: updated.code,
    status: updated.status,
  });
  return { promotion: promotionView(db, updated) };
}

/** Chi tiet ma kem tom tat dung {used_count, usage_limit, per_customer_limit}. */
export function getPromotionDetail(
  db: DatabaseSync,
  actor: Actor,
  id: number,
): { promotion: PromotionView } {
  const row = loadPromotion(db, id);
  if (!row) throw notFound('không tìm thấy mã giảm giá');
  if (row.org_id !== actor.orgId) throw forbidden('mã giảm giá không thuộc doanh nghiệp của bạn');
  if (
    !can(actor, 'view-promotions', { orgId: actor.orgId, branchId: row.branch_id })
  ) {
    throw forbidden('bạn không được phép xem mã giảm giá này');
  }
  return { promotion: promotionView(db, row, true) };
}

function parsePageInt(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

/**
 * Danh sach ma cua org, moi nhat truoc; loc code (chuoi con) / name
 * (chuoi con tren code) / status / channel / branch_id (khop CHINH XAC:
 * ma branch_id NULL khong xuat hien khi loc theo 1 chi nhanh cu the);
 * limit mac dinh 20 toi da 100, offset mac dinh 0, kem tong so.
 * Sales chi thay ma branch_id NULL hoac dung chi nhanh minh.
 */
export function listPromotions(
  db: DatabaseSync,
  actor: Actor,
  query: PromotionListQuery,
): { promotions: PromotionView[]; total: number } {
  const orgId = actor.orgId;
  const status =
    typeof query.status === 'string' && query.status !== '' ? query.status : undefined;
  if (status !== undefined && status !== 'active' && status !== 'locked') {
    throw bad('status không hợp lệ');
  }
  const channel =
    typeof query.channel === 'string' && query.channel !== '' ? query.channel : undefined;
  if (channel !== undefined && !(PROMO_CHANNELS as readonly string[]).includes(channel)) {
    throw bad('channel không hợp lệ');
  }
  const code =
    typeof query.code === 'string' && query.code.trim() !== '' ? query.code.trim() : undefined;
  const name =
    typeof query.name === 'string' && query.name.trim() !== '' ? query.name.trim() : undefined;
  let branchFilter: number | null = null;
  if (query.branch_id !== undefined && query.branch_id !== null && query.branch_id !== '') {
    const n = typeof query.branch_id === 'string' ? Number(query.branch_id) : NaN;
    if (!Number.isInteger(n)) throw bad('branch_id không hợp lệ');
    requireBranchInOrg(db, orgId, n);
    branchFilter = n;
  }
  // Gate vai tren bo loc xin: sales xin chi nhanh khac / warehouse -> 403.
  if (
    !can(actor, 'view-promotions', {
      orgId,
      branchId: branchFilter ?? null,
    })
  ) {
    throw forbidden('bạn không được phép xem danh sách mã giảm giá này');
  }
  let where = 'WHERE org_id = ?';
  const params: (number | string)[] = [orgId];
  if (actor.role === 'sales' && actor.branchId !== null) {
    where += ' AND (branch_id IS NULL OR branch_id = ?)';
    params.push(actor.branchId);
  }
  if (branchFilter !== null) {
    where += ' AND branch_id = ?';
    params.push(branchFilter);
  }
  if (status !== undefined) {
    where += ' AND status = ?';
    params.push(status);
  }
  if (code !== undefined) {
    where += ' AND code LIKE ?';
    params.push(`%${code.toUpperCase()}%`);
  }
  if (name !== undefined) {
    where += ' AND code LIKE ?';
    params.push(`%${name.toUpperCase()}%`);
  }
  if (channel !== undefined) {
    // channels luu JSON: loc bang LIKE tren chuoi JSON (kenh la chuoi
    // nguyen ven trong mang, vd '"web"').
    where += ' AND channels LIKE ?';
    params.push(`%"${channel}"%`);
  }
  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM promotions ${where}`)
    .get(...params) as { c: number };
  const limitRaw = parsePageInt(query.limit);
  const limit = limitRaw === null ? 20 : Math.min(100, Math.max(0, limitRaw));
  const offsetRaw = parsePageInt(query.offset);
  const offset = offsetRaw === null ? 0 : Math.max(0, offsetRaw);
  const rows = db
    .prepare(`SELECT * FROM promotions ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as unknown as PromotionRow[];
  return { promotions: rows.map((r) => promotionView(db, r)), total: totalRow.c };
}

interface OrderApplyRow {
  id: number;
  org_id: number;
  branch_id: number;
  channel: string;
  code: string;
  status: string;
  total: number;
  customer_id: number | null;
  points_discount: number;
  promotion_id: number | null;
  promo_discount: number;
}

/**
 * Ap ma vao don nhap trong transaction (route boc bang
 * withStockIdempotency khi co key, runStockTransaction khi khong).
 * Moi kiem tra gioi han dung + ghi usage + cap nhat don + audit log nam
 * trong CUNG MOT transaction BEGIN IMMEDIATE — hai yeu cau ap cung ma
 * dong thoi khong cung lot qua gioi han (D1: chi co y nghia trong mot
 * process). Thanh cong -> 201, tra don kem promotion + promo_discount.
 */
export function applyPromotionTx(
  db: DatabaseSync,
  actor: Actor,
  orderId: number,
  body: { code?: unknown },
): {
  order: ReturnType<typeof orderDetail>;
  promotion: { id: number; code: string; type: PromoType; value: number };
  promo_discount: number;
} {
  const orgId = actor.orgId;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as
    | OrderApplyRow
    | undefined;
  if (!order) throw notFound('không tìm thấy đơn hàng');
  if (order.org_id !== orgId) throw forbidden('đơn không thuộc doanh nghiệp của bạn');
  if (
    !can(actor, 'apply-promotion', { orgId, branchId: order.branch_id })
  ) {
    throw forbidden('bạn không được phép áp mã cho đơn này');
  }
  if (order.status !== 'draft') throw bad('chỉ áp mã cho đơn ở trạng thái nháp');
  if (order.promotion_id !== null) throw bad('đơn đã áp một mã rồi');
  const rawCode = body.code;
  if (typeof rawCode !== 'string' || rawCode.trim().length === 0) {
    throw bad('code không được trống');
  }
  const code = rawCode.trim().toUpperCase();
  const promo = db
    .prepare('SELECT * FROM promotions WHERE org_id = ? AND code = ?')
    .get(orgId, code) as PromotionRow | undefined;
  if (!promo) throw notFound('không tìm thấy mã giảm giá');
  if (promo.status === 'locked') throw bad('mã giảm giá đã bị khóa');
  if (promo.channels !== null) {
    let channels: string[] = [];
    try {
      channels = JSON.parse(promo.channels) as string[];
    } catch {
      channels = [];
    }
    if (!channels.includes(order.channel)) {
      throw bad('kênh bán của đơn không áp được mã này');
    }
  }
  if (promo.branch_id !== null && promo.branch_id !== order.branch_id) {
    throw bad('chi nhánh của đơn không áp được mã này');
  }
  const nowMs = Date.now();
  if (promo.valid_from !== null && nowMs < Date.parse(promo.valid_from)) {
    throw bad('mã giảm giá chưa tới thời gian hiệu lực');
  }
  if (promo.valid_to !== null && nowMs > Date.parse(promo.valid_to)) {
    throw bad('mã giảm giá đã hết thời gian hiệu lực');
  }
  if (order.total < promo.min_order_total) {
    throw bad('tổng đơn chưa đủ mức tối thiểu để áp mã');
  }
  if (promo.usage_limit !== null && usedCount(db, promo.id) >= promo.usage_limit) {
    throw bad('mã giảm giá đã hết lượt dùng');
  }
  if (
    promo.per_customer_limit !== null &&
    order.customer_id !== null &&
    perCustomerUsedCount(db, promo.id, order.customer_id) >= promo.per_customer_limit
  ) {
    throw bad('khách hàng đã hết lượt dùng mã này');
  }
  const discount = calculateDiscount(
    order.total,
    { type: promo.type, value: promo.value, cap: promo.cap },
    order.points_discount ?? 0,
  );
  if (discount <= 0) throw bad('không còn phần giảm nào để áp mã');
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO promotion_usages (promotion_id, order_id, customer_id, discount_amount,
       status, released_at, release_reason, created_at)
     VALUES (?, ?, ?, ?, 'used', NULL, NULL, ?)`,
  ).run(promo.id, order.id, order.customer_id, discount, now);
  db.prepare(
    'UPDATE orders SET promotion_id = ?, promo_discount = ?, updated_at = ? WHERE id = ?',
  ).run(promo.id, discount, now, order.id);
  audit(db, orgId, actor.id, 'apply-promotion', {
    target_promotion_id: promo.id,
    promotion_code: promo.code,
    target_order_id: order.id,
    order_code: order.code,
    discount,
  });
  return {
    order: orderDetail(db, order.id),
    promotion: { id: promo.id, code: promo.code, type: promo.type, value: promo.value },
    promo_discount: discount,
  };
}
