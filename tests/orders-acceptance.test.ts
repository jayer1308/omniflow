import { test, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { migrate, openDb } from '../src/db.js';
import { canTransition, formatOrderCode } from '../src/orders.js';
import { can, type Role } from '../src/rbac.js';
import { seed } from '../src/seed.js';

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

/** Lay object don tu response (tra truc tiep hoac boc {order}). */
function asOrder(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (body.order as Record<string, unknown>) ?? body;
}

/** Lay danh sach don + tong so tu response list (tra truc tiep hoac boc). */
function asListAndTotal(res: { body: unknown }): {
  list: Record<string, unknown>[];
  total: number;
} {
  const body = res.body as Record<string, unknown>;
  let list: Record<string, unknown>[] = [];
  if (Array.isArray(res.body)) list = res.body as Record<string, unknown>[];
  else {
    for (const key of ['orders', 'items', 'rows', 'data']) {
      if (Array.isArray(body[key])) {
        list = body[key] as Record<string, unknown>[];
        break;
      }
    }
  }
  const total =
    typeof body.total === 'number'
      ? (body.total as number)
      : typeof body.count === 'number'
        ? (body.count as number)
        : list.length;
  return { list, total };
}

/** Lay object kho/muc ton tu response (tra truc tiep hoac boc). */
function asOne(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (
    (body.warehouse as Record<string, unknown>) ??
    (body.stock as Record<string, unknown>) ??
    (body.level as Record<string, unknown>) ??
    body
  );
}

function rand(): string {
  return Math.random().toString(36).slice(2, 8);
}

async function createWarehouse(
  agent: Agent,
  name: string,
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await agent.post('/api/warehouses').send({ name, ...overrides });
  expect(res.status).toBe(201);
  const w = asOne(res);
  expect(w.id).toBeDefined();
  return w;
}

async function createProduct(
  agent: Agent,
  overrides: Record<string, unknown> = {},
): Promise<{ id: number; code: string }> {
  const code = (overrides.code as string) ?? `SP-DON-${rand()}`;
  const res = await agent.post('/api/products').send({
    code,
    name: 'San pham don gia lap',
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

async function createVariant(
  agent: Agent,
  productId: number,
  overrides: Record<string, unknown> = {},
): Promise<number> {
  const sku = (overrides.sku as string) ?? `SKU-DON-${rand()}`;
  const res = await agent.post(`/api/products/${productId}/variants`).send({
    sku,
    name: 'Bien the gia lap',
    ...overrides,
  });
  expect(res.status).toBe(201);
  const v = (res.body as Record<string, unknown>).variant as Record<string, unknown> | undefined;
  const id = ((v ?? res.body) as Record<string, unknown>).id as number;
  expect(id).toBeDefined();
  return id;
}

/** Nhap kho, bat buoc thanh cong (200/201). */
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
 * Boi canh don: 2 kho (A, B) + 2 san pham/bien the (V1 gia 100000, V2 gia
 * 50000) + ton: whA V1 50 / V2 30, whB V1 100. Kem id bien the + kho mau
 * cua seed (SKU-SEED-01-M gia web 160000, Kho Chinh ton 3, Kho Phu ton 20).
 */
async function orderCtx() {
  const ctx = await fullCtx();
  const { db } = ctx;
  const whA = await createWarehouse(ctx.owner, 'Kho A');
  const whB = await createWarehouse(ctx.owner, 'Kho B');
  const p1 = await createProduct(ctx.owner, { name: 'SP don 1', price: 100000, min_stock: 0 });
  const v1 = await createVariant(ctx.owner, p1.id);
  const p2 = await createProduct(ctx.owner, { name: 'SP don 2', price: 50000, min_stock: 0 });
  const v2 = await createVariant(ctx.owner, p2.id);
  await mustStockIn(ctx.owner, whA.id as number, v1, 50);
  await mustStockIn(ctx.owner, whA.id as number, v2, 30);
  await mustStockIn(ctx.owner, whB.id as number, v1, 100);
  const seedVariantId = (
    db.prepare("SELECT id FROM product_variants WHERE sku = 'SKU-SEED-01-M'").get() as {
      id: number;
    }
  ).id;
  const seedProductId = (
    db.prepare("SELECT id FROM products WHERE code = 'SP-SEED-01'").get() as { id: number }
  ).id;
  const khoChinhId = (
    db.prepare("SELECT id FROM warehouses WHERE name = 'Kho Chính'").get() as { id: number }
  ).id;
  const khoPhuId = (
    db.prepare("SELECT id FROM warehouses WHERE name = 'Kho Phụ'").get() as { id: number }
  ).id;
  return { ...ctx, whA, whB, p1, v1, p2, v2, seedVariantId, seedProductId, khoChinhId, khoPhuId };
}

type Ctx = Awaited<ReturnType<typeof orderCtx>>;

/** Tao don, bat buoc 201; tra don da tao. */
async function mustCreateOrder(
  agent: Agent,
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<Record<string, unknown>> {
  const req = agent.post('/api/orders');
  if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
  const res = await req.send(body);
  expect(res.status).toBe(201);
  const order = asOrder(res);
  expect(order.id).toBeDefined();
  expect(order.code).toBeDefined();
  return order;
}

/** Chuyen trang thai don; tra response tho (khong bat buoc thanh cong). */
async function transition(
  agent: Agent,
  orderId: number,
  action: 'confirm' | 'process' | 'complete' | 'cancel',
  body: Record<string, unknown> = {},
  idempotencyKey?: string,
) {
  const req = agent.post(`/api/orders/${orderId}/${action}`);
  if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
  return req.send(body);
}

async function mustTransition(
  agent: Agent,
  orderId: number,
  action: 'confirm' | 'process' | 'complete' | 'cancel',
  body: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await transition(agent, orderId, action, body);
  expect([200, 201]).toContain(res.status);
  return asOrder(res);
}

/** Doc 1 dong muc ton qua API; null khi chua co dong ton nao. */
async function levelOf(
  agent: Agent,
  warehouseId: number,
  variantId: number,
): Promise<Record<string, unknown> | null> {
  const res = await agent.get(
    `/api/stock/levels?warehouse_id=${warehouseId}&variant_id=${variantId}`,
  );
  expect(res.status).toBe(200);
  const body = res.body as Record<string, unknown>;
  const list = Array.isArray(res.body)
    ? (res.body as Record<string, unknown>[])
    : ((body.levels ?? body.items ?? []) as Record<string, unknown>[]);
  return (
    list.find((r) => r.warehouse_id === warehouseId && r.variant_id === variantId) ?? null
  );
}

function movementRows(db: Db, where = '1 = 1'): Record<string, unknown>[] {
  return db
    .prepare(`SELECT * FROM stock_movements WHERE ${where} ORDER BY id`)
    .all() as Record<string, unknown>[];
}

function eventsFor(db: Db, orderId: number): Record<string, unknown>[] {
  return db
    .prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY id')
    .all(orderId) as Record<string, unknown>[];
}

function orderRow(db: Db, orderId: number): Record<string, unknown> {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId) as Record<string, unknown>;
}

function auditRows(
  db: Db,
  orgId: number,
): { action: string; detail: Record<string, unknown>; user_id: number }[] {
  const rows = db
    .prepare('SELECT * FROM audit_log WHERE org_id = ? ORDER BY id')
    .all(orgId) as { action: string; detail: string | null; user_id: number }[];
  return rows.map((r) => {
    let detail: Record<string, unknown> = {};
    try {
      detail = JSON.parse(r.detail ?? '{}') as Record<string, unknown>;
    } catch {
      detail = {};
    }
    return { action: r.action, detail, user_id: r.user_id };
  });
}

/** Actor / Target cho can(): dung branchId + warehouseId cua don. */
function orderActor(
  id: number,
  role: Role,
  branchId: number | null = null,
  warehouseId: number | null = null,
) {
  return { id, orgId: 1, branchId, role, warehouseId };
}

function orderTarget(orgId = 1, branchId?: number | null, warehouseId?: number | null) {
  return { orgId, branchId, warehouseId };
}

// ---------- AC-1: don + luoc do don + snapshot gia ----------

test('AC-1 migration 010 tao du 3 bang don + cot + UNIQUE/CHECK', () => {
  const { db, seeded } = freshApp();
  const names = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);
  for (const t of ['orders', 'order_items', 'order_events']) {
    expect(names).toContain(t);
  }
  const versions = (
    db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
      version: number;
    }[]
  ).map((r) => r.version);
  expect(versions).toContain(10);
  const cols = (table: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  for (const c of [
    'org_id', 'branch_id', 'warehouse_id', 'code', 'channel', 'customer_name', 'status',
    'total', 'created_by', 'created_at', 'updated_at',
  ]) {
    expect(cols('orders')).toContain(c);
  }
  for (const c of [
    'order_id', 'variant_id', 'product_id', 'sku', 'name', 'unit_price', 'price_source',
    'qty', 'line_total',
  ]) {
    expect(cols('order_items')).toContain(c);
  }
  for (const c of ['order_id', 'from_status', 'to_status', 'actor_id', 'note', 'created_at']) {
    expect(cols('order_events')).toContain(c);
  }
  // UNIQUE + CHECK o tang DB: trung ma don trong org bi tu choi, trung bien
  // the trong cung don bi tu choi, status la bi tu choi, qty <= 0 bi tu choi.
  const now = new Date().toISOString();
  const whId = (
    db.prepare("SELECT id FROM warehouses WHERE name = 'Kho Chính'").get() as { id: number }
  ).id;
  const variant = db.prepare('SELECT id FROM product_variants LIMIT 1').get() as { id: number };
  const owner = db.prepare("SELECT id FROM users WHERE role = 'owner'").get() as { id: number };
  const orderId = Number(
    db
      .prepare(
        `INSERT INTO orders (org_id, branch_id, warehouse_id, code, channel, status, total,
          created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'counter', 'draft', 0, ?, ?, ?)`,
      )
      .run(seeded.orgId, seeded.branchId, whId, 'DH-20261127-0001', owner.id, now, now)
      .lastInsertRowid,
  );
  expect(() =>
    db
      .prepare(
        `INSERT INTO orders (org_id, branch_id, warehouse_id, code, channel, status, total,
          created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'counter', 'draft', 0, ?, ?, ?)`,
      )
      .run(seeded.orgId, seeded.branchId, whId, 'DH-20261127-0001', owner.id, now, now),
  ).toThrow();
  expect(() =>
    db
      .prepare(
        "INSERT INTO orders (org_id, branch_id, warehouse_id, code, channel, status, total, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'counter', 'bogus', 0, ?, ?, ?)",
      )
      .run(seeded.orgId, seeded.branchId, whId, 'DH-20261127-0002', owner.id, now, now),
  ).toThrow();
  const product = db.prepare('SELECT product_id FROM product_variants WHERE id = ?').get(
    variant.id,
  ) as { product_id: number };
  db.prepare(
    `INSERT INTO order_items (order_id, variant_id, product_id, sku, name, unit_price,
      price_source, qty, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(orderId, variant.id, product.product_id, 'SKU-DB', 'Bien the DB', 1000, 'base', 2, 2000);
  expect(() =>
    db.prepare(
      `INSERT INTO order_items (order_id, variant_id, product_id, sku, name, unit_price,
        price_source, qty, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(orderId, variant.id, product.product_id, 'SKU-DB', 'Bien the DB', 1000, 'base', 1, 1000),
  ).toThrow();
  expect(() =>
    db.prepare(
      `INSERT INTO order_items (order_id, variant_id, product_id, sku, name, unit_price,
        price_source, qty, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(orderId, variant.id, product.product_id, 'SKU-DB', 'Bien the DB', 1000, 'base', 0, 0),
  ).toThrow();
});

test('AC-1 tao don 201 kem items snapshot gia web + total server tinh; code DH-YYYYMMDD-NNNN; don o draft, ton khong doi', async () => {
  const ctx = await orderCtx();
  const before = await levelOf(ctx.owner, ctx.khoPhuId, ctx.seedVariantId);
  expect(before).not.toBeNull();
  expect(before?.on_hand).toBe(20);
  expect(before?.reserved).toBe(0);
  const order = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.khoPhuId,
    channel: 'web',
    customer_name: 'Khach Web',
    items: [{ variant_id: ctx.seedVariantId, qty: 2 }],
    total: 1,
  });
  expect(order.status).toBe('draft');
  expect(order.channel).toBe('web');
  expect(order.customer_name).toBe('Khach Web');
  expect(order.warehouse_id).toBe(ctx.khoPhuId);
  expect(order.code).toMatch(/^DH-\d{8}-\d{4}$/);
  expect(order.code as string).toMatch(/-0001$/);
  const items = order.items as Record<string, unknown>[];
  expect(items).toHaveLength(1);
  // Seed: gia web rieng 160000 cho SP-SEED-01 (product_channel) — snapshot.
  expect(items[0].variant_id).toBe(ctx.seedVariantId);
  expect(items[0].unit_price).toBe(160000);
  expect(items[0].price_source).toBe('channel');
  expect(items[0].sku).toBe('SKU-SEED-01-M');
  expect(items[0].qty).toBe(2);
  expect(items[0].line_total).toBe(320000);
  // Total do server tinh, khong tin total client gui len (1).
  expect(order.total).toBe(320000);
  // Tao don KHONG giu hang, KHONG tru kho.
  const after = await levelOf(ctx.owner, ctx.khoPhuId, ctx.seedVariantId);
  expect(after?.on_hand).toBe(20);
  expect(after?.reserved).toBe(0);
  expect(movementRows(ctx.db, `reference = '${order.code as string}'`)).toHaveLength(0);
  // Ma don thu 2 trong ngay tang so thu tu.
  const order2 = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.khoPhuId,
    channel: 'web',
    items: [{ variant_id: ctx.seedVariantId, qty: 1 }],
  });
  expect(order2.code).toMatch(/-0002$/);
  expect(order2.code).not.toBe(order.code);
});

test('AC-1 tao don kenh counter snapshot gia goc source base; don 2 dong tong dung', async () => {
  const ctx = await orderCtx();
  const order = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    customer_name: 'Khach Quay',
    items: [
      { variant_id: ctx.v1, qty: 3 },
      { variant_id: ctx.v2, qty: 2 },
    ],
  });
  expect(order.status).toBe('draft');
  const items = order.items as Record<string, unknown>[];
  expect(items).toHaveLength(2);
  const byVariant = new Map(items.map((i) => [i.variant_id as number, i]));
  expect(byVariant.get(ctx.v1)?.unit_price).toBe(100000);
  expect(byVariant.get(ctx.v1)?.price_source).toBe('base');
  expect(byVariant.get(ctx.v1)?.line_total).toBe(300000);
  expect(byVariant.get(ctx.v2)?.unit_price).toBe(50000);
  expect(byVariant.get(ctx.v2)?.price_source).toBe('base');
  expect(byVariant.get(ctx.v2)?.line_total).toBe(100000);
  expect(order.total).toBe(400000);
});

test('AC-1 snapshot gia: doi gia sau khi dat don khong doi gia don', async () => {
  const ctx = await orderCtx();
  const order1 = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.khoPhuId,
    channel: 'web',
    items: [{ variant_id: ctx.seedVariantId, qty: 1 }],
  });
  expect((order1.items as Record<string, unknown>[])[0].unit_price).toBe(160000);
  // Doi gia web cua SP-SEED-01 tu 160000 -> 180000 (upsert product_prices).
  const changed = await ctx.owner
    .post(`/api/products/${ctx.seedProductId}/prices`)
    .send({ channel: 'web', price: 180000, reason: 'tang gia web gia lap' });
  expect(changed.status).toBe(201);
  const order2 = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.khoPhuId,
    channel: 'web',
    items: [{ variant_id: ctx.seedVariantId, qty: 1 }],
  });
  expect((order2.items as Record<string, unknown>[])[0].unit_price).toBe(180000);
  // Don cu giu nguyen gia snapshot, khong lay gia hien tai.
  const reread = await ctx.owner.get(`/api/orders/${order1.id as number}`);
  expect(reread.status).toBe(200);
  expect((asOrder(reread).items as Record<string, unknown>[])[0].unit_price).toBe(160000);
  expect(asOrder(reread).total).toBe(160000);
});

test('AC-1 tao don sai dau vao bi 400: channel la, items rong, qty 0/am/khong nguyen, trung bien the', async () => {
  const ctx = await orderCtx();
  const base = {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  };
  const badChannel = await ctx.owner
    .post('/api/orders')
    .send({ ...base, channel: 'shopee' });
  expect(badChannel.status).toBe(400);
  const emptyItems = await ctx.owner.post('/api/orders').send({ ...base, items: [] });
  expect(emptyItems.status).toBe(400);
  for (const qty of [0, -1, 1.5, '2']) {
    const res = await ctx.owner
      .post('/api/orders')
      .send({ ...base, items: [{ variant_id: ctx.v1, qty }] });
    expect(res.status).toBe(400);
  }
  const dupVariant = await ctx.owner.post('/api/orders').send({
    ...base,
    items: [
      { variant_id: ctx.v1, qty: 1 },
      { variant_id: ctx.v1, qty: 2 },
    ],
  });
  expect(dupVariant.status).toBe(400);
  const missingWarehouse = await ctx.owner.post('/api/orders').send({ ...base, warehouse_id: undefined });
  expect(missingWarehouse.status).toBe(400);
});

test('AC-1 tao don bien the khong ton tai 404, bien the org B 403/404, kho khong ton tai 404, kho org B 403/404', async () => {
  const ctx = await orderCtx();
  const missingVariant = await ctx.owner.post('/api/orders').send({
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: 999999, qty: 1 }],
  });
  expect(missingVariant.status).toBe(404);
  const missingWarehouse = await ctx.owner.post('/api/orders').send({
    warehouse_id: 999999,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  expect(missingWarehouse.status).toBe(404);
  // Du lieu org B tao qua API bang ownerB.
  const pB = await createProduct(ctx.ownerB, { name: 'SP org B' });
  const vB = await createVariant(ctx.ownerB, pB.id);
  const whB = await createWarehouse(ctx.ownerB, 'Kho B org B');
  const crossVariant = await ctx.owner.post('/api/orders').send({
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: vB, qty: 1 }],
  });
  expect([403, 404]).toContain(crossVariant.status);
  const crossWarehouse = await ctx.owner.post('/api/orders').send({
    warehouse_id: whB.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  expect([403, 404]).toContain(crossWarehouse.status);
});

test('AC-1 tao don kho inactive 400; branch_id khac chi nhanh actor 403; manager thieu branch_id 400/403', async () => {
  const ctx = await orderCtx();
  const whOff = await createWarehouse(ctx.owner, 'Kho Tam Ngung');
  const patched = await ctx.owner
    .patch(`/api/warehouses/${whOff.id as number}`)
    .send({ status: 'inactive' });
  expect(patched.status).toBe(200);
  const inactive = await ctx.owner.post('/api/orders').send({
    warehouse_id: whOff.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  expect(inactive.status).toBe(400);
  // Owner thuoc chi nhanh 1: body branch_id chi nhanh 2 -> 403.
  const wrongBranch = await ctx.owner.post('/api/orders').send({
    branch_id: ctx.branch2,
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  expect(wrongBranch.status).toBe(403);
  // Manager toan org: thieu branch_id -> 400/403; co branch_id hop le -> 201.
  const managerNoBranch = await ctx.manager.post('/api/orders').send({
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  expect([400, 403]).toContain(managerNoBranch.status);
  const managerOk = await mustCreateOrder(ctx.manager, {
    branch_id: ctx.branch2,
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  expect(managerOk.branch_id).toBe(ctx.branch2);
});

test('AC-1 tao don bien the san pham ngung kinh doanh 400', async () => {
  const ctx = await orderCtx();
  const p = await createProduct(ctx.owner, { name: 'SP se ngung ban' });
  const v = await createVariant(ctx.owner, p.id);
  const stopped = await ctx.owner.patch(`/api/products/${p.id}/status`).send({ status: 'discontinued' });
  expect(stopped.status).toBe(200);
  const res = await ctx.owner.post('/api/orders').send({
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: v, qty: 1 }],
  });
  expect(res.status).toBe(400);
});

test('AC-1 khong co endpoint DELETE don: DELETE tra 404/405 va don van doc duoc', async () => {
  const ctx = await orderCtx();
  const order = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  const del = await ctx.owner.delete(`/api/orders/${order.id as number}`);
  expect([404, 405]).toContain(del.status);
  const reread = await ctx.owner.get(`/api/orders/${order.id as number}`);
  expect(reread.status).toBe(200);
  expect(asOrder(reread).id).toBe(order.id);
});

test('AC-1 GET /api/orders/:id tra don kem items + events theo thu tu tao truoc; don khong ton tai 404', async () => {
  const ctx = await orderCtx();
  const order = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    customer_name: 'Khach Chi Tiet',
    items: [{ variant_id: ctx.v1, qty: 2 }],
  });
  const res = await ctx.owner.get(`/api/orders/${order.id as number}`);
  expect(res.status).toBe(200);
  const got = asOrder(res);
  expect(got.id).toBe(order.id);
  expect(got.code).toBe(order.code);
  expect(got.status).toBe('draft');
  expect(got.items).toHaveLength(1);
  const events = got.events as Record<string, unknown>[];
  expect(events).toHaveLength(1);
  // Events theo thu tu thoi gian tang dan: event dau la tao don.
  expect(events[0].from_status).toBeNull();
  expect(events[0].to_status).toBe('draft');
  expect(events[0].actor_id).toBeDefined();
  const missing = await ctx.owner.get('/api/orders/999999');
  expect(missing.status).toBe(404);
});

test('AC-1 GET /api/orders loc status/channel/code/customer_name + phan trang limit/offset + total, moi nhat truoc', async () => {
  const ctx = await orderCtx();
  const o1 = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'web',
    customer_name: 'Nguyen Van A',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  const o2 = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    customer_name: 'Tran Thi B',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  const o3 = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whB.id,
    channel: 'web',
    customer_name: 'nguyen van C',
    items: [{ variant_id: ctx.v2, qty: 1 }],
  });
  // Moi nhat truoc.
  const all = await ctx.owner.get('/api/orders');
  expect(all.status).toBe(200);
  const { list: allList, total: allTotal } = asListAndTotal(all);
  expect(allTotal).toBe(3);
  expect(allList).toHaveLength(3);
  expect(allList[0].id).toBe(o3.id);
  // Loc theo channel.
  const web = await ctx.owner.get('/api/orders').query({ channel: 'web' });
  expect(asListAndTotal(web).total).toBe(2);
  expect(asListAndTotal(web).list.map((o) => o.id).sort()).toEqual([o1.id, o3.id].sort());
  const counter = await ctx.owner.get('/api/orders').query({ channel: 'counter' });
  expect(asListAndTotal(counter).total).toBe(1);
  // Loc theo customer_name: chuoi con, khong phan biet hoa thuong.
  const byName = await ctx.owner.get('/api/orders').query({ customer_name: 'NGUYEN VAN' });
  expect(asListAndTotal(byName).total).toBe(2);
  const byNameNone = await ctx.owner.get('/api/orders').query({ customer_name: 'Le Van' });
  expect(asListAndTotal(byNameNone).total).toBe(0);
  // Loc theo code: chuoi con.
  const byCode = await ctx.owner.get('/api/orders').query({ code: o2.code as string });
  expect(asListAndTotal(byCode).total).toBe(1);
  expect(asListAndTotal(byCode).list[0].id).toBe(o2.id);
  // Loc theo status.
  const draft = await ctx.owner.get('/api/orders').query({ status: 'draft' });
  expect(asListAndTotal(draft).total).toBe(3);
  const completed = await ctx.owner.get('/api/orders').query({ status: 'completed' });
  expect(asListAndTotal(completed).total).toBe(0);
  // Phan trang: limit 2 lay 2 don moi nhat, total van 3; offset 2 lay don cu nhat.
  const page1 = await ctx.owner.get('/api/orders').query({ limit: 2, offset: 0 });
  const p1 = asListAndTotal(page1);
  expect(p1.list).toHaveLength(2);
  expect(p1.total).toBe(3);
  expect(p1.list[0].id).toBe(o3.id);
  const page2 = await ctx.owner.get('/api/orders').query({ limit: 2, offset: 2 });
  const p2 = asListAndTotal(page2);
  expect(p2.list).toHaveLength(1);
  expect(p2.total).toBe(3);
  expect(p2.list[0].id).toBe(o1.id);
});

test('AC-1 canTransition truc tiep: chuyen hop le true, chuyen sai false (src/orders.ts)', () => {
  expect(canTransition('draft', 'confirmed')).toBe(true);
  expect(canTransition('confirmed', 'processing')).toBe(true);
  expect(canTransition('processing', 'completed')).toBe(true);
  expect(canTransition('draft', 'cancelled')).toBe(true);
  expect(canTransition('confirmed', 'cancelled')).toBe(true);
  expect(canTransition('processing', 'cancelled')).toBe(true);
  expect(canTransition('draft', 'completed')).toBe(false);
  expect(canTransition('draft', 'processing')).toBe(false);
  expect(canTransition('confirmed', 'confirmed')).toBe(false);
  expect(canTransition('completed', 'cancelled')).toBe(false);
  expect(canTransition('cancelled', 'confirmed')).toBe(false);
  expect(canTransition('completed', 'draft')).toBe(false);
});

test('AC-1 formatOrderCode truc tiep: DH-YYYYMMDD-NNNN dung dinh dang (src/orders.ts)', () => {
  expect(formatOrderCode(new Date(2026, 10, 27, 12, 0, 0), 1)).toBe('DH-20261127-0001');
  expect(formatOrderCode(new Date(2026, 10, 27, 12, 0, 0), 3)).toBe('DH-20261127-0003');
  expect(formatOrderCode(new Date(2026, 0, 5, 12, 0, 0), 12)).toBe('DH-20260105-0012');
});

// ---------- AC-2: vong doi don + giu/giai phong/xuat kho ----------

test('AC-2 xac nhan giu dung so: reserved tang, on_hand khong doi, movement reserve reference ma don, event draft->confirmed', async () => {
  const ctx = await orderCtx();
  const order = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 10 }],
  });
  const res = await mustTransition(ctx.owner, order.id as number, 'confirm');
  expect(res.status).toBe('confirmed');
  const level = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(level?.on_hand).toBe(50);
  expect(level?.reserved).toBe(10);
  expect(level?.available).toBe(40);
  const moves = movementRows(ctx.db, `reference = '${order.code as string}'`);
  expect(moves).toHaveLength(1);
  expect(moves[0].type).toBe('reserve');
  expect(moves[0].qty_change).toBe(0);
  expect(moves[0].reserved_change).toBe(10);
  expect(moves[0].on_hand_after).toBe(50);
  expect(moves[0].reserved_after).toBe(10);
  const events = eventsFor(ctx.db, order.id as number);
  expect(events).toHaveLength(2);
  expect(events[1].from_status).toBe('draft');
  expect(events[1].to_status).toBe('confirmed');
});

test('AC-2 xac nhan thieu ton 400 insufficient_stock: khong giu dong nao, don o lai draft, khong ghi movement/event', async () => {
  const ctx = await orderCtx();
  // Dong 1 du ton (10/50), dong 2 thieu ton (999/30): ca hai deu khong duoc giu.
  const order = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [
      { variant_id: ctx.v1, qty: 10 },
      { variant_id: ctx.v2, qty: 999 },
    ],
  });
  const res = await transition(ctx.owner, order.id as number, 'confirm');
  expect(res.status).toBe(400);
  expect(JSON.stringify(res.body)).toContain('insufficient_stock');
  const level1 = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(level1?.reserved).toBe(0);
  expect(level1?.on_hand).toBe(50);
  const level2 = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v2);
  expect(level2?.reserved).toBe(0);
  expect(level2?.on_hand).toBe(30);
  expect(orderRow(ctx.db, order.id as number).status).toBe('draft');
  expect(movementRows(ctx.db, `reference = '${order.code as string}'`)).toHaveLength(0);
  expect(eventsFor(ctx.db, order.id as number)).toHaveLength(1);
});

test('AC-2 xac nhan 2 lan: lan 2 bi 400, khong doi kho, khong them event', async () => {
  const ctx = await orderCtx();
  const order = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 5 }],
  });
  await mustTransition(ctx.owner, order.id as number, 'confirm');
  const again = await transition(ctx.owner, order.id as number, 'confirm');
  expect(again.status).toBe(400);
  const level = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(level?.reserved).toBe(5);
  expect(level?.on_hand).toBe(50);
  expect(eventsFor(ctx.db, order.id as number)).toHaveLength(2);
  expect(movementRows(ctx.db, `reference = '${order.code as string}'`)).toHaveLength(1);
});

test('AC-2 chuyen sai 400: draft->process, draft->complete, processing->confirm, completed->cancel, huy 2 lan', async () => {
  const ctx = await orderCtx();
  const order = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 5 }],
  });
  const toProcess = await transition(ctx.owner, order.id as number, 'process');
  expect(toProcess.status).toBe(400);
  const toComplete = await transition(ctx.owner, order.id as number, 'complete');
  expect(toComplete.status).toBe(400);
  expect(orderRow(ctx.db, order.id as number).status).toBe('draft');
  expect(eventsFor(ctx.db, order.id as number)).toHaveLength(1);
  expect(movementRows(ctx.db, `reference = '${order.code as string}'`)).toHaveLength(0);
  await mustTransition(ctx.owner, order.id as number, 'confirm');
  await mustTransition(ctx.owner, order.id as number, 'process');
  const backToConfirm = await transition(ctx.owner, order.id as number, 'confirm');
  expect(backToConfirm.status).toBe(400);
  await mustTransition(ctx.owner, order.id as number, 'complete');
  expect(orderRow(ctx.db, order.id as number).status).toBe('completed');
  expect(eventsFor(ctx.db, order.id as number)).toHaveLength(4);
  const cancelCompleted = await transition(ctx.owner, order.id as number, 'cancel', {
    note: 'muon huy don da xong',
  });
  expect(cancelCompleted.status).toBe(400);
  expect(orderRow(ctx.db, order.id as number).status).toBe('completed');
  expect(eventsFor(ctx.db, order.id as number)).toHaveLength(4);
  const order2 = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  await mustTransition(ctx.owner, order2.id as number, 'cancel', { note: 'huy lan 1' });
  const cancelAgain = await transition(ctx.owner, order2.id as number, 'cancel', {
    note: 'huy lan 2',
  });
  expect(cancelAgain.status).toBe(400);
  expect(eventsFor(ctx.db, order2.id as number)).toHaveLength(2);
});

test('AC-2 hoan tat release + out dung so hoc: reserved ve 0, on_hand tru dung, 2 movement release + out', async () => {
  const ctx = await orderCtx();
  const order = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 10 }],
  });
  await mustTransition(ctx.owner, order.id as number, 'confirm');
  const mid = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(mid?.on_hand).toBe(50);
  expect(mid?.reserved).toBe(10);
  expect(mid?.available).toBe(40);
  await mustTransition(ctx.owner, order.id as number, 'process');
  const done = await mustTransition(ctx.owner, order.id as number, 'complete');
  expect(done.status).toBe('completed');
  const level = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(level?.on_hand).toBe(40);
  expect(level?.reserved).toBe(0);
  expect(level?.available).toBe(40);
  const moves = movementRows(ctx.db, `reference = '${order.code as string}'`);
  expect(moves.map((m) => m.type)).toEqual(['reserve', 'release', 'out']);
  const release = moves[1];
  expect(release.qty_change).toBe(0);
  expect(release.reserved_change).toBe(-10);
  expect(release.on_hand_after).toBe(50);
  expect(release.reserved_after).toBe(0);
  const out = moves[2];
  expect(out.qty_change).toBe(-10);
  expect(out.reserved_change).toBe(0);
  expect(out.on_hand_after).toBe(40);
  expect(out.reserved_after).toBe(0);
  const events = eventsFor(ctx.db, order.id as number);
  expect(events.map((e) => e.to_status)).toEqual([
    'draft',
    'confirmed',
    'processing',
    'completed',
  ]);
});

test('AC-2 huy tu draft chi doi trang thai, khong dong kho, event luu note', async () => {
  const ctx = await orderCtx();
  const order = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 5 }],
  });
  const res = await mustTransition(ctx.owner, order.id as number, 'cancel', {
    note: 'khach doi y',
  });
  expect(res.status).toBe('cancelled');
  const level = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(level?.on_hand).toBe(50);
  expect(level?.reserved).toBe(0);
  expect(movementRows(ctx.db, `reference = '${order.code as string}'`)).toHaveLength(0);
  const events = eventsFor(ctx.db, order.id as number);
  expect(events).toHaveLength(2);
  expect(events[1].from_status).toBe('draft');
  expect(events[1].to_status).toBe('cancelled');
  expect(events[1].note).toBe('khach doi y');
});

test('AC-2 huy tu confirmed giai phong dung so da giu', async () => {
  const ctx = await orderCtx();
  const order = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 10 }],
  });
  await mustTransition(ctx.owner, order.id as number, 'confirm');
  const res = await mustTransition(ctx.owner, order.id as number, 'cancel', {
    note: 'khach huy sau khi xac nhan',
  });
  expect(res.status).toBe('cancelled');
  const level = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(level?.on_hand).toBe(50);
  expect(level?.reserved).toBe(0);
  expect(level?.available).toBe(50);
  const moves = movementRows(ctx.db, `reference = '${order.code as string}'`);
  expect(moves.map((m) => m.type)).toEqual(['reserve', 'release']);
  expect(moves[1].reserved_change).toBe(-10);
  const events = eventsFor(ctx.db, order.id as number);
  expect(events[2].from_status).toBe('confirmed');
  expect(events[2].to_status).toBe('cancelled');
});

test('AC-2 huy khi dang processing giai phong dung so: reserved ve 0, on_hand khong doi, available ve nhu truoc xac nhan', async () => {
  const ctx = await orderCtx();
  const before = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(before?.available).toBe(50);
  const order = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 10 }],
  });
  await mustTransition(ctx.owner, order.id as number, 'confirm');
  await mustTransition(ctx.owner, order.id as number, 'process');
  const res = await mustTransition(ctx.owner, order.id as number, 'cancel', {
    note: 'huy khi dang xu ly',
  });
  expect(res.status).toBe('cancelled');
  const level = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(level?.on_hand).toBe(50);
  expect(level?.reserved).toBe(0);
  expect(level?.available).toBe(50);
  const moves = movementRows(ctx.db, `reference = '${order.code as string}'`);
  expect(moves.map((m) => m.type)).toEqual(['reserve', 'release']);
});

test('AC-2 kho inactive chan xac nhan 400: don tao khi kho active, khoa kho roi xac nhan bi 400, don o lai draft', async () => {
  const ctx = await orderCtx();
  const order = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 5 }],
  });
  const patched = await ctx.owner
    .patch(`/api/warehouses/${ctx.whA.id as number}`)
    .send({ status: 'inactive' });
  expect(patched.status).toBe(200);
  const res = await transition(ctx.owner, order.id as number, 'confirm');
  expect(res.status).toBe(400);
  expect(orderRow(ctx.db, order.id as number).status).toBe('draft');
  const level = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(level?.reserved).toBe(0);
  expect(movementRows(ctx.db, `reference = '${order.code as string}'`)).toHaveLength(0);
});

test('AC-2 order_events append-only: PATCH/DELETE lich su tra 404/405 va lich su van nguyen', async () => {
  const ctx = await orderCtx();
  const order = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  await mustTransition(ctx.owner, order.id as number, 'confirm');
  const events = eventsFor(ctx.db, order.id as number);
  expect(events).toHaveLength(2);
  const eventId = events[0].id as number;
  const patch = await ctx.owner
    .patch(`/api/orders/${order.id as number}/events/${eventId}`)
    .send({ to_status: 'completed' });
  expect([404, 405]).toContain(patch.status);
  const del = await ctx.owner.delete(`/api/orders/${order.id as number}/events/${eventId}`);
  expect([404, 405]).toContain(del.status);
  expect(eventsFor(ctx.db, order.id as number)).toHaveLength(2);
});

// ---------- AC-3: idempotency + chong ban qua ton ----------

test('AC-3 idempotency tao don: gui lai cung Idempotency-Key (header) -> cung ma don, chi 1 don, replayed true', async () => {
  const ctx = await orderCtx();
  const body = {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    customer_name: 'Khach Lap',
    items: [{ variant_id: ctx.v1, qty: 2 }],
  };
  const first = await ctx.owner.post('/api/orders').set('Idempotency-Key', 'ord-001').send(body);
  expect(first.status).toBe(201);
  const code = asOrder(first).code as string;
  const second = await ctx.owner.post('/api/orders').set('Idempotency-Key', 'ord-001').send(body);
  expect([200, 201]).toContain(second.status);
  expect(asOrder(second).code).toBe(code);
  expect(second.body.replayed).toBe(true);
  const count = (
    ctx.db.prepare('SELECT COUNT(*) AS c FROM orders WHERE code = ?').get(code) as { c: number }
  ).c;
  expect(count).toBe(1);
  const list = await ctx.owner.get('/api/orders');
  expect(asListAndTotal(list).total).toBe(1);
});

test('AC-3 idempotency tao don qua body idempotency_key: cung key replayed true, key khac tao don moi', async () => {
  const ctx = await orderCtx();
  const body = {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
    idempotency_key: 'ord-body-001',
  };
  const first = await ctx.owner.post('/api/orders').send(body);
  expect(first.status).toBe(201);
  const code = asOrder(first).code as string;
  const second = await ctx.owner.post('/api/orders').send(body);
  expect([200, 201]).toContain(second.status);
  expect(asOrder(second).code).toBe(code);
  expect(second.body.replayed).toBe(true);
  const other = await ctx.owner.post('/api/orders').send({
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
    idempotency_key: 'ord-body-002',
  });
  expect(other.status).toBe(201);
  expect(asOrder(other).code).not.toBe(code);
  expect(asListAndTotal(await ctx.owner.get('/api/orders')).total).toBe(2);
});

test('AC-3 idempotency xac nhan: gui lai cung key -> replayed true, reserved + movement khong doi; replay tra response cu ngay ca khi don da chuyen tiep', async () => {
  const ctx = await orderCtx();
  const order = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 10 }],
  });
  const first = await transition(ctx.owner, order.id as number, 'confirm', {}, 'cfm-001');
  expect(first.status).toBe(200);
  expect(asOrder(first).status).toBe('confirmed');
  const second = await transition(ctx.owner, order.id as number, 'confirm', {}, 'cfm-001');
  expect(second.status).toBe(200);
  expect(second.body.replayed).toBe(true);
  expect(asOrder(second).status).toBe('confirmed');
  const level = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(level?.reserved).toBe(10);
  expect(movementRows(ctx.db, `reference = '${order.code as string}'`)).toHaveLength(1);
  expect(eventsFor(ctx.db, order.id as number)).toHaveLength(2);
  // Key khac nhau thi thuc thi (va that bai vi don khong con o draft).
  const otherKey = await transition(ctx.owner, order.id as number, 'confirm', {}, 'cfm-002');
  expect(otherKey.status).toBe(400);
  // Don chuyen tiep sang processing, replay key cu van tra response cu.
  await mustTransition(ctx.owner, order.id as number, 'process');
  const replayLater = await transition(ctx.owner, order.id as number, 'confirm', {}, 'cfm-001');
  expect(replayLater.status).toBe(200);
  expect(replayLater.body.replayed).toBe(true);
  expect(asOrder(replayLater).status).toBe('confirmed');
  expect(orderRow(ctx.db, order.id as number).status).toBe('processing');
  const levelAfter = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(levelAfter?.reserved).toBe(10);
});

test('AC-3 race 10 xac nhan dong thoi: tong giu <= available, don vuot 400 insufficient_stock, ton khong am', async () => {
  const ctx = await orderCtx();
  const orders: Record<string, unknown>[] = [];
  for (let i = 0; i < 10; i++) {
    orders.push(
      await mustCreateOrder(ctx.owner, {
        warehouse_id: ctx.whA.id,
        channel: 'counter',
        items: [{ variant_id: ctx.v1, qty: 10 }],
      }),
    );
  }
  const results = await Promise.all(
    orders.map((o) => transition(ctx.owner, o.id as number, 'confirm')),
  );
  const ok = results.filter((r) => r.status === 200);
  const failed = results.filter((r) => r.status === 400);
  expect(ok.length).toBeGreaterThanOrEqual(1);
  expect(ok.length * 10).toBeLessThanOrEqual(50);
  expect(failed.length).toBe(10 - ok.length);
  for (const f of failed) {
    expect(JSON.stringify(f.body)).toContain('insufficient_stock');
  }
  const level = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(level?.on_hand).toBe(50);
  expect(level?.reserved).toBe(ok.length * 10);
  expect(level?.reserved).toBeLessThanOrEqual(level?.on_hand as number);
  expect(level?.available).toBeGreaterThanOrEqual(0);
});

test('AC-3 race xac nhan cung don 2 lan dong thoi (khac key): chi 1 lan thanh cong, lan con lai 400', async () => {
  const ctx = await orderCtx();
  const order = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 10 }],
  });
  const [a, b] = await Promise.all([
    transition(ctx.owner, order.id as number, 'confirm', {}, 'race-a'),
    transition(ctx.owner, order.id as number, 'confirm', {}, 'race-b'),
  ]);
  expect([a.status, b.status].sort()).toEqual([200, 400]);
  const level = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(level?.reserved).toBe(10);
  expect(level?.on_hand).toBe(50);
  expect(movementRows(ctx.db, `reference = '${order.code as string}'`)).toHaveLength(1);
  expect(orderRow(ctx.db, order.id as number).status).toBe('confirmed');
});

test('AC-3 race gui lai cung idempotency key dong thoi: chi 1 lan thuc thi', async () => {
  const ctx = await orderCtx();
  const order = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 10 }],
  });
  const [a, b] = await Promise.all([
    transition(ctx.owner, order.id as number, 'confirm', {}, 'race-same-key'),
    transition(ctx.owner, order.id as number, 'confirm', {}, 'race-same-key'),
  ]);
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  const replayedCount = [a, b].filter((r) => r.body.replayed === true).length;
  expect(replayedCount).toBe(1);
  const level = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(level?.reserved).toBe(10);
  expect(movementRows(ctx.db, `reference = '${order.code as string}'`)).toHaveLength(1);
  expect(eventsFor(ctx.db, order.id as number)).toHaveLength(2);
});

test('AC-3 race tao don cung key dong thoi: chi 1 don duoc tao', async () => {
  const ctx = await orderCtx();
  const body = {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  };
  const [a, b] = await Promise.all([
    ctx.owner.post('/api/orders').set('Idempotency-Key', 'ord-race-001').send(body),
    ctx.owner.post('/api/orders').set('Idempotency-Key', 'ord-race-001').send(body),
  ]);
  expect([a.status, b.status].every((s) => [200, 201].includes(s))).toBe(true);
  expect(asOrder(a).code).toBe(asOrder(b).code);
  expect(asListAndTotal(await ctx.owner.get('/api/orders')).total).toBe(1);
});

// ---------- AC-4: RBAC + audit + checks mo rong ----------

test('AC-4 can() 6 actions don theo ma tran (src/rbac.ts)', () => {
  const owner = orderActor(1, 'owner', 1);
  const manager = orderActor(2, 'manager', null);
  const salesOwn = orderActor(3, 'sales', 1);
  const salesOther = orderActor(4, 'sales', 2);
  const warehouseOwn = orderActor(5, 'warehouse', 1, 10);
  const warehouseOther = orderActor(6, 'warehouse', 1, 11);
  const accountant = orderActor(7, 'accountant', 1);
  const ownBranch = orderTarget(1, 1, 10);
  const otherBranch = orderTarget(1, 2, 10);
  const otherWarehouse = orderTarget(1, 1, 11);
  // create-order: owner/manager/sales dung chi nhanh duoc; warehouse/accountant khong.
  expect(can(owner, 'create-order', ownBranch)).toBe(true);
  expect(can(manager, 'create-order', otherBranch)).toBe(true);
  expect(can(salesOwn, 'create-order', ownBranch)).toBe(true);
  expect(can(salesOwn, 'create-order', otherBranch)).toBe(false);
  expect(can(warehouseOwn, 'create-order', ownBranch)).toBe(false);
  expect(can(accountant, 'create-order', ownBranch)).toBe(false);
  expect(can(owner, 'create-order', orderTarget(2, 1, 10))).toBe(false);
  // confirm-order / cancel-order: nhu create-order.
  expect(can(owner, 'confirm-order', ownBranch)).toBe(true);
  expect(can(salesOwn, 'confirm-order', ownBranch)).toBe(true);
  expect(can(salesOwn, 'confirm-order', otherBranch)).toBe(false);
  expect(can(warehouseOwn, 'confirm-order', ownBranch)).toBe(false);
  expect(can(accountant, 'confirm-order', ownBranch)).toBe(false);
  expect(can(salesOwn, 'cancel-order', ownBranch)).toBe(true);
  expect(can(salesOwn, 'cancel-order', otherBranch)).toBe(false);
  expect(can(warehouseOwn, 'cancel-order', ownBranch)).toBe(false);
  // process-order / complete-order: owner/manager/warehouse dung kho duoc; sales/accountant khong.
  expect(can(owner, 'process-order', ownBranch)).toBe(true);
  expect(can(manager, 'complete-order', ownBranch)).toBe(true);
  expect(can(warehouseOwn, 'process-order', ownBranch)).toBe(true);
  expect(can(warehouseOwn, 'complete-order', ownBranch)).toBe(true);
  expect(can(warehouseOwn, 'process-order', otherWarehouse)).toBe(false);
  expect(can(warehouseOwn, 'complete-order', otherWarehouse)).toBe(false);
  expect(can(salesOwn, 'process-order', ownBranch)).toBe(false);
  expect(can(accountant, 'complete-order', ownBranch)).toBe(false);
  // view-orders: owner/manager/accountant toan org; sales chi chi nhanh minh; warehouse chi kho minh.
  expect(can(owner, 'view-orders', otherBranch)).toBe(true);
  expect(can(manager, 'view-orders', otherBranch)).toBe(true);
  expect(can(accountant, 'view-orders', ownBranch)).toBe(true);
  expect(can(salesOwn, 'view-orders', ownBranch)).toBe(true);
  expect(can(salesOwn, 'view-orders', otherBranch)).toBe(false);
  expect(can(warehouseOwn, 'view-orders', ownBranch)).toBe(true);
  expect(can(warehouseOwn, 'view-orders', otherWarehouse)).toBe(false);
  expect(can(owner, 'view-orders', orderTarget(2, 1, 10))).toBe(false);
});

test('AC-4 RBAC 403 qua HTTP: warehouse tao don, accountant xac nhan, sales xu ly don', async () => {
  const ctx = await orderCtx();
  const created = await ctx.warehouse.post('/api/orders').send({
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  expect(created.status).toBe(403);
  const order = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  const accountantConfirm = await transition(ctx.accountant, order.id as number, 'confirm');
  expect(accountantConfirm.status).toBe(403);
  await mustTransition(ctx.owner, order.id as number, 'confirm');
  const salesProcess = await transition(ctx.sales, order.id as number, 'process');
  expect(salesProcess.status).toBe(403);
  expect(orderRow(ctx.db, order.id as number).status).toBe('confirmed');
});

test('AC-4 sales xac nhan don ngoai chi nhanh 403; sales xem don ngoai chi nhanh 403', async () => {
  const ctx = await orderCtx();
  // Manager (toan org) tao don thuoc chi nhanh 2.
  const order = await mustCreateOrder(ctx.manager, {
    branch_id: ctx.branch2,
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  expect(order.branch_id).toBe(ctx.branch2);
  const salesConfirm = await transition(ctx.sales, order.id as number, 'confirm');
  expect(salesConfirm.status).toBe(403);
  const salesRead = await ctx.sales.get(`/api/orders/${order.id as number}`);
  expect(salesRead.status).toBe(403);
  // Sales dung chi nhanh (sales2) xac nhan duoc.
  const ok = await transition(ctx.sales2, order.id as number, 'confirm');
  expect(ok.status).toBe(200);
});

test('AC-4 warehouse hoan tat don kho ngoai pham vi 403; warehouse trong pham vi duoc xu ly/hoan tat', async () => {
  const ctx = await orderCtx();
  const scope = await ctx.owner
    .patch(`/api/users/${ctx.warehouseId}/scope`)
    .send({ warehouse_id: ctx.whA.id });
  expect(scope.status).toBe(200);
  // Don kho A: warehouse duoc gan xu ly + hoan tat duoc.
  const orderA = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 5 }],
  });
  await mustTransition(ctx.owner, orderA.id as number, 'confirm');
  const processA = await transition(ctx.warehouse, orderA.id as number, 'process');
  expect(processA.status).toBe(200);
  const completeA = await transition(ctx.warehouse, orderA.id as number, 'complete');
  expect(completeA.status).toBe(200);
  expect(orderRow(ctx.db, orderA.id as number).status).toBe('completed');
  // Don kho B: warehouse gan kho A hoan tat bi 403; warehouse chua gan kho lam duoc.
  const orderB = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whB.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 5 }],
  });
  await mustTransition(ctx.owner, orderB.id as number, 'confirm');
  await mustTransition(ctx.owner, orderB.id as number, 'process');
  const completeB = await transition(ctx.warehouse, orderB.id as number, 'complete');
  expect(completeB.status).toBe(403);
  expect(orderRow(ctx.db, orderB.id as number).status).toBe('processing');
  const completeBNull = await transition(ctx.warehouseNull, orderB.id as number, 'complete');
  expect(completeBNull.status).toBe(200);
});

test('AC-4 org A doc don org B 403: ownerB GET chi tiet 403/404, list khong thay don org A', async () => {
  const ctx = await orderCtx();
  const order = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  const detailB = await ctx.ownerB.get(`/api/orders/${order.id as number}`);
  expect([403, 404]).toContain(detailB.status);
  const listB = await ctx.ownerB.get('/api/orders');
  expect(listB.status).toBe(200);
  expect(asListAndTotal(listB).list.some((o) => o.id === order.id)).toBe(false);
  expect(asListAndTotal(listB).total).toBe(0);
});

test('AC-4 audit log don: tao/xac nhan/xu ly/hoan tat/huy deu ghi audit voi actor + detail day du', async () => {
  const ctx = await orderCtx();
  const ownerId = (
    ctx.db.prepare("SELECT id FROM users WHERE email = 'owner@example.local'").get() as {
      id: number;
    }
  ).id;
  const order1 = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 2 }],
  });
  await mustTransition(ctx.owner, order1.id as number, 'confirm');
  await mustTransition(ctx.owner, order1.id as number, 'process');
  await mustTransition(ctx.owner, order1.id as number, 'complete');
  const order2 = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  await mustTransition(ctx.owner, order2.id as number, 'cancel', { note: 'huy de kiem audit' });
  const res = await ctx.owner.get('/api/audit-log');
  expect(res.status).toBe(200);
  const rows = auditRows(ctx.db, ctx.orgId).filter((r) =>
    ['create-order', 'confirm-order', 'process-order', 'complete-order', 'cancel-order'].includes(
      r.action,
    ),
  );
  expect(rows.length).toBeGreaterThanOrEqual(5);
  const byAction = new Map(rows.map((r) => [r.action, r]));
  for (const action of [
    'create-order',
    'confirm-order',
    'process-order',
    'complete-order',
    'cancel-order',
  ]) {
    const row = byAction.get(action);
    expect(row).toBeDefined();
    expect(row?.user_id).toBe(ownerId);
    expect(row?.detail.target_order_id).toBeDefined();
    expect(row?.detail.order_code).toBeDefined();
    expect(typeof row?.detail.total).toBe('number');
  }
  // create-order co 2 ban ghi (order1 + order2); Map theo action chi giu ban cuoi
  // nen tim dung ban ghi cua order1 theo target_order_id.
  const createOrder1 = rows.find(
    (r) => r.action === 'create-order' && r.detail.target_order_id === order1.id,
  );
  expect(createOrder1?.detail.target_order_id).toBe(order1.id);
  expect(createOrder1?.detail.order_code).toBe(order1.code);
  expect(createOrder1?.detail.total).toBe(200000);
  expect(createOrder1?.detail.to_status).toBe('draft');
  expect(byAction.get('confirm-order')?.detail.from_status).toBe('draft');
  expect(byAction.get('confirm-order')?.detail.to_status).toBe('confirmed');
  expect(byAction.get('complete-order')?.detail.from_status).toBe('processing');
  expect(byAction.get('complete-order')?.detail.to_status).toBe('completed');
  expect(byAction.get('cancel-order')?.detail.target_order_id).toBe(order2.id);
  expect(byAction.get('cancel-order')?.detail.to_status).toBe('cancelled');
  // Vai khac owner/manager khong duoc xem audit log.
  const salesAudit = await ctx.sales.get('/api/audit-log');
  expect(salesAudit.status).toBe(403);
});

test('AC-4 RBAC tao don: accountant 403, manager duoc, sales dung chi nhanh duoc, sales sai chi nhanh 403', async () => {
  const ctx = await orderCtx();
  const body = {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  };
  const accountantCreate = await ctx.accountant.post('/api/orders').send(body);
  expect(accountantCreate.status).toBe(403);
  const managerOrder = await mustCreateOrder(ctx.manager, { ...body, branch_id: ctx.branch1 });
  expect(managerOrder.branch_id).toBe(ctx.branch1);
  const salesOrder = await mustCreateOrder(ctx.sales, body);
  expect(salesOrder.branch_id).toBe(ctx.branch1);
  const salesWrongBranch = await ctx.sales.post('/api/orders').send({
    ...body,
    branch_id: ctx.branch2,
  });
  expect(salesWrongBranch.status).toBe(403);
});

test('AC-4 warehouse xem don: chi don co kho trong pham vi; accountant xem duoc toan org', async () => {
  const ctx = await orderCtx();
  const scope = await ctx.owner
    .patch(`/api/users/${ctx.warehouseId}/scope`)
    .send({ warehouse_id: ctx.whA.id });
  expect(scope.status).toBe(200);
  const orderA = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  const orderB = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whB.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  const whList = await ctx.warehouse.get('/api/orders');
  expect(whList.status).toBe(200);
  const whOrders = asListAndTotal(whList);
  expect(whOrders.list.some((o) => o.id === orderA.id)).toBe(true);
  expect(whOrders.list.some((o) => o.id === orderB.id)).toBe(false);
  const whDetailB = await ctx.warehouse.get(`/api/orders/${orderB.id as number}`);
  expect(whDetailB.status).toBe(403);
  const accList = await ctx.accountant.get('/api/orders');
  expect(accList.status).toBe(200);
  expect(asListAndTotal(accList).total).toBe(2);
});
