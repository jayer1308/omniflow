import { test, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { migrate, openDb, tableNames } from '../src/db.js';
import { can, type Action, type Actor, type Role, type Target } from '../src/rbac.js';
import { seed } from '../src/seed.js';
import { computePaymentSummary } from '../src/payments.js';
import { calculateDiscount } from '../src/promotions.js';

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
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function randPhone(): string {
  return `090${String(Math.floor(Math.random() * 10000000)).padStart(7, '0')}`;
}

async function createWarehouse(agent: Agent, name: string): Promise<Record<string, unknown>> {
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
  const code = (overrides.code as string) ?? `SP-KM-${rand()}`;
  const res = await agent.post('/api/products').send({
    code,
    name: 'San pham khuyen mai gia lap',
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
    sku: `SKU-KM-${rand()}`,
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
 * Boi canh khuyen mai: 1 kho A + 3 san pham/bien the (V1 gia 100000,
 * V2 gia 50000, V3 gia 5000) + ton: whA V1 200 / V2 100 / V3 50.
 */
async function promoCtx() {
  const ctx = await fullCtx();
  const whA = await createWarehouse(ctx.owner, 'Kho A');
  const p1 = await createProduct(ctx.owner, { name: 'SP KM 1', price: 100000, min_stock: 0 });
  const v1 = await createVariant(ctx.owner, p1.id);
  const p2 = await createProduct(ctx.owner, { name: 'SP KM 2', price: 50000, min_stock: 0 });
  const v2 = await createVariant(ctx.owner, p2.id);
  const p3 = await createProduct(ctx.owner, { name: 'SP KM 3', price: 5000, min_stock: 0 });
  const v3 = await createVariant(ctx.owner, p3.id);
  await mustStockIn(ctx.owner, whA.id as number, v1, 200);
  await mustStockIn(ctx.owner, whA.id as number, v2, 100);
  await mustStockIn(ctx.owner, whA.id as number, v3, 50);
  return { ...ctx, whA, p1, v1, p2, v2, p3, v3 };
}

type Ctx = Awaited<ReturnType<typeof promoCtx>>;

function asOrder(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (body.order as Record<string, unknown>) ?? body;
}

function asPromo(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (body.promotion as Record<string, unknown>) ?? body;
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

function cols(db: Db, table: string): string[] {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return rows.map((r) => r.name);
  } catch {
    return [];
  }
}

function orderRow(db: Db, id: number): Record<string, unknown> {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Record<string, unknown>;
}

function promoRow(db: Db, id: number): Record<string, unknown> | undefined {
  try {
    return db.prepare('SELECT * FROM promotions WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
  } catch {
    return undefined;
  }
}

function promoCountByCode(db: Db, code: string): number {
  try {
    const row = db
      .prepare('SELECT COUNT(*) AS c FROM promotions WHERE code = ?')
      .get(code) as { c: number };
    return row.c;
  } catch {
    return 0;
  }
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
): Promise<Record<string, unknown>> {
  await mustTransition(ctx.owner, orderId, 'confirm');
  await mustTransition(ctx.owner, orderId, 'process');
  const done = await mustTransition(ctx.owner, orderId, 'complete');
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

function createPromoRaw(
  agent: Agent,
  body: Record<string, unknown>,
  idempotencyKey?: string,
) {
  const req = agent.post('/api/promotions');
  if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
  return req.send(body);
}

async function mustCreatePromo(
  agent: Agent,
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<Record<string, unknown>> {
  const res = await createPromoRaw(agent, body, idempotencyKey);
  expect(res.status).toBe(201);
  const promo = asPromo(res);
  expect(promo.id).toBeDefined();
  return promo;
}

function applyPromoRaw(
  agent: Agent,
  orderId: number,
  code: string,
  opts: { headerKey?: string; bodyKey?: string } = {},
) {
  const req = agent.post(`/api/orders/${orderId}/promotion`);
  if (opts.headerKey) req.set('Idempotency-Key', opts.headerKey);
  const body: Record<string, unknown> = { code };
  if (opts.bodyKey) body.idempotency_key = opts.bodyKey;
  return req.send(body);
}

async function mustApplyPromo(
  agent: Agent,
  orderId: number,
  code: string,
  opts: { headerKey?: string; bodyKey?: string } = {},
): Promise<Record<string, unknown>> {
  const res = await applyPromoRaw(agent, orderId, code, opts);
  expect(res.status).toBe(201);
  const body = res.body as Record<string, unknown>;
  const order = asOrder(res);
  expect(order.id).toBeDefined();
  // Worker co the dat promotion/promo_discount o top-level hoac trong
  // order: chuan hoa ve order de test doc 1 cho.
  return {
    ...order,
    ...(body.promotion !== undefined ? { promotion: body.promotion } : {}),
    ...(typeof body.promo_discount === 'number' ? { promo_discount: body.promo_discount } : {}),
  };
}

async function mustGetPromo(agent: Agent, promoId: number): Promise<Record<string, unknown>> {
  const res = await agent.get(`/api/promotions/${promoId}`);
  expect(res.status).toBe(200);
  return asPromo(res);
}

function promoActor(
  id: number,
  role: Role,
  branchId: number | null = null,
): Actor {
  return { id, orgId: 1, branchId, role };
}

function promoTarget(orgId = 1, branchId?: number | null): Target {
  return { orgId, branchId };
}

// ---------- AC-1: ma giam gia + schema ----------

test('AC-1 migration 014 tao du 2 bang khuyen mai + cot orders promotion_id promo_discount', () => {
  const { db } = freshApp();
  const names = tableNames(db);
  expect(names).toContain('promotions');
  expect(names).toContain('promotion_usages');
  for (const c of ['org_id', 'code', 'type', 'value', 'cap', 'min_order_total', 'channels', 'branch_id', 'valid_from', 'valid_to', 'usage_limit', 'per_customer_limit', 'status', 'created_at', 'updated_at']) {
    expect(cols(db, 'promotions')).toContain(c);
  }
  for (const c of ['promotion_id', 'order_id', 'customer_id', 'discount_amount', 'status', 'released_at', 'release_reason', 'created_at']) {
    expect(cols(db, 'promotion_usages')).toContain(c);
  }
  expect(cols(db, 'orders')).toContain('promotion_id');
  expect(cols(db, 'orders')).toContain('promo_discount');
});

test('AC-1 POST api promotions 201 ma chuan hoa UPPERCASE trim kem used_count 0', async () => {
  const ctx = await promoCtx();
  const promo = await mustCreatePromo(ctx.owner, {
    code: ' sale10 ',
    type: 'percent',
    value: 10,
    cap: 20000,
  });
  expect(promo.code).toBe('SALE10');
  expect(promo.type).toBe('percent');
  expect(promo.value).toBe(10);
  expect(promo.cap).toBe(20000);
  expect(promo.status).toBe('active');
  const detail = await mustGetPromo(ctx.owner, promo.id as number);
  expect(detail.code).toBe('SALE10');
  expect(detail.used_count).toBe(0);
  expect(detail.usage_limit).toBeNull();
  expect(detail.per_customer_limit).toBeNull();
});

test('AC-1 POST trung ma trong org 409, cung ma org B 201', async () => {
  const ctx = await promoCtx();
  await mustCreatePromo(ctx.owner, { code: 'SALE10', type: 'percent', value: 10 });
  const dup = await createPromoRaw(ctx.owner, { code: ' sale10 ', type: 'percent', value: 20 });
  expect(dup.status).toBe(409);
  expect(promoCountByCode(ctx.db, 'SALE10')).toBe(1);
  const inB = await mustCreatePromo(ctx.ownerB, { code: 'SALE10', type: 'fixed', value: 5000 });
  expect(inB.code).toBe('SALE10');
});

test('AC-1 POST sai validate code type value: code trong qua 50 ky tu type la percent ngoai 1-100 fixed nho hon 1', async () => {
  const ctx = await promoCtx();
  for (const body of [
    { code: '', type: 'percent', value: 10 },
    { code: '   ', type: 'percent', value: 10 },
    { code: 'A'.repeat(51), type: 'percent', value: 10 },
    { code: 'BADTYPE', type: 'bogus', value: 10 },
    { code: 'P0', type: 'percent', value: 0 },
    { code: 'P101', type: 'percent', value: 101 },
    { code: 'P150', type: 'percent', value: 150 },
    { code: 'F0', type: 'fixed', value: 0 },
    { code: 'FNEG', type: 'fixed', value: -5 },
  ]) {
    const res = await createPromoRaw(ctx.owner, body);
    expect(res.status).toBe(400);
    expect(typeof (res.body as Record<string, unknown>).error).toBe('string');
  }
});

test('AC-1 POST sai validate cap min gioi han: cap voi fixed cap nho hon 1 min am gioi han nho hon 1', async () => {
  const ctx = await promoCtx();
  for (const body of [
    { code: 'CAPFIX', type: 'fixed', value: 10000, cap: 5000 },
    { code: 'CAP0', type: 'percent', value: 10, cap: 0 },
    { code: 'CAPNEG', type: 'percent', value: 10, cap: -1 },
    { code: 'MINNEG', type: 'percent', value: 10, min_order_total: -1 },
    { code: 'LIM0', type: 'percent', value: 10, usage_limit: 0 },
    { code: 'LIMNEG', type: 'percent', value: 10, usage_limit: -2 },
    { code: 'PER0', type: 'percent', value: 10, per_customer_limit: 0 },
    { code: 'PERNEG', type: 'percent', value: 10, per_customer_limit: -1 },
  ]) {
    const res = await createPromoRaw(ctx.owner, body);
    expect(res.status).toBe(400);
  }
});

test('AC-1 POST sai validate kenh thoi gian: channels rong la valid_from valid_to sai dinh dang hoac valid_from lon hon valid_to', async () => {
  const ctx = await promoCtx();
  for (const body of [
    { code: 'CHEMPTY', type: 'percent', value: 10, channels: [] },
    { code: 'CHBAD', type: 'percent', value: 10, channels: ['bogus'] },
    { code: 'CHBAD2', type: 'percent', value: 10, channels: ['counter', 'bogus'] },
    { code: 'DTBAD', type: 'percent', value: 10, valid_from: 'khong-phai-ngay' },
    { code: 'DTBAD2', type: 'percent', value: 10, valid_to: '32-13-2026' },
    { code: 'DTEQ', type: 'percent', value: 10, valid_from: '2026-06-01T00:00:00.000Z', valid_to: '2026-06-01T00:00:00.000Z' },
    { code: 'DTREV', type: 'percent', value: 10, valid_from: '2026-06-02T00:00:00.000Z', valid_to: '2026-06-01T00:00:00.000Z' },
  ]) {
    const res = await createPromoRaw(ctx.owner, body);
    expect(res.status).toBe(400);
  }
});

test('AC-1 POST branch khong ton tai 404 branch org B 403', async () => {
  const ctx = await promoCtx();
  const missing = await createPromoRaw(ctx.owner, {
    code: 'BR404', type: 'percent', value: 10, branch_id: 999999,
  });
  expect(missing.status).toBe(404);
  const foreign = await createPromoRaw(ctx.owner, {
    code: 'BR403', type: 'percent', value: 10, branch_id: ctx.branchBId,
  });
  expect(foreign.status).toBe(403);
});

test('AC-1 PATCH sua value cap min_order_total 200 gui code 400', async () => {
  const ctx = await promoCtx();
  const promo = await mustCreatePromo(ctx.owner, {
    code: 'PATCH1', type: 'percent', value: 10, cap: 20000, min_order_total: 0,
  });
  const res = await ctx.owner
    .patch(`/api/promotions/${promo.id as number}`)
    .send({ value: 15, cap: 30000, min_order_total: 50000 });
  expect(res.status).toBe(200);
  const updated = asPromo(res);
  expect(updated.value).toBe(15);
  expect(updated.cap).toBe(30000);
  expect(updated.min_order_total).toBe(50000);
  expect(updated.code).toBe('PATCH1');
  const codeChange = await ctx.owner
    .patch(`/api/promotions/${promo.id as number}`)
    .send({ code: 'KHAC' });
  expect(codeChange.status).toBe(400);
  const after = await mustGetPromo(ctx.owner, promo.id as number);
  expect(after.code).toBe('PATCH1');
});

test('AC-1 PATCH khoa mo ma: locked 200 roi ap ma 400 mo lai active 200 roi ap duoc', async () => {
  const ctx = await promoCtx();
  const promo = await mustCreatePromo(ctx.owner, { code: 'LOCK1', type: 'percent', value: 10 });
  const order = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  const locked = await ctx.owner
    .patch(`/api/promotions/${promo.id as number}`)
    .send({ status: 'locked' });
  expect(locked.status).toBe(200);
  expect(asPromo(locked).status).toBe('locked');
  const denied = await applyPromoRaw(ctx.owner, order.id as number, 'LOCK1');
  expect(denied.status).toBe(400);
  const unlocked = await ctx.owner
    .patch(`/api/promotions/${promo.id as number}`)
    .send({ status: 'active' });
  expect(unlocked.status).toBe(200);
  expect(asPromo(unlocked).status).toBe('active');
  await mustApplyPromo(ctx.owner, order.id as number, 'LOCK1');
});

test('AC-1 PATCH ma khong ton tai 404 ma org B 403 PATCH percent 150 400 PATCH cap voi fixed 400', async () => {
  const ctx = await promoCtx();
  const promo = await mustCreatePromo(ctx.owner, { code: 'PATCH2', type: 'fixed', value: 10000 });
  const missing = await ctx.owner.patch('/api/promotions/999999').send({ value: 20 });
  expect(missing.status).toBe(404);
  const foreign = await ctx.ownerB
    .patch(`/api/promotions/${promo.id as number}`)
    .send({ value: 20 });
  expect(foreign.status).toBe(403);
  const pctPromo = await mustCreatePromo(ctx.owner, { code: 'PATCH4', type: 'percent', value: 10 });
  const badValue = await ctx.owner
    .patch(`/api/promotions/${pctPromo.id as number}`)
    .send({ value: 150 });
  expect(badValue.status).toBe(400);
  const fixedPromo = await mustCreatePromo(ctx.owner, { code: 'PATCH3', type: 'fixed', value: 10000 });
  const capFixed = await ctx.owner
    .patch(`/api/promotions/${fixedPromo.id as number}`)
    .send({ cap: 5000 });
  expect(capFixed.status).toBe(400);
  const badStatus = await ctx.owner
    .patch(`/api/promotions/${promo.id as number}`)
    .send({ status: 'bogus' });
  expect(badStatus.status).toBe(400);
});

test('AC-1 GET list loc code status channel branch phan trang limit offset kem total moi nhat truoc', async () => {
  const ctx = await promoCtx();
  const a = await mustCreatePromo(ctx.owner, { code: 'LISTA', type: 'percent', value: 10, channels: ['counter'] });
  const b = await mustCreatePromo(ctx.owner, { code: 'LISTB', type: 'percent', value: 20, channels: ['web'] });
  await mustCreatePromo(ctx.owner, {
    code: 'LISTC', type: 'fixed', value: 5000, branch_id: ctx.branch2,
  });
  const all = await ctx.owner.get('/api/promotions');
  expect(all.status).toBe(200);
  const rows = asList(all, ['promotions']);
  expect(rows.length).toBe(3);
  expect(listTotal(all)).toBe(3);
  expect(rows[0].code).toBe('LISTC');
  const byCode = await ctx.owner.get('/api/promotions?code=LISTA');
  expect(asList(byCode, ['promotions']).map((r) => r.code)).toEqual(['LISTA']);
  const byChannel = await ctx.owner.get('/api/promotions?channel=web');
  expect(asList(byChannel, ['promotions']).map((r) => r.code)).toEqual(['LISTB']);
  const byBranch = await ctx.owner.get(`/api/promotions?branch_id=${ctx.branch2}`);
  expect(asList(byBranch, ['promotions']).map((r) => r.code)).toEqual(['LISTC']);
  expect(a.id).toBeDefined();
  expect(b.id).toBeDefined();
  const page1 = await ctx.owner.get('/api/promotions?limit=2&offset=0');
  expect(asList(page1, ['promotions']).length).toBe(2);
  expect(listTotal(page1)).toBe(3);
  const page2 = await ctx.owner.get('/api/promotions?limit=2&offset=2');
  expect(asList(page2, ['promotions']).length).toBe(1);
});

test('AC-1 GET list status la 400 channel la 400 branch khong ton tai 404 branch org B 403', async () => {
  const ctx = await promoCtx();
  await mustCreatePromo(ctx.owner, { code: 'LISTD', type: 'percent', value: 10 });
  expect((await ctx.owner.get('/api/promotions?status=bogus')).status).toBe(400);
  expect((await ctx.owner.get('/api/promotions?channel=bogus')).status).toBe(400);
  expect((await ctx.owner.get('/api/promotions?branch_id=999999')).status).toBe(404);
  expect((await ctx.owner.get(`/api/promotions?branch_id=${ctx.branchBId}`)).status).toBe(403);
  const byStatus = await ctx.owner.get('/api/promotions?status=active');
  expect(byStatus.status).toBe(200);
  expect(asList(byStatus, ['promotions']).length).toBe(1);
});

test('AC-1 GET detail kem used_count usage_limit per_customer_limit ma khong ton tai 404 ma org B 403', async () => {
  const ctx = await promoCtx();
  const promo = await mustCreatePromo(ctx.owner, {
    code: 'DET1', type: 'percent', value: 10, usage_limit: 5, per_customer_limit: 2,
  });
  const detail = await mustGetPromo(ctx.owner, promo.id as number);
  expect(detail.used_count).toBe(0);
  expect(detail.usage_limit).toBe(5);
  expect(detail.per_customer_limit).toBe(2);
  expect((await ctx.owner.get('/api/promotions/999999')).status).toBe(404);
  expect((await ctx.ownerB.get(`/api/promotions/${promo.id as number}`)).status).toBe(403);
});

// ---------- AC-2: ap ma + dieu kien + tinh giam + gioi han dung ----------

test('AC-2 ham thuan calculateDiscount percent cap fixed cat tong va cat phan con lai sau diem', () => {
  expect(calculateDiscount(250000, { type: 'percent', value: 10, cap: 20000 })).toBe(20000);
  expect(calculateDiscount(100000, { type: 'percent', value: 20, cap: null })).toBe(20000);
  expect(calculateDiscount(50000, { type: 'fixed', value: 100000, cap: null })).toBe(50000);
  expect(calculateDiscount(999, { type: 'percent', value: 10, cap: null })).toBe(99);
  expect(calculateDiscount(100000, { type: 'percent', value: 50, cap: null }, 90000)).toBe(10000);
  expect(calculateDiscount(100000, { type: 'fixed', value: 10000, cap: null }, 20000)).toBe(10000);
  expect(calculateDiscount(100000, { type: 'fixed', value: 30000, cap: null }, 0)).toBe(30000);
  expect(calculateDiscount(100000, { type: 'percent', value: 10, cap: 5000 }, 95000)).toBe(5000);
});

test('AC-2 ap ma 10 cap 20000 cho don 250000 giam 20000 tong goc khong doi usage ghi dung', async () => {
  const ctx = await promoCtx();
  const promo = await mustCreatePromo(ctx.owner, { code: 'SALE10', type: 'percent', value: 10, cap: 20000 });
  const order = await mustOrder250(ctx);
  expect(order.total).toBe(250000);
  const applied = await mustApplyPromo(ctx.owner, order.id as number, 'SALE10');
  const body = applied as Record<string, unknown>;
  expect(body.promo_discount).toBe(20000);
  const nested = (body.promotion as Record<string, unknown>) ?? {};
  expect(nested.code).toBe('SALE10');
  expect(nested.type).toBe('percent');
  expect(nested.value).toBe(10);
  const row = orderRow(ctx.db, order.id as number);
  expect(row.total).toBe(250000);
  expect(row.promo_discount).toBe(20000);
  expect(row.promotion_id).toBe(promo.id);
  const usages = usagesOf(ctx.db, promo.id as number);
  expect(usages.length).toBe(1);
  expect(usages[0].discount_amount).toBe(20000);
  expect(usages[0].status).toBe('used');
  expect(usages[0].order_id).toBe(order.id);
  expect(usages[0].customer_id).toBeNull();
  const detail = await mustGetPromo(ctx.owner, promo.id as number);
  expect(detail.used_count).toBe(1);
});

test('AC-2 ap ma fixed 100000 cho don 50000 giam 50000 cat o tong don', async () => {
  const ctx = await promoCtx();
  await mustCreatePromo(ctx.owner, { code: 'FIX100', type: 'fixed', value: 100000 });
  const order = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v2, qty: 1 }]);
  expect(order.total).toBe(50000);
  const applied = await mustApplyPromo(ctx.owner, order.id as number, 'FIX100');
  expect((applied as Record<string, unknown>).promo_discount).toBe(50000);
  expect(orderRow(ctx.db, order.id as number).promo_discount).toBe(50000);
  expect(orderRow(ctx.db, order.id as number).total).toBe(50000);
});

test('AC-2 ap ma fixed 30000 cho don 100000 giam 30000', async () => {
  const ctx = await promoCtx();
  await mustCreatePromo(ctx.owner, { code: 'FIX30', type: 'fixed', value: 30000 });
  const order = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  const applied = await mustApplyPromo(ctx.owner, order.id as number, 'FIX30');
  expect((applied as Record<string, unknown>).promo_discount).toBe(30000);
});

test('AC-2 ap ma sai kenh 400 sai chi nhanh 400', async () => {
  const ctx = await promoCtx();
  await mustCreatePromo(ctx.owner, { code: 'CHWEB', type: 'percent', value: 10, channels: ['web'] });
  const counterOrder = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  const wrongChannel = await applyPromoRaw(ctx.owner, counterOrder.id as number, 'CHWEB');
  expect(wrongChannel.status).toBe(400);
  expect(typeof (wrongChannel.body as Record<string, unknown>).error).toBe('string');
  expect(orderRow(ctx.db, counterOrder.id as number).promo_discount).toBe(0);
  await mustCreatePromo(ctx.owner, { code: 'BR2ONLY', type: 'percent', value: 10, branch_id: ctx.branch2 });
  const branch1Order = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  const wrongBranch = await applyPromoRaw(ctx.owner, branch1Order.id as number, 'BR2ONLY');
  expect(wrongBranch.status).toBe(400);
  const branch2Order = await mustCreateOrder(ctx.manager, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    branch_id: ctx.branch2,
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  await mustApplyPromo(ctx.manager, branch2Order.id as number, 'BR2ONLY');
});

test('AC-2 ap ma het han 400 chua toi han 400', async () => {
  const ctx = await promoCtx();
  await mustCreatePromo(ctx.owner, {
    code: 'EXPIRED', type: 'percent', value: 10,
    valid_from: '2019-01-01T00:00:00.000Z', valid_to: '2020-01-01T00:00:00.000Z',
  });
  await mustCreatePromo(ctx.owner, {
    code: 'NOTYET', type: 'percent', value: 10,
    valid_from: '2999-01-01T00:00:00.000Z', valid_to: '2999-12-31T00:00:00.000Z',
  });
  const order1 = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  expect((await applyPromoRaw(ctx.owner, order1.id as number, 'EXPIRED')).status).toBe(400);
  const order2 = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  expect((await applyPromoRaw(ctx.owner, order2.id as number, 'NOTYET')).status).toBe(400);
  await mustCreatePromo(ctx.owner, {
    code: 'VALID', type: 'percent', value: 10,
    valid_from: '2020-01-01T00:00:00.000Z', valid_to: '2999-01-01T00:00:00.000Z',
  });
  const order3 = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  await mustApplyPromo(ctx.owner, order3.id as number, 'VALID');
});

test('AC-2 ap ma tong don duoi min_order_total 400', async () => {
  const ctx = await promoCtx();
  await mustCreatePromo(ctx.owner, { code: 'MIN50', type: 'percent', value: 10, min_order_total: 50000 });
  const small = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v3, qty: 6 }]);
  expect(small.total).toBe(30000);
  const res = await applyPromoRaw(ctx.owner, small.id as number, 'MIN50');
  expect(res.status).toBe(400);
  expect(orderRow(ctx.db, small.id as number).promo_discount).toBe(0);
});

test('AC-2 ap ma cho don khong draft 400', async () => {
  const ctx = await promoCtx();
  await mustCreatePromo(ctx.owner, { code: 'NODRAFT', type: 'percent', value: 10 });
  const order = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  await mustTransition(ctx.owner, order.id as number, 'confirm');
  const res = await applyPromoRaw(ctx.owner, order.id as number, 'NODRAFT');
  expect(res.status).toBe(400);
  expect(orderRow(ctx.db, order.id as number).promo_discount).toBe(0);
});

test('AC-2 ap ma lan 2 cung don 400 promo_discount khong doi', async () => {
  const ctx = await promoCtx();
  await mustCreatePromo(ctx.owner, { code: 'ONCE1', type: 'percent', value: 10 });
  await mustCreatePromo(ctx.owner, { code: 'ONCE2', type: 'fixed', value: 5000 });
  const order = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  await mustApplyPromo(ctx.owner, order.id as number, 'ONCE1');
  const again = await applyPromoRaw(ctx.owner, order.id as number, 'ONCE2');
  expect(again.status).toBe(400);
  const sameKey = await applyPromoRaw(ctx.owner, order.id as number, 'ONCE1', { headerKey: 'other-key-1' });
  expect(sameKey.status).toBe(400);
  expect(orderRow(ctx.db, order.id as number).promo_discount).toBe(10000);
});

test('AC-2 ap ma khong ton tai 404 don khong ton tai 404 don org A bang user org B 403 ma org B 404', async () => {
  const ctx = await promoCtx();
  await mustCreatePromo(ctx.owner, { code: 'REAL1', type: 'percent', value: 10 });
  await mustCreatePromo(ctx.ownerB, { code: 'ONLYB', type: 'percent', value: 10 });
  const order = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  expect((await applyPromoRaw(ctx.owner, order.id as number, 'KHONGCO')).status).toBe(404);
  expect((await applyPromoRaw(ctx.owner, order.id as number, 'ONLYB')).status).toBe(404);
  expect((await applyPromoRaw(ctx.owner, 999999, 'REAL1')).status).toBe(404);
  expect((await applyPromoRaw(ctx.ownerB, order.id as number, 'REAL1')).status).toBe(403);
});

test('AC-2 ap ma bi khoa 400', async () => {
  const ctx = await promoCtx();
  const promo = await mustCreatePromo(ctx.owner, { code: 'LOCKED2', type: 'percent', value: 10 });
  await ctx.owner.patch(`/api/promotions/${promo.id as number}`).send({ status: 'locked' });
  const order = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  const res = await applyPromoRaw(ctx.owner, order.id as number, 'LOCKED2');
  expect(res.status).toBe(400);
  expect(usagesOf(ctx.db, promo.id as number).length).toBe(0);
});

test('AC-2 het luot tong usage_limit 2 ap 2 lan 201 lan 3 400 don khong doi', async () => {
  const ctx = await promoCtx();
  const promo = await mustCreatePromo(ctx.owner, { code: 'LIMTOT', type: 'percent', value: 10, usage_limit: 2 });
  const o1 = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  const o2 = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  const o3 = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  await mustApplyPromo(ctx.owner, o1.id as number, 'LIMTOT');
  await mustApplyPromo(ctx.owner, o2.id as number, 'LIMTOT');
  const third = await applyPromoRaw(ctx.owner, o3.id as number, 'LIMTOT');
  expect(third.status).toBe(400);
  expect(orderRow(ctx.db, o3.id as number).promo_discount).toBe(0);
  expect(orderRow(ctx.db, o3.id as number).promotion_id).toBeNull();
  expect(usagesOf(ctx.db, promo.id as number).length).toBe(2);
  const detail = await mustGetPromo(ctx.owner, promo.id as number);
  expect(detail.used_count).toBe(2);
});

test('AC-2 het luot moi khach per_customer_limit 1 ap lan 2 cung khach 400 khach khac ap duoc', async () => {
  const ctx = await promoCtx();
  const promo = await mustCreatePromo(ctx.owner, {
    code: 'LIMCUST', type: 'percent', value: 10, per_customer_limit: 1,
  });
  const c1 = await mustCreateCustomer(ctx.owner, { name: 'Khach 1', phone: randPhone(), branch_id: ctx.branch1 });
  const c2 = await mustCreateCustomer(ctx.owner, { name: 'Khach 2', phone: randPhone(), branch_id: ctx.branch1 });
  const o1 = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }], { customer_id: c1.id });
  const o2 = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }], { customer_id: c1.id });
  const o3 = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }], { customer_id: c2.id });
  await mustApplyPromo(ctx.owner, o1.id as number, 'LIMCUST');
  const second = await applyPromoRaw(ctx.owner, o2.id as number, 'LIMCUST');
  expect(second.status).toBe(400);
  expect(orderRow(ctx.db, o2.id as number).promo_discount).toBe(0);
  await mustApplyPromo(ctx.owner, o3.id as number, 'LIMCUST');
  const usages = usagesOf(ctx.db, promo.id as number);
  expect(usages.length).toBe(2);
  expect(usages[0].customer_id).toBe(c1.id);
  expect(usages[1].customer_id).toBe(c2.id);
});

test('AC-2 don khong gan khach chi tinh gioi han tong per_customer_limit 1 usage_limit 2 ap 2 don 201 lan 3 400', async () => {
  const ctx = await promoCtx();
  const promo = await mustCreatePromo(ctx.owner, {
    code: 'LIMNOCUST', type: 'percent', value: 10, usage_limit: 2, per_customer_limit: 1,
  });
  const o1 = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  const o2 = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  const o3 = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  await mustApplyPromo(ctx.owner, o1.id as number, 'LIMNOCUST');
  await mustApplyPromo(ctx.owner, o2.id as number, 'LIMNOCUST');
  const third = await applyPromoRaw(ctx.owner, o3.id as number, 'LIMNOCUST');
  expect(third.status).toBe(400);
  const usages = usagesOf(ctx.db, promo.id as number);
  expect(usages.length).toBe(2);
  for (const u of usages) expect(u.customer_id).toBeNull();
});

test('AC-2 ap dong thoi 10 lan ma gioi han 5 dung 5 thanh cong used_count 5', async () => {
  const ctx = await promoCtx();
  const promo = await mustCreatePromo(ctx.owner, { code: 'CONC5', type: 'percent', value: 10, usage_limit: 5 });
  const orders: Record<string, unknown>[] = [];
  for (let i = 0; i < 10; i++) {
    orders.push(await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]));
  }
  const results = await Promise.all(
    orders.map((o, i) =>
      applyPromoRaw(ctx.owner, o.id as number, 'CONC5', { headerKey: `conc-5-${i}` }),
    ),
  );
  const ok = results.filter((r) => r.status === 201);
  const denied = results.filter((r) => r.status === 400);
  expect(ok.length).toBe(5);
  expect(denied.length).toBe(5);
  expect(usagesOf(ctx.db, promo.id as number).length).toBe(5);
  const detail = await mustGetPromo(ctx.owner, promo.id as number);
  expect(detail.used_count).toBe(5);
});

// ---------- AC-3: chong giam + huy don hoan luot + doi soat ----------

test('AC-3 chong giam ma truoc diem sau ma 20 khong cap cong 200 diem don 100000 tong giam 40000', async () => {
  const ctx = await promoCtx();
  await mustCreatePromo(ctx.owner, { code: 'STACK20', type: 'percent', value: 20 });
  const cust = await mustCreateCustomer(ctx.owner, { name: 'Khach stack', phone: randPhone(), branch_id: ctx.branch1 });
  grantPoints(ctx.db, ctx.orgId, cust.id as number, 200);
  const order = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }], { customer_id: cust.id });
  await mustApplyPromo(ctx.owner, order.id as number, 'STACK20');
  expect(orderRow(ctx.db, order.id as number).promo_discount).toBe(20000);
  const redeemed = await mustRedeemPoints(ctx.owner, cust.id as number, order.id as number, 200);
  expect(redeemed.discount).toBe(20000);
  const row = orderRow(ctx.db, order.id as number);
  expect(row.points_discount).toBe(20000);
  expect(row.promo_discount).toBe(20000);
  expect((row.points_discount as number) + (row.promo_discount as number)).toBe(40000);
  const summary = computePaymentSummary(ctx.db, order.id as number);
  expect(summary.outstanding).toBe(60000);
  expect(summary.payment_status).toBe('unpaid');
});

test('AC-3 chong giam diem truoc ma sau ma 20 khong cap cong 200 diem don 100000 tong giam 40000', async () => {
  const ctx = await promoCtx();
  await mustCreatePromo(ctx.owner, { code: 'STACK20B', type: 'percent', value: 20 });
  const cust = await mustCreateCustomer(ctx.owner, { name: 'Khach stack 2', phone: randPhone(), branch_id: ctx.branch1 });
  grantPoints(ctx.db, ctx.orgId, cust.id as number, 200);
  const order = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }], { customer_id: cust.id });
  const redeemed = await mustRedeemPoints(ctx.owner, cust.id as number, order.id as number, 200);
  expect(redeemed.discount).toBe(20000);
  await mustApplyPromo(ctx.owner, order.id as number, 'STACK20B');
  const row = orderRow(ctx.db, order.id as number);
  expect(row.points_discount).toBe(20000);
  expect(row.promo_discount).toBe(20000);
  expect((row.points_discount as number) + (row.promo_discount as number)).toBe(40000);
  const summary = computePaymentSummary(ctx.db, order.id as number);
  expect(summary.outstanding).toBe(60000);
  expect(summary.payment_status).toBe('unpaid');
});

test('AC-3 chong giam bao hoa ma truoc ma 50 cong 900 diem don 100000 tong giam 100000 outstanding 0 payment_status unpaid', async () => {
  const ctx = await promoCtx();
  await mustCreatePromo(ctx.owner, { code: 'SAT50', type: 'percent', value: 50 });
  const cust = await mustCreateCustomer(ctx.owner, { name: 'Khach bao hoa', phone: randPhone(), branch_id: ctx.branch1 });
  grantPoints(ctx.db, ctx.orgId, cust.id as number, 900);
  const order = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }], { customer_id: cust.id });
  await mustApplyPromo(ctx.owner, order.id as number, 'SAT50');
  expect(orderRow(ctx.db, order.id as number).promo_discount).toBe(50000);
  const redeemed = await mustRedeemPoints(ctx.owner, cust.id as number, order.id as number, 900);
  expect(redeemed.discount).toBe(50000);
  const row = orderRow(ctx.db, order.id as number);
  expect((row.points_discount as number) + (row.promo_discount as number)).toBe(100000);
  const summary = computePaymentSummary(ctx.db, order.id as number);
  expect(summary.outstanding).toBe(0);
  expect(summary.payment_status).toBe('unpaid');
  const viaApi = await ctx.owner.get(`/api/orders/${order.id as number}/payments`);
  expect(viaApi.status).toBe(200);
  expect(asSummary(viaApi).outstanding).toBe(0);
  expect(asSummary(viaApi).payment_status).toBe('unpaid');
});

test('AC-3 chong giam bao hoa diem truoc ma 50 cong 900 diem don 100000 tong giam 100000 outstanding 0', async () => {
  const ctx = await promoCtx();
  await mustCreatePromo(ctx.owner, { code: 'SAT50B', type: 'percent', value: 50 });
  const cust = await mustCreateCustomer(ctx.owner, { name: 'Khach bao hoa 2', phone: randPhone(), branch_id: ctx.branch1 });
  grantPoints(ctx.db, ctx.orgId, cust.id as number, 900);
  const order = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }], { customer_id: cust.id });
  const redeemed = await mustRedeemPoints(ctx.owner, cust.id as number, order.id as number, 900);
  expect(redeemed.discount).toBe(90000);
  await mustApplyPromo(ctx.owner, order.id as number, 'SAT50B');
  const row = orderRow(ctx.db, order.id as number);
  expect(row.points_discount).toBe(90000);
  expect(row.promo_discount).toBe(10000);
  expect((row.points_discount as number) + (row.promo_discount as number)).toBe(100000);
  const summary = computePaymentSummary(ctx.db, order.id as number);
  expect(summary.outstanding).toBe(0);
  expect(summary.payment_status).toBe('unpaid');
});

test('AC-3 doi diem tren don da co ma bi cat o total tru promo_discount ma fixed 30000 doi 900 diem giam 70000', async () => {
  const ctx = await promoCtx();
  await mustCreatePromo(ctx.owner, { code: 'CAPPOINT', type: 'fixed', value: 30000 });
  const cust = await mustCreateCustomer(ctx.owner, { name: 'Khach cat diem', phone: randPhone(), branch_id: ctx.branch1 });
  grantPoints(ctx.db, ctx.orgId, cust.id as number, 900);
  const order = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }], { customer_id: cust.id });
  await mustApplyPromo(ctx.owner, order.id as number, 'CAPPOINT');
  const redeemed = await mustRedeemPoints(ctx.owner, cust.id as number, order.id as number, 900);
  expect(redeemed.discount).toBe(70000);
  const row = orderRow(ctx.db, order.id as number);
  expect(row.promo_discount).toBe(30000);
  expect(row.points_discount).toBe(70000);
  expect((row.points_discount as number) + (row.promo_discount as number)).toBe(100000);
});

test('AC-3 huy don co ma usage released promo_discount 0 promotion_id NULL ap lai duoc', async () => {
  const ctx = await promoCtx();
  const promo = await mustCreatePromo(ctx.owner, {
    code: 'CANCEL1', type: 'percent', value: 10, per_customer_limit: 1,
  });
  const cust = await mustCreateCustomer(ctx.owner, { name: 'Khach huy', phone: randPhone(), branch_id: ctx.branch1 });
  const order = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }], { customer_id: cust.id });
  await mustApplyPromo(ctx.owner, order.id as number, 'CANCEL1');
  expect(usagesOf(ctx.db, promo.id as number)[0].status).toBe('used');
  const cancelled = await mustTransition(ctx.owner, order.id as number, 'cancel');
  expect(cancelled.status).toBe('cancelled');
  const row = orderRow(ctx.db, order.id as number);
  expect(row.promo_discount).toBe(0);
  expect(row.promotion_id).toBeNull();
  const usages = usagesOf(ctx.db, promo.id as number);
  expect(usages.length).toBe(1);
  expect(usages[0].status).toBe('released');
  expect(usages[0].released_at).toBeTruthy();
  expect(String(usages[0].release_reason)).toContain(String(order.code));
  const detail = await mustGetPromo(ctx.owner, promo.id as number);
  expect(detail.used_count).toBe(0);
  const order2 = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }], { customer_id: cust.id });
  await mustApplyPromo(ctx.owner, order2.id as number, 'CANCEL1');
  const usages2 = usagesOf(ctx.db, promo.id as number);
  expect(usages2.length).toBe(2);
  expect(usages2[0].status).toBe('released');
  expect(usages2[1].status).toBe('used');
});

test('AC-3 tra hang hoan tien khong hoan luot dung usage van used promo_discount giu nguyen', async () => {
  const ctx = await promoCtx();
  const promo = await mustCreatePromo(ctx.owner, { code: 'RET1', type: 'percent', value: 10, cap: 20000 });
  const order = await mustOrder250(ctx);
  await mustApplyPromo(ctx.owner, order.id as number, 'RET1');
  expect(orderRow(ctx.db, order.id as number).promo_discount).toBe(20000);
  await mustCompletedOrder(ctx, order.id as number);
  await mustPayCash(ctx, order.id as number, 250000);
  const retRes = await ctx.owner.post(`/api/orders/${order.id as number}/returns`).send({
    items: [{ variant_id: ctx.v1, qty: 1, condition: 'resalable' }],
    reason: 'tra gia lap',
  });
  expect(retRes.status).toBe(201);
  const ret = (retRes.body as Record<string, unknown>).return as Record<string, unknown>;
  expect(ret.id).toBeDefined();
  expect((await ctx.owner.post(`/api/returns/${ret.id as number}/approve`).send({})).status).toBe(200);
  expect((await ctx.owner.post(`/api/returns/${ret.id as number}/receive`).send({})).status).toBe(200);
  const refundRes = await ctx.owner.post(`/api/returns/${ret.id as number}/refund`).send({});
  expect(refundRes.status).toBe(200);
  const usages = usagesOf(ctx.db, promo.id as number);
  expect(usages.length).toBe(1);
  expect(usages[0].status).toBe('used');
  expect(orderRow(ctx.db, order.id as number).promo_discount).toBe(20000);
  expect(orderRow(ctx.db, order.id as number).promotion_id).toBe(promo.id);
});

test('AC-3 hoan tien truc tiep khong hoan luot dung usage van used', async () => {
  const ctx = await promoCtx();
  const promo = await mustCreatePromo(ctx.owner, { code: 'REF1', type: 'percent', value: 10 });
  const order = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  await mustApplyPromo(ctx.owner, order.id as number, 'REF1');
  const payment = await mustPayCash(ctx, order.id as number, 100000);
  const refundRes = await ctx.owner
    .post(`/api/payments/${payment.id as number}/refunds`)
    .send({ amount: 50000, reason: 'hoan gia lap' });
  expect(refundRes.status).toBe(201);
  const usages = usagesOf(ctx.db, promo.id as number);
  expect(usages.length).toBe(1);
  expect(usages[0].status).toBe('used');
  expect(orderRow(ctx.db, order.id as number).promo_discount).toBe(10000);
});

test('AC-3 doi soat don 250000 ma 20000 diem 1000 tra 100000 outstanding 129000 payment_status partially_paid', async () => {
  const ctx = await promoCtx();
  await mustCreatePromo(ctx.owner, { code: 'RECON1', type: 'percent', value: 10, cap: 20000 });
  const cust = await mustCreateCustomer(ctx.owner, { name: 'Khach doi soat', phone: randPhone(), branch_id: ctx.branch1 });
  grantPoints(ctx.db, ctx.orgId, cust.id as number, 10);
  const order = await mustOrder250(ctx, { customer_id: cust.id });
  await mustApplyPromo(ctx.owner, order.id as number, 'RECON1');
  const redeemed = await mustRedeemPoints(ctx.owner, cust.id as number, order.id as number, 10);
  expect(redeemed.discount).toBe(1000);
  await mustPayCash(ctx, order.id as number, 100000);
  const summary = computePaymentSummary(ctx.db, order.id as number);
  expect(summary.order_total).toBe(250000);
  expect(summary.paid_total).toBe(100000);
  expect(summary.outstanding).toBe(129000);
  expect(summary.payment_status).toBe('partially_paid');
  const viaApi = await ctx.owner.get(`/api/orders/${order.id as number}/payments`);
  expect(viaApi.status).toBe(200);
  expect(asSummary(viaApi).outstanding).toBe(129000);
  expect(asSummary(viaApi).payment_status).toBe('partially_paid');
});

test('AC-3 tich diem tren tong goc don 250000 ap ma 10 hoan tat tich 25 diem', async () => {
  const ctx = await promoCtx();
  await mustCreatePromo(ctx.owner, { code: 'EARN1', type: 'percent', value: 10, cap: 20000 });
  const cust = await mustCreateCustomer(ctx.owner, { name: 'Khach tich diem', phone: randPhone(), branch_id: ctx.branch1 });
  const order = await mustOrder250(ctx, { customer_id: cust.id });
  await mustApplyPromo(ctx.owner, order.id as number, 'EARN1');
  await mustCompletedOrder(ctx, order.id as number);
  const earnRes = await ctx.owner
    .post(`/api/customers/${cust.id as number}/points/earn`)
    .send({ order_id: order.id });
  expect(earnRes.status).toBe(201);
  const body = earnRes.body as Record<string, unknown>;
  expect(body.points_earned).toBe(25);
  expect(body.points_balance).toBe(25);
});

// ---------- AC-4: RBAC + audit + idempotency ----------

test('AC-4 can 4 actions khuyen mai theo dung ma tran brief', () => {
  const owner = promoActor(1, 'owner', null);
  const manager = promoActor(2, 'manager', null);
  const sales1 = promoActor(3, 'sales', 1);
  const accountant = promoActor(5, 'accountant', 1);
  const t = (branchId?: number | null) => promoTarget(1, branchId);
  expect(can(owner, 'create-promotion' as Action, t())).toBe(true);
  expect(can(manager, 'create-promotion' as Action, t())).toBe(true);
  expect(can(owner, 'update-promotion' as Action, t())).toBe(true);
  expect(can(manager, 'update-promotion' as Action, t())).toBe(true);
  expect(can(owner, 'apply-promotion' as Action, t(1))).toBe(true);
  expect(can(manager, 'apply-promotion' as Action, t(2))).toBe(true);
  expect(can(sales1, 'apply-promotion' as Action, t(1))).toBe(true);
  expect(can(owner, 'view-promotions' as Action, t(2))).toBe(true);
  expect(can(manager, 'view-promotions' as Action, t(2))).toBe(true);
  expect(can(accountant, 'view-promotions' as Action, t(2))).toBe(true);
  expect(can(sales1, 'view-promotions' as Action, t(null))).toBe(true);
  expect(can(sales1, 'view-promotions' as Action, t(1))).toBe(true);
});

test('AC-4 RBAC 403 qua HTTP theo tung o cam trong ma tran khuyen mai', async () => {
  const ctx = await promoCtx();
  const promo = await mustCreatePromo(ctx.owner, { code: 'RBAC1', type: 'percent', value: 10 });
  const branchPromo = await mustCreatePromo(ctx.owner, {
    code: 'RBACBR2', type: 'percent', value: 10, branch_id: ctx.branch2,
  });
  const order = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  const branch2Order = await mustCreateOrder(ctx.manager, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    branch_id: ctx.branch2,
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  expect((await createPromoRaw(ctx.warehouse, { code: 'RBACW', type: 'percent', value: 10 })).status).toBe(403);
  expect((await ctx.sales.patch(`/api/promotions/${promo.id as number}`).send({ value: 20 })).status).toBe(403);
  expect((await applyPromoRaw(ctx.accountant, order.id as number, 'RBAC1')).status).toBe(403);
  expect((await applyPromoRaw(ctx.sales, branch2Order.id as number, 'RBAC1')).status).toBe(403);
  expect((await ctx.warehouse.get('/api/promotions')).status).toBe(403);
  expect((await ctx.warehouse.get(`/api/promotions/${promo.id as number}`)).status).toBe(403);
  expect((await ctx.ownerB.get(`/api/promotions/${promo.id as number}`)).status).toBe(403);
  expect((await ctx.sales.get(`/api/promotions/${branchPromo.id as number}`)).status).toBe(403);
  expect((await ctx.sales2.get(`/api/promotions/${branchPromo.id as number}`)).status).toBe(200);
});

test('AC-4 RBAC duong manager tao 201 accountant xem 200 sales xem ma khong gioi han chi nhanh 200 sales ap ma don dung chi nhanh 201', async () => {
  const ctx = await promoCtx();
  const promo = await mustCreatePromo(ctx.manager, { code: 'RBACOK', type: 'percent', value: 10 });
  expect((await ctx.accountant.get('/api/promotions')).status).toBe(200);
  expect((await ctx.accountant.get(`/api/promotions/${promo.id as number}`)).status).toBe(200);
  expect((await ctx.sales.get(`/api/promotions/${promo.id as number}`)).status).toBe(200);
  const order = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  await mustApplyPromo(ctx.sales, order.id as number, 'RBACOK');
  expect(orderRow(ctx.db, order.id as number).promo_discount).toBe(10000);
});

test('AC-4 audit log ghi tao sua khoa ap ma voi user_id created_at detail sales xem log 403 detail khong chua thong tin the', async () => {
  const ctx = await promoCtx();
  const promo = await mustCreatePromo(ctx.owner, { code: 'AUD1', type: 'percent', value: 10 });
  await ctx.owner.patch(`/api/promotions/${promo.id as number}`).send({ value: 15 });
  await ctx.owner.patch(`/api/promotions/${promo.id as number}`).send({ status: 'locked' });
  await ctx.owner.patch(`/api/promotions/${promo.id as number}`).send({ status: 'active' });
  const order = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  await mustApplyPromo(ctx.owner, order.id as number, 'AUD1');
  const rows = auditRows(ctx.db, ctx.orgId).filter(
    (r) => r.detail.target_promotion_id === promo.id,
  );
  expect(rows.length).toBeGreaterThanOrEqual(4);
  for (const r of rows) {
    expect(typeof r.user_id).toBe('number');
    expect(r.created_at).toBeTruthy();
    expect(r.detail.promotion_code ?? r.detail.target_promotion_id).toBeDefined();
  }
  const applied = rows.filter((r) => r.detail.target_order_id === order.id);
  expect(applied.length).toBeGreaterThanOrEqual(1);
  expect(applied[0].detail.discount).toBe(15000);
  expect(String(applied[0].detail.order_code)).toBe(String(order.code));
  for (const r of rows) {
    expect(JSON.stringify(r.detail)).not.toContain('4111');
    expect(JSON.stringify(r.detail)).not.toContain('card_number');
  }
  const logRes = await ctx.owner.get('/api/audit-log');
  expect(logRes.status).toBe(200);
  expect((await ctx.sales.get('/api/audit-log')).status).toBe(403);
});

test('AC-4 audit log ghi hoan luot dung khi huy don co ban ghi promotion-usage-released hoac cancel-order kem ma khuyen mai', async () => {
  const ctx = await promoCtx();
  const promo = await mustCreatePromo(ctx.owner, { code: 'AUDREL', type: 'percent', value: 10 });
  const order = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  await mustApplyPromo(ctx.owner, order.id as number, 'AUDREL');
  await mustTransition(ctx.owner, order.id as number, 'cancel');
  const rows = auditRows(ctx.db, ctx.orgId);
  const release = rows.filter(
    (r) =>
      (r.action === 'promotion-usage-released' && r.detail.target_promotion_id === promo.id) ||
      (r.action === 'cancel-order' &&
        r.detail.target_order_id === order.id &&
        (r.detail.target_promotion_id === promo.id ||
          r.detail.promotion_code === 'AUDREL' ||
          r.rawDetail.includes('AUDREL'))),
  );
  expect(release.length).toBeGreaterThanOrEqual(1);
  expect(release[0].user_id).toBeDefined();
  expect(release[0].created_at).toBeTruthy();
});

test('AC-4 idempotency tao ma gui lai cung key replayed true khong tao ma moi', async () => {
  const ctx = await promoCtx();
  const first = await createPromoRaw(ctx.owner, { code: 'IDEM1', type: 'percent', value: 10 }, 'idem-create-1');
  expect(first.status).toBe(201);
  const firstPromo = asPromo(first);
  const replay = await createPromoRaw(ctx.owner, { code: 'IDEM1', type: 'percent', value: 10 }, 'idem-create-1');
  expect(replay.status).toBe(201);
  expect((replay.body as Record<string, unknown>).replayed).toBe(true);
  expect(asPromo(replay).id).toBe(firstPromo.id);
  expect(promoCountByCode(ctx.db, 'IDEM1')).toBe(1);
  const list = await ctx.owner.get('/api/promotions?code=IDEM1');
  expect(listTotal(list)).toBe(1);
});

test('AC-4 idempotency ap ma gui lai cung key header replayed true khong ghi usage moi promo_discount khong doi', async () => {
  const ctx = await promoCtx();
  const promo = await mustCreatePromo(ctx.owner, { code: 'IDEMAP', type: 'percent', value: 10 });
  const order = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  const first = await applyPromoRaw(ctx.owner, order.id as number, 'IDEMAP', { headerKey: 'idem-apply-1' });
  expect(first.status).toBe(201);
  expect(usagesOf(ctx.db, promo.id as number).length).toBe(1);
  const replay = await applyPromoRaw(ctx.owner, order.id as number, 'IDEMAP', { headerKey: 'idem-apply-1' });
  expect(replay.status).toBe(201);
  expect((replay.body as Record<string, unknown>).replayed).toBe(true);
  expect(usagesOf(ctx.db, promo.id as number).length).toBe(1);
  expect(orderRow(ctx.db, order.id as number).promo_discount).toBe(10000);
  const detail = await mustGetPromo(ctx.owner, promo.id as number);
  expect(detail.used_count).toBe(1);
});

test('AC-4 idempotency ap ma bang idempotency_key trong body gui lai replayed true khong ghi usage moi', async () => {
  const ctx = await promoCtx();
  const promo = await mustCreatePromo(ctx.owner, { code: 'IDEMBD', type: 'percent', value: 10 });
  const order = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  const first = await applyPromoRaw(ctx.owner, order.id as number, 'IDEMBD', { bodyKey: 'idem-body-1' });
  expect(first.status).toBe(201);
  const replay = await applyPromoRaw(ctx.owner, order.id as number, 'IDEMBD', { bodyKey: 'idem-body-1' });
  expect(replay.status).toBe(201);
  expect((replay.body as Record<string, unknown>).replayed).toBe(true);
  expect(usagesOf(ctx.db, promo.id as number).length).toBe(1);
  expect(orderRow(ctx.db, order.id as number).promo_discount).toBe(10000);
});

test('AC-4 lich su dung ma tao ap huy ap lai dung thu tu du buoc khong dong thua', async () => {
  const ctx = await promoCtx();
  const promo = await mustCreatePromo(ctx.owner, { code: 'LEDGER1', type: 'percent', value: 10 });
  const order1 = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  await mustApplyPromo(ctx.owner, order1.id as number, 'LEDGER1');
  await mustTransition(ctx.owner, order1.id as number, 'cancel');
  const order2 = await mustOrderWithTotal(ctx, [{ variant_id: ctx.v1, qty: 1 }]);
  await mustApplyPromo(ctx.owner, order2.id as number, 'LEDGER1');
  const usages = usagesOf(ctx.db, promo.id as number);
  expect(usages.length).toBe(2);
  expect(usages[0].order_id).toBe(order1.id);
  expect(usages[0].status).toBe('released');
  expect(usages[0].discount_amount).toBe(10000);
  expect(usages[0].released_at).toBeTruthy();
  expect(usages[1].order_id).toBe(order2.id);
  expect(usages[1].status).toBe('used');
  expect(usages[1].discount_amount).toBe(10000);
  expect(usages[1].released_at).toBeNull();
  const createdAts = usages.map((u) => String(u.created_at));
  expect(createdAts[0] <= createdAts[1]).toBe(true);
  const detail = await mustGetPromo(ctx.owner, promo.id as number);
  expect(detail.used_count).toBe(1);
});
