import type { DatabaseSync } from 'node:sqlite';

/**
 * Thong bao (GOAL-011, brief-011.md R-1/R-2/R-3/R-9, D29).
 * - 1 job send-notification cho 1 nguoi nhan (to_user_id XOR to_email);
 *   job nao cung mang subject/body theo mau D29 trong payload.
 * - Nguoi nhan la user thi kiem tra preferences (thieu dong = BAT);
 *   tat -> enqueueNotification tra null, khong tao job, khong tao
 *   notification, khong tinh failed. Nguoi nhan la khach (email) thi
 *   luon gui neu co email.
 * - Chong trung theo (event_key + nguoi nhan): enqueue lan 2 cung
 *   event_key + cung nguoi nhan tra ve job da co, khong tao moi.
 *   (Cung event_key nhung khac nguoi nhan la 2 job rieng — vd don co
 *   khach thi owner + khach nhan 2 job, 2 dong notifications.)
 */

/** Danh muc su kien thong bao co dinh (R-1, D29). */
export const NOTIFICATION_EVENT_TYPES = [
  'order.confirmed',
  'order.completed',
  'order.cancelled',
  'payment.paid',
  'payment.failed',
  'payment.refunded',
  'shipment.shipped',
  'shipment.delivered',
  'shipment.failed',
  'return.requested',
  'return.approved',
  'return.rejected',
  'return.received',
  'stock.low',
  'promotion.expiring',
] as const;

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export function isNotificationEventType(value: unknown): value is NotificationEventType {
  return (
    typeof value === 'string' &&
    (NOTIFICATION_EVENT_TYPES as readonly string[]).includes(value)
  );
}

export interface NotificationInput {
  orgId: number;
  eventKey: string;
  eventType: string;
  toUserId?: number | null;
  toEmail?: string | null;
  subject: string;
  body: string;
}

export interface NotificationContent {
  subject: string;
  body: string;
}

/** Ngay YYYY-MM-DD theo Asia/Ho_Chi_Minh (dung cho period_key + event_key scan). */
export function hcmDateString(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** true khi user bat loai thong bao nay (thieu dong = BAT). */
export function isNotificationEnabled(
  db: DatabaseSync,
  userId: number,
  eventType: string,
): boolean {
  const row = db
    .prepare('SELECT enabled FROM notification_preferences WHERE user_id = ? AND event_type = ?')
    .get(userId, eventType) as { enabled: number } | undefined;
  return row === undefined ? true : row.enabled === 1;
}

interface JobPayloadRow {
  id: number;
  payload: string;
}

/** Job send-notification da co cho (event_key + nguoi nhan), neu co. */
export function findNotificationJobId(
  db: DatabaseSync,
  eventKey: string,
  toUserId: number | null,
  toEmail: string,
): number | null {
  const rows = db
    .prepare("SELECT id, payload FROM jobs WHERE type = 'send-notification'")
    .all() as unknown as JobPayloadRow[];
  for (const row of rows) {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (
      payload.event_key === eventKey &&
      (payload.to_user_id ?? null) === toUserId &&
      payload.to_email === toEmail
    ) {
      return row.id;
    }
  }
  return null;
}

/**
 * Tao job send-notification cho 1 nguoi nhan (tra id job moi, job da co
 * neu trung event_key + nguoi nhan, hoac null neu nguoi nhan da tat loai
 * nay trong preferences / khong co email dich). KHONG tu mo transaction:
 * goi trong transaction cua cap nhat trang thai goc khi co the, hoac
 * autocommit khi goi doc lap.
 */
export function enqueueNotification(
  db: DatabaseSync,
  input: NotificationInput,
): number | null {
  let email: string | null = input.toEmail ?? null;
  const toUserId = input.toUserId ?? null;
  if (toUserId !== null) {
    if (!isNotificationEnabled(db, toUserId, input.eventType)) return null;
    if (email === null) {
      const user = db.prepare('SELECT email FROM users WHERE id = ?').get(toUserId) as
        | { email: string }
        | undefined;
      if (!user) return null;
      email = user.email;
    }
  }
  if (email === null || email === '') return null;
  const existing = findNotificationJobId(db, input.eventKey, toUserId, email);
  if (existing !== null) return existing;
  const now = new Date().toISOString();
  const payload = JSON.stringify({
    event_key: input.eventKey,
    event_type: input.eventType,
    to_user_id: toUserId,
    to_email: email,
    subject: input.subject,
    body: input.body,
  });
  return Number(
    db
      .prepare(
        `INSERT INTO jobs (type, payload, status, attempts, max_attempts, next_run_at, last_error, created_at, updated_at)
         VALUES ('send-notification', ?, 'pending', 0, 3, ?, NULL, ?, ?)`,
      )
      .run(payload, now, now, now).lastInsertRowid,
  );
}

/** Mau email co dinh tung loai (D29): subject/body chua ma don / so tien / SKU / kho / ma khuyen mai tuy loai, khong chua thong tin the. */
export function buildNotificationContent(
  eventType: string,
  data: Record<string, unknown>,
): NotificationContent {
  const code = typeof data.orderCode === 'string' ? data.orderCode : '';
  const total = data.total !== undefined ? String(data.total) : '';
  const amount = data.amount !== undefined ? String(data.amount) : total;
  const carrier = typeof data.carrier === 'string' ? data.carrier : '';
  const tracking = typeof data.trackingCode === 'string' ? data.trackingCode : '';
  const reason = typeof data.reason === 'string' ? data.reason : '';
  const returnCode = typeof data.returnCode === 'string' ? data.returnCode : '';
  switch (eventType) {
    case 'order.confirmed':
      return {
        subject: `Don ${code} da xac nhan`,
        body: `Don ${code} da duoc xac nhan. Tong tien: ${total} VND.`,
      };
    case 'order.completed':
      return {
        subject: `Don ${code} da hoan tat`,
        body: `Don ${code} da hoan tat. Tong tien: ${total} VND.`,
      };
    case 'order.cancelled':
      return {
        subject: `Don ${code} da huy`,
        body: `Don ${code} da bi huy. Tong tien: ${total} VND.`,
      };
    case 'payment.paid':
      return {
        subject: `Da nhan ${amount} VND cho don ${code}`,
        body: `Da nhan ${amount} VND cho don ${code}. Tong don: ${total} VND.`,
      };
    case 'payment.failed':
      return {
        subject: `Thanh toan don ${code} that bai`,
        body: `Thanh toan ${amount} VND cho don ${code} that bai. Vui long thu lai.`,
      };
    case 'payment.refunded':
      return {
        subject: `Da hoan tien ${amount} VND cho don ${code}`,
        body: `Da hoan tien ${amount} VND cho don ${code}. Tong don: ${total} VND.`,
      };
    case 'shipment.shipped':
      return {
        subject: `Don ${code} da giao cho don vi van chuyen`,
        body: `Don ${code} da giao cho don vi van chuyen${carrier !== '' ? ` ${carrier}` : ''}${tracking !== '' ? `, ma van don ${tracking}` : ''}.`,
      };
    case 'shipment.delivered':
      return {
        subject: `Don ${code} da giao thanh cong`,
        body: `Don ${code} da giao thanh cong${tracking !== '' ? `, ma van don ${tracking}` : ''}.`,
      };
    case 'shipment.failed':
      return {
        subject: `Giao hang don ${code} that bai`,
        body: `Giao hang don ${code} that bai${reason !== '' ? `: ${reason}` : ''}.`,
      };
    case 'return.requested':
      return {
        subject: `Yeu cau tra hang cho don ${code}`,
        body: `Yeu cau tra hang${returnCode !== '' ? ` ${returnCode}` : ''} cho don ${code} da duoc tao.`,
      };
    case 'return.approved':
      return {
        subject: `Yeu cau tra hang cho don ${code} da duoc duyet`,
        body: `Yeu cau tra hang${returnCode !== '' ? ` ${returnCode}` : ''} cho don ${code} da duoc duyet.`,
      };
    case 'return.rejected':
      return {
        subject: `Yeu cau tra hang cho don ${code} da bi tu choi`,
        body: `Yeu cau tra hang${returnCode !== '' ? ` ${returnCode}` : ''} cho don ${code} da bi tu choi${reason !== '' ? `: ${reason}` : ''}.`,
      };
    case 'return.received':
      return {
        subject: `Da nhan hang tra cho don ${code}`,
        body: `Da nhan hang tra${returnCode !== '' ? ` ${returnCode}` : ''} cho don ${code}.`,
      };
    case 'stock.low': {
      const sku = typeof data.sku === 'string' ? data.sku : '';
      const productName = typeof data.productName === 'string' ? data.productName : '';
      const warehouseName = typeof data.warehouseName === 'string' ? data.warehouseName : '';
      const available = data.available !== undefined ? String(data.available) : '';
      const minStock = data.minStock !== undefined ? String(data.minStock) : '';
      const shortage = data.shortage !== undefined ? String(data.shortage) : '';
      return {
        subject: `Ton thap: ${sku} tai ${warehouseName}`,
        body: `San pham ${productName} (${sku}) tai kho ${warehouseName}: con ${available}, muc toi thieu ${minStock}, thieu ${shortage}.`,
      };
    }
    case 'promotion.expiring': {
      const promoCode = typeof data.promoCode === 'string' ? data.promoCode : '';
      const validTo = typeof data.validTo === 'string' ? data.validTo : '';
      const usedCount = data.usedCount !== undefined ? String(data.usedCount) : '0';
      const usageLimit =
        data.usageLimit === null || data.usageLimit === undefined
          ? 'khong gioi han'
          : String(data.usageLimit);
      return {
        subject: `Ma ${promoCode} sap het han (${validTo})`,
        body: `Ma khuyen mai ${promoCode} het han ngay ${validTo}. Da dung ${usedCount}/${usageLimit}.`,
      };
    }
    default:
      return {
        subject: `Thong bao ${eventType}${code !== '' ? `: ${code}` : ''}`,
        body: `Su kien ${eventType}${code !== '' ? ` cho don ${code}` : ''}.`,
      };
  }
}

// ---------- Giai quyet nguoi nhan (R-1) ----------

/** Email cua khach (NULL khi khach khong co email). */
export function customerEmailOf(db: DatabaseSync, customerId: number): string | null {
  const row = db.prepare('SELECT email FROM customers WHERE id = ?').get(customerId) as
    | { email: string | null }
    | undefined;
  return row ? row.email : null;
}

/** Id user dang hoat dong theo vai trong org. */
export function userIdsByRole(db: DatabaseSync, orgId: number, role: string): number[] {
  const rows = db
    .prepare("SELECT id FROM users WHERE org_id = ? AND role = ? AND status = 'active' ORDER BY id")
    .all(orgId, role) as { id: number }[];
  return rows.map((r) => r.id);
}

/** Id sales dang hoat dong cua 1 chi nhanh. */
export function salesIdsOfBranch(db: DatabaseSync, orgId: number, branchId: number): number[] {
  const rows = db
    .prepare(
      "SELECT id FROM users WHERE org_id = ? AND role = 'sales' AND branch_id = ? AND status = 'active' ORDER BY id",
    )
    .all(orgId, branchId) as { id: number }[];
  return rows.map((r) => r.id);
}

/** Id user warehouse dang hoat dong duoc gan 1 kho. */
export function warehouseUserIdsOf(db: DatabaseSync, orgId: number, warehouseId: number): number[] {
  const rows = db
    .prepare(
      "SELECT id FROM users WHERE org_id = ? AND role = 'warehouse' AND warehouse_id = ? AND status = 'active' ORDER BY id",
    )
    .all(orgId, warehouseId) as { id: number }[];
  return rows.map((r) => r.id);
}

export interface NotifyEventInput {
  orgId: number;
  eventType: string;
  eventKey: string;
  data: Record<string, unknown>;
  customerEmail?: string | null;
  userIds: number[];
}

/** Tao 1 job / 1 nguoi nhan cho 1 su kien (khach qua email + user qua preferences). */
export function enqueueEventNotifications(
  db: DatabaseSync,
  input: NotifyEventInput,
): number[] {
  const content = buildNotificationContent(input.eventType, input.data);
  const ids: number[] = [];
  if (input.customerEmail) {
    const id = enqueueNotification(db, {
      orgId: input.orgId,
      eventKey: input.eventKey,
      eventType: input.eventType,
      toUserId: null,
      toEmail: input.customerEmail,
      subject: content.subject,
      body: content.body,
    });
    if (id !== null) ids.push(id);
  }
  for (const userId of input.userIds) {
    const id = enqueueNotification(db, {
      orgId: input.orgId,
      eventKey: input.eventKey,
      eventType: input.eventType,
      toUserId: userId,
      subject: content.subject,
      body: content.body,
    });
    if (id !== null) ids.push(id);
  }
  return ids;
}

/** Don toi thieu de giai quyet nguoi nhan cho su kien don/thanh toan/giao/tra. */
export interface OrderEventOrder {
  org_id: number;
  branch_id: number;
  warehouse_id: number;
  code: string;
  total: number;
  customer_id: number | null;
}

/**
 * Tao job cho su kien gan voi don (R-1/R-9): nguoi nhan mac dinh la email
 * khach (neu co) + owner; thanh toan/hoan tien them accountant; tra hang
 * them sales cua chi nhanh don. Tra id cac job da tao (da co / da tat
 * preferences thi khong tinh).
 */
export function enqueueOrderEvent(
  db: DatabaseSync,
  order: OrderEventOrder,
  eventType: string,
  extra: Record<string, unknown> = {},
): number[] {
  const eventKey = `${eventType}:${order.code}`;
  const customerEmail =
    order.customer_id !== null ? customerEmailOf(db, order.customer_id) : null;
  let userIds = userIdsByRole(db, order.org_id, 'owner');
  if (eventType.startsWith('payment.')) {
    userIds = [...userIds, ...userIdsByRole(db, order.org_id, 'accountant')];
  }
  if (eventType.startsWith('return.')) {
    userIds = [...userIds, ...salesIdsOfBranch(db, order.org_id, order.branch_id)];
  }
  return enqueueEventNotifications(db, {
    orgId: order.org_id,
    eventType,
    eventKey,
    data: { orderCode: order.code, total: order.total, ...extra },
    customerEmail,
    userIds,
  });
}

// ---------- Suy pham vi tu event_key (RBAC, D29) ----------

/**
 * Suy org/chi nhanh/kho cua 1 su kien tu event_key (bang jobs khong co
 * org_id, bang notifications khong co branch_id/warehouse_id — D29):
 * - order/payment/shipment/return: <type>:<ma don> -> tra don theo ma
 *   (gioi han theo orgId khi biet truoc, vi ma don trung nhau giua 2 org
 *   la co the — so thu tu theo tung org).
 * - stock.low:variant:<id>:warehouse:<id>:<ngay> -> tra kho.
 * - promotion.expiring:<id>:<ngay> -> tra khuyen mai.
 * Tra null khi khong suy duoc (vd ma don gia lap trong test).
 */
export interface EventScope {
  orgId: number | null;
  branchId: number | null;
  warehouseId: number | null;
}

export function deriveEventScope(
  db: DatabaseSync,
  eventKey: string,
  orgId?: number,
): EventScope | null {
  const parts = eventKey.split(':');
  const eventType = parts[0] ?? '';
  if (eventType === 'stock.low') {
    // stock.low:variant:<id>:warehouse:<id>:<YYYY-MM-DD>
    const warehouseId = Number(parts[4]);
    if (!Number.isInteger(warehouseId)) return null;
    const row = db.prepare('SELECT org_id, branch_id FROM warehouses WHERE id = ?').get(
      warehouseId,
    ) as { org_id: number; branch_id: number | null } | undefined;
    if (!row) return null;
    if (orgId !== undefined && row.org_id !== orgId) return null;
    return { orgId: row.org_id, branchId: row.branch_id, warehouseId };
  }
  if (eventType === 'promotion.expiring') {
    const promoId = Number(parts[1]);
    if (!Number.isInteger(promoId)) return null;
    const row = db.prepare('SELECT org_id, branch_id FROM promotions WHERE id = ?').get(promoId) as
      | { org_id: number; branch_id: number | null }
      | undefined;
    if (!row) return null;
    if (orgId !== undefined && row.org_id !== orgId) return null;
    return { orgId: row.org_id, branchId: row.branch_id, warehouseId: null };
  }
  // order.*/payment.*/shipment.*/return.*:<ma don>
  const code = parts.slice(1).join(':');
  if (code === '') return null;
  const row =
    orgId !== undefined
      ? (db
          .prepare('SELECT org_id, branch_id, warehouse_id FROM orders WHERE code = ? AND org_id = ?')
          .get(code, orgId) as
          | { org_id: number; branch_id: number; warehouse_id: number }
          | undefined)
      : (db
          .prepare('SELECT org_id, branch_id, warehouse_id FROM orders WHERE code = ? ORDER BY id LIMIT 1')
          .get(code) as
          | { org_id: number; branch_id: number; warehouse_id: number }
          | undefined);
  if (!row) return null;
  return { orgId: row.org_id, branchId: row.branch_id, warehouseId: row.warehouse_id };
}

/** Org cua 1 job send-notification (suy tu event_key), null khi khong suy duoc. */
export function deriveJobOrg(db: DatabaseSync, payload: Record<string, unknown>): number | null {
  const eventKey = typeof payload.event_key === 'string' ? payload.event_key : '';
  if (eventKey === '') return null;
  const scope = deriveEventScope(db, eventKey);
  return scope ? scope.orgId : null;
}

/** Org dau tien trong DB (fallback khi job tong hop khong gan thuc the nao — vd job test chen tay). */
export function firstOrgId(db: DatabaseSync): number | null {
  const row = db.prepare('SELECT id FROM orgs ORDER BY id LIMIT 1').get() as
    | { id: number }
    | undefined;
  return row ? row.id : null;
}
