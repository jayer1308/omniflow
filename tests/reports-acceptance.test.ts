import { test, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { migrate, openDb } from '../src/db.js';
import { can, type Action, type Actor, type Role, type Target } from '../src/rbac.js';
import { seed } from '../src/seed.js';
import { computePaymentSummary } from '../src/payments.js';
import {
  allocateDiscounts,
  completedUtcRange,
  computePointsReport,
  computePromotionsReport,
  computeReconciliationReport,
  computeRevenueReport,
  reportRange,
} from '../src/reports.js';

// Mat khau GIA LAP chi dung cho test, khong phai credential that.
const OWNER_PASSWORD = 'gia-lap-owner-123';
const STAFF_PASSWORD = 'gia-lap-staff-123';

type Db = ReturnType<typeof openDb>;
type App = ReturnType<typeof createApp>;

function freshApp() {
  const db = openDb(':memory:');
  migrate(db);
  const seeded = seed(db, { ownerPassword: OWNER_PASSWORD, staffPassword: STAFF_PASSWORD });
  const app = createApp(db);
  return { db, app, seeded };
}

function addBranch(db: Db, orgId: number, name: string): number {
  return Number(
    db.prepare('INSERT INTO branches (org_id, name) VALUES (?, ?)').run(orgId, name)
      .lastInsertRowid,
  );
}

async function addUser(
  db: Db,
  orgId: number,
  branchId: number | null,
  email: string,
  role: string,
): Promise<number> {
  const hash = await hashPassword('gia-lap-123');
  return Number(
    db
      .prepare(
        'INSERT INTO users (org_id, branch_id, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      )
      .run(orgId, branchId, email, hash, role).lastInsertRowid,
  );
}

async function addOrgB(db: Db) {
  const orgBId = Number(
    db.prepare('INSERT INTO orgs (name) VALUES (?)').run('Cong ty B gia lap').lastInsertRowid,
  );
  const branchBId = addBranch(db, orgBId, 'Chi nhanh B');
  const userBId = await addUser(db, orgBId, branchBId, 'owner-b@example.local', 'owner');
  return { orgBId, branchBId, userBId };
}

function addWarehouseRaw(db: Db, orgId: number, branchId: number, name: string): number {
  const now = new Date().toISOString();
  return Number(
    db
      .prepare(
        'INSERT INTO warehouses (org_id, name, branch_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(orgId, name, branchId, 'active', now, now).lastInsertRowid,
  );
}

async function loginAgent(app: App, email: string, password: string) {
  const agent = request.agent(app);
  const res = await agent.post('/login').send({ email, password });
  expect(res.status).toBe(200);
  return agent;
}

type Agent = Awaited<ReturnType<typeof loginAgent>>;

async function ownerAgent(app: App, seeded: { ownerEmail: string }) {
  return loginAgent(app, seeded.ownerEmail, OWNER_PASSWORD);
}

async function salesAgent(app: App, seeded: { staffEmail: string }) {
  return loginAgent(app, seeded.staffEmail, STAFF_PASSWORD);
}

/** Boi canh day du: org A 2 chi nhanh + du 5 vai, org B 1 owner. */
async function fullCtx() {
  const { db, app, seeded } = freshApp();
  const orgId = seeded.orgId;
  const branch1 = seeded.branchId;
  const branch2 = addBranch(db, orgId, 'Chi nhanh 2');
  const managerId = await addUser(db, orgId, null, 'manager@example.local', 'manager');
  const warehouseId = await addUser(db, orgId, branch1, 'kho@example.local', 'warehouse');
  const accountantId = await addUser(db, orgId, branch1, 'ketoan@example.local', 'accountant');
  const sales2Id = await addUser(db, orgId, branch2, 'sales2@example.local', 'sales');
  const { orgBId, branchBId } = await addOrgB(db);
  const owner = await ownerAgent(app, seeded);
  const sales = await salesAgent(app, seeded);
  const manager = await loginAgent(app, 'manager@example.local', 'gia-lap-123');
  const warehouse = await loginAgent(app, 'kho@example.local', 'gia-lap-123');
  const accountant = await loginAgent(app, 'ketoan@example.local', 'gia-lap-123');
  const sales2 = await loginAgent(app, 'sales2@example.local', 'gia-lap-123');
  const ownerB = await loginAgent(app, 'owner-b@example.local', 'gia-lap-123');
  return {
    db, app, seeded, orgId, branch1, branch2, orgBId, branchBId,
    managerId, warehouseId, accountantId, sales2Id,
    owner, sales, manager, warehouse, accountant, sales2, ownerB,
  };
}

function rand(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function randPhone(): string {
  return `090${String(Math.floor(Math.random() * 10000000)).padStart(7, '0')}`;
}

/** Ngay YYYY-MM-DD theo Asia/Ho_Chi_Minh. */
function hcmDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function hcmToday(): string {
  return hcmDate(new Date());
}

function hcmFirstOfMonth(): string {
  return `${hcmToday().slice(0, 7)}-01`;
}

function hcmYearMonth(): string {
  return hcmToday().slice(0, 7);
}

function dayBefore(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function createWarehouse(agent: Agent, name: string): Promise<Record<string, unknown>> {
  const res = await agent.post('/api/warehouses').send({ name });
  expect(res.status).toBe(201);
  const body = res.body as Record<string, unknown>;
  const w = (body.warehouse as Record<string, unknown>) ?? body;
  expect(w.id).toBeDefined();
  return w;
}

async function createCategory(agent: Agent, name: string): Promise<number> {
  const res = await agent.post('/api/categories').send({ name });
  expect(res.status).toBe(201);
  const row = res.body as Record<string, unknown>;
  expect(row.id).toBeDefined();
  return row.id as number;
}

async function createProduct(
  agent: Agent,
  overrides: Record<string, unknown> = {},
): Promise<{ id: number; code: string }> {
  const code = (overrides.code as string) ?? `SP-BC-${rand()}`;
  const res = await agent.post('/api/products').send({
    code,
    name: 'San pham bao cao gia lap',
    price: 100000,
    unit: 'cai',
    ...overrides,
  });
  expect(res.status).toBe(201);
  const p = (res.body as Record<string, unknown>).product as Record<string, unknown> | undefined;
  const row = p ?? (res.body as Record<string, unknown>);
  expect(row.id).toBeDefined();
  return { id: row.id as number, code: row.code as string };
}

async function createVariant(agent: Agent, productId: number): Promise<number> {
  const res = await agent.post(`/api/products/${productId}/variants`).send({
    sku: `SKU-BC-${rand()}`,
    name: 'Bien the gia lap',
  });
  expect(res.status).toBe(201);
  const v = (res.body as Record<string, unknown>).variant as Record<string, unknown> | undefined;
  const id = ((v ?? res.body) as Record<string, unknown>).id as number;
  expect(id).toBeDefined();
  return id;
}

async function mustStockIn(agent: Agent, warehouseId: number, variantId: number, qty: number): Promise<void> {
  const res = await agent
    .post('/api/stock/in')
    .send({ warehouse_id: warehouseId, variant_id: variantId, qty, reason: 'nhap gia lap' });
  expect([200, 201]).toContain(res.status);
}

/**
 * Boi canh bao cao: 1 kho A + 3 san pham/bien the (V1 gia 100000,
 * V2 gia 50000, V3 gia 5000) + ton: whA V1 200 / V2 100 / V3 50.
 */
async function reportCtx() {
  const ctx = await fullCtx();
  const whA = await createWarehouse(ctx.owner, 'Kho A');
  const whB = await createWarehouse(ctx.owner, 'Kho B');
  const p1 = await createProduct(ctx.owner, { name: 'SP BC 1', price: 100000, min_stock: 0 });
  const v1 = await createVariant(ctx.owner, p1.id);
  const p2 = await createProduct(ctx.owner, { name: 'SP BC 2', price: 50000, min_stock: 0 });
  const v2 = await createVariant(ctx.owner, p2.id);
  const p3 = await createProduct(ctx.owner, { name: 'SP BC 3', price: 5000, min_stock: 0 });
  const v3 = await createVariant(ctx.owner, p3.id);
  await mustStockIn(ctx.owner, whA.id as number, v1, 200);
  await mustStockIn(ctx.owner, whA.id as number, v2, 100);
  await mustStockIn(ctx.owner, whA.id as number, v3, 50);
  return { ...ctx, whA, whB, p1, v1, p2, v2, p3, v3 };
}

type Ctx = Awaited<ReturnType<typeof reportCtx>>;

function asOrder(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (body.order as Record<string, unknown>) ?? body;
}

function asSummary(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (body.order_summary as Record<string, unknown>) ??
    (body.summary as Record<string, unknown>) ?? {};
}

function orderRow(db: Db, id: number): Record<string, unknown> {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Record<string, unknown>;
}

function usagesOf(db: Db, promoId: number): Record<string, unknown>[] {
  try {
    return db
      .prepare('SELECT * FROM promotion_usages WHERE promotion_id = ? ORDER BY id')
      .all(promoId) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

function auditRows(
  db: Db,
  orgId: number,
): { action: string; detail: Record<string, unknown>; rawDetail: string; user_id: number | null; created_at: string }[] {
  const rows = db
    .prepare('SELECT * FROM audit_log WHERE org_id = ? ORDER BY id')
    .all(orgId) as { action: string; detail: string | null; user_id: number | null; created_at: string }[];
  return rows.map((r) => {
    let detail: Record<string, unknown> = {};
    try {
      detail = JSON.parse(r.detail ?? '{}') as Record<string, unknown>;
    } catch {
      detail = {};
    }
    return { action: r.action, detail, rawDetail: r.detail ?? '', user_id: r.user_id, created_at: r.created_at };
  });
}

function exportAuditRows(db: Db, orgId: number) {
  return auditRows(db, orgId).filter((r) => r.action === 'export-report');
}

/** Cap diem truc tiep vao ledger (setup test, khong qua API tich diem). */
function grantPoints(db: Db, orgId: number, customerId: number, points: number): void {
  const owner = db
    .prepare("SELECT id FROM users WHERE org_id = ? AND role = 'owner' ORDER BY id LIMIT 1")
    .get(orgId) as { id: number };
  db.prepare(
    `INSERT INTO customer_points (customer_id, org_id, type, points, reason, order_id, created_by, created_at)
     VALUES (?, ?, 'earn', ?, 'gia lap', NULL, ?, ?)`,
  ).run(customerId, orgId, points, owner.id, new Date().toISOString());
}

/** Doi thoi diem hoan tat cua don trong order_events (setup test bien mui gio). */
function setCompletedAt(db: Db, orderId: number, utcIso: string): void {
  db.prepare("UPDATE order_events SET created_at = ? WHERE order_id = ? AND to_status = 'completed'")
    .run(utcIso, orderId);
}

function sumQtyChange(db: Db, variantId: number, warehouseId: number): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(qty_change), 0) AS s FROM stock_movements WHERE variant_id = ? AND warehouse_id = ?')
    .get(variantId, warehouseId) as { s: number };
  return row.s;
}

async function mustCreateCustomer(
  agent: Agent,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await agent.post('/api/customers').send(body);
  expect(res.status).toBe(201);
  const c = (res.body as Record<string, unknown>).customer as Record<string, unknown> | undefined;
  const row = c ?? (res.body as Record<string, unknown>);
  expect(row.id).toBeDefined();
  return row;
}

async function mustCreateOrder(
  agent: Agent,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await agent.post('/api/orders').send(body);
  expect(res.status).toBe(201);
  const order = asOrder(res);
  expect(order.id).toBeDefined();
  expect(order.code).toBeDefined();
  return order;
}

async function transition(
  agent: Agent,
  orderId: number,
  action: 'confirm' | 'process' | 'complete' | 'cancel',
) {
  return agent.post(`/api/orders/${orderId}/${action}`).send({});
}

async function mustTransition(
  agent: Agent,
  orderId: number,
  action: 'confirm' | 'process' | 'complete' | 'cancel',
): Promise<Record<string, unknown>> {
  const res = await transition(agent, orderId, action);
  expect([200, 201]).toContain(res.status);
  return asOrder(res);
}

/** Don draft, mac dinh 2 x V1 + 1 x V2 = 250000, kenh counter, chi nhanh 1. */
async function mustOrder250(ctx: Ctx, overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [
      { variant_id: ctx.v1, qty: 2 },
      { variant_id: ctx.v2, qty: 1 },
    ],
    ...overrides,
  });
}

async function mustOrderWithTotal(
  ctx: Ctx,
  items: { variant_id: number; qty: number }[],
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items,
    ...overrides,
  });
}

async function mustCompletedOrder(
  ctx: Ctx,
  orderId: number,
  agent: Agent = ctx.owner,
): Promise<Record<string, unknown>> {
  await mustTransition(agent, orderId, 'confirm');
  await mustTransition(agent, orderId, 'process');
  const done = await mustTransition(agent, orderId, 'complete');
  expect(done.status).toBe('completed');
  return done;
}

async function mustPayCash(
  ctx: Ctx,
  orderId: number,
  amount: number,
  agent: Agent = ctx.owner,
): Promise<Record<string, unknown>> {
  const res = await agent
    .post(`/api/orders/${orderId}/payments`)
    .send({ method: 'cash', amount });
  expect(res.status).toBe(201);
  const body = res.body as Record<string, unknown>;
  const payment = (body.payment as Record<string, unknown>) ?? body;
  expect(payment.id).toBeDefined();
  return payment;
}

async function mustRedeemPoints(
  agent: Agent,
  customerId: number,
  orderId: number,
  points: number,
): Promise<Record<string, unknown>> {
  const res = await agent
    .post(`/api/customers/${customerId}/points/redeem`)
    .send({ order_id: orderId, points });
  expect(res.status).toBe(201);
  return res.body as Record<string, unknown>;
}

async function mustCreatePromo(
  agent: Agent,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await agent.post('/api/promotions').send(body);
  expect(res.status).toBe(201);
  const promo = (res.body as Record<string, unknown>).promotion as Record<string, unknown> | undefined;
  const row = promo ?? (res.body as Record<string, unknown>);
  expect(row.id).toBeDefined();
  return row;
}

async function mustApplyPromo(
  agent: Agent,
  orderId: number,
  code: string,
): Promise<Record<string, unknown>> {
  const res = await agent.post(`/api/orders/${orderId}/promotion`).send({ code });
  expect(res.status).toBe(201);
  return asOrder(res);
}

async function mustReturnAndRefund(
  ctx: Ctx,
  orderId: number,
  variantId: number,
  qty: number,
): Promise<void> {
  const retRes = await ctx.owner.post(`/api/orders/${orderId}/returns`).send({
    items: [{ variant_id: variantId, qty, condition: 'resalable' }],
    reason: 'tra gia lap',
  });
  expect(retRes.status).toBe(201);
  const ret = (retRes.body as Record<string, unknown>).return as Record<string, unknown>;
  expect(ret.id).toBeDefined();
  expect((await ctx.owner.post(`/api/returns/${ret.id as number}/approve`).send({})).status).toBe(200);
  expect((await ctx.owner.post(`/api/returns/${ret.id as number}/receive`).send({})).status).toBe(200);
  expect((await ctx.owner.post(`/api/returns/${ret.id as number}/refund`).send({})).status).toBe(200);
}

function reportActor(
  id: number,
  role: Role,
  branchId: number | null = null,
  warehouseId?: number | null,
): Actor {
  return { id, orgId: 1, branchId, role, warehouseId: warehouseId ?? null };
}

function reportTarget(orgId = 1, branchId?: number | null, warehouseId?: number | null): Target {
  return { orgId, branchId, warehouseId };
}

/** Tach 1 dong CSV, xu ly truong duoc quote bang dau nhay kep. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const clean = text.replace(/^\uFEFF/, '');
  const lines = clean.split(/\r?\n/).filter((l) => l.length > 0);
  expect(lines.length).toBeGreaterThan(0);
  const header = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map((l) => splitCsvLine(l));
  return { header, rows };
}

function monthRange(): { from: string; to: string } {
  return { from: hcmFirstOfMonth(), to: hcmToday() };
}

// ---------- AC-1: doanh thu + luat chi tinh completed ----------

test('AC-1 ham thuan reportRange mac dinh thang hien tai va completedUtcRange chuyen 00 gio cong 7 sang UTC', () => {
  const range = reportRange(undefined, undefined, new Date('2026-11-27T03:00:00.000Z'));
  expect(range.from).toBe('2026-11-01');
  expect(range.to).toBe('2026-11-27');
  expect(reportRange('2026-11-05', '2026-11-20')).toEqual({ from: '2026-11-05', to: '2026-11-20' });
  const utc = completedUtcRange('2026-11-01', '2026-11-01');
  expect(utc.startUtc).toBe('2026-10-31T17:00:00.000Z');
  expect(utc.endUtc).toBe('2026-11-01T17:00:00.000Z');
  const utc2 = completedUtcRange('2026-11-01', '2026-11-02');
  expect(utc2.startUtc).toBe('2026-10-31T17:00:00.000Z');
  expect(utc2.endUtc).toBe('2026-11-02T17:00:00.000Z');
});

test('AC-1 ham thuan allocateDiscounts phan bo diem va ma theo ti le line_total tren total', () => {
  expect(allocateDiscounts(200000, 250000, 1000, 20000)).toEqual({ points: 800, promo: 16000 });
  expect(allocateDiscounts(50000, 250000, 1000, 20000)).toEqual({ points: 200, promo: 4000 });
  expect(allocateDiscounts(100000, 100000, 50000, 50000)).toEqual({ points: 50000, promo: 50000 });
  expect(allocateDiscounts(100000, 100000, 0, 0)).toEqual({ points: 0, promo: 0 });
});

test('AC-1 ham thuan computeRevenueReport truc tiep tu DB khop tong don completed', async () => {
  const ctx = await reportCtx();
  const order = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order.id as number);
  await mustPayCash(ctx, order.id as number, 100000);
  const { from, to } = monthRange();
  const report = computeRevenueReport(ctx.db, { from, to, groupBy: 'day' });
  expect(report.from).toBe(from);
  expect(report.to).toBe(to);
  expect(report.timezone).toBe('Asia/Ho_Chi_Minh');
  expect(report.totals.gross_revenue).toBe(250000);
  expect(report.totals.net_revenue).toBe(250000);
  expect(report.totals.order_count).toBe(1);
  expect(report.totals.paid_total).toBe(100000);
  expect(report.totals.refunded_total).toBe(0);
  expect(report.totals.outstanding_total).toBe(150000);
  expect(report.totals.points_discount_total).toBe(0);
  expect(report.totals.promo_discount_total).toBe(0);
  expect(report.rows.length).toBe(1);
  expect(report.rows[0].key).toBe(hcmToday());
  expect(report.rows[0].gross_revenue).toBe(250000);
});

test('AC-1 doanh thu chi tinh don completed don draft da thu dat coc va don cancelled khong vao', async () => {
  const ctx = await reportCtx();
  const done = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, done.id as number);
  await mustPayCash(ctx, done.id as number, 100000);
  const draft = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v2, qty: 1 }]);
  expect(draft.total).toBe(50000);
  await mustPayCash(ctx, draft.id as number, 20000);
  const cancelled = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  await mustTransition(ctx.owner, cancelled.id as number, 'cancel');
  const { from, to } = monthRange();
  const res = await ctx.owner.get(`/api/reports/revenue?from=${from}&to=${to}&group_by=day`);
  expect(res.status).toBe(200);
  const body = res.body as Record<string, unknown>;
  expect(body.from).toBe(from);
  expect(body.to).toBe(to);
  expect(body.timezone).toBe('Asia/Ho_Chi_Minh');
  const totals = body.totals as Record<string, number>;
  expect(totals.gross_revenue).toBe(250000);
  expect(totals.net_revenue).toBe(250000);
  expect(totals.order_count).toBe(1);
  expect(totals.paid_total).toBe(100000);
  expect(totals.refunded_total).toBe(0);
  expect(totals.outstanding_total).toBe(150000);
  expect(totals.points_discount_total).toBe(0);
  expect(totals.promo_discount_total).toBe(0);
  const rows = body.rows as Record<string, unknown>[];
  expect(rows.length).toBe(1);
  expect(rows[0].key).toBe(hcmToday());
  expect(rows[0].gross_revenue).toBe(250000);
  expect(rows[0].order_count).toBe(1);
  const sumGross = rows.reduce((s, r) => s + (r.gross_revenue as number), 0);
  const sumNet = rows.reduce((s, r) => s + (r.net_revenue as number), 0);
  const sumCount = rows.reduce((s, r) => s + (r.order_count as number), 0);
  expect(sumGross).toBe(totals.gross_revenue);
  expect(sumNet).toBe(totals.net_revenue);
  expect(sumCount).toBe(totals.order_count);
});

test('AC-1 don completed bi tra hang van tinh doanh thu gop tien hoan o cot rieng payment_status partially_refunded', async () => {
  const ctx = await reportCtx();
  const order = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order.id as number);
  await mustPayCash(ctx, order.id as number, 250000);
  await mustReturnAndRefund(ctx, order.id as number, ctx.v1, 1);
  const summary = computePaymentSummary(ctx.db, order.id as number);
  expect(summary.paid_total).toBe(150000);
  expect(summary.refunded_total).toBe(100000);
  expect(summary.outstanding).toBe(100000);
  expect(summary.payment_status).toBe('partially_refunded');
  const { from, to } = monthRange();
  const res = await ctx.owner.get(`/api/reports/revenue?from=${from}&to=${to}&group_by=day`);
  expect(res.status).toBe(200);
  const totals = (res.body as Record<string, unknown>).totals as Record<string, number>;
  expect(totals.gross_revenue).toBe(250000);
  expect(totals.net_revenue).toBe(250000);
  expect(totals.order_count).toBe(1);
  expect(totals.paid_total).toBe(150000);
  expect(totals.refunded_total).toBe(100000);
  expect(totals.outstanding_total).toBe(100000);
});

test('AC-1 nhom theo kenh counter va web tong cac dong khop totals', async () => {
  const ctx = await reportCtx();
  const counter = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, counter.id as number);
  const web = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }], { channel: 'web' });
  expect(web.total).toBe(100000);
  await mustCompletedOrder(ctx, web.id as number);
  const { from, to } = monthRange();
  const res = await ctx.owner.get(`/api/reports/revenue?from=${from}&to=${to}&group_by=channel`);
  expect(res.status).toBe(200);
  const body = res.body as Record<string, unknown>;
  const totals = body.totals as Record<string, number>;
  expect(totals.gross_revenue).toBe(350000);
  expect(totals.order_count).toBe(2);
  const rows = body.rows as Record<string, unknown>[];
  expect(rows.length).toBe(2);
  const byKey = new Map(rows.map((r) => [String(r.key), r]));
  expect(byKey.get('counter')?.gross_revenue).toBe(250000);
  expect(byKey.get('counter')?.order_count).toBe(1);
  expect(byKey.get('web')?.gross_revenue).toBe(100000);
  expect(byKey.get('web')?.order_count).toBe(1);
  const sumGross = rows.reduce((s, r) => s + (r.gross_revenue as number), 0);
  const sumNet = rows.reduce((s, r) => s + (r.net_revenue as number), 0);
  expect(sumGross).toBe(totals.gross_revenue);
  expect(sumNet).toBe(totals.net_revenue);
});

test('AC-1 nhom theo chi nhanh chi nhanh 1 va chi nhanh 2 dung so', async () => {
  const ctx = await reportCtx();
  const b1 = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, b1.id as number);
  const b2 = await mustCreateOrder(ctx.manager, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    branch_id: ctx.branch2,
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  expect(b2.total).toBe(100000);
  await mustCompletedOrder(ctx, b2.id as number, ctx.manager);
  const { from, to } = monthRange();
  const res = await ctx.owner.get(`/api/reports/revenue?from=${from}&to=${to}&group_by=branch`);
  expect(res.status).toBe(200);
  const body = res.body as Record<string, unknown>;
  const totals = body.totals as Record<string, number>;
  expect(totals.gross_revenue).toBe(350000);
  expect(totals.order_count).toBe(2);
  const rows = body.rows as Record<string, unknown>[];
  expect(rows.length).toBe(2);
  const byKey = new Map(rows.map((r) => [String(r.key), r]));
  expect(byKey.get(String(ctx.branch1))?.gross_revenue).toBe(250000);
  expect(byKey.get(String(ctx.branch2))?.gross_revenue).toBe(100000);
  const sumGross = rows.reduce((s, r) => s + (r.gross_revenue as number), 0);
  expect(sumGross).toBe(totals.gross_revenue);
});

test('AC-1 nhom theo san pham phan bo diem va ma theo ti le tong dong khop net_revenue', async () => {
  const ctx = await reportCtx();
  await mustCreatePromo(ctx.owner, { code: 'BC10', type: 'percent', value: 10, cap: 20000 });
  const cust = await mustCreateCustomer(ctx.owner, { name: 'Khach BC', phone: randPhone(), branch_id: ctx.branch1 });
  grantPoints(ctx.db, ctx.orgId, cust.id as number, 10);
  const order = await mustOrder250(ctx, { customer_id: cust.id });
  await mustApplyPromo(ctx.owner, order.id as number, 'BC10');
  expect(orderRow(ctx.db, order.id as number).promo_discount).toBe(20000);
  const redeemed = await mustRedeemPoints(ctx.owner, cust.id as number, order.id as number, 10);
  expect(redeemed.discount).toBe(1000);
  await mustCompletedOrder(ctx, order.id as number);
  const { from, to } = monthRange();
  const res = await ctx.owner.get(`/api/reports/revenue?from=${from}&to=${to}&group_by=product`);
  expect(res.status).toBe(200);
  const body = res.body as Record<string, unknown>;
  const totals = body.totals as Record<string, number>;
  expect(totals.gross_revenue).toBe(250000);
  expect(totals.net_revenue).toBe(229000);
  expect(totals.points_discount_total).toBe(1000);
  expect(totals.promo_discount_total).toBe(20000);
  const rows = body.rows as Record<string, unknown>[];
  expect(rows.length).toBe(2);
  const grosses = rows.map((r) => r.gross_revenue as number).sort((a, b) => a - b);
  expect(grosses).toEqual([50000, 200000]);
  const nets = rows.map((r) => r.net_revenue as number).sort((a, b) => a - b);
  expect(nets).toEqual([45800, 183200]);
  const sumNet = rows.reduce((s, r) => s + (r.net_revenue as number), 0);
  const sumGross = rows.reduce((s, r) => s + (r.gross_revenue as number), 0);
  expect(sumNet).toBe(totals.net_revenue);
  expect(sumGross).toBe(totals.gross_revenue);
});

test('AC-1 nhom theo danh muc san pham chua co danh muc vao Chua phan loai', async () => {
  const ctx = await reportCtx();
  const catId = await createCategory(ctx.owner, 'Quan ao');
  const pCat = await createProduct(ctx.owner, { name: 'SP co danh muc', price: 100000, min_stock: 0, category_id: catId });
  const vCat = await createVariant(ctx.owner, pCat.id);
  const pNoCat = await createProduct(ctx.owner, { name: 'SP khong danh muc', price: 50000, min_stock: 0 });
  const vNoCat = await createVariant(ctx.owner, pNoCat.id);
  await mustStockIn(ctx.owner, ctx.whA.id as number, vCat, 10);
  await mustStockIn(ctx.owner, ctx.whA.id as number, vNoCat, 10);
  const order = await mustOrderWithTotal(ctx, [
    { variant_id: vCat, qty: 1 },
    { variant_id: vNoCat, qty: 1 },
  ]);
  expect(order.total).toBe(150000);
  await mustCompletedOrder(ctx, order.id as number);
  const { from, to } = monthRange();
  const res = await ctx.owner.get(`/api/reports/revenue?from=${from}&to=${to}&group_by=category`);
  expect(res.status).toBe(200);
  const body = res.body as Record<string, unknown>;
  const totals = body.totals as Record<string, number>;
  expect(totals.gross_revenue).toBe(150000);
  expect(totals.order_count).toBe(1);
  const rows = body.rows as Record<string, unknown>[];
  expect(rows.length).toBe(2);
  const unclassified = rows.find((r) => r.label === 'Chưa phân loại');
  expect(unclassified).toBeDefined();
  expect(unclassified?.gross_revenue).toBe(50000);
  expect(unclassified?.net_revenue).toBe(50000);
  const sumGross = rows.reduce((s, r) => s + (r.gross_revenue as number), 0);
  expect(sumGross).toBe(totals.gross_revenue);
});

test('AC-1 nhom theo thang key YYYY-MM va mac dinh thang hien tai khong truyen from to', async () => {
  const ctx = await reportCtx();
  const order = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order.id as number);
  const res = await ctx.owner.get('/api/reports/revenue?group_by=month');
  expect(res.status).toBe(200);
  const body = res.body as Record<string, unknown>;
  expect(body.from).toBe(hcmFirstOfMonth());
  expect(body.to).toBe(hcmToday());
  expect(body.timezone).toBe('Asia/Ho_Chi_Minh');
  const totals = body.totals as Record<string, number>;
  expect(totals.gross_revenue).toBe(250000);
  expect(totals.order_count).toBe(1);
  const rows = body.rows as Record<string, unknown>[];
  expect(rows.length).toBe(1);
  expect(rows[0].key).toBe(hcmYearMonth());
  expect(rows[0].gross_revenue).toBe(250000);
  const plain = await ctx.owner.get('/api/reports/revenue');
  expect(plain.status).toBe(200);
  const plainTotals = (plain.body as Record<string, unknown>).totals as Record<string, number>;
  expect(plainTotals.gross_revenue).toBe(250000);
  expect(plainTotals.order_count).toBe(1);
});

test('AC-1 bien mui gio don hoan tat 00 gio 30 cong 7 ngay 1 thuoc ngay 1 khong roi sang hom truoc', async () => {
  const ctx = await reportCtx();
  const order = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order.id as number);
  const first = hcmFirstOfMonth();
  const completedUtc = new Date(`${first}T00:30:00+07:00`).toISOString();
  setCompletedAt(ctx.db, order.id as number, completedUtc);
  const inDay = await ctx.owner.get(`/api/reports/revenue?from=${first}&to=${first}&group_by=day`);
  expect(inDay.status).toBe(200);
  const inTotals = (inDay.body as Record<string, unknown>).totals as Record<string, number>;
  expect(inTotals.gross_revenue).toBe(250000);
  expect(inTotals.order_count).toBe(1);
  const inRows = (inDay.body as Record<string, unknown>).rows as Record<string, unknown>[];
  expect(inRows.length).toBe(1);
  expect(inRows[0].key).toBe(first);
  const prev = dayBefore(first);
  const outDay = await ctx.owner.get(`/api/reports/revenue?from=${prev}&to=${prev}&group_by=day`);
  expect(outDay.status).toBe(200);
  const outTotals = (outDay.body as Record<string, unknown>).totals as Record<string, number>;
  expect(outTotals.gross_revenue).toBe(0);
  expect(outTotals.order_count).toBe(0);
  expect((outDay.body as Record<string, unknown>).rows).toEqual([]);
});

test('AC-1 ky rong totals 0 rows rong 200', async () => {
  const ctx = await reportCtx();
  const { from, to } = monthRange();
  const res = await ctx.owner.get(`/api/reports/revenue?from=${from}&to=${to}&group_by=day`);
  expect(res.status).toBe(200);
  const totals = (res.body as Record<string, unknown>).totals as Record<string, number>;
  expect(totals.gross_revenue).toBe(0);
  expect(totals.net_revenue).toBe(0);
  expect(totals.order_count).toBe(0);
  expect(totals.paid_total).toBe(0);
  expect(totals.refunded_total).toBe(0);
  expect(totals.outstanding_total).toBe(0);
  expect(totals.points_discount_total).toBe(0);
  expect(totals.promo_discount_total).toBe(0);
  expect((res.body as Record<string, unknown>).rows).toEqual([]);
});

test('AC-1 validate kenh la group_by la from lon hon to ngay sai 400 chi nhanh khong ton tai 404 chi nhanh org B 403', async () => {
  const ctx = await reportCtx();
  const { from, to } = monthRange();
  expect((await ctx.owner.get(`/api/reports/revenue?from=${from}&to=${to}&channel=bogus`)).status).toBe(400);
  expect((await ctx.owner.get(`/api/reports/revenue?from=${from}&to=${to}&group_by=bogus`)).status).toBe(400);
  expect((await ctx.owner.get(`/api/reports/revenue?from=${to}&to=${from}`)).status).toBe(400);
  expect((await ctx.owner.get('/api/reports/revenue?from=khong-phai-ngay&to=2026-11-30')).status).toBe(400);
  expect((await ctx.owner.get('/api/reports/revenue?from=2026-13-01&to=2026-11-30')).status).toBe(400);
  expect((await ctx.owner.get(`/api/reports/revenue?from=${from}&to=${to}&branch_id=999999`)).status).toBe(404);
  expect((await ctx.owner.get(`/api/reports/revenue?from=${from}&to=${to}&branch_id=${ctx.branchBId}`)).status).toBe(403);
});

// ---------- AC-2: ton kho + doi soat 3 mat ----------

test('AC-2 bao cao ton levels available bang on_hand tru reserved va movements tom tat theo loai trong ky', async () => {
  const ctx = await reportCtx();
  const order = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order.id as number);
  const { from, to } = monthRange();
  const res = await ctx.owner.get(`/api/reports/stock?from=${from}&to=${to}`);
  expect(res.status).toBe(200);
  const body = res.body as Record<string, unknown>;
  const levels = body.levels as Record<string, unknown>[];
  const byVariant = new Map(levels.map((l) => [l.variant_id as number, l]));
  const l1 = byVariant.get(ctx.v1);
  expect(l1).toBeDefined();
  expect(l1?.on_hand).toBe(198);
  expect(l1?.reserved).toBe(0);
  expect(l1?.available).toBe(198);
  expect(l1?.sku).toBeDefined();
  expect(l1?.product_name).toBe('SP BC 1');
  expect(l1?.warehouse_id).toBe(ctx.whA.id);
  const l2 = byVariant.get(ctx.v2);
  expect(l2?.on_hand).toBe(99);
  expect(l2?.reserved).toBe(0);
  expect(l2?.available).toBe(99);
  const l3 = byVariant.get(ctx.v3);
  expect(l3?.on_hand).toBe(50);
  expect(l3?.available).toBe(50);
  const movements = body.movements as Record<string, unknown>[];
  const byType = new Map(movements.map((m) => [m.type as string, m]));
  expect(byType.get('in')?.count).toBe(3);
  expect(byType.get('in')?.qty_total).toBe(350);
  expect(byType.get('reserve')?.count).toBe(2);
  expect(byType.get('reserve')?.qty_total).toBe(0);
  expect(byType.get('release')?.count).toBe(2);
  expect(byType.get('release')?.qty_total).toBe(0);
  expect(byType.get('out')?.count).toBe(2);
  expect(Math.abs(byType.get('out')?.qty_total as number)).toBe(3);
});

test('AC-2 canh bao ton thap available nho hon min_stock kem shortage', async () => {
  const ctx = await reportCtx();
  const pLow = await createProduct(ctx.owner, { name: 'SP ton thap', price: 10000, min_stock: 10 });
  const vLow = await createVariant(ctx.owner, pLow.id);
  await mustStockIn(ctx.owner, ctx.whA.id as number, vLow, 4);
  const res = await ctx.owner.get('/api/reports/stock');
  expect(res.status).toBe(200);
  const low = (res.body as Record<string, unknown>).low_stock as Record<string, unknown>[];
  const hit = low.find((l) => l.variant_id === vLow);
  expect(hit).toBeDefined();
  expect(hit?.available).toBe(4);
  expect(hit?.min_stock).toBe(10);
  expect(hit?.shortage).toBe(6);
  expect(hit?.warehouse_id).toBe(ctx.whA.id);
  expect(low.find((l) => l.variant_id === ctx.v3)).toBeUndefined();
});

test('AC-2 bao cao ton loc kho va bien the khong ton tai 404 kho org B 403 kho inactive van hien', async () => {
  const ctx = await reportCtx();
  const whBId = addWarehouseRaw(ctx.db, ctx.orgBId, ctx.branchBId, 'Kho B gia lap');
  const resB = await ctx.owner.get(`/api/reports/stock?warehouse_id=${ctx.whB.id}`);
  expect(resB.status).toBe(200);
  const levelsB = (resB.body as Record<string, unknown>).levels as Record<string, unknown>[];
  for (const l of levelsB) expect(l.warehouse_id).toBe(ctx.whB.id);
  expect((await ctx.owner.get('/api/reports/stock?warehouse_id=999999')).status).toBe(404);
  expect((await ctx.owner.get(`/api/reports/stock?warehouse_id=${whBId}`)).status).toBe(403);
  expect((await ctx.owner.get('/api/reports/stock?variant_id=999999')).status).toBe(404);
  const resV = await ctx.owner.get(`/api/reports/stock?variant_id=${ctx.v1}`);
  expect(resV.status).toBe(200);
  const levelsV = (resV.body as Record<string, unknown>).levels as Record<string, unknown>[];
  expect(levelsV.length).toBeGreaterThan(0);
  for (const l of levelsV) expect(l.variant_id).toBe(ctx.v1);
  await mustStockIn(ctx.owner, ctx.whB.id as number, ctx.v1, 10);
  ctx.db.prepare("UPDATE warehouses SET status = 'inactive' WHERE id = ?").run(ctx.whB.id);
  const resInactive = await ctx.owner.get(`/api/reports/stock?warehouse_id=${ctx.whB.id}`);
  expect(resInactive.status).toBe(200);
  const levelsInactive = (resInactive.body as Record<string, unknown>).levels as Record<string, unknown>[];
  expect(levelsInactive.length).toBeGreaterThan(0);
  for (const l of levelsInactive) expect(l.warehouse_id).toBe(ctx.whB.id);
});

test('AC-2 doi soat du lieu chuan khong co dong error khong co stock-level hay order-stock don thieu thu co dong info', async () => {
  const ctx = await reportCtx();
  const partial = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, partial.id as number);
  await mustPayCash(ctx, partial.id as number, 100000);
  const full = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  await mustCompletedOrder(ctx, full.id as number);
  await mustPayCash(ctx, full.id as number, 100000);
  const { from, to } = monthRange();
  const res = await ctx.owner.get(`/api/reports/reconciliation?from=${from}&to=${to}`);
  expect(res.status).toBe(200);
  const body = res.body as Record<string, unknown>;
  expect(body.from).toBe(from);
  expect(body.to).toBe(to);
  expect(body.timezone).toBe('Asia/Ho_Chi_Minh');
  const summary = body.summary as Record<string, number>;
  expect(summary.checked_orders).toBeGreaterThanOrEqual(2);
  expect(summary.checked_stock_pairs).toBeGreaterThanOrEqual(1);
  const mismatches = body.mismatches as Record<string, unknown>[];
  expect(summary.mismatch_count).toBe(mismatches.length);
  expect(mismatches.filter((m) => m.kind === 'stock-level')).toEqual([]);
  expect(mismatches.filter((m) => m.kind === 'order-stock')).toEqual([]);
  expect(mismatches.filter((m) => m.severity === 'error')).toEqual([]);
  const info = mismatches.filter((m) => m.kind === 'order-payment' && m.severity === 'info');
  expect(info.length).toBe(1);
  expect(info[0].order_code).toBe(partial.code);
  const text = [info[0].note, info[0].status, info[0].message].filter(Boolean).join(' ');
  expect(text).toContain('chưa thu đủ');
  expect(mismatches.filter((m) => m.order_code === full.code)).toEqual([]);
});

test('AC-2 doi soat don thu thua outstanding am co dong info thu thua', async () => {
  const ctx = await reportCtx();
  const order = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v2, qty: 1 }]);
  expect(order.total).toBe(50000);
  await mustCompletedOrder(ctx, order.id as number);
  await mustPayCash(ctx, order.id as number, 60000);
  const summary = computePaymentSummary(ctx.db, order.id as number);
  expect(summary.outstanding).toBe(-10000);
  expect(summary.payment_status).toBe('overpaid');
  const { from, to } = monthRange();
  const res = await ctx.owner.get(`/api/reports/reconciliation?from=${from}&to=${to}`);
  expect(res.status).toBe(200);
  const mismatches = (res.body as Record<string, unknown>).mismatches as Record<string, unknown>[];
  const hit = mismatches.find((m) => m.order_code === order.code);
  expect(hit).toBeDefined();
  expect(hit?.kind).toBe('order-payment');
  expect(hit?.severity).toBe('info');
  const text = [hit?.note, hit?.status, hit?.message].filter(Boolean).join(' ');
  expect(text).toContain('thu thừa');
});

test('AC-2 doi soat chen lech ton truc tiep o DB thay stock_levels thay dong stock-level kem so ky vong va thuc te', async () => {
  const ctx = await reportCtx();
  const expected = sumQtyChange(ctx.db, ctx.v1, ctx.whA.id as number);
  expect(expected).toBe(200);
  ctx.db
    .prepare('UPDATE stock_levels SET on_hand = on_hand + 5 WHERE variant_id = ? AND warehouse_id = ?')
    .run(ctx.v1, ctx.whA.id);
  const { from, to } = monthRange();
  const res = await ctx.owner.get(`/api/reports/reconciliation?from=${from}&to=${to}`);
  expect(res.status).toBe(200);
  const mismatches = (res.body as Record<string, unknown>).mismatches as Record<string, unknown>[];
  const hit = mismatches.find(
    (m) => m.kind === 'stock-level' && m.variant_id === ctx.v1 && m.warehouse_id === ctx.whA.id,
  );
  expect(hit).toBeDefined();
  expect(hit?.expected).toBe(expected);
  expect(hit?.actual).toBe(205);
  expect(hit?.difference).toBe(5);
  expect((hit?.actual as number) - (hit?.expected as number)).toBe(hit?.difference);
});

test('AC-2 doi soat xoa movement out cua don completed thay dong order-stock kem ma don va bien the', async () => {
  const ctx = await reportCtx();
  const order = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order.id as number);
  ctx.db
    .prepare("DELETE FROM stock_movements WHERE type = 'out' AND reference = ?")
    .run(order.code);
  const { from, to } = monthRange();
  const res = await ctx.owner.get(`/api/reports/reconciliation?from=${from}&to=${to}`);
  expect(res.status).toBe(200);
  const mismatches = (res.body as Record<string, unknown>).mismatches as Record<string, unknown>[];
  const hit = mismatches.find(
    (m) => m.kind === 'order-stock' && m.order_code === order.code && m.variant_id === ctx.v1,
  );
  expect(hit).toBeDefined();
  expect(Math.abs(hit?.expected_qty as number)).toBe(2);
  expect(hit?.actual_qty).toBe(0);
  const hit2 = mismatches.find(
    (m) => m.kind === 'order-stock' && m.order_code === order.code && m.variant_id === ctx.v2,
  );
  expect(hit2).toBeDefined();
  expect(Math.abs(hit2?.expected_qty as number)).toBe(1);
  expect(hit2?.actual_qty).toBe(0);
});

test('AC-2 ham thuan computeReconciliationReport truc tiep khong co dong error tren du lieu chuan', async () => {
  const ctx = await reportCtx();
  const partial = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, partial.id as number);
  await mustPayCash(ctx, partial.id as number, 100000);
  const { from, to } = monthRange();
  const report = computeReconciliationReport(ctx.db, { from, to });
  expect(report.from).toBe(from);
  expect(report.to).toBe(to);
  expect(report.timezone).toBe('Asia/Ho_Chi_Minh');
  expect(report.summary.checked_orders).toBeGreaterThanOrEqual(1);
  expect(report.summary.mismatch_count).toBe(report.mismatches.length);
  expect(report.mismatches.filter((m) => m.kind === 'stock-level')).toEqual([]);
  expect(report.mismatches.filter((m) => m.kind === 'order-stock')).toEqual([]);
  expect(report.mismatches.filter((m) => m.severity === 'error')).toEqual([]);
  const info = report.mismatches.filter((m) => m.kind === 'order-payment' && m.severity === 'info');
  expect(info.length).toBe(1);
  expect(info[0].order_code).toBe(partial.code);
});

test('AC-2 doi soat tung don dung lai computePaymentSummary outstanding va payment_status giu logic D22', async () => {
  const ctx = await reportCtx();
  await mustCreatePromo(ctx.owner, { code: 'BC50', type: 'percent', value: 50 });
  const cust = await mustCreateCustomer(ctx.owner, { name: 'Khach D22', phone: randPhone(), branch_id: ctx.branch1 });
  grantPoints(ctx.db, ctx.orgId, cust.id as number, 500);
  const covered = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }], { customer_id: cust.id });
  await mustApplyPromo(ctx.owner, covered.id as number, 'BC50');
  const redeemed = await mustRedeemPoints(ctx.owner, cust.id as number, covered.id as number, 500);
  expect(redeemed.discount).toBe(50000);
  await mustCompletedOrder(ctx, covered.id as number);
  const coveredSummary = computePaymentSummary(ctx.db, covered.id as number);
  expect(coveredSummary.outstanding).toBe(0);
  expect(coveredSummary.payment_status).toBe('unpaid');
  const paid = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  const payment = await mustPayCash(ctx, paid.id as number, 100000);
  const refundRes = await ctx.owner
    .post(`/api/payments/${payment.id as number}/refunds`)
    .send({ amount: 50000, reason: 'hoan gia lap' });
  expect(refundRes.status).toBe(201);
  const refundSummary = computePaymentSummary(ctx.db, paid.id as number);
  expect(refundSummary.paid_total).toBe(50000);
  expect(refundSummary.refunded_total).toBe(50000);
  expect(refundSummary.outstanding).toBe(50000);
  expect(refundSummary.payment_status).toBe('partially_paid');
  const viaApi = await ctx.owner.get(`/api/orders/${paid.id as number}/payments`);
  expect(viaApi.status).toBe(200);
  expect(asSummary(viaApi).payment_status).toBe('partially_paid');
  expect(asSummary(viaApi).outstanding).toBe(50000);
  const { from, to } = monthRange();
  const res = await ctx.owner.get(`/api/reports/reconciliation?from=${from}&to=${to}`);
  expect(res.status).toBe(200);
  const mismatches = (res.body as Record<string, unknown>).mismatches as Record<string, unknown>[];
  expect(mismatches.filter((m) => m.order_code === covered.code)).toEqual([]);
});

// ---------- AC-3: khuyen mai + diem + xuat CSV ----------

test('AC-3 bao cao khuyen mai so ma tong giam theo ma va ma chua dung van hien so 0', async () => {
  const ctx = await reportCtx();
  const promo = await mustCreatePromo(ctx.owner, { code: 'BCSALE10', type: 'percent', value: 10, cap: 20000 });
  const order = await mustOrder250(ctx);
  await mustApplyPromo(ctx.owner, order.id as number, 'BCSALE10');
  expect(orderRow(ctx.db, order.id as number).promo_discount).toBe(20000);
  await mustCompletedOrder(ctx, order.id as number);
  const unused = await mustCreatePromo(ctx.owner, { code: 'BCUNUSED', type: 'fixed', value: 5000 });
  const { from, to } = monthRange();
  const res = await ctx.owner.get(`/api/reports/promotions?from=${from}&to=${to}`);
  expect(res.status).toBe(200);
  const rows = res.body as Record<string, unknown>[];
  const list = Array.isArray(rows) ? rows : ((res.body as Record<string, unknown>).rows as Record<string, unknown>[]);
  expect(list.length).toBe(2);
  const byCode = new Map(list.map((r) => [r.code as string, r]));
  const used = byCode.get('BCSALE10');
  expect(used).toBeDefined();
  expect(used?.promotion_id).toBe(promo.id);
  expect(used?.used_count).toBe(1);
  expect(used?.released_count).toBe(0);
  expect(used?.total_discount).toBe(20000);
  expect(used?.order_count).toBe(1);
  const idle = byCode.get('BCUNUSED');
  expect(idle).toBeDefined();
  expect(idle?.promotion_id).toBe(unused.id);
  expect(idle?.used_count).toBe(0);
  expect(idle?.released_count).toBe(0);
  expect(idle?.total_discount).toBe(0);
  expect(idle?.order_count).toBe(0);
  const filtered = await ctx.owner.get(`/api/reports/promotions?from=${from}&to=${to}&code=BCSALE`);
  expect(filtered.status).toBe(200);
  const filteredRows = filtered.body as Record<string, unknown>[];
  const filteredList = Array.isArray(filteredRows)
    ? filteredRows
    : ((filtered.body as Record<string, unknown>).rows as Record<string, unknown>[]);
  expect(filteredList.length).toBe(1);
  expect(filteredList[0].code).toBe('BCSALE10');
});

test('AC-3 bao cao khuyen mai huy don hoan luot released_count 1 total_discount 0', async () => {
  const ctx = await reportCtx();
  const promo = await mustCreatePromo(ctx.owner, { code: 'BCCANCEL', type: 'percent', value: 10 });
  const order = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  await mustApplyPromo(ctx.owner, order.id as number, 'BCCANCEL');
  expect(usagesOf(ctx.db, promo.id as number)[0].status).toBe('used');
  await mustTransition(ctx.owner, order.id as number, 'cancel');
  expect(usagesOf(ctx.db, promo.id as number)[0].status).toBe('released');
  const { from, to } = monthRange();
  const res = await ctx.owner.get(`/api/reports/promotions?from=${from}&to=${to}&code=BCCANCEL`);
  expect(res.status).toBe(200);
  const rows = res.body as Record<string, unknown>[];
  const list = Array.isArray(rows) ? rows : ((res.body as Record<string, unknown>).rows as Record<string, unknown>[]);
  expect(list.length).toBe(1);
  expect(list[0].used_count).toBe(0);
  expect(list[0].released_count).toBe(1);
  expect(list[0].total_discount).toBe(0);
});

test('AC-3 bao cao diem tich va doi redeemed_amount bang diem doi nhan 100d', async () => {
  const ctx = await reportCtx();
  const custA = await mustCreateCustomer(ctx.owner, { name: 'Khach tich diem', phone: randPhone(), branch_id: ctx.branch1 });
  const orderA = await mustOrder250(ctx, { customer_id: custA.id });
  await mustCompletedOrder(ctx, orderA.id as number);
  const earnRes = await ctx.owner
    .post(`/api/customers/${custA.id as number}/points/earn`)
    .send({ order_id: orderA.id });
  expect(earnRes.status).toBe(201);
  expect((earnRes.body as Record<string, unknown>).points_earned).toBe(25);
  const custB = await mustCreateCustomer(ctx.owner, { name: 'Khach doi diem', phone: randPhone(), branch_id: ctx.branch1 });
  grantPoints(ctx.db, ctx.orgId, custB.id as number, 200);
  const orderB = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }], { customer_id: custB.id });
  const redeemed = await mustRedeemPoints(ctx.owner, custB.id as number, orderB.id as number, 200);
  expect(redeemed.discount).toBe(20000);
  const { from, to } = monthRange();
  const res = await ctx.owner.get(`/api/reports/points?from=${from}&to=${to}`);
  expect(res.status).toBe(200);
  const body = res.body as Record<string, unknown>;
  const totals = body.totals as Record<string, number>;
  expect(totals.earned_total).toBe(225);
  expect(totals.redeemed_total).toBe(200);
  expect(totals.redeemed_amount).toBe(20000);
  const rows = body.rows as Record<string, unknown>[];
  const byCustomer = new Map(rows.map((r) => [r.customer_id as number, r]));
  const rowA = byCustomer.get(custA.id as number);
  expect(rowA).toBeDefined();
  expect(rowA?.earned).toBe(25);
  expect(rowA?.redeemed).toBe(0);
  expect(rowA?.redeemed_amount).toBe(0);
  const rowB = byCustomer.get(custB.id as number);
  expect(rowB).toBeDefined();
  expect(rowB?.earned).toBe(200);
  expect(rowB?.redeemed).toBe(200);
  expect(rowB?.redeemed_amount).toBe(20000);
  const sumEarned = rows.reduce((s, r) => s + (r.earned as number), 0);
  const sumRedeemed = rows.reduce((s, r) => s + (r.redeemed as number), 0);
  expect(sumEarned).toBe(totals.earned_total);
  expect(sumRedeemed).toBe(totals.redeemed_total);
});

test('AC-3 ham thuan computePromotionsReport va computePointsReport truc tiep khop API', async () => {
  const ctx = await reportCtx();
  const promo = await mustCreatePromo(ctx.owner, { code: 'BCCMP', type: 'percent', value: 10, cap: 20000 });
  const cust = await mustCreateCustomer(ctx.owner, { name: 'Khach so sanh', phone: randPhone(), branch_id: ctx.branch1 });
  const order = await mustOrder250(ctx, { customer_id: cust.id });
  await mustApplyPromo(ctx.owner, order.id as number, 'BCCMP');
  await mustCompletedOrder(ctx, order.id as number);
  const earnRes = await ctx.owner
    .post(`/api/customers/${cust.id as number}/points/earn`)
    .send({ order_id: order.id });
  expect(earnRes.status).toBe(201);
  expect((earnRes.body as Record<string, unknown>).points_earned).toBe(25);
  const { from, to } = monthRange();
  const promoRows = computePromotionsReport(ctx.db, { from, to });
  expect(promoRows.length).toBe(1);
  expect(promoRows[0].code).toBe('BCCMP');
  expect(promoRows[0].promotion_id).toBe(promo.id);
  expect(promoRows[0].used_count).toBe(1);
  expect(promoRows[0].total_discount).toBe(20000);
  expect(promoRows[0].order_count).toBe(1);
  const points = computePointsReport(ctx.db, { from, to });
  expect(points.totals.earned_total).toBe(25);
  expect(points.totals.redeemed_total).toBe(0);
  expect(points.totals.redeemed_amount).toBe(0);
  expect(points.rows.length).toBe(1);
  expect(points.rows[0].customer_id).toBe(cust.id);
  expect(points.rows[0].earned).toBe(25);
  const apiPromo = await ctx.owner.get(`/api/reports/promotions?from=${from}&to=${to}`);
  expect(apiPromo.status).toBe(200);
  const apiPromoRows = apiPromo.body as Record<string, unknown>[];
  const apiPromoList = Array.isArray(apiPromoRows)
    ? apiPromoRows
    : ((apiPromo.body as Record<string, unknown>).rows as Record<string, unknown>[]);
  expect(apiPromoList[0].total_discount).toBe(promoRows[0].total_discount);
  const apiPoints = await ctx.owner.get(`/api/reports/points?from=${from}&to=${to}`);
  expect(apiPoints.status).toBe(200);
  const apiPointsTotals = (apiPoints.body as Record<string, unknown>).totals as Record<string, number>;
  expect(apiPointsTotals.earned_total).toBe(points.totals.earned_total);
  expect(apiPointsTotals.redeemed_total).toBe(points.totals.redeemed_total);
  expect(apiPointsTotals.redeemed_amount).toBe(points.totals.redeemed_amount);
});

test('AC-3 xuat CSV doanh thu khop JSON tung so kem dong TOTAL', async () => {
  const ctx = await reportCtx();
  const counter = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, counter.id as number);
  await mustPayCash(ctx, counter.id as number, 100000);
  const web = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }], { channel: 'web' });
  await mustCompletedOrder(ctx, web.id as number);
  const { from, to } = monthRange();
  const query = `from=${from}&to=${to}&group_by=channel`;
  const jsonRes = await ctx.owner.get(`/api/reports/revenue?${query}`);
  expect(jsonRes.status).toBe(200);
  const csvRes = await ctx.owner.get(`/api/reports/revenue?${query}&format=csv`);
  expect(csvRes.status).toBe(200);
  expect(String(csvRes.headers['content-type'])).toContain('text/csv');
  const parsed = parseCsv(csvRes.text);
  expect(parsed.header).toEqual([
    'key', 'label', 'gross_revenue', 'net_revenue', 'order_count', 'paid_total',
    'refunded_total', 'points_discount_total', 'promo_discount_total',
  ]);
  const totals = (jsonRes.body as Record<string, unknown>).totals as Record<string, number>;
  const jsonRows = (jsonRes.body as Record<string, unknown>).rows as Record<string, unknown>[];
  const dataRows = parsed.rows.filter((r) => r[0] !== 'TOTAL');
  expect(dataRows.length).toBe(jsonRows.length);
  for (const jr of jsonRows) {
    const cr = dataRows.find((r) => r[0] === String(jr.key));
    expect(cr).toBeDefined();
    expect(Number(cr?.[2])).toBe(jr.gross_revenue);
    expect(Number(cr?.[3])).toBe(jr.net_revenue);
    expect(Number(cr?.[4])).toBe(jr.order_count);
    expect(Number(cr?.[5])).toBe(jr.paid_total);
    expect(Number(cr?.[6])).toBe(jr.refunded_total);
    expect(Number(cr?.[7])).toBe(jr.points_discount_total);
    expect(Number(cr?.[8])).toBe(jr.promo_discount_total);
  }
  const totalRow = parsed.rows.find((r) => r[0] === 'TOTAL');
  expect(totalRow).toBeDefined();
  expect(Number(totalRow?.[2])).toBe(totals.gross_revenue);
  expect(Number(totalRow?.[3])).toBe(totals.net_revenue);
  expect(Number(totalRow?.[4])).toBe(totals.order_count);
  expect(Number(totalRow?.[5])).toBe(totals.paid_total);
  expect(Number(totalRow?.[6])).toBe(totals.refunded_total);
  expect(Number(totalRow?.[7])).toBe(totals.points_discount_total);
  expect(Number(totalRow?.[8])).toBe(totals.promo_discount_total);
});

test('AC-3 xuat CSV ton kho khop JSON kem ten co dau phay duoc quote', async () => {
  const ctx = await reportCtx();
  const pComma = await createProduct(ctx.owner, { name: 'SP, co dau phay', price: 10000, min_stock: 10 });
  const vComma = await createVariant(ctx.owner, pComma.id);
  await mustStockIn(ctx.owner, ctx.whA.id as number, vComma, 4);
  const jsonRes = await ctx.owner.get('/api/reports/stock');
  expect(jsonRes.status).toBe(200);
  const csvRes = await ctx.owner.get('/api/reports/stock?format=csv');
  expect(csvRes.status).toBe(200);
  expect(String(csvRes.headers['content-type'])).toContain('text/csv');
  expect(csvRes.text).toContain('"SP, co dau phay"');
  const parsed = parseCsv(csvRes.text);
  expect(parsed.header).toEqual([
    'variant_id', 'sku', 'product_name', 'warehouse_id', 'warehouse_name',
    'on_hand', 'reserved', 'available', 'min_stock', 'shortage',
  ]);
  const levels = (jsonRes.body as Record<string, unknown>).levels as Record<string, unknown>[];
  expect(parsed.rows.length).toBe(levels.length);
  for (const level of levels) {
    const cr = parsed.rows.find(
      (r) => Number(r[0]) === level.variant_id && Number(r[3]) === level.warehouse_id,
    );
    expect(cr).toBeDefined();
    expect(cr?.[2]).toBe(level.product_name);
    expect(Number(cr?.[5])).toBe(level.on_hand);
    expect(Number(cr?.[6])).toBe(level.reserved);
    expect(Number(cr?.[7])).toBe(level.available);
  }
  const commaRow = parsed.rows.find((r) => Number(r[0]) === vComma);
  expect(commaRow).toBeDefined();
  expect(commaRow?.[2]).toBe('SP, co dau phay');
  expect(Number(commaRow?.[5])).toBe(4);
  expect(Number(commaRow?.[8])).toBe(10);
  expect(Number(commaRow?.[9])).toBe(6);
});

test('AC-3 xuat CSV doi soat khop JSON tung dong lech', async () => {
  const ctx = await reportCtx();
  const expected = sumQtyChange(ctx.db, ctx.v1, ctx.whA.id as number);
  ctx.db
    .prepare('UPDATE stock_levels SET on_hand = on_hand + 5 WHERE variant_id = ? AND warehouse_id = ?')
    .run(ctx.v1, ctx.whA.id);
  const { from, to } = monthRange();
  const query = `from=${from}&to=${to}`;
  const jsonRes = await ctx.owner.get(`/api/reports/reconciliation?${query}`);
  expect(jsonRes.status).toBe(200);
  const csvRes = await ctx.owner.get(`/api/reports/reconciliation?${query}&format=csv`);
  expect(csvRes.status).toBe(200);
  expect(String(csvRes.headers['content-type'])).toContain('text/csv');
  const parsed = parseCsv(csvRes.text);
  expect(parsed.header).toEqual([
    'kind', 'severity', 'order_code', 'variant_id', 'warehouse_id',
    'expected', 'actual', 'difference', 'note',
  ]);
  const mismatches = (jsonRes.body as Record<string, unknown>).mismatches as Record<string, unknown>[];
  expect(parsed.rows.length).toBe(mismatches.length);
  const hit = mismatches.find((m) => m.kind === 'stock-level' && m.variant_id === ctx.v1);
  expect(hit).toBeDefined();
  expect(hit?.expected).toBe(expected);
  expect(hit?.actual).toBe(expected + 5);
  const csvHit = parsed.rows.find((r) => r[0] === 'stock-level' && Number(r[3]) === ctx.v1);
  expect(csvHit).toBeDefined();
  expect(Number(csvHit?.[5])).toBe(hit?.expected);
  expect(Number(csvHit?.[6])).toBe(hit?.actual);
  expect(Number(csvHit?.[7])).toBe(hit?.difference);
});

test('AC-3 xuat CSV khuyen mai va diem khop JSON kem dong TOTAL', async () => {
  const ctx = await reportCtx();
  const promo = await mustCreatePromo(ctx.owner, { code: 'BCCSV', type: 'percent', value: 10, cap: 20000 });
  const cust = await mustCreateCustomer(ctx.owner, { name: 'Khach CSV', phone: randPhone(), branch_id: ctx.branch1 });
  const order = await mustOrder250(ctx, { customer_id: cust.id });
  await mustApplyPromo(ctx.owner, order.id as number, 'BCCSV');
  await mustCompletedOrder(ctx, order.id as number);
  const earnRes = await ctx.owner
    .post(`/api/customers/${cust.id as number}/points/earn`)
    .send({ order_id: order.id });
  expect(earnRes.status).toBe(201);
  const { from, to } = monthRange();
  const promoJson = await ctx.owner.get(`/api/reports/promotions?from=${from}&to=${to}`);
  expect(promoJson.status).toBe(200);
  const promoCsv = await ctx.owner.get(`/api/reports/promotions?from=${from}&to=${to}&format=csv`);
  expect(promoCsv.status).toBe(200);
  expect(String(promoCsv.headers['content-type'])).toContain('text/csv');
  const promoParsed = parseCsv(promoCsv.text);
  expect(promoParsed.header).toEqual(['code', 'used_count', 'released_count', 'total_discount', 'order_count']);
  const promoRows = promoJson.body as Record<string, unknown>[];
  const promoList = Array.isArray(promoRows)
    ? promoRows
    : ((promoJson.body as Record<string, unknown>).rows as Record<string, unknown>[]);
  const promoData = promoParsed.rows.filter((r) => r[0] !== 'TOTAL');
  expect(promoData.length).toBe(promoList.length);
  const promoRow = promoData.find((r) => r[0] === 'BCCSV');
  expect(promoRow).toBeDefined();
  expect(Number(promoRow?.[1])).toBe(1);
  expect(Number(promoRow?.[2])).toBe(0);
  expect(Number(promoRow?.[3])).toBe(20000);
  expect(Number(promoRow?.[4])).toBe(1);
  expect(promo.id).toBeDefined();
  const promoTotal = promoParsed.rows.find((r) => r[0] === 'TOTAL');
  expect(promoTotal).toBeDefined();
  expect(Number(promoTotal?.[1])).toBe(1);
  expect(Number(promoTotal?.[3])).toBe(20000);
  const pointsJson = await ctx.owner.get(`/api/reports/points?from=${from}&to=${to}`);
  expect(pointsJson.status).toBe(200);
  const pointsCsv = await ctx.owner.get(`/api/reports/points?from=${from}&to=${to}&format=csv`);
  expect(pointsCsv.status).toBe(200);
  const pointsParsed = parseCsv(pointsCsv.text);
  expect(pointsParsed.header).toEqual(['customer_id', 'customer_name', 'earned', 'redeemed', 'redeemed_amount']);
  const pointsTotals = (pointsJson.body as Record<string, unknown>).totals as Record<string, number>;
  const pointsRows = (pointsJson.body as Record<string, unknown>).rows as Record<string, unknown>[];
  const pointsData = pointsParsed.rows.filter((r) => r[0] !== 'TOTAL');
  expect(pointsData.length).toBe(pointsRows.length);
  const pointsRow = pointsData.find((r) => Number(r[0]) === cust.id);
  expect(pointsRow).toBeDefined();
  expect(Number(pointsRow?.[2])).toBe(25);
  expect(Number(pointsRow?.[3])).toBe(0);
  expect(Number(pointsRow?.[4])).toBe(0);
  const pointsTotal = pointsParsed.rows.find((r) => r[0] === 'TOTAL');
  expect(pointsTotal).toBeDefined();
  expect(Number(pointsTotal?.[2])).toBe(pointsTotals.earned_total);
  expect(Number(pointsTotal?.[3])).toBe(pointsTotals.redeemed_total);
  expect(Number(pointsTotal?.[4])).toBe(pointsTotals.redeemed_amount);
});

test('AC-3 format la 400 tren moi endpoint bao cao', async () => {
  const ctx = await reportCtx();
  const { from, to } = monthRange();
  expect((await ctx.owner.get(`/api/reports/revenue?from=${from}&to=${to}&format=xml`)).status).toBe(400);
  expect((await ctx.owner.get(`/api/reports/stock?format=xml`)).status).toBe(400);
  expect((await ctx.owner.get(`/api/reports/reconciliation?from=${from}&to=${to}&format=xml`)).status).toBe(400);
  expect((await ctx.owner.get(`/api/reports/promotions?from=${from}&to=${to}&format=xml`)).status).toBe(400);
  expect((await ctx.owner.get(`/api/reports/points?from=${from}&to=${to}&format=xml`)).status).toBe(400);
});

// ---------- AC-4: RBAC + audit + idempotency ----------

test('AC-4 can 2 actions bao cao theo dung ma tran brief', () => {
  const owner = reportActor(1, 'owner', null);
  const manager = reportActor(2, 'manager', null);
  const sales1 = reportActor(3, 'sales', 1);
  const accountant = reportActor(5, 'accountant', 1);
  const warehouseA = reportActor(4, 'warehouse', 1, 7);
  const t = (branchId?: number | null, warehouseId?: number | null) => reportTarget(1, branchId, warehouseId);
  expect(can(owner, 'view-reports' as Action, t())).toBe(true);
  expect(can(owner, 'view-reports' as Action, t(2))).toBe(true);
  expect(can(manager, 'view-reports' as Action, t(2))).toBe(true);
  expect(can(accountant, 'view-reports' as Action, t())).toBe(true);
  expect(can(accountant, 'view-reports' as Action, t(2))).toBe(true);
  expect(can(owner, 'export-reports' as Action, t())).toBe(true);
  expect(can(manager, 'export-reports' as Action, t(2))).toBe(true);
  expect(can(accountant, 'export-reports' as Action, t())).toBe(true);
  expect(can(sales1, 'view-reports' as Action, t(1))).toBe(true);
  expect(can(sales1, 'export-reports' as Action, t(1))).toBe(true);
  expect(can(warehouseA, 'view-reports' as Action, t(null, 7))).toBe(true);
  expect(can(warehouseA, 'export-reports' as Action, t(null, 7))).toBe(true);
});

test('AC-4 RBAC 403 sales xem doanh thu chi nhanh khac sales xem bao cao ton warehouse xem doanh thu', async () => {
  const ctx = await reportCtx();
  expect((await ctx.sales.get(`/api/reports/revenue?branch_id=${ctx.branch2}`)).status).toBe(403);
  expect((await ctx.sales.get('/api/reports/stock')).status).toBe(403);
  expect((await ctx.sales.get('/api/reports/stock?format=csv')).status).toBe(403);
  expect((await ctx.warehouse.get('/api/reports/revenue')).status).toBe(403);
  expect((await ctx.warehouse.get('/api/reports/reconciliation')).status).toBe(403);
  expect((await ctx.warehouse.get('/api/reports/promotions')).status).toBe(403);
  expect((await ctx.warehouse.get('/api/reports/points')).status).toBe(403);
  expect((await ctx.warehouse.get('/api/reports/revenue?format=csv')).status).toBe(403);
});

test('AC-4 RBAC 403 warehouse xem ton kho ngoai pham vi va user org A doc bao cao org B', async () => {
  const ctx = await reportCtx();
  const whUserId = await addUser(ctx.db, ctx.orgId, ctx.branch1, 'kho-a@example.local', 'warehouse');
  ctx.db.prepare('UPDATE users SET warehouse_id = ? WHERE id = ?').run(ctx.whA.id, whUserId);
  const whAUser = await loginAgent(ctx.app, 'kho-a@example.local', 'gia-lap-123');
  expect((await whAUser.get(`/api/reports/stock?warehouse_id=${ctx.whB.id}`)).status).toBe(403);
  expect((await whAUser.get(`/api/reports/stock?warehouse_id=${ctx.whA.id}`)).status).toBe(200);
  expect((await ctx.ownerB.get('/api/reports/revenue')).status).toBe(403);
  expect((await ctx.ownerB.get('/api/reports/stock')).status).toBe(403);
  expect((await ctx.ownerB.get('/api/reports/reconciliation')).status).toBe(403);
  expect((await ctx.ownerB.get('/api/reports/promotions')).status).toBe(403);
  expect((await ctx.ownerB.get('/api/reports/points')).status).toBe(403);
});

test('AC-4 RBAC duong accountant xem toan org 200 sales xem doanh thu chi nhanh minh 200 warehouse xem ton kho duoc gan 200', async () => {
  const ctx = await reportCtx();
  const b1 = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, b1.id as number);
  const b2 = await mustCreateOrder(ctx.manager, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    branch_id: ctx.branch2,
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  await mustCompletedOrder(ctx, b2.id as number, ctx.manager);
  const { from, to } = monthRange();
  const acc = await ctx.accountant.get(`/api/reports/revenue?from=${from}&to=${to}`);
  expect(acc.status).toBe(200);
  expect((acc.body as Record<string, unknown>).totals as Record<string, number>).toBeDefined();
  expect(((acc.body as Record<string, unknown>).totals as Record<string, number>).gross_revenue).toBe(350000);
  const salesPlain = await ctx.sales.get(`/api/reports/revenue?from=${from}&to=${to}`);
  expect(salesPlain.status).toBe(200);
  expect(((salesPlain.body as Record<string, unknown>).totals as Record<string, number>).gross_revenue).toBe(250000);
  const salesOwn = await ctx.sales.get(`/api/reports/revenue?from=${from}&to=${to}&branch_id=${ctx.branch1}`);
  expect(salesOwn.status).toBe(200);
  expect(((salesOwn.body as Record<string, unknown>).totals as Record<string, number>).gross_revenue).toBe(250000);
  const sales2Plain = await ctx.sales2.get(`/api/reports/revenue?from=${from}&to=${to}`);
  expect(sales2Plain.status).toBe(200);
  expect(((sales2Plain.body as Record<string, unknown>).totals as Record<string, number>).gross_revenue).toBe(100000);
  const whUserId = await addUser(ctx.db, ctx.orgId, ctx.branch1, 'kho-a2@example.local', 'warehouse');
  ctx.db.prepare('UPDATE users SET warehouse_id = ? WHERE id = ?').run(ctx.whA.id, whUserId);
  const whAUser = await loginAgent(ctx.app, 'kho-a2@example.local', 'gia-lap-123');
  const whStock = await whAUser.get(`/api/reports/stock?warehouse_id=${ctx.whA.id}`);
  expect(whStock.status).toBe(200);
  const whLevels = (whStock.body as Record<string, unknown>).levels as Record<string, unknown>[];
  expect(whLevels.length).toBeGreaterThan(0);
  for (const l of whLevels) expect(l.warehouse_id).toBe(ctx.whA.id);
  const whStockDefault = await whAUser.get('/api/reports/stock');
  expect(whStockDefault.status).toBe(200);
  const whDefaultLevels = (whStockDefault.body as Record<string, unknown>).levels as Record<string, unknown>[];
  expect(whDefaultLevels.length).toBeGreaterThan(0);
  for (const l of whDefaultLevels) expect(l.warehouse_id).toBe(ctx.whA.id);
  const whNull = await ctx.warehouse.get('/api/reports/stock');
  expect(whNull.status).toBe(200);
  const mgrStock = await ctx.manager.get('/api/reports/stock');
  expect(mgrStock.status).toBe(200);
});

test('AC-4 audit xuat CSV ghi dung 1 ban ghi khop filter xem JSON khong tang xuat lai tang them 1', async () => {
  const ctx = await reportCtx();
  const order = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order.id as number);
  const { from, to } = monthRange();
  expect(exportAuditRows(ctx.db, ctx.orgId).length).toBe(0);
  const csv = await ctx.owner.get(
    `/api/reports/revenue?from=${from}&to=${to}&channel=counter&group_by=channel&format=csv`,
  );
  expect(csv.status).toBe(200);
  expect(String(csv.headers['content-type'])).toContain('text/csv');
  const afterOne = exportAuditRows(ctx.db, ctx.orgId);
  expect(afterOne.length).toBe(1);
  expect(afterOne[0].action).toBe('export-report');
  expect(typeof afterOne[0].user_id).toBe('number');
  expect(afterOne[0].created_at).toBeTruthy();
  expect(afterOne[0].detail.report).toBe('revenue');
  expect(afterOne[0].detail.from).toBe(from);
  expect(afterOne[0].detail.to).toBe(to);
  expect(afterOne[0].detail.format).toBe('csv');
  expect(afterOne[0].detail.channel).toBe('counter');
  expect(afterOne[0].detail.group_by).toBe('channel');
  expect(JSON.stringify(afterOne[0].detail)).not.toContain('card_number');
  expect(JSON.stringify(afterOne[0].detail)).not.toContain('4111');
  const json = await ctx.owner.get(`/api/reports/revenue?from=${from}&to=${to}&channel=counter&group_by=channel`);
  expect(json.status).toBe(200);
  expect(exportAuditRows(ctx.db, ctx.orgId).length).toBe(1);
  const csv2 = await ctx.owner.get(
    `/api/reports/revenue?from=${from}&to=${to}&channel=counter&group_by=channel&format=csv`,
  );
  expect(csv2.status).toBe(200);
  expect(exportAuditRows(ctx.db, ctx.orgId).length).toBe(2);
  const logRes = await ctx.owner.get('/api/audit-log');
  expect(logRes.status).toBe(200);
  expect((await ctx.sales.get('/api/audit-log')).status).toBe(403);
});

test('AC-4 GET bao cao 2 lan tra cung ket qua khong yeu cau idempotency', async () => {
  const ctx = await reportCtx();
  const order = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order.id as number);
  const { from, to } = monthRange();
  const first = await ctx.owner.get(`/api/reports/revenue?from=${from}&to=${to}&group_by=day`);
  expect(first.status).toBe(200);
  const second = await ctx.owner.get(`/api/reports/revenue?from=${from}&to=${to}&group_by=day`);
  expect(second.status).toBe(200);
  expect(second.body).toEqual(first.body);
  const stockFirst = await ctx.owner.get('/api/reports/stock');
  expect(stockFirst.status).toBe(200);
  const stockSecond = await ctx.owner.get('/api/reports/stock');
  expect(stockSecond.status).toBe(200);
  expect(stockSecond.body).toEqual(stockFirst.body);
});
