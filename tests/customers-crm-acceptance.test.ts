import { test, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { migrate, openDb, tableNames } from '../src/db.js';
import { can, type Action, type Actor, type Role, type Target } from '../src/rbac.js';
import { seed } from '../src/seed.js';
import { computePaymentSummary } from '../src/payments.js';

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
  return Math.random().toString(36).slice(2, 8);
}

async function createWarehouse(
  agent: Agent,
  name: string,
): Promise<Record<string, unknown>> {
  const res = await agent.post('/api/warehouses').send({ name });
  expect(res.status).toBe(201);
  const body = res.body as Record<string, unknown>;
  const w = (body.warehouse as Record<string, unknown>) ?? body;
  expect(w.id).toBeDefined();
  return w;
}

async function createProduct(
  agent: Agent,
  overrides: Record<string, unknown> = {},
): Promise<{ id: number; code: string }> {
  const code = (overrides.code as string) ?? `SP-CRM-${rand()}`;
  const res = await agent.post('/api/products').send({
    code,
    name: 'San pham CRM gia lap',
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
    sku: `SKU-CRM-${rand()}`,
    name: 'Bien the gia lap',
  });
  expect(res.status).toBe(201);
  const v = (res.body as Record<string, unknown>).variant as Record<string, unknown> | undefined;
  const id = ((v ?? res.body) as Record<string, unknown>).id as number;
  expect(id).toBeDefined();
  return id;
}

async function mustStockIn(
  agent: Agent,
  warehouseId: number,
  variantId: number,
  qty: number,
): Promise<void> {
  const res = await agent
    .post('/api/stock/in')
    .send({ warehouse_id: warehouseId, variant_id: variantId, qty, reason: 'nhap gia lap' });
  expect([200, 201]).toContain(res.status);
}

/**
 * Boi canh CRM: 1 kho A + 3 san pham/bien the (V1 gia 100000, V2 gia
 * 50000, V3 gia 5000) + ton: whA V1 200 / V2 100 / V3 50.
 */
async function crmCtx() {
  const ctx = await fullCtx();
  const whA = await createWarehouse(ctx.owner, 'Kho A');
  const p1 = await createProduct(ctx.owner, { name: 'SP CRM 1', price: 100000, min_stock: 0 });
  const v1 = await createVariant(ctx.owner, p1.id);
  const p2 = await createProduct(ctx.owner, { name: 'SP CRM 2', price: 50000, min_stock: 0 });
  const v2 = await createVariant(ctx.owner, p2.id);
  const p3 = await createProduct(ctx.owner, { name: 'SP CRM 3', price: 5000, min_stock: 0 });
  const v3 = await createVariant(ctx.owner, p3.id);
  await mustStockIn(ctx.owner, whA.id as number, v1, 200);
  await mustStockIn(ctx.owner, whA.id as number, v2, 100);
  await mustStockIn(ctx.owner, whA.id as number, v3, 50);
  return { ...ctx, whA, p1, v1, p2, v2, p3, v3 };
}

type Ctx = Awaited<ReturnType<typeof crmCtx>>;

function asOrder(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (body.order as Record<string, unknown>) ?? body;
}

function asCustomer(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (body.customer as Record<string, unknown>) ?? body;
}

function asList(res: { body: unknown }, keys: string[]): Record<string, unknown>[] {
  const body = res.body as Record<string, unknown>;
  if (Array.isArray(res.body)) return res.body as Record<string, unknown>[];
  for (const key of keys) {
    if (Array.isArray(body[key])) return body[key] as Record<string, unknown>[];
  }
  return [];
}

function listTotal(res: { body: unknown }): number | undefined {
  const body = res.body as Record<string, unknown>;
  if (typeof body.total === 'number') return body.total;
  if (typeof body.count === 'number') return body.count;
  return undefined;
}

function asSummary(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (body.order_summary as Record<string, unknown>) ??
    (body.summary as Record<string, unknown>) ?? {};
}

function purchaseSummary(c: Record<string, unknown>): Record<string, unknown> {
  return (c.purchase_summary as Record<string, unknown>) ?? {};
}

function cols(db: Db, table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.map((r) => r.name);
}

function auditRows(
  db: Db,
  orgId: number,
): { action: string; detail: Record<string, unknown>; user_id: number | null; created_at: string }[] {
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
    return { action: r.action, detail, user_id: r.user_id, created_at: r.created_at };
  });
}

function pointsLedger(db: Db, customerId: number): Record<string, unknown>[] {
  return db
    .prepare('SELECT * FROM customer_points WHERE customer_id = ? ORDER BY id')
    .all(customerId) as Record<string, unknown>[];
}

function notesRows(db: Db, customerId: number): Record<string, unknown>[] {
  return db
    .prepare('SELECT * FROM customer_notes WHERE customer_id = ? ORDER BY id')
    .all(customerId) as Record<string, unknown>[];
}

function customerRow(db: Db, id: number): Record<string, unknown> | undefined {
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
}

function orderRow(db: Db, id: number): Record<string, unknown> {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Record<string, unknown>;
}

/** Doi created_at cua don ve N ngay truoc (de tinh phan khuc ngu quen). */
function setOrderDaysAgo(db: Db, orderId: number, days: number): void {
  db.prepare("UPDATE orders SET created_at = datetime('now', ?), updated_at = datetime('now', ?) WHERE id = ?").run(
    `-${days} days`,
    `-${days} days`,
    orderId,
  );
}

async function mustCreateCustomer(
  agent: Agent,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await agent.post('/api/customers').send(body);
  expect(res.status).toBe(201);
  const c = asCustomer(res);
  expect(c.id).toBeDefined();
  return c;
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

/** Don cua khach, mac dinh 2 x V1 = 200000. */
async function mustOrderForCustomer(
  ctx: Ctx,
  customerId: number,
  items?: { variant_id: number; qty: number }[],
  agent: Agent = ctx.owner,
): Promise<Record<string, unknown>> {
  return mustCreateOrder(agent, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    customer_id: customerId,
    items: items ?? [{ variant_id: ctx.v1, qty: 2 }],
  });
}

async function mustCompletedOrderForCustomer(
  ctx: Ctx,
  customerId: number,
  items?: { variant_id: number; qty: number }[],
  agent: Agent = ctx.owner,
): Promise<Record<string, unknown>> {
  const order = await mustOrderForCustomer(ctx, customerId, items, agent);
  await mustTransition(ctx.owner, order.id as number, 'confirm');
  await mustTransition(ctx.owner, order.id as number, 'process');
  const done = await mustTransition(ctx.owner, order.id as number, 'complete');
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
  expect(payment.status).toBe('paid');
  return payment;
}

async function mustRefund(
  agent: Agent,
  paymentId: number,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await agent.post(`/api/payments/${paymentId}/refunds`).send(body);
  expect(res.status).toBe(201);
  const b = res.body as Record<string, unknown>;
  const refund = (b.refund as Record<string, unknown>) ?? b;
  expect(refund.id).toBeDefined();
  return refund;
}

async function earnPoints(
  agent: Agent,
  customerId: number,
  orderId: number,
  idempotencyKey?: string,
) {
  const req = agent.post(`/api/customers/${customerId}/points/earn`);
  if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
  return req.send({ order_id: orderId });
}

async function mustEarnPoints(
  agent: Agent,
  customerId: number,
  orderId: number,
  idempotencyKey?: string,
): Promise<Record<string, unknown>> {
  const res = await earnPoints(agent, customerId, orderId, idempotencyKey);
  expect(res.status).toBe(201);
  return res.body as Record<string, unknown>;
}

async function redeemPoints(
  agent: Agent,
  customerId: number,
  orderId: number,
  points: number,
  idempotencyKey?: string,
) {
  const req = agent.post(`/api/customers/${customerId}/points/redeem`);
  if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
  return req.send({ order_id: orderId, points });
}

async function mustRedeemPoints(
  agent: Agent,
  customerId: number,
  orderId: number,
  points: number,
  idempotencyKey?: string,
): Promise<Record<string, unknown>> {
  const res = await redeemPoints(agent, customerId, orderId, points, idempotencyKey);
  expect(res.status).toBe(201);
  return res.body as Record<string, unknown>;
}

async function getCustomer(agent: Agent, customerId: number) {
  return agent.get(`/api/customers/${customerId}`);
}

async function mustGetCustomer(agent: Agent, customerId: number): Promise<Record<string, unknown>> {
  const res = await getCustomer(agent, customerId);
  expect(res.status).toBe(200);
  return asCustomer(res);
}

function custActor(
  id: number,
  role: Role,
  branchId: number | null = null,
  warehouseId: number | null = null,
): Actor {
  return { id, orgId: 1, branchId, role, warehouseId };
}

function custTarget(orgId = 1, branchId?: number | null, warehouseId?: number | null): Target {
  return { orgId, branchId, warehouseId };
}

// ---------- AC-1: ho so khach + lich su mua ----------

test('AC-1 migration 013 tao du 3 bang khach/diem/ghi chu + cot orders, khong co cot segment/expires_at', () => {
  const { db } = freshApp();
  const names = tableNames(db);
  for (const t of ['customers', 'customer_points', 'customer_notes']) {
    expect(names).toContain(t);
  }
  for (const c of ['org_id', 'branch_id', 'name', 'phone', 'email', 'address', 'status', 'merged_into_id', 'created_at', 'updated_at']) {
    expect(cols(db, 'customers')).toContain(c);
  }
  expect(cols(db, 'customers')).not.toContain('segment');
  for (const c of ['customer_id', 'org_id', 'type', 'points', 'reason', 'order_id', 'created_by', 'created_at']) {
    expect(cols(db, 'customer_points')).toContain(c);
  }
  expect(cols(db, 'customer_points')).not.toContain('expires_at');
  for (const c of ['customer_id', 'org_id', 'author_id', 'content', 'created_at']) {
    expect(cols(db, 'customer_notes')).toContain(c);
  }
  expect(cols(db, 'orders')).toContain('customer_id');
  expect(cols(db, 'orders')).toContain('points_discount');
  // Don cu giu customer_id NULL + points_discount 0.
  const oldOrder = db.prepare('SELECT customer_id, points_discount FROM orders LIMIT 1').get() as
    | { customer_id: unknown; points_discount: number }
    | undefined;
  if (oldOrder) {
    expect(oldOrder.customer_id).toBeNull();
    expect(oldOrder.points_discount).toBe(0);
  }
});

test('AC-1 POST /api/customers 201 kem purchase_summary rong + points_balance 0 + segment new', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, {
    name: 'Nguyen Van A',
    phone: '0901000001',
    email: 'a@example.local',
    address: 'Ben Cat',
    branch_id: ctx.branch1,
  });
  expect(c.name).toBe('Nguyen Van A');
  expect(c.phone).toBe('0901000001');
  expect(c.status).toBe('active');
  const ps = purchaseSummary(c);
  expect(ps.total_spent).toBe(0);
  expect(ps.order_count).toBe(0);
  expect(ps.last_order_at).toBeNull();
  expect(c.points_balance).toBe(0);
  expect(c.segment).toBe('new');
  expect(customerRow(ctx.db, c.id as number)?.org_id).toBe(ctx.orgId);
});

test('AC-1 tao khach sai dau vao: thieu name 400, trung phone 409, branch la 404/403, sales sai chi nhanh 403', async () => {
  const ctx = await crmCtx();
  const noName = await ctx.owner.post('/api/customers').send({ phone: '0901000011' });
  expect(noName.status).toBe(400);
  const blankName = await ctx.owner.post('/api/customers').send({ name: '   ', phone: '0901000012' });
  expect(blankName.status).toBe(400);
  await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001' });
  const dup = await ctx.owner.post('/api/customers').send({ name: 'Trung So', phone: '0901000001' });
  expect(dup.status).toBe(409);
  // Trung phone o org B khong anh huong org A (phone duy nhat trong org).
  const otherOrg = await ctx.ownerB.post('/api/customers').send({ name: 'Org B', phone: '0901000001' });
  expect(otherOrg.status).toBe(201);
  const badBranch = await ctx.owner.post('/api/customers').send({ name: 'Sai CN', branch_id: 999999 });
  expect(badBranch.status).toBe(404);
  const crossBranch = await ctx.owner.post('/api/customers').send({ name: 'CN org B', branch_id: ctx.branchBId });
  expect(crossBranch.status).toBe(403);
  // Sales tao khach: branch_id khac chi nhanh minh -> 403; khong gui thi thuoc chi nhanh minh.
  const salesWrong = await ctx.sales.post('/api/customers').send({ name: 'Sai CN sales', branch_id: ctx.branch2 });
  expect(salesWrong.status).toBe(403);
  const salesOk = await mustCreateCustomer(ctx.sales, { name: 'Khach sales', phone: '0901000002' });
  expect(customerRow(ctx.db, salesOk.id as number)?.branch_id).toBe(ctx.branch1);
  const salesExplicit = await mustCreateCustomer(ctx.sales, {
    name: 'Khach sales 2', phone: '0901000003', branch_id: ctx.branch1,
  });
  expect(salesExplicit.branch_id).toBe(ctx.branch1);
});

test('AC-1 PATCH /api/customers/:id 200, name trong 400, doi phone trung 409, khach merged 400', async () => {
  const ctx = await crmCtx();
  const a = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001' });
  const b = await mustCreateCustomer(ctx.owner, { name: 'Tran Thi B', phone: '0901000002' });
  const updated = await ctx.owner.patch(`/api/customers/${a.id as number}`).send({ phone: '0901000009', address: 'Thu Dau Mot' });
  expect(updated.status).toBe(200);
  expect(asCustomer(updated).phone).toBe('0901000009');
  const blank = await ctx.owner.patch(`/api/customers/${a.id as number}`).send({ name: '' });
  expect(blank.status).toBe(400);
  const dup = await ctx.owner.patch(`/api/customers/${a.id as number}`).send({ phone: '0901000002' });
  expect(dup.status).toBe(409);
  const missing = await ctx.owner.patch('/api/customers/999999').send({ name: 'Khong co' });
  expect(missing.status).toBe(404);
  const crossOrg = await ctx.ownerB.patch(`/api/customers/${a.id as number}`).send({ name: 'Org B' });
  expect(crossOrg.status).toBe(403);
  // Khach merged khong sua duoc: hop nhat B vao A roi sua B.
  const merged = await ctx.owner.post(`/api/customers/${a.id as number}/merge`).send({ source_customer_id: b.id, confirm: true });
  expect(merged.status).toBe(200);
  const editMerged = await ctx.owner.patch(`/api/customers/${b.id as number}`).send({ name: 'Doi ten' });
  expect(editMerged.status).toBe(400);
});

test('AC-1 GET /api/customers/:id tra purchase_summary chi tinh don completed, don draft khong tinh', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001' });
  const done = await mustCompletedOrderForCustomer(ctx, c.id as number, [
    { variant_id: ctx.v1, qty: 2 },
    { variant_id: ctx.v2, qty: 1 },
  ]);
  expect(done.total).toBe(250000);
  // Don draft 100000 cua cung khach: khong tinh vao tom tat.
  await mustOrderForCustomer(ctx, c.id as number, [{ variant_id: ctx.v1, qty: 1 }]);
  const got = await mustGetCustomer(ctx.owner, c.id as number);
  const ps = purchaseSummary(got);
  expect(ps.total_spent).toBe(250000);
  expect(ps.order_count).toBe(1);
  expect(ps.last_order_at).toBeTruthy();
  expect(typeof ps.last_order_at).toBe('string');
  expect(got.points_balance).toBe(0);
  expect(got.segment).toBe('new');
  // Khach chua co don: tom tat rong, last_order_at NULL.
  const fresh = await mustCreateCustomer(ctx.owner, { name: 'Khach moi', phone: '0901000002' });
  const freshGot = await mustGetCustomer(ctx.owner, fresh.id as number);
  expect(purchaseSummary(freshGot).total_spent).toBe(0);
  expect(purchaseSummary(freshGot).order_count).toBe(0);
  expect(purchaseSummary(freshGot).last_order_at).toBeNull();
});

test('AC-1 GET /api/customers/:id/orders tra don cua khach moi nhat truoc kem items, phan trang limit/offset', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001' });
  const first = await mustCompletedOrderForCustomer(ctx, c.id as number);
  const second = await mustOrderForCustomer(ctx, c.id as number, [{ variant_id: ctx.v2, qty: 1 }]);
  const other = await mustCreateCustomer(ctx.owner, { name: 'Tran Thi B', phone: '0901000002' });
  await mustCompletedOrderForCustomer(ctx, other.id as number);
  const listRes = await ctx.owner.get(`/api/customers/${c.id as number}/orders`);
  expect(listRes.status).toBe(200);
  const list = asList(listRes, ['orders', 'items', 'rows', 'data']);
  expect(list).toHaveLength(2);
  expect(list[0]?.id).toBe(second.id);
  expect(list[1]?.id).toBe(first.id);
  expect(Array.isArray(list[0]?.items)).toBe(true);
  expect((list[0]?.items as unknown[]).length).toBe(1);
  const page = await ctx.owner.get(`/api/customers/${c.id as number}/orders?limit=1&offset=1`);
  expect(page.status).toBe(200);
  const pageList = asList(page, ['orders', 'items', 'rows', 'data']);
  expect(pageList).toHaveLength(1);
  expect(pageList[0]?.id).toBe(first.id);
  const missing = await ctx.owner.get('/api/customers/999999/orders');
  expect(missing.status).toBe(404);
});

test('AC-1 POST /api/orders nhan customer_id optional: gan khach 201, khong gui van tao duoc, sai khach 404/403/400', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001' });
  const linked = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    customer_id: c.id,
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  expect(linked.customer_id).toBe(c.id);
  expect(orderRow(ctx.db, linked.id as number).customer_id).toBe(c.id);
  const unlinked = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  expect(unlinked.customer_id == null).toBe(true);
  const missing = await ctx.owner.post('/api/orders').send({
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    customer_id: 999999,
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  expect(missing.status).toBe(404);
  const otherOrg = await mustCreateCustomer(ctx.ownerB, { name: 'Org B', phone: '0901000002' });
  const cross = await ctx.owner.post('/api/orders').send({
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    customer_id: otherOrg.id,
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  expect(cross.status).toBe(403);
  const src = await mustCreateCustomer(ctx.owner, { name: 'Nguon', phone: '0901000003' });
  const merged = await ctx.owner.post(`/api/customers/${c.id as number}/merge`).send({ source_customer_id: src.id, confirm: true });
  expect(merged.status).toBe(200);
  const mergedOrder = await ctx.owner.post('/api/orders').send({
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    customer_id: src.id,
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  expect(mergedOrder.status).toBe(400);
});

test('AC-1 doc khach ngoai org 403, khach khong ton tai 404', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001' });
  const cross = await ctx.ownerB.get(`/api/customers/${c.id as number}`);
  expect(cross.status).toBe(403);
  const missing = await ctx.owner.get('/api/customers/999999');
  expect(missing.status).toBe(404);
  const crossOrders = await ctx.ownerB.get(`/api/customers/${c.id as number}/orders`);
  expect(crossOrders.status).toBe(403);
});

// ---------- AC-2: diem tich luy + doi diem + ledger ----------

test('AC-2 tich diem don completed 250000d -> 25 diem, 1 dong ledger earn reason la ma don', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001' });
  const order = await mustCompletedOrderForCustomer(ctx, c.id as number, [
    { variant_id: ctx.v1, qty: 2 },
    { variant_id: ctx.v2, qty: 1 },
  ]);
  const res = await mustEarnPoints(ctx.owner, c.id as number, order.id as number);
  expect(res.points_earned).toBe(25);
  expect(res.points_balance).toBe(25);
  expect(res.customer_id).toBe(c.id);
  expect(res.order_id).toBe(order.id);
  const ledger = pointsLedger(ctx.db, c.id as number);
  expect(ledger).toHaveLength(1);
  expect(ledger[0]?.type).toBe('earn');
  expect(ledger[0]?.points).toBe(25);
  expect(ledger[0]?.reason).toBe(order.code);
  expect(ledger[0]?.order_id).toBe(order.id);
  expect(ledger[0]?.created_by).toBeDefined();
  const got = await mustGetCustomer(ctx.owner, c.id as number);
  expect(got.points_balance).toBe(25);
});

test('AC-2 tich diem don chua completed -> 400, khong ghi ledger, so du khong doi', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001' });
  const draft = await mustOrderForCustomer(ctx, c.id as number);
  const confirmed = await mustOrderForCustomer(ctx, c.id as number);
  await mustTransition(ctx.owner, confirmed.id as number, 'confirm');
  const processing = await mustOrderForCustomer(ctx, c.id as number);
  await mustTransition(ctx.owner, processing.id as number, 'confirm');
  await mustTransition(ctx.owner, processing.id as number, 'process');
  const cancelled = await mustOrderForCustomer(ctx, c.id as number);
  await mustTransition(ctx.owner, cancelled.id as number, 'cancel');
  for (const o of [draft, confirmed, processing, cancelled]) {
    const res = await earnPoints(ctx.owner, c.id as number, o.id as number);
    expect(res.status).toBe(400);
  }
  expect(pointsLedger(ctx.db, c.id as number)).toHaveLength(0);
  // Don khong thuoc khach -> 400; don khong ton tai -> 404; khach khong ton tai -> 404.
  const other = await mustCreateCustomer(ctx.owner, { name: 'Tran Thi B', phone: '0901000002' });
  const otherOrder = await mustCompletedOrderForCustomer(ctx, other.id as number);
  const wrongOwner = await earnPoints(ctx.owner, c.id as number, otherOrder.id as number);
  expect(wrongOwner.status).toBe(400);
  const missingOrder = await earnPoints(ctx.owner, c.id as number, 999999);
  expect(missingOrder.status).toBe(404);
  const missingCustomer = await earnPoints(ctx.owner, 999999, otherOrder.id as number);
  expect(missingCustomer.status).toBe(404);
  const crossOrg = await earnPoints(ctx.ownerB, c.id as number, otherOrder.id as number);
  expect(crossOrg.status).toBe(403);
});

test('AC-2 tich diem lan 2 cung don khac key -> 400, so du khong doi', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001' });
  const order = await mustCompletedOrderForCustomer(ctx, c.id as number);
  await mustEarnPoints(ctx.owner, c.id as number, order.id as number, 'earn-key-1');
  const again = await earnPoints(ctx.owner, c.id as number, order.id as number, 'earn-key-2');
  expect(again.status).toBe(400);
  expect(pointsLedger(ctx.db, c.id as number)).toHaveLength(1);
  const got = await mustGetCustomer(ctx.owner, c.id as number);
  expect(got.points_balance).toBe(20);
});

test('AC-2 tich diem tinh tren tong sau hoan: don 250000d hoan 60000d -> 19 diem', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001' });
  const order = await mustCompletedOrderForCustomer(ctx, c.id as number, [
    { variant_id: ctx.v1, qty: 2 },
    { variant_id: ctx.v2, qty: 1 },
  ]);
  const payment = await mustPayCash(ctx, order.id as number, 250000);
  await mustRefund(ctx.owner, payment.id as number, { amount: 60000, reason: 'hoan mot phan gia lap' });
  const res = await mustEarnPoints(ctx.owner, c.id as number, order.id as number);
  expect(res.points_earned).toBe(19);
  expect(res.points_balance).toBe(19);
});

test('AC-2 don tong sau hoan < 10000d -> 400, khong ghi ledger 0 diem', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001' });
  const order = await mustCompletedOrderForCustomer(ctx, c.id as number, [
    { variant_id: ctx.v2, qty: 1 },
  ]);
  expect(order.total).toBe(50000);
  const payment = await mustPayCash(ctx, order.id as number, 50000);
  await mustRefund(ctx.owner, payment.id as number, { amount: 45000, reason: 'hoan gan het gia lap' });
  const res = await earnPoints(ctx.owner, c.id as number, order.id as number);
  expect(res.status).toBe(400);
  expect(pointsLedger(ctx.db, c.id as number)).toHaveLength(0);
  const got = await mustGetCustomer(ctx.owner, c.id as number);
  expect(got.points_balance).toBe(0);
});

test('AC-2 doi diem 10 diem tru 1000d don draft, outstanding giam, payment_status van unpaid', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001' });
  const completed = await mustCompletedOrderForCustomer(ctx, c.id as number, [
    { variant_id: ctx.v1, qty: 2 },
    { variant_id: ctx.v2, qty: 1 },
  ]);
  await mustEarnPoints(ctx.owner, c.id as number, completed.id as number);
  const draft = await mustOrderForCustomer(ctx, c.id as number, [{ variant_id: ctx.v1, qty: 1 }]);
  expect(draft.total).toBe(100000);
  const res = await mustRedeemPoints(ctx.owner, c.id as number, draft.id as number, 10);
  expect(res.points_redeemed).toBe(10);
  expect(res.discount).toBe(1000);
  expect(res.points_balance).toBe(15);
  expect(res.order_points_discount).toBe(1000);
  expect(orderRow(ctx.db, draft.id as number).points_discount).toBe(1000);
  const ledger = pointsLedger(ctx.db, c.id as number);
  expect(ledger).toHaveLength(2);
  expect(ledger[1]?.type).toBe('redeem');
  expect(ledger[1]?.points).toBe(10);
  expect(ledger[1]?.reason).toBe(draft.code);
  // Doi soat qua API + truc tiep qua computePaymentSummary.
  const payments = await ctx.owner.get(`/api/orders/${draft.id as number}/payments`);
  expect(payments.status).toBe(200);
  expect(asSummary(payments).outstanding).toBe(99000);
  expect(asSummary(payments).payment_status).toBe('unpaid');
  const direct = computePaymentSummary(ctx.db, draft.id as number) as Record<string, unknown>;
  expect(direct.outstanding).toBe(99000);
  expect(direct.payment_status).toBe('unpaid');
  // Don doi diem van di tiep vong doi binh thuong va chi tich diem khi completed.
  await mustTransition(ctx.owner, draft.id as number, 'confirm');
  await mustTransition(ctx.owner, draft.id as number, 'process');
  const done = await mustTransition(ctx.owner, draft.id as number, 'complete');
  expect(done.status).toBe('completed');
  const earnDone = await mustEarnPoints(ctx.owner, c.id as number, draft.id as number);
  // Tich diem tinh tren order_total, khong tru points_discount cua chinh don do.
  expect(earnDone.points_earned).toBe(10);
});

test('AC-2 doi diem sai: vuot so du 400, points khong nguyen/<=0 400, don khong draft 400, don khong thuoc khach 400', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001' });
  const completed = await mustCompletedOrderForCustomer(ctx, c.id as number);
  await mustEarnPoints(ctx.owner, c.id as number, completed.id as number);
  expect((await mustGetCustomer(ctx.owner, c.id as number)).points_balance).toBe(20);
  const draft = await mustOrderForCustomer(ctx, c.id as number, [{ variant_id: ctx.v1, qty: 1 }]);
  const over = await redeemPoints(ctx.owner, c.id as number, draft.id as number, 21);
  expect(over.status).toBe(400);
  const fractional = await redeemPoints(ctx.owner, c.id as number, draft.id as number, 2.5);
  expect(fractional.status).toBe(400);
  const zero = await redeemPoints(ctx.owner, c.id as number, draft.id as number, 0);
  expect(zero.status).toBe(400);
  const negative = await redeemPoints(ctx.owner, c.id as number, draft.id as number, -5);
  expect(negative.status).toBe(400);
  const notDraft = await redeemPoints(ctx.owner, c.id as number, completed.id as number, 5);
  expect(notDraft.status).toBe(400);
  const other = await mustCreateCustomer(ctx.owner, { name: 'Tran Thi B', phone: '0901000002' });
  const otherDraft = await mustOrderForCustomer(ctx, other.id as number);
  const wrongOwner = await redeemPoints(ctx.owner, c.id as number, otherDraft.id as number, 5);
  expect(wrongOwner.status).toBe(400);
  const missingOrder = await redeemPoints(ctx.owner, c.id as number, 999999, 5);
  expect(missingOrder.status).toBe(404);
  expect(pointsLedger(ctx.db, c.id as number)).toHaveLength(1);
  expect(orderRow(ctx.db, draft.id as number).points_discount).toBe(0);
  const got = await mustGetCustomer(ctx.owner, c.id as number);
  expect(got.points_balance).toBe(20);
});

test('AC-2 doi diem lan 2 cung don -> 400, so du + points_discount khong doi', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001' });
  const completed = await mustCompletedOrderForCustomer(ctx, c.id as number);
  await mustEarnPoints(ctx.owner, c.id as number, completed.id as number);
  const draft = await mustOrderForCustomer(ctx, c.id as number, [{ variant_id: ctx.v1, qty: 1 }]);
  await mustRedeemPoints(ctx.owner, c.id as number, draft.id as number, 10, 'redeem-key-1');
  const again = await redeemPoints(ctx.owner, c.id as number, draft.id as number, 5, 'redeem-key-2');
  expect(again.status).toBe(400);
  expect(pointsLedger(ctx.db, c.id as number)).toHaveLength(2);
  expect(orderRow(ctx.db, draft.id as number).points_discount).toBe(1000);
  const got = await mustGetCustomer(ctx.owner, c.id as number);
  expect(got.points_balance).toBe(10);
});

test('AC-2 doi diem vuot tong don: 100 diem cho don 5000d thi discount = 5000d, so diem tru van 100', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001' });
  const big = await mustCompletedOrderForCustomer(ctx, c.id as number, [
    { variant_id: ctx.v1, qty: 10 },
  ]);
  expect(big.total).toBe(1000000);
  await mustEarnPoints(ctx.owner, c.id as number, big.id as number);
  const small = await mustOrderForCustomer(ctx, c.id as number, [{ variant_id: ctx.v3, qty: 1 }]);
  expect(small.total).toBe(5000);
  const res = await mustRedeemPoints(ctx.owner, c.id as number, small.id as number, 100);
  expect(res.points_redeemed).toBe(100);
  expect(res.discount).toBe(5000);
  expect(res.points_balance).toBe(0);
  expect(orderRow(ctx.db, small.id as number).points_discount).toBe(5000);
  const payments = await ctx.owner.get(`/api/orders/${small.id as number}/payments`);
  expect(asSummary(payments).outstanding).toBe(0);
  expect(asSummary(payments).payment_status).toBe('unpaid');
});

test('AC-2 idempotency tich/doi diem: gui lai cung key -> replayed true, khong cong/tru lan 2', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001' });
  const completed = await mustCompletedOrderForCustomer(ctx, c.id as number, [
    { variant_id: ctx.v1, qty: 2 },
    { variant_id: ctx.v2, qty: 1 },
  ]);
  const first = await mustEarnPoints(ctx.owner, c.id as number, completed.id as number, 'idem-earn-1');
  expect(first.points_earned).toBe(25);
  const replay = await earnPoints(ctx.owner, c.id as number, completed.id as number, 'idem-earn-1');
  expect(replay.status).toBe(201);
  expect((replay.body as Record<string, unknown>).replayed).toBe(true);
  expect((replay.body as Record<string, unknown>).points_earned).toBe(25);
  expect(pointsLedger(ctx.db, c.id as number)).toHaveLength(1);
  const draft = await mustOrderForCustomer(ctx, c.id as number, [{ variant_id: ctx.v1, qty: 1 }]);
  const rFirst = await mustRedeemPoints(ctx.owner, c.id as number, draft.id as number, 10, 'idem-redeem-1');
  expect(rFirst.discount).toBe(1000);
  const rReplay = await redeemPoints(ctx.owner, c.id as number, draft.id as number, 10, 'idem-redeem-1');
  expect(rReplay.status).toBe(201);
  expect((rReplay.body as Record<string, unknown>).replayed).toBe(true);
  expect(pointsLedger(ctx.db, c.id as number)).toHaveLength(2);
  expect(orderRow(ctx.db, draft.id as number).points_discount).toBe(1000);
  const got = await mustGetCustomer(ctx.owner, c.id as number);
  expect(got.points_balance).toBe(15);
});

test('AC-2 tich/doi diem dong thoi 2 lan cung don: chi 1 lan thanh cong, so du dung', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001' });
  const completed = await mustCompletedOrderForCustomer(ctx, c.id as number);
  const [r1, r2] = await Promise.all([
    earnPoints(ctx.owner, c.id as number, completed.id as number, 'race-earn-a'),
    earnPoints(ctx.owner, c.id as number, completed.id as number, 'race-earn-b'),
  ]);
  const statuses = [r1.status, r2.status].sort();
  expect(statuses).toEqual([201, 400]);
  expect(pointsLedger(ctx.db, c.id as number)).toHaveLength(1);
  expect((await mustGetCustomer(ctx.owner, c.id as number)).points_balance).toBe(20);
  const draft = await mustOrderForCustomer(ctx, c.id as number, [{ variant_id: ctx.v1, qty: 1 }]);
  const [d1, d2] = await Promise.all([
    redeemPoints(ctx.owner, c.id as number, draft.id as number, 10, 'race-redeem-a'),
    redeemPoints(ctx.owner, c.id as number, draft.id as number, 10, 'race-redeem-b'),
  ]);
  const dStatuses = [d1.status, d2.status].sort();
  expect(dStatuses).toEqual([201, 400]);
  expect(pointsLedger(ctx.db, c.id as number)).toHaveLength(2);
  expect(orderRow(ctx.db, draft.id as number).points_discount).toBe(1000);
  expect((await mustGetCustomer(ctx.owner, c.id as number)).points_balance).toBe(10);
});

test('AC-2 GET /api/customers/:id/points tra balance + ledger moi nhat truoc', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001' });
  const empty = await ctx.owner.get(`/api/customers/${c.id as number}/points`);
  expect(empty.status).toBe(200);
  const emptyBody = empty.body as Record<string, unknown>;
  expect(emptyBody.balance ?? emptyBody.points_balance).toBe(0);
  expect((emptyBody.ledger as unknown[]) ?? []).toHaveLength(0);
  const completed = await mustCompletedOrderForCustomer(ctx, c.id as number);
  await mustEarnPoints(ctx.owner, c.id as number, completed.id as number);
  const draft = await mustOrderForCustomer(ctx, c.id as number, [{ variant_id: ctx.v1, qty: 1 }]);
  await mustRedeemPoints(ctx.owner, c.id as number, draft.id as number, 5);
  const res = await ctx.owner.get(`/api/customers/${c.id as number}/points`);
  expect(res.status).toBe(200);
  const body = res.body as Record<string, unknown>;
  expect(body.balance ?? body.points_balance).toBe(15);
  const ledger = (body.ledger as Record<string, unknown>[]) ?? [];
  expect(ledger).toHaveLength(2);
  expect(ledger[0]?.type).toBe('redeem');
  expect(ledger[1]?.type).toBe('earn');
  expect(ledger[0]?.reason).toBeTruthy();
  expect(ledger[0]?.order_id).toBeDefined();
  expect(ledger[0]?.created_by).toBeDefined();
  expect(ledger[0]?.created_at).toBeTruthy();
  const missing = await ctx.owner.get('/api/customers/999999/points');
  expect(missing.status).toBe(404);
  const cross = await ctx.ownerB.get(`/api/customers/${c.id as number}/points`);
  expect(cross.status).toBe(403);
});

// ---------- AC-3: ghi chu + phan khuc + tim/loc ----------

test('AC-3 POST /api/customers/:id/notes 201 author la nguoi thuc hien, GET moi nhat truoc + phan trang', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001', branch_id: ctx.branch1 });
  const n1 = await ctx.owner.post(`/api/customers/${c.id as number}/notes`).send({ content: 'Goi cham soc lan 1' });
  expect(n1.status).toBe(201);
  const note1 = (n1.body as Record<string, unknown>).note as Record<string, unknown> ?? n1.body as Record<string, unknown>;
  expect(note1.content).toBe('Goi cham soc lan 1');
  expect(note1.author_id).toBeDefined();
  const n2 = await ctx.sales.post(`/api/customers/${c.id as number}/notes`).send({ content: 'Goi cham soc lan 2' });
  expect(n2.status).toBe(201);
  const listRes = await ctx.owner.get(`/api/customers/${c.id as number}/notes`);
  expect(listRes.status).toBe(200);
  const list = asList(listRes, ['notes', 'items', 'rows', 'data']);
  expect(list).toHaveLength(2);
  expect(list[0]?.content).toBe('Goi cham soc lan 2');
  expect(list[1]?.content).toBe('Goi cham soc lan 1');
  const page = await ctx.owner.get(`/api/customers/${c.id as number}/notes?limit=1&offset=1`);
  expect(asList(page, ['notes', 'items', 'rows', 'data'])).toHaveLength(1);
  expect(asList(page, ['notes', 'items', 'rows', 'data'])[0]?.content).toBe('Goi cham soc lan 1');
  expect(notesRows(ctx.db, c.id as number)).toHaveLength(2);
  const missing = await ctx.owner.get('/api/customers/999999/notes');
  expect(missing.status).toBe(404);
});

test('AC-3 ghi chu content trong 400, ghi chu cho khach merged 400', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001' });
  const blank = await ctx.owner.post(`/api/customers/${c.id as number}/notes`).send({ content: '   ' });
  expect(blank.status).toBe(400);
  const empty = await ctx.owner.post(`/api/customers/${c.id as number}/notes`).send({});
  expect(empty.status).toBe(400);
  const src = await mustCreateCustomer(ctx.owner, { name: 'Nguon', phone: '0901000002' });
  const merged = await ctx.owner.post(`/api/customers/${c.id as number}/merge`).send({ source_customer_id: src.id, confirm: true });
  expect(merged.status).toBe(200);
  const noteMerged = await ctx.owner.post(`/api/customers/${src.id as number}/notes`).send({ content: 'Ghi chu khach merged' });
  expect(noteMerged.status).toBe(400);
  expect(notesRows(ctx.db, c.id as number)).toHaveLength(0);
});

test('AC-3 khong co API sua/xoa ghi chu hay ledger: goi sua/xoa -> 404 hoac 405', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001' });
  const order = await mustCompletedOrderForCustomer(ctx, c.id as number);
  await mustEarnPoints(ctx.owner, c.id as number, order.id as number);
  const note = await ctx.owner.post(`/api/customers/${c.id as number}/notes`).send({ content: 'Ghi chu goc' });
  expect(note.status).toBe(201);
  const noteId = ((note.body as Record<string, unknown>).note as Record<string, unknown> ?? note.body as Record<string, unknown>).id as number;
  const ledgerId = pointsLedger(ctx.db, c.id as number)[0]?.id as number;
  for (const [method, url] of [
    ['patch', `/api/customers/${c.id as number}/notes/${noteId}`],
    ['delete', `/api/customers/${c.id as number}/notes/${noteId}`],
    ['patch', `/api/customers/${c.id as number}/points/${ledgerId}`],
    ['delete', `/api/customers/${c.id as number}/points/${ledgerId}`],
  ] as const) {
    const res = method === 'patch'
      ? await ctx.owner.patch(url).send({ content: 'Sua', points: 1 })
      : await ctx.owner.delete(url);
    expect([404, 405]).toContain(res.status);
  }
  expect(notesRows(ctx.db, c.id as number)).toHaveLength(1);
  expect(pointsLedger(ctx.db, c.id as number)).toHaveLength(1);
});

test('AC-3 segment new: khach chua co don va khach 2 don gan day deu new', async () => {
  const ctx = await crmCtx();
  const fresh = await mustCreateCustomer(ctx.owner, { name: 'Khach moi', phone: '0901000001' });
  expect((await mustGetCustomer(ctx.owner, fresh.id as number)).segment).toBe('new');
  const two = await mustCreateCustomer(ctx.owner, { name: 'Hai don', phone: '0901000002' });
  await mustCompletedOrderForCustomer(ctx, two.id as number);
  await mustCompletedOrderForCustomer(ctx, two.id as number);
  expect((await mustGetCustomer(ctx.owner, two.id as number)).segment).toBe('new');
});

test('AC-3 segment frequent: khach 3 don completed gan day', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Thuong xuyen', phone: '0901000001' });
  await mustCompletedOrderForCustomer(ctx, c.id as number);
  await mustCompletedOrderForCustomer(ctx, c.id as number);
  expect((await mustGetCustomer(ctx.owner, c.id as number)).segment).toBe('new');
  await mustCompletedOrderForCustomer(ctx, c.id as number);
  const got = await mustGetCustomer(ctx.owner, c.id as number);
  expect(got.segment).toBe('frequent');
  expect(purchaseSummary(got).order_count).toBe(3);
});

test('AC-3 segment vip: tong chi >= 5000000d hoac >= 10 don completed', async () => {
  const ctx = await crmCtx();
  const big = await mustCreateCustomer(ctx.owner, { name: 'VIP tien', phone: '0901000001' });
  await mustCompletedOrderForCustomer(ctx, big.id as number, [{ variant_id: ctx.v1, qty: 50 }]);
  const bigGot = await mustGetCustomer(ctx.owner, big.id as number);
  expect(purchaseSummary(bigGot).total_spent).toBe(5000000);
  expect(bigGot.segment).toBe('vip');
  const many = await mustCreateCustomer(ctx.owner, { name: 'VIP don', phone: '0901000002' });
  for (let i = 0; i < 9; i++) {
    await mustCompletedOrderForCustomer(ctx, many.id as number, [{ variant_id: ctx.v2, qty: 1 }]);
  }
  expect((await mustGetCustomer(ctx.owner, many.id as number)).segment).toBe('frequent');
  await mustCompletedOrderForCustomer(ctx, many.id as number, [{ variant_id: ctx.v2, qty: 1 }]);
  const manyGot = await mustGetCustomer(ctx.owner, many.id as number);
  expect(purchaseSummary(manyGot).order_count).toBe(10);
  expect(manyGot.segment).toBe('vip');
});

test('AC-3 thu tu uu tien segment: VIP 100 ngay van VIP, 5 don lan mua cuoi 100 ngay -> dormant', async () => {
  const ctx = await crmCtx();
  const vip = await mustCreateCustomer(ctx.owner, { name: 'VIP ngu', phone: '0901000001' });
  const vipOrder = await mustCompletedOrderForCustomer(ctx, vip.id as number, [{ variant_id: ctx.v1, qty: 50 }]);
  setOrderDaysAgo(ctx.db, vipOrder.id as number, 100);
  expect((await mustGetCustomer(ctx.owner, vip.id as number)).segment).toBe('vip');
  const dormant = await mustCreateCustomer(ctx.owner, { name: 'Ngu quen', phone: '0901000002' });
  const orders: Record<string, unknown>[] = [];
  for (let i = 0; i < 5; i++) {
    orders.push(await mustCompletedOrderForCustomer(ctx, dormant.id as number, [{ variant_id: ctx.v2, qty: 1 }]));
  }
  for (const o of orders) setOrderDaysAgo(ctx.db, o.id as number, 100);
  const dormantGot = await mustGetCustomer(ctx.owner, dormant.id as number);
  expect(purchaseSummary(dormantGot).order_count).toBe(5);
  expect(dormantGot.segment).toBe('dormant');
  // Khách 5 don nhung lan mua cuoi 5 ngay truoc thi frequent, khong phai dormant.
  const frequent = await mustCreateCustomer(ctx.owner, { name: 'Gan day', phone: '0901000003' });
  for (let i = 0; i < 5; i++) {
    await mustCompletedOrderForCustomer(ctx, frequent.id as number, [{ variant_id: ctx.v2, qty: 1 }]);
  }
  expect((await mustGetCustomer(ctx.owner, frequent.id as number)).segment).toBe('frequent');
});

test('AC-3 tim/loc khach theo ten/dien thoai/pham vi segment, segment la -> 400', async () => {
  const ctx = await crmCtx();
  const a = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001' });
  const b = await mustCreateCustomer(ctx.owner, { name: 'Tran Thi B', phone: '0902000002' });
  const vip = await mustCreateCustomer(ctx.owner, { name: 'Le Van VIP', phone: '0903000003' });
  await mustCompletedOrderForCustomer(ctx, vip.id as number, [{ variant_id: ctx.v1, qty: 50 }]);
  const byName = await ctx.owner.get('/api/customers?name=nguyen');
  expect(byName.status).toBe(200);
  expect(asList(byName, ['customers', 'items', 'rows', 'data']).map((r) => r.id)).toEqual([a.id]);
  const byNameUpper = await ctx.owner.get('/api/customers?name=NGUYEN');
  expect(asList(byNameUpper, ['customers', 'items', 'rows', 'data']).map((r) => r.id)).toEqual([a.id]);
  const byPhone = await ctx.owner.get('/api/customers?phone=02000002');
  expect(asList(byPhone, ['customers', 'items', 'rows', 'data']).map((r) => r.id)).toEqual([b.id]);
  const bySegment = await ctx.owner.get('/api/customers?segment=vip');
  expect(bySegment.status).toBe(200);
  expect(asList(bySegment, ['customers', 'items', 'rows', 'data']).map((r) => r.id)).toEqual([vip.id]);
  const bySegmentNew = await ctx.owner.get('/api/customers?segment=new');
  expect(asList(bySegmentNew, ['customers', 'items', 'rows', 'data']).map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
  const badSegment = await ctx.owner.get('/api/customers?segment=sieu-cap');
  expect(badSegment.status).toBe(400);
  const combined = await ctx.owner.get('/api/customers?name=van&segment=new');
  expect(asList(combined, ['customers', 'items', 'rows', 'data']).map((r) => r.id)).toEqual([a.id]);
  const crossOrg = await ctx.ownerB.get('/api/customers?name=nguyen');
  expect(crossOrg.status).toBe(200);
  expect(asList(crossOrg, ['customers', 'items', 'rows', 'data'])).toHaveLength(0);
});

test('AC-3 loc theo branch_id + phan trang limit/offset + total, sales khong thay khach chua gan chi nhanh', async () => {
  const ctx = await crmCtx();
  const unassigned = await mustCreateCustomer(ctx.owner, { name: 'Chua gan CN', phone: '0901000001' });
  const b1 = await mustCreateCustomer(ctx.owner, { name: 'CN mot A', phone: '0901000002', branch_id: ctx.branch1 });
  const b2 = await mustCreateCustomer(ctx.owner, { name: 'CN hai A', phone: '0901000003', branch_id: ctx.branch2 });
  const byBranch = await ctx.owner.get(`/api/customers?branch_id=${ctx.branch2}`);
  expect(byBranch.status).toBe(200);
  expect(asList(byBranch, ['customers', 'items', 'rows', 'data']).map((r) => r.id)).toEqual([b2.id]);
  const badBranch = await ctx.owner.get('/api/customers?branch_id=999999');
  expect(badBranch.status).toBe(404);
  const crossBranch = await ctx.owner.get(`/api/customers?branch_id=${ctx.branchBId}`);
  expect(crossBranch.status).toBe(403);
  // Phan trang: moi nhat truoc, limit mac dinh 20, total kem theo.
  const all = await ctx.owner.get('/api/customers');
  expect(all.status).toBe(200);
  const allList = asList(all, ['customers', 'items', 'rows', 'data']);
  expect(allList).toHaveLength(3);
  expect(allList[0]?.id).toBe(b2.id);
  expect(listTotal(all)).toBe(3);
  const page1 = await ctx.owner.get('/api/customers?limit=2&offset=0');
  expect(asList(page1, ['customers', 'items', 'rows', 'data'])).toHaveLength(2);
  expect(listTotal(page1)).toBe(3);
  const page2 = await ctx.owner.get('/api/customers?limit=2&offset=2');
  expect(asList(page2, ['customers', 'items', 'rows', 'data'])).toHaveLength(1);
  const overLimit = await ctx.owner.get('/api/customers?limit=200');
  expect(asList(overLimit, ['customers', 'items', 'rows', 'data'])).toHaveLength(3);
  // Sales chi thay khach thuoc chi nhanh minh; khach chua gan chi nhanh bi loc khoi danh sach.
  const salesList = await ctx.sales.get('/api/customers');
  expect(salesList.status).toBe(200);
  expect(asList(salesList, ['customers', 'items', 'rows', 'data']).map((r) => r.id)).toEqual([b1.id]);
  const salesDirect = await ctx.sales.get(`/api/customers/${unassigned.id as number}`);
  expect(salesDirect.status).toBe(403);
  const salesOwn = await ctx.sales.get(`/api/customers/${b1.id as number}`);
  expect(salesOwn.status).toBe(200);
});

// ---------- AC-4: hop nhat + xuat/xoa du lieu ca nhan ----------

test('AC-4 hop nhat thieu/false confirm -> 400, khong lam gi', async () => {
  const ctx = await crmCtx();
  const keep = await mustCreateCustomer(ctx.owner, { name: 'Giu lai', phone: '0901000001' });
  const src = await mustCreateCustomer(ctx.owner, { name: 'Nguon', phone: '0901000002' });
  const noConfirm = await ctx.owner.post(`/api/customers/${keep.id as number}/merge`).send({ source_customer_id: src.id });
  expect(noConfirm.status).toBe(400);
  const falseConfirm = await ctx.owner.post(`/api/customers/${keep.id as number}/merge`).send({ source_customer_id: src.id, confirm: false });
  expect(falseConfirm.status).toBe(400);
  expect(customerRow(ctx.db, src.id as number)?.status).toBe('active');
  expect(customerRow(ctx.db, src.id as number)?.phone).toBe('0901000002');
  const missingKeep = await ctx.owner.post('/api/customers/999999/merge').send({ source_customer_id: src.id, confirm: true });
  expect(missingKeep.status).toBe(404);
  const missingSrc = await ctx.owner.post(`/api/customers/${keep.id as number}/merge`).send({ source_customer_id: 999999, confirm: true });
  expect(missingSrc.status).toBe(404);
  const crossOrg = await ctx.ownerB.post(`/api/customers/${keep.id as number}/merge`).send({ source_customer_id: src.id, confirm: true });
  expect(crossOrg.status).toBe(403);
});

test('AC-4 hop nhat co confirm: diem/lich su cong don, nguon merged + phone/email NULL, ghi chu ca 2 con', async () => {
  const ctx = await crmCtx();
  const keep = await mustCreateCustomer(ctx.owner, { name: 'Giu lai', phone: '0901000001', email: 'giu@example.local' });
  const keepOrder = await mustCompletedOrderForCustomer(ctx, keep.id as number, [
    { variant_id: ctx.v1, qty: 2 },
  ]);
  await mustEarnPoints(ctx.owner, keep.id as number, keepOrder.id as number);
  await ctx.owner.post(`/api/customers/${keep.id as number}/notes`).send({ content: 'Ghi chu giu lai' });
  const src = await mustCreateCustomer(ctx.owner, { name: 'Nguon', phone: '0901000002', email: 'nguon@example.local' });
  const srcOrder = await mustCompletedOrderForCustomer(ctx, src.id as number, [
    { variant_id: ctx.v1, qty: 1 },
  ]);
  await mustEarnPoints(ctx.owner, src.id as number, srcOrder.id as number);
  await ctx.owner.post(`/api/customers/${src.id as number}/notes`).send({ content: 'Ghi chu nguon' });
  const res = await ctx.owner.post(`/api/customers/${keep.id as number}/merge`).send({ source_customer_id: src.id, confirm: true });
  expect(res.status).toBe(200);
  const merged = asCustomer(res);
  expect(merged.id).toBe(keep.id);
  expect(merged.points_balance).toBe(30);
  expect(purchaseSummary(merged).total_spent).toBe(300000);
  expect(purchaseSummary(merged).order_count).toBe(2);
  expect(merged.segment).toBe('new');
  // Don + ledger + ghi chu cua nguon da chuyen sang khach giu; ma don giu nguyen.
  expect(orderRow(ctx.db, srcOrder.id as number).customer_id).toBe(keep.id);
  expect(orderRow(ctx.db, srcOrder.id as number).code).toBe(srcOrder.code);
  expect(pointsLedger(ctx.db, keep.id as number)).toHaveLength(2);
  expect(notesRows(ctx.db, keep.id as number)).toHaveLength(2);
  expect(notesRows(ctx.db, keep.id as number).map((n) => n.content).sort()).toEqual(['Ghi chu giu lai', 'Ghi chu nguon'].sort());
  // Khach nguon: status merged, merged_into_id = khach giu, phone/email NULL, row van ton tai.
  const srcRow = customerRow(ctx.db, src.id as number);
  expect(srcRow?.status).toBe('merged');
  expect(srcRow?.merged_into_id).toBe(keep.id);
  expect(srcRow?.phone).toBeNull();
  expect(srcRow?.email).toBeNull();
  // Khach merged khong xuat hien trong danh sach mac dinh.
  const list = await ctx.owner.get('/api/customers');
  expect(asList(list, ['customers', 'items', 'rows', 'data']).map((r) => r.id)).toEqual([keep.id]);
  // Xem khach merged van duoc (tru thao tac doi du lieu).
  const viewMerged = await ctx.owner.get(`/api/customers/${src.id as number}`);
  expect(viewMerged.status).toBe(200);
  expect(asCustomer(viewMerged).status).toBe('merged');
});

test('AC-4 hop nhat voi chinh minh 400, hop nhat khach da merged 400', async () => {
  const ctx = await crmCtx();
  const keep = await mustCreateCustomer(ctx.owner, { name: 'Giu lai', phone: '0901000001' });
  const src = await mustCreateCustomer(ctx.owner, { name: 'Nguon', phone: '0901000002' });
  const third = await mustCreateCustomer(ctx.owner, { name: 'Thu ba', phone: '0901000003' });
  const self = await ctx.owner.post(`/api/customers/${keep.id as number}/merge`).send({ source_customer_id: keep.id, confirm: true });
  expect(self.status).toBe(400);
  const first = await ctx.owner.post(`/api/customers/${keep.id as number}/merge`).send({ source_customer_id: src.id, confirm: true });
  expect(first.status).toBe(200);
  const srcAgain = await ctx.owner.post(`/api/customers/${third.id as number}/merge`).send({ source_customer_id: src.id, confirm: true });
  expect(srcAgain.status).toBe(400);
  const keepMerged = await ctx.owner.post(`/api/customers/${src.id as number}/merge`).send({ source_customer_id: third.id, confirm: true });
  expect(keepMerged.status).toBe(400);
});

test('AC-4 khach merged: khong tao don/tich/doi diem/ghi chu duoc, moi thao tac -> 400', async () => {
  const ctx = await crmCtx();
  const keep = await mustCreateCustomer(ctx.owner, { name: 'Giu lai', phone: '0901000001' });
  const src = await mustCreateCustomer(ctx.owner, { name: 'Nguon', phone: '0901000002' });
  const srcOrder = await mustCompletedOrderForCustomer(ctx, src.id as number);
  await mustEarnPoints(ctx.owner, src.id as number, srcOrder.id as number);
  const merged = await ctx.owner.post(`/api/customers/${keep.id as number}/merge`).send({ source_customer_id: src.id, confirm: true });
  expect(merged.status).toBe(200);
  const newOrder = await ctx.owner.post('/api/orders').send({
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    customer_id: src.id,
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  expect(newOrder.status).toBe(400);
  const earn = await earnPoints(ctx.owner, src.id as number, srcOrder.id as number);
  expect(earn.status).toBe(400);
  const draft = await mustOrderForCustomer(ctx, keep.id as number);
  const redeem = await redeemPoints(ctx.owner, src.id as number, draft.id as number, 5);
  expect(redeem.status).toBe(400);
  const note = await ctx.owner.post(`/api/customers/${src.id as number}/notes`).send({ content: 'Ghi chu' });
  expect(note.status).toBe(400);
});

test('AC-4 GET /api/customers/:id/export tra du 4 phan + audit log; export khach merged tra rong kem merged_into_id', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001', email: 'a@example.local' });
  const order = await mustCompletedOrderForCustomer(ctx, c.id as number, [
    { variant_id: ctx.v1, qty: 2 },
    { variant_id: ctx.v2, qty: 1 },
  ]);
  await mustEarnPoints(ctx.owner, c.id as number, order.id as number);
  await ctx.owner.post(`/api/customers/${c.id as number}/notes`).send({ content: 'Ghi chu cham soc' });
  const before = auditRows(ctx.db, ctx.orgId).filter((r) => r.detail.target_customer_id === c.id).length;
  const res = await ctx.owner.get(`/api/customers/${c.id as number}/export`);
  expect(res.status).toBe(200);
  const body = res.body as Record<string, unknown>;
  const exported = (body.customer as Record<string, unknown>) ?? {};
  expect(exported.id).toBe(c.id);
  const orders = (body.orders as Record<string, unknown>[]) ?? [];
  expect(orders).toHaveLength(1);
  expect(orders[0]?.id).toBe(order.id);
  expect(Array.isArray(orders[0]?.items)).toBe(true);
  const points = (body.points as Record<string, unknown>) ?? {};
  expect(points.balance).toBe(25);
  expect((points.ledger as unknown[])).toHaveLength(1);
  const notes = (body.notes as Record<string, unknown>[]) ?? [];
  expect(notes).toHaveLength(1);
  expect(notes[0]?.content).toBe('Ghi chu cham soc');
  const after = auditRows(ctx.db, ctx.orgId).filter((r) => r.detail.target_customer_id === c.id).length;
  expect(after).toBe(before + 1);
  const missing = await ctx.owner.get('/api/customers/999999/export');
  expect(missing.status).toBe(404);
  const cross = await ctx.ownerB.get(`/api/customers/${c.id as number}/export`);
  expect(cross.status).toBe(403);
  // Export khach merged: orders/points/notes rong kem merged_into_id.
  const src = await mustCreateCustomer(ctx.owner, { name: 'Nguon', phone: '0901000002' });
  const srcOrder = await mustCompletedOrderForCustomer(ctx, src.id as number);
  await mustEarnPoints(ctx.owner, src.id as number, srcOrder.id as number);
  await ctx.owner.post(`/api/customers/${src.id as number}/notes`).send({ content: 'Ghi chu nguon' });
  const merged = await ctx.owner.post(`/api/customers/${c.id as number}/merge`).send({ source_customer_id: src.id, confirm: true });
  expect(merged.status).toBe(200);
  const srcExport = await ctx.owner.get(`/api/customers/${src.id as number}/export`);
  expect(srcExport.status).toBe(200);
  const srcBody = srcExport.body as Record<string, unknown>;
  const srcCustomer = (srcBody.customer as Record<string, unknown>) ?? {};
  expect(srcCustomer.merged_into_id).toBe(c.id);
  expect((srcBody.orders as unknown[]) ?? []).toHaveLength(0);
  expect(((srcBody.points as Record<string, unknown>) ?? {}).balance).toBe(0);
  expect((srcBody.notes as unknown[]) ?? []).toHaveLength(0);
});

test('AC-4 audit detail cua MOI thao tac khach KHONG chua phone/email/address', async () => {
  const ctx = await crmCtx();
  const phone = '0901000777';
  const email = 'pii-rieng@example.local';
  const address = 'Dia chi PII rieng 123';
  const c = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone, email, address });
  await ctx.owner.patch(`/api/customers/${c.id as number}`).send({ address: 'Dia chi PII rieng 456' });
  const order = await mustCompletedOrderForCustomer(ctx, c.id as number);
  await mustEarnPoints(ctx.owner, c.id as number, order.id as number);
  const draft = await mustOrderForCustomer(ctx, c.id as number, [{ variant_id: ctx.v1, qty: 1 }]);
  await mustRedeemPoints(ctx.owner, c.id as number, draft.id as number, 5);
  await ctx.owner.post(`/api/customers/${c.id as number}/notes`).send({ content: 'Ghi chu' });
  const src = await mustCreateCustomer(ctx.owner, { name: 'Nguon', phone: '0901000778' });
  await ctx.owner.post(`/api/customers/${c.id as number}/merge`).send({ source_customer_id: src.id, confirm: true });
  await ctx.owner.get(`/api/customers/${c.id as number}/export`);
  const rows = auditRows(ctx.db, ctx.orgId).filter((r) => r.detail.target_customer_id === c.id);
  expect(rows.length).toBeGreaterThanOrEqual(7);
  for (const row of rows) {
    expect(row.user_id).toBeDefined();
    expect(row.created_at).toBeTruthy();
    expect(row.action).toBeTruthy();
  }
  const blob = JSON.stringify(rows.map((r) => r.detail));
  expect(blob).not.toContain(phone);
  expect(blob).not.toContain(email);
  expect(blob).not.toContain(address);
  expect(blob).not.toContain('Dia chi PII rieng 456');
  expect(blob).not.toContain('0901000778');
});

test('AC-4 DELETE khach chua co don 200 + GET lai 404; khach co don 400; khach merged 400', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Xoa duoc', phone: '0901000001' });
  const order = await mustCompletedOrderForCustomer(ctx, c.id as number);
  // Khach CO don (moi trang thai) thi khong xoa duoc — dung khach co don completed o tren.
  const withOrder = await ctx.owner.delete(`/api/customers/${c.id as number}`);
  expect(withOrder.status).toBe(400);
  expect(customerRow(ctx.db, c.id as number)).toBeDefined();
  const draftOnly = await mustCreateCustomer(ctx.owner, { name: 'Chi don draft', phone: '0901000002' });
  await mustOrderForCustomer(ctx, draftOnly.id as number);
  const draftDelete = await ctx.owner.delete(`/api/customers/${draftOnly.id as number}`);
  expect(draftDelete.status).toBe(400);
  // Khach chua co don: tich diem khong co, nhung co ghi chu + ledger rong — xoa cung ghi chu.
  const deletable = await mustCreateCustomer(ctx.owner, { name: 'Xoa duoc 2', phone: '0901000003' });
  await ctx.owner.post(`/api/customers/${deletable.id as number}/notes`).send({ content: 'Ghi chu se bi xoa cung' });
  expect(notesRows(ctx.db, deletable.id as number)).toHaveLength(1);
  const del = await ctx.owner.delete(`/api/customers/${deletable.id as number}`);
  expect(del.status).toBe(200);
  expect(customerRow(ctx.db, deletable.id as number)).toBeUndefined();
  expect(notesRows(ctx.db, deletable.id as number)).toHaveLength(0);
  expect(pointsLedger(ctx.db, deletable.id as number)).toHaveLength(0);
  const gone = await ctx.owner.get(`/api/customers/${deletable.id as number}`);
  expect(gone.status).toBe(404);
  const missing = await ctx.owner.delete('/api/customers/999999');
  expect(missing.status).toBe(404);
  // Khach merged khong xoa lai duoc.
  const keep = await mustCreateCustomer(ctx.owner, { name: 'Giu lai', phone: '0901000004' });
  const src = await mustCreateCustomer(ctx.owner, { name: 'Nguon', phone: '0901000005' });
  const merged = await ctx.owner.post(`/api/customers/${keep.id as number}/merge`).send({ source_customer_id: src.id, confirm: true });
  expect(merged.status).toBe(200);
  const delMerged = await ctx.owner.delete(`/api/customers/${src.id as number}`);
  expect(delMerged.status).toBe(400);
  expect(customerRow(ctx.db, src.id as number)?.status).toBe('merged');
});

test('AC-4 idempotency hop nhat: gui lai cung key -> replayed true, khong chuyen lan 2; hop nhat dong thoi chi 1 lan', async () => {
  const ctx = await crmCtx();
  const keep = await mustCreateCustomer(ctx.owner, { name: 'Giu lai', phone: '0901000001' });
  const keepOrder = await mustCompletedOrderForCustomer(ctx, keep.id as number);
  await mustEarnPoints(ctx.owner, keep.id as number, keepOrder.id as number);
  const src = await mustCreateCustomer(ctx.owner, { name: 'Nguon', phone: '0901000002' });
  const srcOrder = await mustCompletedOrderForCustomer(ctx, src.id as number);
  await mustEarnPoints(ctx.owner, src.id as number, srcOrder.id as number);
  const req = ctx.owner.post(`/api/customers/${keep.id as number}/merge`);
  req.set('Idempotency-Key', 'idem-merge-1');
  const first = await req.send({ source_customer_id: src.id, confirm: true });
  expect(first.status).toBe(200);
  expect(asCustomer(first).points_balance).toBe(40);
  const req2 = ctx.owner.post(`/api/customers/${keep.id as number}/merge`);
  req2.set('Idempotency-Key', 'idem-merge-1');
  const replay = await req2.send({ source_customer_id: src.id, confirm: true });
  expect(replay.status).toBe(200);
  expect((replay.body as Record<string, unknown>).replayed).toBe(true);
  expect(asCustomer(replay).points_balance).toBe(40);
  expect(purchaseSummary(asCustomer(replay)).order_count).toBe(2);
  // Hop nhat dong thoi 2 lan (key khac nhau): chi 1 lan thanh cong.
  const keep2 = await mustCreateCustomer(ctx.owner, { name: 'Giu 2', phone: '0901000003' });
  const src2 = await mustCreateCustomer(ctx.owner, { name: 'Nguon 2', phone: '0901000004' });
  const [m1, m2] = await Promise.all([
    ctx.owner.post(`/api/customers/${keep2.id as number}/merge`).send({ source_customer_id: src2.id, confirm: true, idempotency_key: 'race-merge-a' }),
    ctx.owner.post(`/api/customers/${keep2.id as number}/merge`).send({ source_customer_id: src2.id, confirm: true, idempotency_key: 'race-merge-b' }),
  ]);
  const statuses = [m1.status, m2.status].sort();
  expect(statuses).toEqual([200, 400]);
  expect(customerRow(ctx.db, src2.id as number)?.status).toBe('merged');
});

// ---------- AC-5: RBAC + audit + lich su ----------

test('AC-5 can() 9 actions khach/CRM theo dung ma tran brief', () => {
  const owner = custActor(1, 'owner');
  const manager = custActor(2, 'manager');
  const salesOwn = custActor(3, 'sales', 1);
  const salesOther = custActor(4, 'sales', 2);
  const warehouse = custActor(5, 'warehouse', 1);
  const accountant = custActor(6, 'accountant');
  const ownBranch = custTarget(1, 1);
  const otherBranch = custTarget(1, 2);
  const unassigned = custTarget(1, null);
  const crossOrg = custTarget(2, 1);
  const check = (action: string, actor: Actor, target: Target) => can(actor, action as Action, target);
  // Tao/sua khach: owner/manager/sales dung chi nhanh; warehouse/accountant 403.
  for (const action of ['create-customer', 'update-customer'] as Action[]) {
    expect(check(action, owner, ownBranch)).toBe(true);
    expect(check(action, manager, ownBranch)).toBe(true);
    expect(check(action, salesOwn, ownBranch)).toBe(true);
    expect(check(action, salesOwn, otherBranch)).toBe(false);
    expect(check(action, warehouse, ownBranch)).toBe(false);
    expect(check(action, accountant, ownBranch)).toBe(false);
    expect(check(action, owner, crossOrg)).toBe(false);
  }
  // Xem khach: moi vai theo pham vi; sales khong thay khach chua gan chi nhanh.
  expect(check('view-customers', owner, ownBranch)).toBe(true);
  expect(check('view-customers', manager, ownBranch)).toBe(true);
  expect(check('view-customers', salesOwn, ownBranch)).toBe(true);
  expect(check('view-customers', salesOwn, otherBranch)).toBe(false);
  expect(check('view-customers', salesOwn, unassigned)).toBe(false);
  expect(check('view-customers', warehouse, ownBranch)).toBe(true);
  expect(check('view-customers', accountant, ownBranch)).toBe(true);
  expect(check('view-customers', owner, crossOrg)).toBe(false);
  // Tich/doi diem: owner/manager/sales dung chi nhanh; warehouse/accountant 403.
  for (const action of ['earn-points', 'redeem-points'] as Action[]) {
    expect(check(action, owner, ownBranch)).toBe(true);
    expect(check(action, manager, ownBranch)).toBe(true);
    expect(check(action, salesOwn, ownBranch)).toBe(true);
    expect(check(action, salesOwn, otherBranch)).toBe(false);
    expect(check(action, warehouse, ownBranch)).toBe(false);
    expect(check(action, accountant, ownBranch)).toBe(false);
    expect(check(action, owner, crossOrg)).toBe(false);
  }
  // Ghi chu: owner/manager/sales dung chi nhanh duoc ghi; warehouse/accountant chi xem (khong ghi).
  expect(check('add-note', owner, ownBranch)).toBe(true);
  expect(check('add-note', manager, ownBranch)).toBe(true);
  expect(check('add-note', salesOwn, ownBranch)).toBe(true);
  expect(check('add-note', salesOwn, otherBranch)).toBe(false);
  expect(check('add-note', warehouse, ownBranch)).toBe(false);
  expect(check('add-note', accountant, ownBranch)).toBe(false);
  // Hop nhat: chi owner/manager.
  expect(check('merge-customers', owner, ownBranch)).toBe(true);
  expect(check('merge-customers', manager, ownBranch)).toBe(true);
  expect(check('merge-customers', salesOwn, ownBranch)).toBe(false);
  expect(check('merge-customers', warehouse, ownBranch)).toBe(false);
  expect(check('merge-customers', accountant, ownBranch)).toBe(false);
  // Xuat du lieu: owner/manager/accountant toan org, sales dung chi nhanh, warehouse 403.
  expect(check('export-customer', owner, ownBranch)).toBe(true);
  expect(check('export-customer', manager, ownBranch)).toBe(true);
  expect(check('export-customer', accountant, ownBranch)).toBe(true);
  expect(check('export-customer', salesOwn, ownBranch)).toBe(true);
  expect(check('export-customer', salesOwn, otherBranch)).toBe(false);
  expect(check('export-customer', warehouse, ownBranch)).toBe(false);
  expect(check('export-customer', owner, crossOrg)).toBe(false);
  // Xoa khach: chi owner/manager (action rieng delete-customer).
  expect(check('delete-customer', owner, ownBranch)).toBe(true);
  expect(check('delete-customer', manager, ownBranch)).toBe(true);
  expect(check('delete-customer', salesOwn, ownBranch)).toBe(false);
  expect(check('delete-customer', warehouse, ownBranch)).toBe(false);
  expect(check('delete-customer', accountant, ownBranch)).toBe(false);
});

test('AC-5 RBAC 403 qua HTTP theo tung o cam trong ma tran khach/CRM', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001', branch_id: ctx.branch1 });
  const otherBranch = await mustCreateCustomer(ctx.owner, { name: 'Chi nhanh 2', phone: '0901000002', branch_id: ctx.branch2 });
  const unassigned = await mustCreateCustomer(ctx.owner, { name: 'Chua gan CN', phone: '0901000003' });
  const order = await mustCompletedOrderForCustomer(ctx, c.id as number);
  await mustEarnPoints(ctx.owner, c.id as number, order.id as number);
  const otherOrder = await mustCompletedOrderForCustomer(ctx, otherBranch.id as number);
  const draft = await mustOrderForCustomer(ctx, c.id as number, [{ variant_id: ctx.v1, qty: 1 }]);
  // Warehouse tao khach -> 403; accountant sua khach -> 403.
  expect((await ctx.warehouse.post('/api/customers').send({ name: 'Kho tao' })).status).toBe(403);
  expect((await ctx.accountant.patch(`/api/customers/${c.id as number}`).send({ name: 'Ke toan sua' })).status).toBe(403);
  // Sales tich diem khach ngoai chi nhanh -> 403; warehouse doi diem -> 403.
  expect((await ctx.sales.post(`/api/customers/${otherBranch.id as number}/points/earn`).send({ order_id: otherOrder.id })).status).toBe(403);
  expect((await ctx.warehouse.post(`/api/customers/${c.id as number}/points/redeem`).send({ order_id: draft.id, points: 5 })).status).toBe(403);
  // Sales hop nhat -> 403; warehouse xuat du lieu -> 403; sales xoa khach -> 403.
  expect((await ctx.sales.post(`/api/customers/${c.id as number}/merge`).send({ source_customer_id: otherBranch.id, confirm: true })).status).toBe(403);
  expect((await ctx.warehouse.get(`/api/customers/${c.id as number}/export`)).status).toBe(403);
  expect((await ctx.sales.delete(`/api/customers/${c.id as number}`)).status).toBe(403);
  // Sales xem khach chua gan chi nhanh -> 403; sales xem khach chi nhanh khac -> 403.
  expect((await ctx.sales.get(`/api/customers/${unassigned.id as number}`)).status).toBe(403);
  expect((await ctx.sales.get(`/api/customers/${otherBranch.id as number}`)).status).toBe(403);
  // User org A doc khach org B -> 403; warehouse ghi chu -> 403.
  expect((await ctx.ownerB.get(`/api/customers/${c.id as number}`)).status).toBe(403);
  expect((await ctx.warehouse.post(`/api/customers/${c.id as number}/notes`).send({ content: 'Kho ghi chu' })).status).toBe(403);
  // Accountant tich diem -> 403; sales2 (chi nhanh 2) tich diem khach chi nhanh 1 -> 403.
  expect((await ctx.accountant.post(`/api/customers/${c.id as number}/points/earn`).send({ order_id: order.id })).status).toBe(403);
  expect((await ctx.sales2.post(`/api/customers/${c.id as number}/points/earn`).send({ order_id: order.id })).status).toBe(403);
});

test('AC-5 RBAC duong: sales dung chi nhanh tao/tich/ghi chu 201, warehouse xem 200, accountant xuat 200', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.sales, { name: 'Khach sales', phone: '0901000001' });
  expect(customerRow(ctx.db, c.id as number)?.branch_id).toBe(ctx.branch1);
  const order = await mustCompletedOrderForCustomer(ctx, c.id as number, undefined, ctx.sales);
  const earn = await earnPoints(ctx.sales, c.id as number, order.id as number);
  expect(earn.status).toBe(201);
  const note = await ctx.sales.post(`/api/customers/${c.id as number}/notes`).send({ content: 'Sales ghi chu' });
  expect(note.status).toBe(201);
  const whView = await ctx.warehouse.get(`/api/customers/${c.id as number}`);
  expect(whView.status).toBe(200);
  const whNotes = await ctx.warehouse.get(`/api/customers/${c.id as number}/notes`);
  expect(whNotes.status).toBe(200);
  const accExport = await ctx.accountant.get(`/api/customers/${c.id as number}/export`);
  expect(accExport.status).toBe(200);
  const mgrDelete = await ctx.manager.delete(`/api/customers/${c.id as number}`);
  // Khach da co don nen manager xoa -> 400 (khong phai 403: dung vai, sai dieu kien).
  expect(mgrDelete.status).toBe(400);
});

test('AC-5 audit log ghi MOI thao tac khach/CRM voi user_id + created_at + detail, sales xem log 403', async () => {
  const ctx = await crmCtx();
  const c = await mustCreateCustomer(ctx.owner, { name: 'Nguyen Van A', phone: '0901000001' });
  await ctx.owner.patch(`/api/customers/${c.id as number}`).send({ address: 'Ben Cat' });
  const order = await mustCompletedOrderForCustomer(ctx, c.id as number);
  await mustEarnPoints(ctx.owner, c.id as number, order.id as number);
  const draft = await mustOrderForCustomer(ctx, c.id as number, [{ variant_id: ctx.v1, qty: 1 }]);
  await mustRedeemPoints(ctx.owner, c.id as number, draft.id as number, 5);
  await ctx.owner.post(`/api/customers/${c.id as number}/notes`).send({ content: 'Ghi chu' });
  const src = await mustCreateCustomer(ctx.owner, { name: 'Nguon', phone: '0901000002' });
  await ctx.owner.post(`/api/customers/${c.id as number}/merge`).send({ source_customer_id: src.id, confirm: true });
  await ctx.owner.get(`/api/customers/${c.id as number}/export`);
  const deletable = await mustCreateCustomer(ctx.owner, { name: 'Xoa', phone: '0901000003' });
  await ctx.owner.delete(`/api/customers/${deletable.id as number}`);
  const rows = auditRows(ctx.db, ctx.orgId).filter((r) => r.detail.target_customer_id === c.id);
  expect(rows.length).toBeGreaterThanOrEqual(7);
  for (const row of rows) {
    expect(row.user_id).toBeDefined();
    expect(row.created_at).toBeTruthy();
    expect(row.action).toBeTruthy();
    expect(row.detail.target_customer_id).toBe(c.id);
  }
  const earnRows = rows.filter((r) => r.detail.target_order_id === order.id && typeof r.detail.points === 'number');
  expect(earnRows.length).toBeGreaterThanOrEqual(1);
  const mergeRows = rows.filter((r) => r.detail.source_customer_id === src.id);
  expect(mergeRows.length).toBe(1);
  const deleteRows = auditRows(ctx.db, ctx.orgId).filter((r) => r.detail.target_customer_id === deletable.id);
  expect(deleteRows.length).toBeGreaterThanOrEqual(2);
  // Xem log theo luat GOAL-002: owner 200, sales 403.
  const salesLog = await ctx.sales.get('/api/audit-log');
  expect(salesLog.status).toBe(403);
  const ownerLog = await ctx.owner.get('/api/audit-log');
  expect(ownerLog.status).toBe(200);
  const blob = JSON.stringify(rows.map((r) => r.detail));
  expect(blob).not.toMatch(/card|cvv|CVV|password/i);
});

test('AC-5 lich su diem/ghi chu: tao -> tich -> doi -> ghi chu -> hop nhat, dung thu tu, khong dong thua khi gui lap', async () => {
  const ctx = await crmCtx();
  const keep = await mustCreateCustomer(ctx.owner, { name: 'Giu lai', phone: '0901000001' });
  const keepOrder = await mustCompletedOrderForCustomer(ctx, keep.id as number);
  await mustEarnPoints(ctx.owner, keep.id as number, keepOrder.id as number, 'seq-earn-keep');
  const draft = await mustOrderForCustomer(ctx, keep.id as number, [{ variant_id: ctx.v1, qty: 1 }]);
  await mustRedeemPoints(ctx.owner, keep.id as number, draft.id as number, 5, 'seq-redeem-keep');
  // Gui lap cung key: khong ghi dong ledger moi.
  await earnPoints(ctx.owner, keep.id as number, keepOrder.id as number, 'seq-earn-keep');
  await redeemPoints(ctx.owner, keep.id as number, draft.id as number, 5, 'seq-redeem-keep');
  await ctx.owner.post(`/api/customers/${keep.id as number}/notes`).send({ content: 'Ghi chu giu lai' });
  const src = await mustCreateCustomer(ctx.owner, { name: 'Nguon', phone: '0901000002' });
  const srcOrder = await mustCompletedOrderForCustomer(ctx, src.id as number);
  await mustEarnPoints(ctx.owner, src.id as number, srcOrder.id as number, 'seq-earn-src');
  await ctx.owner.post(`/api/customers/${src.id as number}/notes`).send({ content: 'Ghi chu nguon' });
  await ctx.owner.post(`/api/customers/${keep.id as number}/merge`).send({ source_customer_id: src.id, confirm: true, idempotency_key: 'seq-merge' });
  const ledger = pointsLedger(ctx.db, keep.id as number);
  expect(ledger.map((r) => r.type)).toEqual(['earn', 'redeem', 'earn']);
  expect(ledger.map((r) => r.points)).toEqual([20, 5, 20]);
  const notes = notesRows(ctx.db, keep.id as number);
  expect(notes.map((n) => n.content)).toEqual(['Ghi chu giu lai', 'Ghi chu nguon']);
  const got = await mustGetCustomer(ctx.owner, keep.id as number);
  expect(got.points_balance).toBe(35);
  expect(purchaseSummary(got).order_count).toBe(2);
  const pointsRes = await ctx.owner.get(`/api/customers/${keep.id as number}/points`);
  const pointsBody = pointsRes.body as Record<string, unknown>;
  expect(pointsBody.balance ?? pointsBody.points_balance).toBe(35);
  expect(((pointsBody.ledger as unknown[]) ?? [])).toHaveLength(3);
});
