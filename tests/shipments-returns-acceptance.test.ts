import { test, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { migrate, openDb, tableNames } from '../src/db.js';
import { can, type Action, type Role } from '../src/rbac.js';
import { seed } from '../src/seed.js';
import { FakeShippingAdapter } from '../src/adapters/index.js';
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
  const warehouseNullId = await addUser(db, orgId, branch1, 'kho-null@example.local', 'warehouse');
  const accountantId = await addUser(db, orgId, branch1, 'ketoan@example.local', 'accountant');
  const sales2Id = await addUser(db, orgId, branch2, 'sales2@example.local', 'sales');
  const { orgBId, branchBId } = await addOrgB(db);
  const owner = await ownerAgent(app, seeded);
  const sales = await salesAgent(app, seeded);
  const manager = await loginAgent(app, 'manager@example.local', 'gia-lap-123');
  const warehouse = await loginAgent(app, 'kho@example.local', 'gia-lap-123');
  const warehouseNull = await loginAgent(app, 'kho-null@example.local', 'gia-lap-123');
  const accountant = await loginAgent(app, 'ketoan@example.local', 'gia-lap-123');
  const sales2 = await loginAgent(app, 'sales2@example.local', 'gia-lap-123');
  const ownerB = await loginAgent(app, 'owner-b@example.local', 'gia-lap-123');
  return {
    db, app, seeded, orgId, branch1, branch2, orgBId, branchBId,
    managerId, warehouseId, warehouseNullId, accountantId, sales2Id,
    owner, sales, manager, warehouse, warehouseNull, accountant, sales2, ownerB,
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
  const code = (overrides.code as string) ?? `SP-SHIP-${rand()}`;
  const res = await agent.post('/api/products').send({
    code,
    name: 'San pham giao/tra gia lap',
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
    sku: `SKU-SHIP-${rand()}`,
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
 * Boi canh giao/tra: 2 kho (A, B) + 2 san pham/bien the (V1 gia 100000,
 * V2 gia 50000) + ton: whA V1 50 / V2 30, whB V1 100.
 */
async function shipCtx() {
  const ctx = await fullCtx();
  const whA = await createWarehouse(ctx.owner, 'Kho A');
  const whB = await createWarehouse(ctx.owner, 'Kho B');
  const p1 = await createProduct(ctx.owner, { name: 'SP giao 1', price: 100000, min_stock: 0 });
  const v1 = await createVariant(ctx.owner, p1.id);
  const p2 = await createProduct(ctx.owner, { name: 'SP giao 2', price: 50000, min_stock: 0 });
  const v2 = await createVariant(ctx.owner, p2.id);
  await mustStockIn(ctx.owner, whA.id as number, v1, 50);
  await mustStockIn(ctx.owner, whA.id as number, v2, 30);
  await mustStockIn(ctx.owner, whB.id as number, v1, 100);
  return { ...ctx, whA, whB, p1, v1, p2, v2 };
}

type Ctx = Awaited<ReturnType<typeof shipCtx>>;

function asOrder(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (body.order as Record<string, unknown>) ?? body;
}

function asShipment(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (body.shipment as Record<string, unknown>) ?? body;
}

function asReturn(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (body.return as Record<string, unknown>) ?? body;
}

function asList(res: { body: unknown }, keys: string[]): Record<string, unknown>[] {
  const body = res.body as Record<string, unknown>;
  if (Array.isArray(res.body)) return res.body as Record<string, unknown>[];
  for (const key of keys) {
    if (Array.isArray(body[key])) return body[key] as Record<string, unknown>[];
  }
  return [];
}

function asSummary(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (body.order_summary as Record<string, unknown>) ??
    (body.summary as Record<string, unknown>) ?? {};
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

/** Don completed kho A: 2 x V1 = 200000 (mac dinh). */
async function mustCompletedOrder(
  ctx: Ctx,
  agent: Agent = ctx.owner,
  items?: { variant_id: number; qty: number }[],
): Promise<Record<string, unknown>> {
  const order = await mustCreateOrder(agent, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: items ?? [{ variant_id: ctx.v1, qty: 2 }],
  });
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

async function mustCreateShipment(
  agent: Agent,
  orderId: number,
  body: Record<string, unknown> = {},
  idempotencyKey?: string,
): Promise<Record<string, unknown>> {
  const req = agent.post(`/api/orders/${orderId}/shipments`);
  if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
  const res = await req.send({ carrier: 'GHN-fake', destination: 'TP.HCM', ...body });
  expect(res.status).toBe(201);
  const shipment = asShipment(res);
  expect(shipment.id).toBeDefined();
  return shipment;
}

async function mustUpdateShipment(
  agent: Agent,
  shipmentId: number,
  body: Record<string, unknown>,
  idempotencyKey?: string,
) {
  const req = agent.post(`/api/shipments/${shipmentId}/status`);
  if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
  return req.send(body);
}

async function mustCreateReturn(
  agent: Agent,
  orderId: number,
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<Record<string, unknown>> {
  const req = agent.post(`/api/orders/${orderId}/returns`);
  if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
  const res = await req.send(body);
  expect(res.status).toBe(201);
  const ret = asReturn(res);
  expect(ret.id).toBeDefined();
  return ret;
}

/** Luong tra day du toi received: tao -> duyet -> nhan; tra return da nhan. */
async function mustReceivedReturn(
  ctx: Ctx,
  orderId: number,
  items: { variant_id: number; qty: number; condition: string }[],
): Promise<Record<string, unknown>> {
  const ret = await mustCreateReturn(ctx.owner, orderId, {
    items,
    reason: 'khach doi y gia lap',
  });
  const approved = await ctx.owner.post(`/api/returns/${ret.id as number}/approve`).send({});
  expect(approved.status).toBe(200);
  expect(asReturn(approved).status).toBe('approved');
  const received = await ctx.owner.post(`/api/returns/${ret.id as number}/receive`).send({});
  expect(received.status).toBe(200);
  expect(asReturn(received).status).toBe('received');
  return asReturn(received);
}

function shipmentEvents(db: Db, shipmentId: number): Record<string, unknown>[] {
  return db
    .prepare('SELECT * FROM shipment_events WHERE shipment_id = ? ORDER BY id')
    .all(shipmentId) as Record<string, unknown>[];
}

function returnEvents(db: Db, returnId: number): Record<string, unknown>[] {
  return db
    .prepare('SELECT * FROM return_events WHERE return_id = ? ORDER BY id')
    .all(returnId) as Record<string, unknown>[];
}

function shipmentRow(db: Db, id: number): Record<string, unknown> {
  return db.prepare('SELECT * FROM shipments WHERE id = ?').get(id) as Record<string, unknown>;
}

function returnRow(db: Db, id: number): Record<string, unknown> {
  return db.prepare('SELECT * FROM returns WHERE id = ?').get(id) as Record<string, unknown>;
}

function shipmentsOfOrder(db: Db, orderId: number): Record<string, unknown>[] {
  return db
    .prepare('SELECT * FROM shipments WHERE order_id = ? ORDER BY id')
    .all(orderId) as Record<string, unknown>[];
}

function returnsOfOrder(db: Db, orderId: number): Record<string, unknown>[] {
  return db
    .prepare('SELECT * FROM returns WHERE order_id = ? ORDER BY id')
    .all(orderId) as Record<string, unknown>[];
}

function refundRowsByReason(db: Db, reason: string): Record<string, unknown>[] {
  return db
    .prepare('SELECT * FROM refunds WHERE reason = ? ORDER BY id')
    .all(reason) as Record<string, unknown>[];
}

function movementRows(db: Db, where = '1 = 1'): Record<string, unknown>[] {
  return db
    .prepare(`SELECT * FROM stock_movements WHERE ${where} ORDER BY id`)
    .all() as Record<string, unknown>[];
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

async function levelOf(
  agent: Agent,
  warehouseId: number,
  variantId: number,
): Promise<Record<string, unknown> | null> {
  const res = await agent.get(
    `/api/stock/levels?warehouse_id=${warehouseId}&variant_id=${variantId}`,
  );
  expect(res.status).toBe(200);
  const list = asList(res, ['levels', 'items', 'rows', 'data']);
  return (
    list.find((r) => r.warehouse_id === warehouseId && r.variant_id === variantId) ?? null
  );
}

/** Actor / Target cho can(): dung branchId + warehouseId cua don. */
function shipActor(
  id: number,
  role: Role,
  branchId: number | null = null,
  warehouseId: number | null = null,
) {
  return { id, orgId: 1, branchId, role, warehouseId };
}

function shipTarget(orgId = 1, branchId?: number | null, warehouseId?: number | null) {
  return { orgId, branchId, warehouseId };
}

// ---------- AC-1: giao hang + schema giao/tra ----------

test('AC-1 migration 012 tao du 5 bang giao/tra + cot + UNIQUE/CHECK, giu du lieu cu', () => {
  const { db, seeded } = freshApp();
  const names = tableNames(db);
  for (const t of ['shipments', 'shipment_events', 'returns', 'return_items', 'return_events']) {
    expect(names).toContain(t);
  }
  const versions = (
    db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
      version: number;
    }[]
  ).map((r) => r.version);
  expect(versions).toContain(12);
  const cols = (table: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  for (const c of [
    'org_id', 'order_id', 'carrier', 'tracking_code', 'destination', 'fee', 'eta_days',
    'status', 'created_at', 'updated_at',
  ]) {
    expect(cols('shipments')).toContain(c);
  }
  for (const c of ['shipment_id', 'event_type', 'actor_id', 'detail', 'created_at']) {
    expect(cols('shipment_events')).toContain(c);
  }
  for (const c of [
    'org_id', 'order_id', 'code', 'reason', 'status', 'reviewed_by', 'received_by',
    'review_reason', 'created_at', 'updated_at',
  ]) {
    expect(cols('returns')).toContain(c);
  }
  for (const c of ['return_id', 'variant_id', 'qty', 'condition', 'unit_price']) {
    expect(cols('return_items')).toContain(c);
  }
  for (const c of ['return_id', 'event_type', 'actor_id', 'detail', 'created_at']) {
    expect(cols('return_events')).toContain(c);
  }
  const shipSql = (
    db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'shipments'")
      .get() as { sql: string }
  ).sql;
  expect(shipSql).toContain('tracking_code');
  expect(shipSql).toContain('UNIQUE');
  expect(shipSql).toContain("'requested'");
  expect(shipSql).toContain("'delivered'");
  const retSql = (
    db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'returns'").get() as {
      sql: string;
    }
  ).sql;
  expect(retSql).toContain('code');
  expect(retSql).toContain('UNIQUE');
  expect(retSql).toContain("'refunded'");
  // Du lieu cu van con: seed org + 2 user + san pham/kho mau (R-14).
  const users = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  expect(users.c).toBeGreaterThanOrEqual(2);
  expect(seeded.orgId).toBeGreaterThan(0);
  const seedVariant = db
    .prepare("SELECT id FROM product_variants WHERE sku = 'SKU-SEED-01-M'")
    .get() as { id: number };
  const khoChinh = db
    .prepare("SELECT id FROM warehouses WHERE name = 'Kho Chính'")
    .get() as { id: number };
  const level = db
    .prepare('SELECT on_hand FROM stock_levels WHERE warehouse_id = ? AND variant_id = ?')
    .get(khoChinh.id, seedVariant.id) as { on_hand: number };
  expect(level.on_hand).toBe(3);
});

test('AC-1 yeu cau giao 201 requested, fee/eta tu quote, ma van don deterministic, 1 event + 1 audit', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  const quote = new FakeShippingAdapter().quote(1000, 'TP.HCM');
  expect(quote.simulated).toBe(true);
  expect(quote.fee).toBe(25000);
  expect(quote.etaDays).toBe(2);
  const res = await ctx.owner
    .post(`/api/orders/${order.id as number}/shipments`)
    .send({ carrier: 'GHN-fake', destination: 'TP.HCM' });
  expect(res.status).toBe(201);
  const shipment = asShipment(res);
  expect(shipment.status).toBe('requested');
  expect(shipment.carrier).toBe('GHN-fake');
  expect(shipment.destination).toBe('TP.HCM');
  expect(shipment.fee).toBe(quote.fee);
  expect(shipment.eta_days).toBe(quote.etaDays);
  expect(shipment.tracking_code).toMatch(/^FAKE-TRK-[0-9A-F]{12}$/);
  expect(shipment.order_id).toBe(order.id);
  const events = shipmentEvents(ctx.db, shipment.id as number);
  expect(events.map((e) => e.event_type)).toEqual(['created']);
  const apiEvents = (shipment.events as Record<string, unknown>[] | undefined) ?? [];
  expect(apiEvents.map((e) => e.event_type)).toContain('created');
  const audits = auditRows(ctx.db, ctx.orgId).filter(
    (r) => r.detail.target_shipment_id === shipment.id,
  );
  expect(audits.length).toBe(1);
  expect(audits[0]?.detail.target_order_id).toBe(order.id);
  expect(audits[0]?.detail.order_code).toBe(order.code);
  expect(audits[0]?.detail.tracking_code).toBe(shipment.tracking_code);
  // Giao hang KHONG doi trang thai don.
  const detail = await ctx.owner.get(`/api/orders/${order.id as number}`);
  expect(asOrder(detail).status).toBe('completed');
});

test('AC-1 chi don completed moi duoc giao: draft/confirmed/cancelled -> 400', async () => {
  const ctx = await shipCtx();
  const draft = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  expect(draft.status).toBe('draft');
  const rDraft = await ctx.owner
    .post(`/api/orders/${draft.id as number}/shipments`)
    .send({ carrier: 'GHN-fake', destination: 'TP.HCM' });
  expect(rDraft.status).toBe(400);
  expect(shipmentsOfOrder(ctx.db, draft.id as number)).toHaveLength(0);
  const confirmed = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  await mustTransition(ctx.owner, confirmed.id as number, 'confirm');
  const rConfirmed = await ctx.owner
    .post(`/api/orders/${confirmed.id as number}/shipments`)
    .send({ carrier: 'GHN-fake', destination: 'TP.HCM' });
  expect(rConfirmed.status).toBe(400);
  const cancelled = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  await mustTransition(ctx.owner, cancelled.id as number, 'cancel');
  const rCancelled = await ctx.owner
    .post(`/api/orders/${cancelled.id as number}/shipments`)
    .send({ carrier: 'GHN-fake', destination: 'TP.HCM' });
  expect(rCancelled.status).toBe(400);
  expect(shipmentsOfOrder(ctx.db, cancelled.id as number)).toHaveLength(0);
});

test('AC-1 moi don toi da 1 shipment chua cuoi: yeu cau lan 2 -> 400, khong tao moi', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  await mustCreateShipment(ctx.owner, order.id as number);
  const second = await ctx.owner
    .post(`/api/orders/${order.id as number}/shipments`)
    .send({ carrier: 'GHN-fake', destination: 'TP.HCM' });
  expect(second.status).toBe(400);
  expect(shipmentsOfOrder(ctx.db, order.id as number)).toHaveLength(1);
  // Sau khi shipment dau in_transit (van chua cuoi) van khong giao them duoc.
  const first = shipmentsOfOrder(ctx.db, order.id as number)[0] as Record<string, unknown>;
  const upd = await mustUpdateShipment(ctx.owner, first.id as number, { status: 'in_transit' });
  expect(upd.status).toBe(200);
  const third = await ctx.owner
    .post(`/api/orders/${order.id as number}/shipments`)
    .send({ carrier: 'GHN-fake', destination: 'TP.HCM' });
  expect(third.status).toBe(400);
  expect(shipmentsOfOrder(ctx.db, order.id as number)).toHaveLength(1);
});

test('AC-1 giao lai sau khi shipment cu failed: 201, ma van don moi khac ma cu', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  const first = await mustCreateShipment(ctx.owner, order.id as number);
  const failed = await mustUpdateShipment(ctx.owner, first.id as number, {
    status: 'failed',
    reason: 'khach vang nha gia lap',
  });
  expect(failed.status).toBe(200);
  const second = await mustCreateShipment(ctx.owner, order.id as number);
  expect(second.status).toBe('requested');
  expect(second.tracking_code).not.toBe(first.tracking_code);
  expect(shipmentsOfOrder(ctx.db, order.id as number)).toHaveLength(2);
});

test('AC-1 FakeShippingAdapter.trackingRef deterministic: cung input cung ma, khac shipment khac ma', () => {
  const adapter = new FakeShippingAdapter();
  const a = adapter.trackingRef('DH-20261127-0001', 'GHN-fake', 7);
  const b = adapter.trackingRef('DH-20261127-0001', 'GHN-fake', 7);
  const c = adapter.trackingRef('DH-20261127-0001', 'GHN-fake', 8);
  const d = adapter.trackingRef('DH-20261127-0001', 'GHTK-fake', 7);
  expect(a).toMatch(/^FAKE-TRK-[0-9A-F]{12}$/);
  expect(b).toBe(a);
  expect(c).not.toBe(a);
  expect(d).not.toBe(a);
});

test('AC-1 idempotency yeu cau giao: gui lai cung key -> replayed true, khong tao shipment moi', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  const first = await mustCreateShipment(ctx.owner, order.id as number, {}, 'ship-key-1');
  expect((first as Record<string, unknown>).replayed ?? false).toBe(false);
  const res = await ctx.owner
    .post(`/api/orders/${order.id as number}/shipments`)
    .set('Idempotency-Key', 'ship-key-1')
    .send({ carrier: 'GHN-fake', destination: 'TP.HCM' });
  expect(res.status).toBe(201);
  expect((res.body as Record<string, unknown>).replayed).toBe(true);
  expect(asShipment(res).id).toBe(first.id);
  expect(shipmentsOfOrder(ctx.db, order.id as number)).toHaveLength(1);
  // Key khac nhau thi thuc thi binh thuong — nhung don da co shipment chua
  // cuoi nen yeu cau moi (key khac) bi 400 theo luat 1 shipment chua cuoi.
  const other = await ctx.owner
    .post(`/api/orders/${order.id as number}/shipments`)
    .set('Idempotency-Key', 'ship-key-2')
    .send({ carrier: 'GHN-fake', destination: 'TP.HCM' });
  expect(other.status).toBe(400);
});

test('AC-1 yeu cau giao sai dau vao 400, don khong ton tai 404, ngoai org 403', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  const emptyCarrier = await ctx.owner
    .post(`/api/orders/${order.id as number}/shipments`)
    .send({ carrier: '   ', destination: 'TP.HCM' });
  expect(emptyCarrier.status).toBe(400);
  const emptyDest = await ctx.owner
    .post(`/api/orders/${order.id as number}/shipments`)
    .send({ carrier: 'GHN-fake', destination: '' });
  expect(emptyDest.status).toBe(400);
  expect(shipmentsOfOrder(ctx.db, order.id as number)).toHaveLength(0);
  const missing = await ctx.owner
    .post('/api/orders/999999/shipments')
    .send({ carrier: 'GHN-fake', destination: 'TP.HCM' });
  expect(missing.status).toBe(404);
  const crossOrg = await ctx.ownerB
    .post(`/api/orders/${order.id as number}/shipments`)
    .send({ carrier: 'GHN-fake', destination: 'TP.HCM' });
  expect(crossOrg.status).toBe(403);
  expect(shipmentsOfOrder(ctx.db, order.id as number)).toHaveLength(0);
});

test('AC-1 phi theo khoi luong tong so luong x 500g + ETA Ha Noi 1 ngay, don van completed', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx, ctx.owner, [
    { variant_id: ctx.v1, qty: 2 },
    { variant_id: ctx.v2, qty: 1 },
  ]);
  // 3 mon x 500g = 1500g -> phi 15000 + 3 x 5000 = 30000; dich Ha Noi -> 1 ngay.
  const shipment = await mustCreateShipment(ctx.owner, order.id as number, {
    destination: 'Hà Nội',
  });
  expect(shipment.fee).toBe(30000);
  expect(shipment.eta_days).toBe(1);
  const detail = await ctx.owner.get(`/api/orders/${order.id as number}`);
  expect(asOrder(detail).status).toBe('completed');
});

// ---------- AC-2: cap nhat trang thai giao hang ----------

test('AC-2 in_transit roi delivered 200, events theo thu tu thoi gian tang dan', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  const shipment = await mustCreateShipment(ctx.owner, order.id as number);
  const r1 = await mustUpdateShipment(ctx.owner, shipment.id as number, { status: 'in_transit' });
  expect(r1.status).toBe(200);
  expect(asShipment(r1).status).toBe('in_transit');
  const r2 = await mustUpdateShipment(ctx.owner, shipment.id as number, { status: 'delivered' });
  expect(r2.status).toBe(200);
  expect(asShipment(r2).status).toBe('delivered');
  const events = shipmentEvents(ctx.db, shipment.id as number);
  expect(events.map((e) => e.event_type)).toEqual(['created', 'in_transit', 'delivered']);
  const detail = await ctx.owner.get(`/api/shipments/${shipment.id as number}`);
  expect(detail.status).toBe(200);
  const apiEvents = ((asShipment(detail).events as Record<string, unknown>[] | undefined) ?? []).map(
    (e) => e.event_type,
  );
  expect(apiEvents).toEqual(['created', 'in_transit', 'delivered']);
});

test('AC-2 gui lai cung trang thai 200 no-op: khong tao event moi, so event khong doi', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  const shipment = await mustCreateShipment(ctx.owner, order.id as number);
  await mustUpdateShipment(ctx.owner, shipment.id as number, { status: 'in_transit' });
  const before = shipmentEvents(ctx.db, shipment.id as number);
  expect(before).toHaveLength(2);
  const r1 = await mustUpdateShipment(ctx.owner, shipment.id as number, { status: 'in_transit' });
  expect(r1.status).toBe(200);
  expect(asShipment(r1).status).toBe('in_transit');
  const r2 = await mustUpdateShipment(ctx.owner, shipment.id as number, { status: 'in_transit' });
  expect(r2.status).toBe(200);
  const after = shipmentEvents(ctx.db, shipment.id as number);
  expect(after).toHaveLength(2);
  expect(after.map((e) => e.event_type)).toEqual(['created', 'in_transit']);
  // Gui lap cung trang thai cung khong ghi audit moi cho lan lap.
  const audits = auditRows(ctx.db, ctx.orgId).filter(
    (r) => r.detail.target_shipment_id === shipment.id && r.detail.to_status === 'in_transit',
  );
  expect(audits.length).toBe(1);
});

test('AC-2 chuyen sai thu tu requested -> delivered 400, khong doi gi, khong ghi event', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  const shipment = await mustCreateShipment(ctx.owner, order.id as number);
  const res = await mustUpdateShipment(ctx.owner, shipment.id as number, { status: 'delivered' });
  expect(res.status).toBe(400);
  expect(shipmentRow(ctx.db, shipment.id as number).status).toBe('requested');
  expect(shipmentEvents(ctx.db, shipment.id as number)).toHaveLength(1);
});

test('AC-2 khong chuyen nguoc tu delivered/failed: delivered -> in_transit 400, failed -> in_transit 400', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  const s1 = await mustCreateShipment(ctx.owner, order.id as number);
  await mustUpdateShipment(ctx.owner, s1.id as number, { status: 'in_transit' });
  await mustUpdateShipment(ctx.owner, s1.id as number, { status: 'delivered' });
  const back = await mustUpdateShipment(ctx.owner, s1.id as number, { status: 'in_transit' });
  expect(back.status).toBe(400);
  expect(shipmentRow(ctx.db, s1.id as number).status).toBe('delivered');
  expect(shipmentEvents(ctx.db, s1.id as number)).toHaveLength(3);
  const order2 = await mustCompletedOrder(ctx);
  const s2 = await mustCreateShipment(ctx.owner, order2.id as number);
  await mustUpdateShipment(ctx.owner, s2.id as number, {
    status: 'failed',
    reason: 'mat hang gia lap',
  });
  const reopen = await mustUpdateShipment(ctx.owner, s2.id as number, { status: 'in_transit' });
  expect(reopen.status).toBe(400);
  expect(shipmentRow(ctx.db, s2.id as number).status).toBe('failed');
});

test('AC-2 failed thieu reason 400; co reason 200 va la trang thai cuoi', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  const shipment = await mustCreateShipment(ctx.owner, order.id as number);
  const noReason = await mustUpdateShipment(ctx.owner, shipment.id as number, { status: 'failed' });
  expect(noReason.status).toBe(400);
  const emptyReason = await mustUpdateShipment(ctx.owner, shipment.id as number, {
    status: 'failed',
    reason: '   ',
  });
  expect(emptyReason.status).toBe(400);
  expect(shipmentRow(ctx.db, shipment.id as number).status).toBe('requested');
  const ok = await mustUpdateShipment(ctx.owner, shipment.id as number, {
    status: 'failed',
    reason: 'khach tu choi nhan gia lap',
  });
  expect(ok.status).toBe(200);
  expect(asShipment(ok).status).toBe('failed');
  expect(shipmentEvents(ctx.db, shipment.id as number).map((e) => e.event_type)).toEqual([
    'created',
    'failed',
  ]);
});

test('AC-2 cap nhat dong thoi in_transit roi delivered: khong ghi nhan sai thu tu', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  const shipment = await mustCreateShipment(ctx.owner, order.id as number);
  const [rIn, rDel] = await Promise.all([
    mustUpdateShipment(ctx.owner, shipment.id as number, { status: 'in_transit' }),
    mustUpdateShipment(ctx.owner, shipment.id as number, { status: 'delivered' }),
  ]);
  // delivered chi thanh cong khi in_transit da thanh cong truoc (dung thu tu).
  if (rDel.status === 200) expect(rIn.status).toBe(200);
  expect([200, 400]).toContain(rIn.status);
  expect([200, 400]).toContain(rDel.status);
  const events = shipmentEvents(ctx.db, shipment.id as number).map((e) => e.event_type);
  expect(events).toEqual(['created', 'in_transit', 'delivered'].slice(0, events.length));
  const finalStatus = shipmentRow(ctx.db, shipment.id as number).status as string;
  expect(finalStatus).toBe(events[events.length - 1]);
});

test('AC-2 cap nhat trang thai 404/403/400 + shipment_events append-only', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  const shipment = await mustCreateShipment(ctx.owner, order.id as number);
  const missing = await mustUpdateShipment(ctx.owner, 999999, { status: 'in_transit' });
  expect(missing.status).toBe(404);
  const crossOrg = await mustUpdateShipment(ctx.ownerB, shipment.id as number, {
    status: 'in_transit',
  });
  expect(crossOrg.status).toBe(403);
  const badStatus = await mustUpdateShipment(ctx.owner, shipment.id as number, { status: 'bay' });
  expect(badStatus.status).toBe(400);
  expect(shipmentRow(ctx.db, shipment.id as number).status).toBe('requested');
  // Lich su append-only: sua/xoa event -> 404/405, lich su van nguyen.
  const patch = await ctx.owner.patch(`/api/shipments/${shipment.id as number}/events/1`).send({
    event_type: 'delivered',
  });
  expect([404, 405]).toContain(patch.status);
  const del = await ctx.owner.delete(`/api/shipments/${shipment.id as number}/events/1`);
  expect([404, 405]).toContain(del.status);
  expect(shipmentEvents(ctx.db, shipment.id as number)).toHaveLength(1);
});

// ---------- AC-3: tra hang ----------

test('AC-3 yeu cau tra 201 requested, ma TH-YYYYMMDD-NNNN, unit_price snapshot, 1 event + 1 audit', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  const res = await ctx.owner.post(`/api/orders/${order.id as number}/returns`).send({
    items: [{ variant_id: ctx.v1, qty: 1, condition: 'resalable' }],
    reason: 'khach doi size gia lap',
  });
  expect(res.status).toBe(201);
  const ret = asReturn(res);
  expect(ret.status).toBe('requested');
  expect(ret.code).toMatch(/^TH-\d{8}-\d{4}$/);
  expect(ret.order_id).toBe(order.id);
  expect(ret.reason).toBe('khach doi size gia lap');
  const items = (ret.items as Record<string, unknown>[] | undefined) ?? [];
  expect(items).toHaveLength(1);
  expect(items[0]?.variant_id).toBe(ctx.v1);
  expect(items[0]?.qty).toBe(1);
  expect(items[0]?.condition).toBe('resalable');
  // Snapshot gia tu order_items, khong tin client (client khong gui gia).
  expect(items[0]?.unit_price).toBe(100000);
  const events = returnEvents(ctx.db, ret.id as number);
  expect(events.map((e) => e.event_type)).toEqual(['created']);
  const apiEvents = (ret.events as Record<string, unknown>[] | undefined) ?? [];
  expect(apiEvents.map((e) => e.event_type)).toContain('created');
  const audits = auditRows(ctx.db, ctx.orgId).filter(
    (r) => r.detail.target_return_id === ret.id,
  );
  expect(audits.length).toBe(1);
  expect(audits[0]?.detail.target_order_id).toBe(order.id);
  expect(audits[0]?.detail.order_code).toBe(order.code);
  expect(audits[0]?.detail.return_code).toBe(ret.code);
  // Tra hang KHONG doi trang thai don.
  const detail = await ctx.owner.get(`/api/orders/${order.id as number}`);
  expect(asOrder(detail).status).toBe('completed');
});

test('AC-3 yeu cau tra sai: don chua completed, bien the ngoai don, vuot tich luy, trung bien the, dau vao sai', async () => {
  const ctx = await shipCtx();
  const draft = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  const rDraft = await ctx.owner.post(`/api/orders/${draft.id as number}/returns`).send({
    items: [{ variant_id: ctx.v1, qty: 1, condition: 'resalable' }],
    reason: 'tra gia lap',
  });
  expect(rDraft.status).toBe(400);
  const order = await mustCompletedOrder(ctx);
  const notInOrder = await ctx.owner.post(`/api/orders/${order.id as number}/returns`).send({
    items: [{ variant_id: ctx.v2, qty: 1, condition: 'resalable' }],
    reason: 'tra gia lap',
  });
  expect(notInOrder.status).toBe(400);
  // Tich luy: yeu cau 1 (qty 1, dang cho duyet) + yeu cau 2 (qty 2) = 3 > 2 da dat.
  const first = await mustCreateReturn(ctx.owner, order.id as number, {
    items: [{ variant_id: ctx.v1, qty: 1, condition: 'resalable' }],
    reason: 'tra 1 gia lap',
  });
  expect(first.status).toBe('requested');
  const over = await ctx.owner.post(`/api/orders/${order.id as number}/returns`).send({
    items: [{ variant_id: ctx.v1, qty: 2, condition: 'resalable' }],
    reason: 'tra vuot gia lap',
  });
  expect(over.status).toBe(400);
  expect(returnsOfOrder(ctx.db, order.id as number)).toHaveLength(1);
  const dup = await ctx.owner.post(`/api/orders/${order.id as number}/returns`).send({
    items: [
      { variant_id: ctx.v1, qty: 1, condition: 'resalable' },
      { variant_id: ctx.v1, qty: 1, condition: 'damaged' },
    ],
    reason: 'trung bien the gia lap',
  });
  expect(dup.status).toBe(400);
  const emptyItems = await ctx.owner.post(`/api/orders/${order.id as number}/returns`).send({
    items: [],
    reason: 'tra gia lap',
  });
  expect(emptyItems.status).toBe(400);
  const emptyReason = await ctx.owner.post(`/api/orders/${order.id as number}/returns`).send({
    items: [{ variant_id: ctx.v1, qty: 1, condition: 'resalable' }],
    reason: '   ',
  });
  expect(emptyReason.status).toBe(400);
  const zeroQty = await ctx.owner.post(`/api/orders/${order.id as number}/returns`).send({
    items: [{ variant_id: ctx.v1, qty: 0, condition: 'resalable' }],
    reason: 'tra gia lap',
  });
  expect(zeroQty.status).toBe(400);
  const badCondition = await ctx.owner.post(`/api/orders/${order.id as number}/returns`).send({
    items: [{ variant_id: ctx.v1, qty: 1, condition: 'lost' }],
    reason: 'tra gia lap',
  });
  expect(badCondition.status).toBe(400);
  const missing = await ctx.owner.post('/api/orders/999999/returns').send({
    items: [{ variant_id: ctx.v1, qty: 1, condition: 'resalable' }],
    reason: 'tra gia lap',
  });
  expect(missing.status).toBe(404);
  const crossOrg = await ctx.ownerB.post(`/api/orders/${order.id as number}/returns`).send({
    items: [{ variant_id: ctx.v1, qty: 1, condition: 'resalable' }],
    reason: 'tra gia lap',
  });
  expect(crossOrg.status).toBe(403);
  expect(returnsOfOrder(ctx.db, order.id as number)).toHaveLength(1);
});

test('AC-3 duyet/tu choi: approve 200, reject sau approve 400, reject thieu reason 400, approve tu trang thai khac 400', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  const ret = await mustCreateReturn(ctx.owner, order.id as number, {
    items: [{ variant_id: ctx.v1, qty: 1, condition: 'resalable' }],
    reason: 'tra gia lap',
  });
  const approved = await ctx.owner.post(`/api/returns/${ret.id as number}/approve`).send({});
  expect(approved.status).toBe(200);
  expect(asReturn(approved).status).toBe('approved');
  const rejectAfterApprove = await ctx.owner
    .post(`/api/returns/${ret.id as number}/reject`)
    .send({ reason: 'muon qua gia lap' });
  expect(rejectAfterApprove.status).toBe(400);
  expect(returnRow(ctx.db, ret.id as number).status).toBe('approved');
  // Reject thieu reason -> 400 tren yeu cau moi.
  const ret2 = await mustCreateReturn(ctx.owner, order.id as number, {
    items: [{ variant_id: ctx.v1, qty: 1, condition: 'damaged' }],
    reason: 'tra hong gia lap',
  });
  const rejectNoReason = await ctx.owner
    .post(`/api/returns/${ret2.id as number}/reject`)
    .send({});
  expect(rejectNoReason.status).toBe(400);
  const rejectEmpty = await ctx.owner
    .post(`/api/returns/${ret2.id as number}/reject`)
    .send({ reason: '  ' });
  expect(rejectEmpty.status).toBe(400);
  expect(returnRow(ctx.db, ret2.id as number).status).toBe('requested');
  // Approve tu trang thai khac: approved roi thi approve lai 400; received roi approve 400.
  const approveAgain = await ctx.owner.post(`/api/returns/${ret.id as number}/approve`).send({});
  expect(approveAgain.status).toBe(400);
  const received = await ctx.owner.post(`/api/returns/${ret.id as number}/receive`).send({});
  expect(received.status).toBe(200);
  const approveReceived = await ctx.owner
    .post(`/api/returns/${ret.id as number}/approve`)
    .send({});
  expect(approveReceived.status).toBe(400);
  // Return khong ton tai 404, ngoai org 403.
  const missing = await ctx.owner.post('/api/returns/999999/approve').send({});
  expect(missing.status).toBe(404);
  const crossOrg = await ctx.ownerB.post(`/api/returns/${ret2.id as number}/approve`).send({});
  expect(crossOrg.status).toBe(403);
});

test('AC-3 tu choi 200 + ly do, yeu cau bi tu choi khong tinh vao tong tra tich luy', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  const ret = await mustCreateReturn(ctx.owner, order.id as number, {
    items: [{ variant_id: ctx.v1, qty: 1, condition: 'resalable' }],
    reason: 'tra gia lap',
  });
  const rejected = await ctx.owner
    .post(`/api/returns/${ret.id as number}/reject`)
    .send({ reason: 'hang da qua su dung gia lap' });
  expect(rejected.status).toBe(200);
  expect(asReturn(rejected).status).toBe('rejected');
  const row = returnRow(ctx.db, ret.id as number);
  expect(row.review_reason).toBe('hang da qua su dung gia lap');
  expect(returnEvents(ctx.db, ret.id as number).map((e) => e.event_type)).toEqual([
    'created',
    'rejected',
  ]);
  // Sau khi bi tu choi, van tra duoc het 2 cai (yeu cau cu khong cong nua).
  const full = await mustCreateReturn(ctx.owner, order.id as number, {
    items: [{ variant_id: ctx.v1, qty: 2, condition: 'resalable' }],
    reason: 'tra lai gia lap',
  });
  expect(full.status).toBe('requested');
});

test('AC-3 nhan hang: resalable nhap lai kho dung so, damaged khong nhap kho, khong ghi movement', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx, ctx.owner, [
    { variant_id: ctx.v1, qty: 2 },
    { variant_id: ctx.v2, qty: 1 },
  ]);
  const beforeV1 = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  const beforeV2 = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v2);
  expect(beforeV1?.on_hand).toBe(48);
  expect(beforeV2?.on_hand).toBe(29);
  const ret = await mustCreateReturn(ctx.owner, order.id as number, {
    items: [
      { variant_id: ctx.v1, qty: 1, condition: 'resalable' },
      { variant_id: ctx.v2, qty: 1, condition: 'damaged' },
    ],
    reason: '1 doi duoc 1 hong gia lap',
  });
  await ctx.owner.post(`/api/returns/${ret.id as number}/approve`).send({});
  const res = await ctx.owner.post(`/api/returns/${ret.id as number}/receive`).send({});
  expect(res.status).toBe(200);
  expect(asReturn(res).status).toBe('received');
  const afterV1 = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  const afterV2 = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v2);
  expect(afterV1?.on_hand).toBe(49);
  expect(afterV2?.on_hand).toBe(29);
  // 1 movement in cho dong resalable (reference = ma tra), khong movement cho damaged.
  const moves = movementRows(
    ctx.db,
    `reference = '${ret.code as string}'`,
  );
  expect(moves).toHaveLength(1);
  expect(moves[0]?.type).toBe('in');
  expect(moves[0]?.variant_id).toBe(ctx.v1);
  expect(moves[0]?.warehouse_id).toBe(ctx.whA.id);
  const damagedMoves = movementRows(
    ctx.db,
    `reference = '${ret.code as string}' AND variant_id = ${ctx.v2}`,
  );
  expect(damagedMoves).toHaveLength(0);
  expect(returnEvents(ctx.db, ret.id as number).map((e) => e.event_type)).toEqual([
    'created',
    'approved',
    'received',
  ]);
});

test('AC-3 nhan hang chi tu approved: nhan tu requested/received -> 400', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  const ret = await mustCreateReturn(ctx.owner, order.id as number, {
    items: [{ variant_id: ctx.v1, qty: 1, condition: 'resalable' }],
    reason: 'tra gia lap',
  });
  const tooEarly = await ctx.owner.post(`/api/returns/${ret.id as number}/receive`).send({});
  expect(tooEarly.status).toBe(400);
  expect(returnRow(ctx.db, ret.id as number).status).toBe('requested');
  await ctx.owner.post(`/api/returns/${ret.id as number}/approve`).send({});
  const ok = await ctx.owner.post(`/api/returns/${ret.id as number}/receive`).send({});
  expect(ok.status).toBe(200);
  const again = await ctx.owner.post(`/api/returns/${ret.id as number}/receive`).send({});
  expect(again.status).toBe(400);
  expect(returnRow(ctx.db, ret.id as number).status).toBe('received');
});

test('AC-3 hoan tien tra hang 200 dung so ca resalable lan damaged, qua bang refunds GOAL-006', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx, ctx.owner, [
    { variant_id: ctx.v1, qty: 2 },
    { variant_id: ctx.v2, qty: 1 },
  ]);
  await mustPayCash(ctx, order.id as number, 250000);
  const ret = await mustReceivedReturn(ctx, order.id as number, [
    { variant_id: ctx.v1, qty: 1, condition: 'resalable' },
    { variant_id: ctx.v2, qty: 1, condition: 'damaged' },
  ]);
  const res = await ctx.owner.post(`/api/returns/${ret.id as number}/refund`).send({});
  expect(res.status).toBe(200);
  expect(asReturn(res).status).toBe('refunded');
  // So tien hoan = 1 x 100000 + 1 x 50000 = 150000 (tinh CA hang hong).
  const refunds = refundRowsByReason(ctx.db, ret.code as string);
  expect(refunds.length).toBeGreaterThanOrEqual(1);
  const total = refunds.reduce((s, r) => s + (r.amount as number), 0);
  expect(total).toBe(150000);
  for (const r of refunds) expect(r.status).toBe('completed');
  const summary = computePaymentSummary(ctx.db, order.id as number);
  expect(summary.paid_total).toBe(100000);
  expect(summary.refunded_total).toBe(150000);
  expect(summary.payment_status).toBe('partially_refunded');
  expect(returnEvents(ctx.db, ret.id as number).map((e) => e.event_type)).toEqual([
    'created',
    'approved',
    'received',
    'refunded',
  ]);
  // Hoan tien KHONG doi trang thai don.
  const detail = await ctx.owner.get(`/api/orders/${order.id as number}`);
  expect(asOrder(detail).status).toBe('completed');
});

test('AC-3 hoan vuot so con hoan duoc -> 400, khong tao refund nao, return o lai received', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  // Chi tra 50000/200000 roi tra het 2 cai (200000) -> vuot so con hoan duoc.
  await mustPayCash(ctx, order.id as number, 50000);
  const ret = await mustReceivedReturn(ctx, order.id as number, [
    { variant_id: ctx.v1, qty: 2, condition: 'resalable' },
  ]);
  const res = await ctx.owner.post(`/api/returns/${ret.id as number}/refund`).send({});
  expect(res.status).toBe(400);
  expect(returnRow(ctx.db, ret.id as number).status).toBe('received');
  expect(refundRowsByReason(ctx.db, ret.code as string)).toHaveLength(0);
  const summary = computePaymentSummary(ctx.db, order.id as number);
  expect(summary.refunded_total).toBe(0);
  expect(summary.paid_total).toBe(50000);
});

test('AC-3 hoan tien chi tu received: hoan tu requested/approved/refunded -> 400', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  await mustPayCash(ctx, order.id as number, 200000);
  const ret = await mustCreateReturn(ctx.owner, order.id as number, {
    items: [{ variant_id: ctx.v1, qty: 1, condition: 'resalable' }],
    reason: 'tra gia lap',
  });
  const tooEarly = await ctx.owner.post(`/api/returns/${ret.id as number}/refund`).send({});
  expect(tooEarly.status).toBe(400);
  await ctx.owner.post(`/api/returns/${ret.id as number}/approve`).send({});
  const tooEarly2 = await ctx.owner.post(`/api/returns/${ret.id as number}/refund`).send({});
  expect(tooEarly2.status).toBe(400);
  await ctx.owner.post(`/api/returns/${ret.id as number}/receive`).send({});
  const ok = await ctx.owner.post(`/api/returns/${ret.id as number}/refund`).send({});
  expect(ok.status).toBe(200);
  const again = await ctx.owner.post(`/api/returns/${ret.id as number}/refund`).send({});
  expect(again.status).toBe(400);
  expect(returnRow(ctx.db, ret.id as number).status).toBe('refunded');
  const missing = await ctx.owner.post('/api/returns/999999/refund').send({});
  expect(missing.status).toBe(404);
});

test('AC-3 doi chieu sau tra day du: payments + stock + don khop nhau ca 3 mat', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx, ctx.owner, [
    { variant_id: ctx.v1, qty: 2 },
    { variant_id: ctx.v2, qty: 1 },
  ]);
  await mustPayCash(ctx, order.id as number, 250000);
  const beforeV1 = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  const beforeV2 = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v2);
  const ret = await mustReceivedReturn(ctx, order.id as number, [
    { variant_id: ctx.v1, qty: 1, condition: 'resalable' },
    { variant_id: ctx.v2, qty: 1, condition: 'damaged' },
  ]);
  const refundRes = await ctx.owner.post(`/api/returns/${ret.id as number}/refund`).send({});
  expect(refundRes.status).toBe(200);
  // Mat thanh toan: paid_total 250000 - 150000 = 100000, refunded 150000.
  const payRes = await ctx.owner.get(`/api/orders/${order.id as number}/payments`);
  expect(payRes.status).toBe(200);
  const summary = asSummary(payRes);
  expect(summary.order_total).toBe(250000);
  expect(summary.paid_total).toBe(100000);
  expect(summary.refunded_total).toBe(150000);
  expect(summary.payment_status).toBe('partially_refunded');
  // Mat kho: V1 tang 1 (ban lai duoc), V2 khong doi (hong).
  const afterV1 = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  const afterV2 = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v2);
  expect((afterV1?.on_hand as number) - (beforeV1?.on_hand as number)).toBe(1);
  expect((afterV2?.on_hand as number) - (beforeV2?.on_hand as number)).toBe(0);
  // Mat don: van completed, tong don khong doi.
  const detail = await ctx.owner.get(`/api/orders/${order.id as number}`);
  expect(asOrder(detail).status).toBe('completed');
  expect(asOrder(detail).total).toBe(250000);
});

test('AC-3 idempotency tra hang: tao/duyet/nhan/hoan gui lai cung key -> replayed true, khong tao moi', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  await mustPayCash(ctx, order.id as number, 200000);
  const createRes = await ctx.owner
    .post(`/api/orders/${order.id as number}/returns`)
    .set('Idempotency-Key', 'ret-create-1')
    .send({
      items: [{ variant_id: ctx.v1, qty: 1, condition: 'resalable' }],
      reason: 'tra gia lap',
    });
  expect(createRes.status).toBe(201);
  const ret = asReturn(createRes);
  const createAgain = await ctx.owner
    .post(`/api/orders/${order.id as number}/returns`)
    .set('Idempotency-Key', 'ret-create-1')
    .send({
      items: [{ variant_id: ctx.v1, qty: 1, condition: 'resalable' }],
      reason: 'tra gia lap',
    });
  expect(createAgain.status).toBe(201);
  expect((createAgain.body as Record<string, unknown>).replayed).toBe(true);
  expect(asReturn(createAgain).id).toBe(ret.id);
  expect(returnsOfOrder(ctx.db, order.id as number)).toHaveLength(1);
  const approveAgain = await ctx.owner
    .post(`/api/returns/${ret.id as number}/approve`)
    .set('Idempotency-Key', 'ret-review-1')
    .send({});
  expect(approveAgain.status).toBe(200);
  const approveReplay = await ctx.owner
    .post(`/api/returns/${ret.id as number}/approve`)
    .set('Idempotency-Key', 'ret-review-1')
    .send({});
  expect(approveReplay.status).toBe(200);
  expect((approveReplay.body as Record<string, unknown>).replayed).toBe(true);
  expect(returnEvents(ctx.db, ret.id as number)).toHaveLength(2);
  const beforeV1 = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  const receiveAgain = await ctx.owner
    .post(`/api/returns/${ret.id as number}/receive`)
    .set('Idempotency-Key', 'ret-receive-1')
    .send({});
  expect(receiveAgain.status).toBe(200);
  const receiveReplay = await ctx.owner
    .post(`/api/returns/${ret.id as number}/receive`)
    .set('Idempotency-Key', 'ret-receive-1')
    .send({});
  expect(receiveReplay.status).toBe(200);
  expect((receiveReplay.body as Record<string, unknown>).replayed).toBe(true);
  const afterV1 = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect((afterV1?.on_hand as number) - (beforeV1?.on_hand as number)).toBe(1);
  const refundAgain = await ctx.owner
    .post(`/api/returns/${ret.id as number}/refund`)
    .set('Idempotency-Key', 'ret-refund-1')
    .send({});
  expect(refundAgain.status).toBe(200);
  const refundReplay = await ctx.owner
    .post(`/api/returns/${ret.id as number}/refund`)
    .set('Idempotency-Key', 'ret-refund-1')
    .send({});
  expect(refundReplay.status).toBe(200);
  expect((refundReplay.body as Record<string, unknown>).replayed).toBe(true);
  expect(refundRowsByReason(ctx.db, ret.code as string)).toHaveLength(1);
});

test('AC-3 nhan hang / hoan tien dong thoi 2 lan: chi 1 lan thuc thi', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  await mustPayCash(ctx, order.id as number, 200000);
  const ret = await mustCreateReturn(ctx.owner, order.id as number, {
    items: [{ variant_id: ctx.v1, qty: 1, condition: 'resalable' }],
    reason: 'tra gia lap',
  });
  await ctx.owner.post(`/api/returns/${ret.id as number}/approve`).send({});
  const beforeV1 = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  const [r1, r2] = await Promise.all([
    ctx.owner.post(`/api/returns/${ret.id as number}/receive`).send({}),
    ctx.owner.post(`/api/returns/${ret.id as number}/receive`).send({}),
  ]);
  const statuses = [r1.status, r2.status].sort();
  expect(statuses).toEqual([200, 400]);
  const afterV1 = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect((afterV1?.on_hand as number) - (beforeV1?.on_hand as number)).toBe(1);
  expect(movementRows(ctx.db, `reference = '${ret.code as string}'`)).toHaveLength(1);
  const [f1, f2] = await Promise.all([
    ctx.owner.post(`/api/returns/${ret.id as number}/refund`).send({}),
    ctx.owner.post(`/api/returns/${ret.id as number}/refund`).send({}),
  ]);
  const fStatuses = [f1.status, f2.status].sort();
  expect(fStatuses).toEqual([200, 400]);
  expect(refundRowsByReason(ctx.db, ret.code as string)).toHaveLength(1);
  expect(returnRow(ctx.db, ret.id as number).status).toBe('refunded');
});

// ---------- AC-4: RBAC + audit + doc/checks ----------

test('AC-4 can() 8 actions giao/tra theo dung ma tran brief', () => {
  const owner = shipActor(1, 'owner');
  const manager = shipActor(2, 'manager');
  const salesOwn = shipActor(3, 'sales', 1);
  const salesOther = shipActor(4, 'sales', 2);
  const whOwn = shipActor(5, 'warehouse', 1, 10);
  const whOther = shipActor(6, 'warehouse', 1, 20);
  const accountant = shipActor(7, 'accountant');
  const ownBranch = shipTarget(1, 1, 10);
  const otherBranch = shipTarget(1, 2, 10);
  const otherWh = shipTarget(1, 1, 20);
  const crossOrg = shipTarget(2, 1, 10);
  const check = (action: Action, actor: ReturnType<typeof shipActor>, target: ReturnType<typeof shipTarget>) =>
    can(actor, action, target);
  // Yeu cau giao / cap nhat trang thai giao.
  for (const action of ['request-shipment', 'update-shipment'] as Action[]) {
    expect(check(action, owner, ownBranch)).toBe(true);
    expect(check(action, manager, ownBranch)).toBe(true);
    expect(check(action, salesOwn, ownBranch)).toBe(false);
    expect(check(action, whOwn, ownBranch)).toBe(true);
    expect(check(action, whOther, ownBranch)).toBe(false);
    expect(check(action, whOwn, otherWh)).toBe(false);
    expect(check(action, accountant, ownBranch)).toBe(false);
    expect(check(action, owner, crossOrg)).toBe(false);
  }
  // Xem giao hang.
  expect(check('view-shipments', owner, ownBranch)).toBe(true);
  expect(check('view-shipments', manager, ownBranch)).toBe(true);
  expect(check('view-shipments', accountant, ownBranch)).toBe(true);
  expect(check('view-shipments', salesOwn, ownBranch)).toBe(true);
  expect(check('view-shipments', salesOwn, otherBranch)).toBe(false);
  expect(check('view-shipments', whOwn, ownBranch)).toBe(true);
  expect(check('view-shipments', whOwn, otherWh)).toBe(false);
  expect(check('view-shipments', owner, crossOrg)).toBe(false);
  // Yeu cau tra.
  expect(check('request-return', owner, ownBranch)).toBe(true);
  expect(check('request-return', manager, ownBranch)).toBe(true);
  expect(check('request-return', salesOwn, ownBranch)).toBe(true);
  expect(check('request-return', salesOwn, otherBranch)).toBe(false);
  expect(check('request-return', whOwn, ownBranch)).toBe(false);
  expect(check('request-return', accountant, ownBranch)).toBe(false);
  // Duyet/tu choi tra.
  expect(check('review-return', owner, ownBranch)).toBe(true);
  expect(check('review-return', manager, ownBranch)).toBe(true);
  expect(check('review-return', salesOwn, ownBranch)).toBe(false);
  expect(check('review-return', whOwn, ownBranch)).toBe(false);
  expect(check('review-return', accountant, ownBranch)).toBe(false);
  // Nhan hang tra.
  expect(check('receive-return', owner, ownBranch)).toBe(true);
  expect(check('receive-return', manager, ownBranch)).toBe(true);
  expect(check('receive-return', whOwn, ownBranch)).toBe(true);
  expect(check('receive-return', whOwn, otherWh)).toBe(false);
  expect(check('receive-return', salesOwn, ownBranch)).toBe(false);
  expect(check('receive-return', accountant, ownBranch)).toBe(false);
  // Hoan tien tra hang.
  expect(check('refund-return', owner, ownBranch)).toBe(true);
  expect(check('refund-return', manager, ownBranch)).toBe(true);
  expect(check('refund-return', accountant, ownBranch)).toBe(true);
  expect(check('refund-return', salesOwn, ownBranch)).toBe(false);
  expect(check('refund-return', whOwn, ownBranch)).toBe(false);
  // Xem tra hang.
  expect(check('view-returns', owner, ownBranch)).toBe(true);
  expect(check('view-returns', manager, ownBranch)).toBe(true);
  expect(check('view-returns', accountant, ownBranch)).toBe(true);
  expect(check('view-returns', salesOwn, ownBranch)).toBe(true);
  expect(check('view-returns', salesOwn, otherBranch)).toBe(false);
  expect(check('view-returns', whOwn, ownBranch)).toBe(true);
  expect(check('view-returns', whOwn, otherWh)).toBe(false);
  expect(check('view-returns', owner, crossOrg)).toBe(false);
});

test('AC-4 RBAC 403 qua HTTP: sales yeu cau giao, accountant cap nhat giao, warehouse yeu cau tra, sales duyet/hoan, warehouse nhan ngoai kho gan', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  const shipBySales = await ctx.sales
    .post(`/api/orders/${order.id as number}/shipments`)
    .send({ carrier: 'GHN-fake', destination: 'TP.HCM' });
  expect(shipBySales.status).toBe(403);
  const shipment = await mustCreateShipment(ctx.owner, order.id as number);
  const updByAccountant = await mustUpdateShipment(ctx.accountant, shipment.id as number, {
    status: 'in_transit',
  });
  expect(updByAccountant.status).toBe(403);
  const retByWarehouse = await ctx.warehouse
    .post(`/api/orders/${order.id as number}/returns`)
    .send({
      items: [{ variant_id: ctx.v1, qty: 1, condition: 'resalable' }],
      reason: 'tra gia lap',
    });
  expect(retByWarehouse.status).toBe(403);
  const ret = await mustCreateReturn(ctx.owner, order.id as number, {
    items: [{ variant_id: ctx.v1, qty: 1, condition: 'resalable' }],
    reason: 'tra gia lap',
  });
  const approveBySales = await ctx.sales.post(`/api/returns/${ret.id as number}/approve`).send({});
  expect(approveBySales.status).toBe(403);
  const refundBySales = await ctx.sales.post(`/api/returns/${ret.id as number}/refund`).send({});
  expect(refundBySales.status).toBe(403);
  // Warehouse gan kho B nhan hang tra cua don kho A -> 403.
  const scope = await ctx.owner
    .patch(`/api/users/${ctx.warehouseId}/scope`)
    .send({ warehouse_id: ctx.whB.id });
  expect(scope.status).toBe(200);
  await ctx.owner.post(`/api/returns/${ret.id as number}/approve`).send({});
  const receiveWrongWh = await ctx.warehouse
    .post(`/api/returns/${ret.id as number}/receive`)
    .send({});
  expect(receiveWrongWh.status).toBe(403);
  expect(returnRow(ctx.db, ret.id as number).status).toBe('approved');
});

test('AC-4 RBAC xem 403: sales xem shipment/return don ngoai chi nhanh, user org A doc shipment/return org B', async () => {
  const ctx = await shipCtx();
  // Don thuoc chi nhanh 2 (sales2 tao), kho A.
  const order = await mustCreateOrder(ctx.sales2, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  await mustTransition(ctx.owner, order.id as number, 'confirm');
  await mustTransition(ctx.owner, order.id as number, 'process');
  await mustTransition(ctx.owner, order.id as number, 'complete');
  const shipment = await mustCreateShipment(ctx.owner, order.id as number);
  const ret = await mustCreateReturn(ctx.owner, order.id as number, {
    items: [{ variant_id: ctx.v1, qty: 1, condition: 'resalable' }],
    reason: 'tra gia lap',
  });
  const shipBySalesOther = await ctx.sales.get(`/api/shipments/${shipment.id as number}`);
  expect(shipBySalesOther.status).toBe(403);
  const retBySalesOther = await ctx.sales.get(`/api/returns/${ret.id as number}`);
  expect(retBySalesOther.status).toBe(403);
  const listShipOther = await ctx.sales.get(`/api/orders/${order.id as number}/shipments`);
  expect(listShipOther.status).toBe(403);
  const listRetOther = await ctx.sales.get(`/api/orders/${order.id as number}/returns`);
  expect(listRetOther.status).toBe(403);
  // Org B doc shipment/return org A -> 403.
  const shipByOrgB = await ctx.ownerB.get(`/api/shipments/${shipment.id as number}`);
  expect(shipByOrgB.status).toBe(403);
  const retByOrgB = await ctx.ownerB.get(`/api/returns/${ret.id as number}`);
  expect(retByOrgB.status).toBe(403);
});

test('AC-4 RBAC duong: warehouse dung kho yeu cau giao 200, sales dung chi nhanh yeu cau tra 200, accountant hoan tien tra hang 200', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  const scope = await ctx.owner
    .patch(`/api/users/${ctx.warehouseId}/scope`)
    .send({ warehouse_id: ctx.whA.id });
  expect(scope.status).toBe(200);
  const shipment = await mustCreateShipment(ctx.warehouse, order.id as number);
  expect(shipment.status).toBe('requested');
  await mustPayCash(ctx, order.id as number, 200000);
  const ret = await mustCreateReturn(ctx.sales, order.id as number, {
    items: [{ variant_id: ctx.v1, qty: 1, condition: 'resalable' }],
    reason: 'tra gia lap',
  });
  expect(ret.status).toBe('requested');
  await ctx.owner.post(`/api/returns/${ret.id as number}/approve`).send({});
  await ctx.warehouse.post(`/api/returns/${ret.id as number}/receive`).send({});
  const refund = await ctx.accountant.post(`/api/returns/${ret.id as number}/refund`).send({});
  expect(refund.status).toBe(200);
  expect(asReturn(refund).status).toBe('refunded');
});

test('AC-4 audit log giao/tra day du + khong chua thong tin the, sales xem log 403', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  await mustPayCash(ctx, order.id as number, 200000);
  const ownerId = (
    ctx.db.prepare('SELECT id FROM users WHERE email = ?').get(ctx.seeded.ownerEmail) as {
      id: number;
    }
  ).id;
  const shipment = await mustCreateShipment(ctx.owner, order.id as number);
  await mustUpdateShipment(ctx.owner, shipment.id as number, { status: 'in_transit' });
  await mustUpdateShipment(ctx.owner, shipment.id as number, { status: 'delivered' });
  const ret = await mustReceivedReturn(ctx, order.id as number, [
    { variant_id: ctx.v1, qty: 1, condition: 'resalable' },
  ]);
  const refundRes = await ctx.owner.post(`/api/returns/${ret.id as number}/refund`).send({});
  expect(refundRes.status).toBe(200);
  const shipAudits = auditRows(ctx.db, ctx.orgId).filter(
    (r) => r.detail.target_shipment_id === shipment.id,
  );
  const retAudits = auditRows(ctx.db, ctx.orgId).filter(
    (r) => r.detail.target_return_id === ret.id,
  );
  // 3 thao tac giao (tao + in_transit + delivered) + 4 thao tac tra
  // (tao + duyet + nhan + hoan) deu ghi audit, dung nguoi thuc hien.
  expect(shipAudits.length).toBe(3);
  expect(retAudits.length).toBe(4);
  for (const row of [...shipAudits, ...retAudits]) {
    expect(row.user_id).toBe(ownerId);
    expect(row.created_at).toBeTruthy();
    expect(row.detail.target_order_id).toBe(order.id);
    expect(row.detail.order_code).toBe(order.code);
  }
  expect(shipAudits.some((r) => r.detail.tracking_code === shipment.tracking_code)).toBe(true);
  expect(
    shipAudits.some((r) => r.detail.from_status === 'requested' && r.detail.to_status === 'in_transit'),
  ).toBe(true);
  expect(
    shipAudits.some((r) => r.detail.from_status === 'in_transit' && r.detail.to_status === 'delivered'),
  ).toBe(true);
  expect(retAudits.some((r) => r.detail.return_code === ret.code)).toBe(true);
  // Khong chua du lieu nhay cam / thong tin the trong audit log.
  const blob = JSON.stringify([...shipAudits, ...retAudits].map((r) => r.detail));
  expect(blob).not.toMatch(/card|cvv|CVV|password/i);
  const salesLog = await ctx.sales.get('/api/audit-log');
  expect(salesLog.status).toBe(403);
  const ownerLog = await ctx.owner.get('/api/audit-log');
  expect(ownerLog.status).toBe(200);
});

test('AC-4 events day du dung thu tu toan luong giao + tra, gui lap khong tao event thua', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  await mustPayCash(ctx, order.id as number, 200000);
  const shipment = await mustCreateShipment(ctx.owner, order.id as number);
  await mustUpdateShipment(ctx.owner, shipment.id as number, { status: 'in_transit' });
  // Gui lap cung trang thai in_transit: khong tao event moi.
  await mustUpdateShipment(ctx.owner, shipment.id as number, { status: 'in_transit' });
  await mustUpdateShipment(ctx.owner, shipment.id as number, { status: 'delivered' });
  expect(shipmentEvents(ctx.db, shipment.id as number).map((e) => e.event_type)).toEqual([
    'created',
    'in_transit',
    'delivered',
  ]);
  const ret = await mustReceivedReturn(ctx, order.id as number, [
    { variant_id: ctx.v1, qty: 1, condition: 'resalable' },
  ]);
  await ctx.owner.post(`/api/returns/${ret.id as number}/refund`).send({});
  expect(returnEvents(ctx.db, ret.id as number).map((e) => e.event_type)).toEqual([
    'created',
    'approved',
    'received',
    'refunded',
  ]);
});

test('AC-4 GET danh sach + chi tiet shipments/returns kem items + events, 404 khi khong ton tai', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  const s1 = await mustCreateShipment(ctx.owner, order.id as number);
  await mustUpdateShipment(ctx.owner, s1.id as number, {
    status: 'failed',
    reason: 'that bai gia lap',
  });
  const s2 = await mustCreateShipment(ctx.owner, order.id as number);
  const listRes = await ctx.owner.get(`/api/orders/${order.id as number}/shipments`);
  expect(listRes.status).toBe(200);
  const list = asList(listRes, ['shipments', 'items', 'rows', 'data']);
  expect(list).toHaveLength(2);
  // Moi nhat truoc.
  expect(list[0]?.id).toBe(s2.id);
  expect(list[1]?.id).toBe(s1.id);
  const s1Events = ((list[1]?.events as Record<string, unknown>[] | undefined) ?? []).map(
    (e) => e.event_type,
  );
  expect(s1Events).toEqual(['created', 'failed']);
  const single = await ctx.owner.get(`/api/shipments/${s2.id as number}`);
  expect(single.status).toBe(200);
  expect(asShipment(single).id).toBe(s2.id);
  const missingShip = await ctx.owner.get('/api/shipments/999999');
  expect(missingShip.status).toBe(404);
  const missingOrderShips = await ctx.owner.get('/api/orders/999999/shipments');
  expect(missingOrderShips.status).toBe(404);
  const ret = await mustCreateReturn(ctx.owner, order.id as number, {
    items: [{ variant_id: ctx.v1, qty: 1, condition: 'resalable' }],
    reason: 'tra gia lap',
  });
  const retListRes = await ctx.owner.get(`/api/orders/${order.id as number}/returns`);
  expect(retListRes.status).toBe(200);
  const retList = asList(retListRes, ['returns', 'items', 'rows', 'data']);
  expect(retList).toHaveLength(1);
  const retItems = ((retList[0]?.items as Record<string, unknown>[] | undefined) ?? []).map(
    (i) => i.variant_id,
  );
  expect(retItems).toContain(ctx.v1);
  const singleRet = await ctx.owner.get(`/api/returns/${ret.id as number}`);
  expect(singleRet.status).toBe(200);
  expect(asReturn(singleRet).id).toBe(ret.id);
  const missingRet = await ctx.owner.get('/api/returns/999999');
  expect(missingRet.status).toBe(404);
  const missingOrderRets = await ctx.owner.get('/api/orders/999999/returns');
  expect(missingOrderRets.status).toBe(404);
});

test('AC-4 khong co endpoint DELETE shipment/return, khong sua/xoa return_events', async () => {
  const ctx = await shipCtx();
  const order = await mustCompletedOrder(ctx);
  const shipment = await mustCreateShipment(ctx.owner, order.id as number);
  const ret = await mustCreateReturn(ctx.owner, order.id as number, {
    items: [{ variant_id: ctx.v1, qty: 1, condition: 'resalable' }],
    reason: 'tra gia lap',
  });
  const delShip = await ctx.owner.delete(`/api/shipments/${shipment.id as number}`);
  expect([404, 405]).toContain(delShip.status);
  const delRet = await ctx.owner.delete(`/api/returns/${ret.id as number}`);
  expect([404, 405]).toContain(delRet.status);
  const patchRetEvent = await ctx.owner
    .patch(`/api/returns/${ret.id as number}/events/1`)
    .send({ event_type: 'refunded' });
  expect([404, 405]).toContain(patchRetEvent.status);
  const delRetEvent = await ctx.owner.delete(`/api/returns/${ret.id as number}/events/1`);
  expect([404, 405]).toContain(delRetEvent.status);
  expect(shipmentRow(ctx.db, shipment.id as number)).toBeTruthy();
  expect(returnRow(ctx.db, ret.id as number)).toBeTruthy();
  expect(returnEvents(ctx.db, ret.id as number)).toHaveLength(1);
});
