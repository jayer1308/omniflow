import { test, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { migrate, openDb } from '../src/db.js';
import { can, type Role } from '../src/rbac.js';
import { seed } from '../src/seed.js';
import { applyMovement, stockLevel, withStockIdempotency } from '../src/stock.js';

// Mật khẩu GIẢ LẬP chỉ dùng cho test, không phải credential thật.
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

/** Bối cảnh đầy đủ: org A 2 chi nhánh + đủ 5 vai, org B 1 owner. */
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

/** Lấy mảng từ response (trả trực tiếp hoặc bọc {warehouses}/{levels}/{movements}/{items}/{rows}). */
function asList(res: { body: unknown }): Record<string, unknown>[] {
  const body = res.body as Record<string, unknown>;
  if (Array.isArray(res.body)) return res.body as Record<string, unknown>[];
  for (const key of ['warehouses', 'levels', 'movements', 'low_stock', 'items', 'rows', 'data']) {
    if (Array.isArray(body[key])) return body[key] as Record<string, unknown>[];
  }
  return [];
}

/** Lấy object kho/mức tồn từ response (trả trực tiếp hoặc bọc {warehouse}/{stock}/{level}). */
function asOne(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (
    (body.warehouse as Record<string, unknown>) ??
    (body.stock as Record<string, unknown>) ??
    (body.level as Record<string, unknown>) ??
    body
  );
}

function asUser(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (body.user as Record<string, unknown>) ?? body;
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
  const code = (overrides.code as string) ?? `SP-KHO-${rand()}`;
  const res = await agent.post('/api/products').send({
    code,
    name: 'San pham kho gia lap',
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
  const sku = (overrides.sku as string) ?? `SKU-KHO-${rand()}`;
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

/** Bối cảnh kho: 2 kho (A, B) + 2 biến thể (V1 min_stock 5, V2 min_stock 0). */
async function stockCtx() {
  const ctx = await fullCtx();
  const whA = await createWarehouse(ctx.owner, 'Kho A');
  const whB = await createWarehouse(ctx.owner, 'Kho B');
  const p1 = await createProduct(ctx.owner, { name: 'SP kho 1', min_stock: 5 });
  const v1 = await createVariant(ctx.owner, p1.id);
  const p2 = await createProduct(ctx.owner, { name: 'SP kho 2', min_stock: 0 });
  const v2 = await createVariant(ctx.owner, p2.id);
  return { ...ctx, whA, whB, p1, v1, p2, v2 };
}

/** Nhập kho, bắt buộc thành công (200/201); trả mức tồn mới. */
async function mustStockIn(
  agent: Agent,
  warehouseId: number,
  variantId: number,
  qty: number,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await agent
    .post('/api/stock/in')
    .send({ warehouse_id: warehouseId, variant_id: variantId, qty, reason: 'nhap gia lap', ...extra });
  expect([200, 201]).toContain(res.status);
  return asOne(res);
}

/** Đọc 1 dòng mức tồn qua API; null khi chưa có dòng tồn nào. */
async function levelOf(
  agent: Agent,
  warehouseId: number,
  variantId: number,
): Promise<Record<string, unknown> | null> {
  const res = await agent.get(
    `/api/stock/levels?warehouse_id=${warehouseId}&variant_id=${variantId}`,
  );
  expect(res.status).toBe(200);
  const row = asList(res).find(
    (r) => r.warehouse_id === warehouseId && r.variant_id === variantId,
  );
  return row ?? null;
}

function movementRows(db: Db, where = '1 = 1'): Record<string, unknown>[] {
  return db
    .prepare(`SELECT * FROM stock_movements WHERE ${where} ORDER BY id`)
    .all() as Record<string, unknown>[];
}

function auditRows(db: Db, orgId: number): { action: string; detail: Record<string, unknown>; user_id: number }[] {
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

/** Actor / Target cho can(): warehouseId là trường mở rộng của GOAL-004. */
function stockActor(id: number, role: Role, warehouseId: number | null = null) {
  return { id, orgId: 1, branchId: null as number | null, role, warehouseId };
}

function stockTarget(warehouseId?: number) {
  return warehouseId === undefined ? { orgId: 1 } : { orgId: 1, warehouseId };
}

// ---------- AC-1: kho + lược đồ tồn ----------

test('AC-1 migration 009 tao du 3 bang kho + cot + UNIQUE/CHECK', () => {
  const { db, seeded } = freshApp();
  const names = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);
  for (const t of ['warehouses', 'stock_levels', 'stock_movements']) {
    expect(names).toContain(t);
  }
  const versions = (
    db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
      version: number;
    }[]
  ).map((r) => r.version);
  expect(versions).toContain(9);
  const cols = (table: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  for (const c of ['org_id', 'name', 'branch_id', 'status', 'created_at', 'updated_at']) {
    expect(cols('warehouses')).toContain(c);
  }
  for (const c of ['org_id', 'warehouse_id', 'variant_id', 'on_hand', 'reserved', 'updated_at']) {
    expect(cols('stock_levels')).toContain(c);
  }
  for (const c of [
    'org_id', 'warehouse_id', 'variant_id', 'type', 'qty_change', 'reserved_change',
    'on_hand_after', 'reserved_after', 'reason', 'reference', 'actor_id', 'created_at',
  ]) {
    expect(cols('stock_movements')).toContain(c);
  }
  // UNIQUE + CHECK ở tầng DB: reserved > on_hand bị từ chối, trùng dòng tồn bị từ chối.
  const now = new Date().toISOString();
  const whId = Number(
    db
      .prepare(
        'INSERT INTO warehouses (org_id, name, branch_id, status, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)',
      )
      .run(seeded.orgId, 'Kho DB', 'active', now, now).lastInsertRowid,
  );
  const variant = db.prepare('SELECT id FROM product_variants LIMIT 1').get() as { id: number };
  expect(() =>
    db
      .prepare(
        'INSERT INTO stock_levels (org_id, warehouse_id, variant_id, on_hand, reserved, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(seeded.orgId, whId, variant.id, 5, 10, now),
  ).toThrow();
  db.prepare(
    'INSERT INTO stock_levels (org_id, warehouse_id, variant_id, on_hand, reserved, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(seeded.orgId, whId, variant.id, 10, 0, now);
  expect(() =>
    db
      .prepare(
        'INSERT INTO stock_levels (org_id, warehouse_id, variant_id, on_hand, reserved, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(seeded.orgId, whId, variant.id, 1, 0, now),
  ).toThrow();
});

test('AC-1 tao kho 201 chi owner, manager/warehouse/sales/accountant tao kho bi 403', async () => {
  const ctx = await fullCtx();
  const wh = await createWarehouse(ctx.owner, 'Kho chinh');
  expect(wh.name).toBe('Kho chinh');
  expect(wh.org_id).toBe(ctx.orgId);
  expect(wh.status).toBe('active');
  for (const agent of [ctx.manager, ctx.warehouse, ctx.sales, ctx.accountant]) {
    const res = await agent.post('/api/warehouses').send({ name: 'Kho khong duoc tao' });
    expect(res.status).toBe(403);
  }
  const list = await ctx.owner.get('/api/warehouses');
  expect(list.status).toBe(200);
  expect(asList(list).some((w) => w.id === wh.id)).toBe(true);
});

test('AC-1 tao kho ten rong bi 400; GET list loc status/branch_id; GET chi tiet', async () => {
  const ctx = await fullCtx();
  const empty = await ctx.owner.post('/api/warehouses').send({ name: '   ' });
  expect(empty.status).toBe(400);
  const whA = await createWarehouse(ctx.owner, 'Kho loc A', { branch_id: ctx.branch2 });
  expect(whA.branch_id).toBe(ctx.branch2);
  const whB = await createWarehouse(ctx.owner, 'Kho loc B');
  const patch = await ctx.owner.patch(`/api/warehouses/${whB.id as number}`).send({ status: 'inactive' });
  expect([200, 201]).toContain(patch.status);
  const inactive = await ctx.owner.get('/api/warehouses?status=inactive');
  expect(inactive.status).toBe(200);
  expect(asList(inactive).some((w) => w.id === whB.id)).toBe(true);
  expect(asList(inactive).some((w) => w.id === whA.id)).toBe(false);
  const active = await ctx.owner.get('/api/warehouses?status=active');
  expect(asList(active).some((w) => w.id === whA.id)).toBe(true);
  expect(asList(active).some((w) => w.id === whB.id)).toBe(false);
  const byBranch = await ctx.owner.get(`/api/warehouses?branch_id=${ctx.branch2}`);
  expect(asList(byBranch).some((w) => w.id === whA.id)).toBe(true);
  expect(asList(byBranch).some((w) => w.id === whB.id)).toBe(false);
  const detail = await ctx.owner.get(`/api/warehouses/${whA.id as number}`);
  expect(detail.status).toBe(200);
  expect(asOne(detail).name).toBe('Kho loc A');
  expect(asOne(detail).branch_id).toBe(ctx.branch2);
  const missing = await ctx.owner.get('/api/warehouses/999999');
  expect(missing.status).toBe(404);
});

test('AC-1 PATCH doi ten/status chi owner; manager PATCH bi 403; kho inactive van doc duoc', async () => {
  const ctx = await fullCtx();
  const wh = await createWarehouse(ctx.owner, 'Kho cu');
  const renamed = await ctx.owner.patch(`/api/warehouses/${wh.id as number}`).send({ name: 'Kho moi' });
  expect([200, 201]).toContain(renamed.status);
  expect(asOne(renamed).name).toBe('Kho moi');
  const forbidden = await ctx.manager.patch(`/api/warehouses/${wh.id as number}`).send({ name: 'Manager doi' });
  expect(forbidden.status).toBe(403);
  const deactivated = await ctx.owner
    .patch(`/api/warehouses/${wh.id as number}`)
    .send({ status: 'inactive' });
  expect([200, 201]).toContain(deactivated.status);
  expect(asOne(deactivated).status).toBe('inactive');
  const detail = await ctx.owner.get(`/api/warehouses/${wh.id as number}`);
  expect(detail.status).toBe(200);
  expect(asOne(detail).status).toBe('inactive');
  const movements = await ctx.owner.get(`/api/stock/movements?warehouse_id=${wh.id as number}`);
  expect(movements.status).toBe(200);
  expect(Array.isArray(asList(movements))).toBe(true);
});

test('AC-1 khong co endpoint DELETE kho: DELETE tra 404/405 va kho van doc duoc', async () => {
  const ctx = await fullCtx();
  const wh = await createWarehouse(ctx.owner, 'Kho khong xoa');
  const del = await ctx.owner.delete(`/api/warehouses/${wh.id as number}`);
  expect([404, 405]).toContain(del.status);
  const still = await ctx.owner.get(`/api/warehouses/${wh.id as number}`);
  expect(still.status).toBe(200);
  expect(asOne(still).name).toBe('Kho khong xoa');
});

test('AC-1 nhap kho san pham chua co bien the: thieu variant_id bi 400, variant_id khong ton tai bi 404', async () => {
  const ctx = await fullCtx();
  const wh = await createWarehouse(ctx.owner, 'Kho bien the');
  const noVariantProduct = await createProduct(ctx.owner, { name: 'SP chua co bien the' });
  expect(noVariantProduct.id).toBeDefined();
  const missingVariant = await ctx.owner.post('/api/stock/in').send({
    warehouse_id: wh.id,
    qty: 10,
    reason: 'nhap khong co bien the',
  });
  expect(missingVariant.status).toBe(400);
  const unknownVariant = await ctx.owner.post('/api/stock/in').send({
    warehouse_id: wh.id,
    variant_id: 999999,
    qty: 10,
    reason: 'nhap bien the khong ton tai',
  });
  expect([404, 403]).toContain(unknownVariant.status);
});

test('AC-1 ton bien the ngoai org bi 403/404; ownerB xem levels khong thay org A', async () => {
  const ctx = await stockCtx();
  const crossIn = await ctx.ownerB.post('/api/stock/in').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 10,
    reason: 'nhap trom org A',
  });
  expect([403, 404]).toContain(crossIn.status);
  const whB = await createWarehouse(ctx.ownerB, 'Kho B org B');
  const crossVariant = await ctx.ownerB.post('/api/stock/in').send({
    warehouse_id: whB.id,
    variant_id: ctx.v1,
    qty: 10,
    reason: 'bien the org A vao kho org B',
  });
  expect([403, 404]).toContain(crossVariant.status);
  await mustStockIn(ctx.owner, ctx.whA.id as number, ctx.v1, 10);
  const levelsB = await ctx.ownerB.get('/api/stock/levels');
  expect(levelsB.status).toBe(200);
  expect(asList(levelsB).some((r) => r.variant_id === ctx.v1)).toBe(false);
});

test('AC-1 stock_movements append-only: PATCH/DELETE lich su tra 404/405 va lich su van nguyen', async () => {
  const ctx = await stockCtx();
  await mustStockIn(ctx.owner, ctx.whA.id as number, ctx.v1, 10);
  const before = movementRows(ctx.db, `variant_id = ${ctx.v1}`);
  expect(before.length).toBe(1);
  const movementId = before[0].id as number;
  const patch = await ctx.owner.patch(`/api/stock/movements/${movementId}`).send({ reason: 'sua lich su' });
  expect([404, 405]).toContain(patch.status);
  const del = await ctx.owner.delete(`/api/stock/movements/${movementId}`);
  expect([404, 405]).toContain(del.status);
  const after = movementRows(ctx.db, `variant_id = ${ctx.v1}`);
  expect(after.length).toBe(1);
  expect(after[0].reason).toBe('nhap gia lap');
});

// ---------- AC-2: nhập/xuất/điều chỉnh/kiểm kê/chuyển/giữ/giải phóng + đọc tồn ----------

test('AC-2 nhap kho dung so hoc: in 50 -> on_hand 50, available 50, movement in', async () => {
  const ctx = await stockCtx();
  const level = await mustStockIn(ctx.owner, ctx.whA.id as number, ctx.v1, 50);
  expect(level.on_hand).toBe(50);
  expect(level.reserved).toBe(0);
  expect(level.available).toBe(50);
  expect(level.low_stock).toBe(false);
  const rows = movementRows(ctx.db, `variant_id = ${ctx.v1} AND type = 'in'`);
  expect(rows.length).toBe(1);
  expect(rows[0].qty_change).toBe(50);
  expect(rows[0].reserved_change).toBe(0);
  expect(rows[0].on_hand_after).toBe(50);
  expect(rows[0].reserved_after).toBe(0);
  expect(rows[0].reason).toBe('nhap gia lap');
  expect(rows[0].actor_id).toBeDefined();
});

test('AC-2 xuat kho dung so hoc va xuat khong tru reserved: in 50, giu 10, xuat 20', async () => {
  const ctx = await stockCtx();
  await mustStockIn(ctx.owner, ctx.whA.id as number, ctx.v1, 50);
  const reserved = await ctx.owner.post('/api/stock/reserve').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 10,
    reason: 'giu hang',
  });
  expect([200, 201]).toContain(reserved.status);
  expect(asOne(reserved).reserved).toBe(10);
  expect(asOne(reserved).on_hand).toBe(50);
  expect(asOne(reserved).available).toBe(40);
  const out = await ctx.owner.post('/api/stock/out').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 20,
    reason: 'xuat hang',
  });
  expect([200, 201]).toContain(out.status);
  expect(asOne(out).on_hand).toBe(30);
  expect(asOne(out).reserved).toBe(10);
  expect(asOne(out).available).toBe(20);
  const rows = movementRows(ctx.db, `variant_id = ${ctx.v1} AND type = 'out'`);
  expect(rows.length).toBe(1);
  expect(rows[0].qty_change).toBe(-20);
  expect(rows[0].on_hand_after).toBe(30);
  expect(rows[0].reserved_after).toBe(10);
});

test('AC-2 xuat qua available bi 400 insufficient_stock va KHONG ghi movement', async () => {
  const ctx = await stockCtx();
  await mustStockIn(ctx.owner, ctx.whA.id as number, ctx.v1, 50);
  await ctx.owner.post('/api/stock/reserve').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 10,
    reason: 'giu hang',
  });
  const before = movementRows(ctx.db, `variant_id = ${ctx.v1}`).length;
  const over = await ctx.owner.post('/api/stock/out').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 45,
    reason: 'xuat qua available',
  });
  expect(over.status).toBe(400);
  expect(JSON.stringify(over.body)).toMatch(/insufficient_stock/);
  expect(movementRows(ctx.db, `variant_id = ${ctx.v1}`).length).toBe(before);
  const level = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(level?.on_hand).toBe(50);
  expect(level?.reserved).toBe(10);
});

test('AC-2 nhap/xuat sai du lieu bi 400: qty 0/am/khong nguyen, thieu reason, kho/bien the khong ton tai', async () => {
  const ctx = await stockCtx();
  const badQty = [0, -5, 2.5];
  for (const qty of badQty) {
    const res = await ctx.owner.post('/api/stock/in').send({
      warehouse_id: ctx.whA.id,
      variant_id: ctx.v1,
      qty,
      reason: 'qty sai',
    });
    expect(res.status).toBe(400);
    const out = await ctx.owner.post('/api/stock/out').send({
      warehouse_id: ctx.whA.id,
      variant_id: ctx.v1,
      qty,
      reason: 'qty sai',
    });
    expect(out.status).toBe(400);
  }
  for (const body of [{ qty: 10 }, { qty: 10, reason: '  ' }, { qty: 10, reason: '' }]) {
    const res = await ctx.owner.post('/api/stock/in').send({
      warehouse_id: ctx.whA.id,
      variant_id: ctx.v1,
      ...body,
    });
    expect(res.status).toBe(400);
  }
  const noWarehouse = await ctx.owner.post('/api/stock/in').send({
    warehouse_id: 999999,
    variant_id: ctx.v1,
    qty: 10,
    reason: 'kho khong ton tai',
  });
  expect([404, 403]).toContain(noWarehouse.status);
  const noVariant = await ctx.owner.post('/api/stock/in').send({
    warehouse_id: ctx.whA.id,
    variant_id: 999999,
    qty: 10,
    reason: 'bien the khong ton tai',
  });
  expect([404, 403]).toContain(noVariant.status);
});

test('AC-2 bien the san pham ngung kinh doanh van nhap/xuat duoc', async () => {
  const ctx = await stockCtx();
  const stop = await ctx.owner.patch(`/api/products/${ctx.p1.id}/status`).send({ status: 'discontinued' });
  expect(stop.status).toBe(200);
  const level = await mustStockIn(ctx.owner, ctx.whA.id as number, ctx.v1, 10);
  expect(level.on_hand).toBe(10);
  const out = await ctx.owner.post('/api/stock/out').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 4,
    reason: 'xuat hang ngung kinh doanh',
  });
  expect([200, 201]).toContain(out.status);
  expect(asOne(out).on_hand).toBe(6);
});

test('AC-2 giu/giai phong dung so hoc: reserve/release, vuot available/reserved bi 400, reference luu lai', async () => {
  const ctx = await stockCtx();
  await mustStockIn(ctx.owner, ctx.whA.id as number, ctx.v1, 50);
  const overReserve = await ctx.owner.post('/api/stock/reserve').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 60,
    reason: 'giu qua available',
  });
  expect(overReserve.status).toBe(400);
  expect(JSON.stringify(overReserve.body)).toMatch(/insufficient_stock/);
  const reserve = await ctx.owner.post('/api/stock/reserve').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 10,
    reason: 'giu cho don',
    reference: 'DON-GIA-LAP-001',
  });
  expect([200, 201]).toContain(reserve.status);
  expect(asOne(reserve).on_hand).toBe(50);
  expect(asOne(reserve).reserved).toBe(10);
  expect(asOne(reserve).available).toBe(40);
  const reserveRows = movementRows(ctx.db, `variant_id = ${ctx.v1} AND type = 'reserve'`);
  expect(reserveRows.length).toBe(1);
  expect(reserveRows[0].qty_change).toBe(0);
  expect(reserveRows[0].reserved_change).toBe(10);
  expect(reserveRows[0].reference).toBe('DON-GIA-LAP-001');
  const overRelease = await ctx.owner.post('/api/stock/release').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 11,
    reason: 'giai phong qua reserved',
  });
  expect(overRelease.status).toBe(400);
  const release = await ctx.owner.post('/api/stock/release').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 4,
    reason: 'giai phong mot phan',
  });
  expect([200, 201]).toContain(release.status);
  expect(asOne(release).reserved).toBe(6);
  expect(asOne(release).on_hand).toBe(50);
  expect(asOne(release).available).toBe(44);
  const releaseRows = movementRows(ctx.db, `variant_id = ${ctx.v1} AND type = 'release'`);
  expect(releaseRows.length).toBe(1);
  expect(releaseRows[0].reserved_change).toBe(-4);
  expect(releaseRows[0].qty_change).toBe(0);
});

test('AC-2 dieu chinh dung so hoc + ly do bat buoc; adjust 0 hoac lam on_hand < reserved bi 400, khong ghi movement', async () => {
  const ctx = await stockCtx();
  await mustStockIn(ctx.owner, ctx.whA.id as number, ctx.v1, 50);
  await ctx.owner.post('/api/stock/reserve').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 10,
    reason: 'giu hang',
  });
  const minus = await ctx.owner.post('/api/stock/adjust').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty_change: -5,
    reason: 'hao hut',
  });
  expect([200, 201]).toContain(minus.status);
  expect(asOne(minus).on_hand).toBe(45);
  expect(asOne(minus).reserved).toBe(10);
  const plus = await ctx.owner.post('/api/stock/adjust').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty_change: 10,
    reason: 'tim thay hang thua',
  });
  expect([200, 201]).toContain(plus.status);
  expect(asOne(plus).on_hand).toBe(55);
  const adjustRows = movementRows(ctx.db, `variant_id = ${ctx.v1} AND type = 'adjust'`);
  expect(adjustRows.length).toBe(2);
  expect(adjustRows[0].qty_change).toBe(-5);
  expect(adjustRows[1].qty_change).toBe(10);
  const before = movementRows(ctx.db, `variant_id = ${ctx.v1}`).length;
  const zero = await ctx.owner.post('/api/stock/adjust').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty_change: 0,
    reason: 'delta 0',
  });
  expect(zero.status).toBe(400);
  const belowReserved = await ctx.owner.post('/api/stock/adjust').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty_change: -50,
    reason: 'lam on_hand nho hon reserved',
  });
  expect(belowReserved.status).toBe(400);
  const noReason = await ctx.owner.post('/api/stock/adjust').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty_change: 1,
  });
  expect(noReason.status).toBe(400);
  expect(movementRows(ctx.db, `variant_id = ${ctx.v1}`).length).toBe(before);
  const level = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(level?.on_hand).toBe(55);
});

test('AC-2 kiem ke dat tuyet doi: count 30 khi on_hand 50, movement count qty_change -20; counted_qty < reserved bi 400', async () => {
  const ctx = await stockCtx();
  await mustStockIn(ctx.owner, ctx.whA.id as number, ctx.v1, 50);
  await ctx.owner.post('/api/stock/reserve').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 10,
    reason: 'giu hang',
  });
  const counted = await ctx.owner.post('/api/stock/count').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    counted_qty: 30,
    reason: 'kiem ke dinh ky',
  });
  expect([200, 201]).toContain(counted.status);
  expect(asOne(counted).on_hand).toBe(30);
  expect(asOne(counted).reserved).toBe(10);
  expect(asOne(counted).available).toBe(20);
  const countRows = movementRows(ctx.db, `variant_id = ${ctx.v1} AND type = 'count'`);
  expect(countRows.length).toBe(1);
  expect(countRows[0].qty_change).toBe(-20);
  expect(countRows[0].on_hand_after).toBe(30);
  const up = await ctx.owner.post('/api/stock/count').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    counted_qty: 60,
    reason: 'kiem ke thay thua',
  });
  expect([200, 201]).toContain(up.status);
  expect(asOne(up).on_hand).toBe(60);
  expect(movementRows(ctx.db, `variant_id = ${ctx.v1} AND type = 'count'`)[1].qty_change).toBe(30);
  const before = movementRows(ctx.db, `variant_id = ${ctx.v1}`).length;
  const belowReserved = await ctx.owner.post('/api/stock/count').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    counted_qty: 5,
    reason: 'dem thieu hon reserved',
  });
  expect(belowReserved.status).toBe(400);
  const negative = await ctx.owner.post('/api/stock/count').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    counted_qty: -1,
    reason: 'so am',
  });
  expect(negative.status).toBe(400);
  const noReason = await ctx.owner.post('/api/stock/count').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    counted_qty: 60,
  });
  expect(noReason.status).toBe(400);
  expect(movementRows(ctx.db, `variant_id = ${ctx.v1}`).length).toBe(before);
});

test('AC-2 chuyen kho thanh cong nguyen tu: 2 movement transfer_out/transfer_in dung so hoc', async () => {
  const ctx = await stockCtx();
  await mustStockIn(ctx.owner, ctx.whA.id as number, ctx.v1, 50);
  const transfer = await ctx.owner.post('/api/stock/transfer').send({
    from_warehouse_id: ctx.whA.id,
    to_warehouse_id: ctx.whB.id,
    variant_id: ctx.v1,
    qty: 20,
    reason: 'chuyen kho can bang',
  });
  expect([200, 201]).toContain(transfer.status);
  const levelA = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  const levelB = await levelOf(ctx.owner, ctx.whB.id as number, ctx.v1);
  expect(levelA?.on_hand).toBe(30);
  expect(levelB?.on_hand).toBe(20);
  const outRows = movementRows(
    ctx.db,
    `variant_id = ${ctx.v1} AND type = 'transfer_out' AND warehouse_id = ${ctx.whA.id as number}`,
  );
  const inRows = movementRows(
    ctx.db,
    `variant_id = ${ctx.v1} AND type = 'transfer_in' AND warehouse_id = ${ctx.whB.id as number}`,
  );
  expect(outRows.length).toBe(1);
  expect(outRows[0].qty_change).toBe(-20);
  expect(outRows[0].on_hand_after).toBe(30);
  expect(inRows.length).toBe(1);
  expect(inRows[0].qty_change).toBe(20);
  expect(inRows[0].on_hand_after).toBe(20);
});

test('AC-2 chuyen kho nguon khong du bi 400 insufficient_stock, kho dich khong doi; hai kho giong nhau bi 400', async () => {
  const ctx = await stockCtx();
  await mustStockIn(ctx.owner, ctx.whA.id as number, ctx.v1, 50);
  const before = movementRows(ctx.db, `variant_id = ${ctx.v1}`).length;
  const over = await ctx.owner.post('/api/stock/transfer').send({
    from_warehouse_id: ctx.whA.id,
    to_warehouse_id: ctx.whB.id,
    variant_id: ctx.v1,
    qty: 60,
    reason: 'chuyen qua ton',
  });
  expect(over.status).toBe(400);
  expect(JSON.stringify(over.body)).toMatch(/insufficient_stock/);
  expect(movementRows(ctx.db, `variant_id = ${ctx.v1}`).length).toBe(before);
  expect(await levelOf(ctx.owner, ctx.whB.id as number, ctx.v1)).toBeNull();
  expect((await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1))?.on_hand).toBe(50);
  const same = await ctx.owner.post('/api/stock/transfer').send({
    from_warehouse_id: ctx.whA.id,
    to_warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 5,
    reason: 'chuyen cung kho',
  });
  expect(same.status).toBe(400);
  const inactivePatch = await ctx.owner.patch(`/api/warehouses/${ctx.whB.id as number}`).send({ status: 'inactive' });
  expect([200, 201]).toContain(inactivePatch.status);
  const toInactive = await ctx.owner.post('/api/stock/transfer').send({
    from_warehouse_id: ctx.whA.id,
    to_warehouse_id: ctx.whB.id,
    variant_id: ctx.v1,
    qty: 5,
    reason: 'chuyen vao kho inactive',
  });
  expect(toInactive.status).toBe(400);
  expect((await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1))?.on_hand).toBe(50);
});

test('AC-2 doc levels: loc warehouse/variant/low_stock, kem product_id/sku/available/low_stock, phan trang', async () => {
  const ctx = await stockCtx();
  await mustStockIn(ctx.owner, ctx.whA.id as number, ctx.v1, 3);
  await mustStockIn(ctx.owner, ctx.whA.id as number, ctx.v2, 10);
  await mustStockIn(ctx.owner, ctx.whB.id as number, ctx.v1, 20);
  const byWarehouse = await ctx.owner.get(`/api/stock/levels?warehouse_id=${ctx.whA.id as number}`);
  expect(byWarehouse.status).toBe(200);
  expect(asList(byWarehouse).length).toBe(2);
  expect(asList(byWarehouse).every((r) => r.warehouse_id === ctx.whA.id)).toBe(true);
  const byVariant = await ctx.owner.get(`/api/stock/levels?variant_id=${ctx.v1}`);
  expect(asList(byVariant).length).toBe(2);
  expect(asList(byVariant).every((r) => r.variant_id === ctx.v1)).toBe(true);
  const lowOnly = await ctx.owner.get('/api/stock/levels?low_stock=true');
  expect(lowOnly.status).toBe(200);
  expect(asList(lowOnly).some((r) => r.variant_id === ctx.v1 && r.warehouse_id === ctx.whA.id)).toBe(true);
  expect(asList(lowOnly).some((r) => r.variant_id === ctx.v2)).toBe(false);
  const page = await ctx.owner.get('/api/stock/levels?limit=1&offset=0');
  expect(asList(page).length).toBeLessThanOrEqual(1);
  const all = await ctx.owner.get('/api/stock/levels');
  const rowV1A = asList(all).find((r) => r.variant_id === ctx.v1 && r.warehouse_id === ctx.whA.id);
  expect(rowV1A).toBeDefined();
  expect(rowV1A?.product_id).toBe(ctx.p1.id);
  expect(rowV1A?.sku).toBeDefined();
  expect(rowV1A?.on_hand).toBe(3);
  expect(rowV1A?.reserved).toBe(0);
  expect(rowV1A?.available).toBe(3);
  expect(rowV1A?.low_stock).toBe(true);
  const rowV2A = asList(all).find((r) => r.variant_id === ctx.v2 && r.warehouse_id === ctx.whA.id);
  expect(rowV2A?.available).toBe(10);
  expect(rowV2A?.low_stock).toBe(false);
});

test('AC-2 doc movements: moi nhat truoc, loc type/warehouse/variant, kem on_hand_after/reserved_after/reason/reference/actor_id', async () => {
  const ctx = await stockCtx();
  await mustStockIn(ctx.owner, ctx.whA.id as number, ctx.v1, 50);
  await ctx.owner.post('/api/stock/reserve').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 10,
    reason: 'giu 10',
    reference: 'REF-1',
  });
  await ctx.owner.post('/api/stock/out').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 20,
    reason: 'xuat 20',
  });
  const res = await ctx.owner.get(`/api/stock/movements?variant_id=${ctx.v1}`);
  expect(res.status).toBe(200);
  const rows = asList(res);
  expect(rows.length).toBe(3);
  expect(rows[0].type).toBe('out');
  expect(rows[1].type).toBe('reserve');
  expect(rows[2].type).toBe('in');
  expect(rows[0].on_hand_after).toBe(30);
  expect(rows[0].reserved_after).toBe(10);
  expect(rows[0].reason).toBe('xuat 20');
  expect(rows[1].reference).toBe('REF-1');
  expect(rows[0].actor_id).toBeDefined();
  const onlyIn = await ctx.owner.get(`/api/stock/movements?variant_id=${ctx.v1}&type=in`);
  expect(asList(onlyIn).length).toBe(1);
  expect(asList(onlyIn)[0].type).toBe('in');
  const byWarehouse = await ctx.owner.get(`/api/stock/movements?warehouse_id=${ctx.whA.id as number}`);
  expect(asList(byWarehouse).length).toBe(3);
  const emptyOther = await ctx.owner.get(`/api/stock/movements?warehouse_id=${ctx.whB.id as number}`);
  expect(asList(emptyOther).length).toBe(0);
});

test('AC-2 stockLevel/applyMovement truc tiep dung so hoc (src/stock.ts)', async () => {
  const { db, app, seeded } = freshApp();
  const owner = await ownerAgent(app, seeded);
  const wh = await createWarehouse(owner, 'Kho truc tiep');
  const { id: pid } = await createProduct(owner, { name: 'SP truc tiep', min_stock: 0 });
  const vid = await createVariant(owner, pid);
  const ownerRow = db.prepare('SELECT id FROM users WHERE email = ?').get(seeded.ownerEmail) as { id: number };
  expect(stockLevel(db, seeded.orgId, wh.id as number, vid)).toBeNull();
  const afterIn = applyMovement(db, seeded.orgId, ownerRow.id, {
    warehouse_id: wh.id as number,
    variant_id: vid,
    type: 'in',
    qty_change: 20,
    reason: 'nhap truc tiep',
  });
  expect(afterIn.on_hand).toBe(20);
  expect(afterIn.reserved).toBe(0);
  expect(afterIn.available).toBe(20);
  const afterReserve = applyMovement(db, seeded.orgId, ownerRow.id, {
    warehouse_id: wh.id as number,
    variant_id: vid,
    type: 'reserve',
    qty_change: 0,
    reserved_change: 5,
    reason: 'giu truc tiep',
  });
  expect(afterReserve.on_hand).toBe(20);
  expect(afterReserve.reserved).toBe(5);
  expect(afterReserve.available).toBe(15);
  const readBack = stockLevel(db, seeded.orgId, wh.id as number, vid);
  expect(readBack?.on_hand).toBe(20);
  expect(readBack?.reserved).toBe(5);
  expect(readBack?.available).toBe(15);
  expect(movementRows(db, `variant_id = ${vid}`).length).toBe(2);
});

// ---------- AC-3: idempotency + chống race + tồn thấp ----------

test('AC-3 idempotency in gui lai cung Idempotency-Key: replayed true, ton + movement khong doi', async () => {
  const ctx = await stockCtx();
  const key = 'key-nhap-lai-001';
  const first = await ctx.owner
    .post('/api/stock/in')
    .set('Idempotency-Key', key)
    .send({ warehouse_id: ctx.whA.id, variant_id: ctx.v1, qty: 40, reason: 'nhap lan dau' });
  expect([200, 201]).toContain(first.status);
  expect(first.body.replayed).not.toBe(true);
  const countBefore = movementRows(ctx.db, `variant_id = ${ctx.v1}`).length;
  expect(countBefore).toBe(1);
  const replay = await ctx.owner
    .post('/api/stock/in')
    .set('Idempotency-Key', key)
    .send({ warehouse_id: ctx.whA.id, variant_id: ctx.v1, qty: 40, reason: 'nhap lan dau' });
  expect([200, 201]).toContain(replay.status);
  expect(replay.body.replayed).toBe(true);
  expect(movementRows(ctx.db, `variant_id = ${ctx.v1}`).length).toBe(countBefore);
  const level = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(level?.on_hand).toBe(40);
  // Gửi lại lần 3 vẫn replay, không trừ/cộng thêm.
  const replay3 = await ctx.owner
    .post('/api/stock/in')
    .set('Idempotency-Key', key)
    .send({ warehouse_id: ctx.whA.id, variant_id: ctx.v1, qty: 40, reason: 'nhap lan dau' });
  expect(replay3.body.replayed).toBe(true);
  expect((await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1))?.on_hand).toBe(40);
});

test('AC-3 idempotency key khac nhau thi thuc thi; thieu key van thuc thi; cung key khac loai khong va nhau', async () => {
  const ctx = await stockCtx();
  const inA = await ctx.owner
    .post('/api/stock/in')
    .set('Idempotency-Key', 'key-khac-loai')
    .send({ warehouse_id: ctx.whA.id, variant_id: ctx.v1, qty: 50, reason: 'nhap 50' });
  expect([200, 201]).toContain(inA.status);
  const inB = await ctx.owner
    .post('/api/stock/in')
    .set('Idempotency-Key', 'key-khac-nhau-2')
    .send({ warehouse_id: ctx.whA.id, variant_id: ctx.v1, qty: 30, reason: 'nhap 30' });
  expect([200, 201]).toContain(inB.status);
  expect(inB.body.replayed).not.toBe(true);
  const noKey = await ctx.owner.post('/api/stock/in').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 5,
    reason: 'nhap khong key',
  });
  expect([200, 201]).toContain(noKey.status);
  // Cùng key nhưng khác loại thao tác (out) thì vẫn thực thi, không replay.
  const outSameKey = await ctx.owner
    .post('/api/stock/out')
    .set('Idempotency-Key', 'key-khac-loai')
    .send({ warehouse_id: ctx.whA.id, variant_id: ctx.v1, qty: 10, reason: 'xuat 10' });
  expect([200, 201]).toContain(outSameKey.status);
  expect(outSameKey.body.replayed).not.toBe(true);
  const level = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(level?.on_hand).toBe(50 + 30 + 5 - 10);
  // idempotency_key trong body cũng được chấp nhận.
  const bodyKey = await ctx.owner.post('/api/stock/in').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 7,
    reason: 'nhap body key',
    idempotency_key: 'key-body-001',
  });
  expect([200, 201]).toContain(bodyKey.status);
  const bodyReplay = await ctx.owner.post('/api/stock/in').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 7,
    reason: 'nhap body key',
    idempotency_key: 'key-body-001',
  });
  expect(bodyReplay.body.replayed).toBe(true);
  expect((await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1))?.on_hand).toBe(50 + 30 + 5 - 10 + 7);
});

test('AC-3 idempotency dong thoi cung key: chi 1 lan thuc thi', async () => {
  const ctx = await stockCtx();
  const key = 'key-dong-thoi-001';
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      ctx.owner
        .post('/api/stock/in')
        .set('Idempotency-Key', key)
        .send({ warehouse_id: ctx.whA.id, variant_id: ctx.v1, qty: 10, reason: 'nhap dong thoi' }),
    ),
  );
  for (const res of results) {
    expect([200, 201]).toContain(res.status);
  }
  const replayedCount = results.filter((r) => r.body.replayed === true).length;
  const freshCount = results.filter((r) => r.body.replayed !== true).length;
  expect(freshCount).toBe(1);
  expect(replayedCount).toBe(4);
  expect(movementRows(ctx.db, `variant_id = ${ctx.v1} AND type = 'in'`).length).toBe(1);
  const level = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(level?.on_hand).toBe(10);
});

test('AC-3 race xuat dong thoi: 10 yeu cau xuat 10 khi available 50, tong xuat <= 50, ton khong am', async () => {
  const ctx = await stockCtx();
  await mustStockIn(ctx.owner, ctx.whA.id as number, ctx.v1, 50);
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      ctx.owner.post('/api/stock/out').send({
        warehouse_id: ctx.whA.id,
        variant_id: ctx.v1,
        qty: 10,
        reason: 'xuat dong thoi',
      }),
    ),
  );
  const succeeded = results.filter((r) => [200, 201].includes(r.status));
  const failed = results.filter((r) => r.status === 400);
  expect(succeeded.length).toBeGreaterThanOrEqual(1);
  expect(succeeded.length).toBeLessThanOrEqual(5);
  expect(succeeded.length + failed.length).toBe(10);
  for (const res of failed) {
    expect(JSON.stringify(res.body)).toMatch(/insufficient_stock/);
  }
  const level = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(level?.on_hand).toBeGreaterThanOrEqual(0);
  expect(level?.on_hand).toBe(50 - succeeded.length * 10);
  expect(movementRows(ctx.db, `variant_id = ${ctx.v1} AND type = 'out'`).length).toBe(succeeded.length);
});

test('AC-3 ton thap dung cap theo min_stock: low-stock tra dung cap kem min_stock/available; levels kem co low_stock', async () => {
  const ctx = await stockCtx();
  await mustStockIn(ctx.owner, ctx.whA.id as number, ctx.v1, 3);
  await mustStockIn(ctx.owner, ctx.whA.id as number, ctx.v2, 10);
  await mustStockIn(ctx.owner, ctx.whB.id as number, ctx.v1, 20);
  const res = await ctx.owner.get('/api/stock/low-stock');
  expect(res.status).toBe(200);
  const rows = asList(res);
  const lowV1A = rows.find((r) => r.variant_id === ctx.v1 && r.warehouse_id === ctx.whA.id);
  expect(lowV1A).toBeDefined();
  expect(lowV1A?.min_stock).toBe(5);
  expect(lowV1A?.available).toBe(3);
  expect(lowV1A?.on_hand).toBe(3);
  expect(lowV1A?.reserved).toBe(0);
  expect(rows.some((r) => r.variant_id === ctx.v2)).toBe(false);
  expect(rows.some((r) => r.variant_id === ctx.v1 && r.warehouse_id === ctx.whB.id)).toBe(false);
  const byWarehouse = await ctx.owner.get(`/api/stock/low-stock?warehouse_id=${ctx.whB.id as number}`);
  expect(asList(byWarehouse).length).toBe(0);
  const levels = await ctx.owner.get('/api/stock/levels');
  const rowV1A = asList(levels).find((r) => r.variant_id === ctx.v1 && r.warehouse_id === ctx.whA.id);
  expect(rowV1A?.low_stock).toBe(true);
  const rowV1B = asList(levels).find((r) => r.variant_id === ctx.v1 && r.warehouse_id === ctx.whB.id);
  expect(rowV1B?.low_stock).toBe(false);
});

test('AC-3 withStockIdempotency truc tiep: gui lai cung key khong thuc thi lai (src/stock.ts)', () => {
  const { db } = freshApp();
  let executions = 0;
  const execute = () => {
    executions += 1;
    return JSON.stringify({ ok: true, executions });
  };
  const first = withStockIdempotency(db, 1, 'stock:in:key-truc-tiep-1', execute);
  expect(first.replayed).toBe(false);
  expect(first.result).toBe(JSON.stringify({ ok: true, executions: 1 }));
  expect(executions).toBe(1);
  const second = withStockIdempotency(db, 1, 'stock:in:key-truc-tiep-1', execute);
  expect(second.replayed).toBe(true);
  expect(second.result).toBe(first.result);
  expect(executions).toBe(1);
  const otherKey = withStockIdempotency(db, 1, 'stock:in:key-truc-tiep-2', execute);
  expect(otherKey.replayed).toBe(false);
  expect(executions).toBe(2);
});

// ---------- AC-4: RBAC + audit ----------

test('AC-4 can() cho phep dung vai dung pham vi kho voi 11 actions moi', () => {
  const owner = stockActor(1, 'owner');
  const manager = stockActor(2, 'manager');
  const sales = stockActor(4, 'sales');
  const accountant = stockActor(5, 'accountant');
  const warehouseIn = stockActor(3, 'warehouse', 7);
  const org = stockTarget();
  const inScope = stockTarget(7);
  expect(can(owner, 'create-warehouse', org)).toBe(true);
  expect(can(owner, 'manage-warehouse', org)).toBe(true);
  expect(can(owner, 'stock-in', org)).toBe(true);
  expect(can(owner, 'stock-out', org)).toBe(true);
  expect(can(owner, 'stock-adjust', org)).toBe(true);
  expect(can(owner, 'stock-count', org)).toBe(true);
  expect(can(owner, 'stock-transfer', org)).toBe(true);
  expect(can(owner, 'stock-reserve', org)).toBe(true);
  expect(can(owner, 'stock-release', org)).toBe(true);
  expect(can(owner, 'view-stock', org)).toBe(true);
  expect(can(owner, 'view-stock-movements', org)).toBe(true);
  expect(can(manager, 'stock-in', org)).toBe(true);
  expect(can(manager, 'stock-out', org)).toBe(true);
  expect(can(manager, 'stock-transfer', org)).toBe(true);
  expect(can(manager, 'view-stock', org)).toBe(true);
  expect(can(manager, 'view-stock-movements', org)).toBe(true);
  expect(can(warehouseIn, 'stock-in', inScope)).toBe(true);
  expect(can(warehouseIn, 'stock-out', inScope)).toBe(true);
  expect(can(warehouseIn, 'stock-adjust', inScope)).toBe(true);
  expect(can(warehouseIn, 'stock-count', inScope)).toBe(true);
  expect(can(warehouseIn, 'stock-transfer', inScope)).toBe(true);
  expect(can(warehouseIn, 'stock-reserve', inScope)).toBe(true);
  expect(can(warehouseIn, 'stock-release', inScope)).toBe(true);
  expect(can(warehouseIn, 'view-stock', inScope)).toBe(true);
  expect(can(warehouseIn, 'view-stock-movements', inScope)).toBe(true);
  expect(can(sales, 'view-stock', org)).toBe(true);
  expect(can(accountant, 'view-stock', org)).toBe(true);
  expect(can(accountant, 'view-stock-movements', org)).toBe(true);
});

test('AC-4 RBAC 403 qua HTTP: sales nhap kho, accountant xuat kho, manager/warehouse/accountant tao kho', async () => {
  const ctx = await stockCtx();
  const salesIn = await ctx.sales.post('/api/stock/in').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 10,
    reason: 'sales nhap kho',
  });
  expect(salesIn.status).toBe(403);
  const accountantOut = await ctx.accountant.post('/api/stock/out').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 10,
    reason: 'accountant xuat kho',
  });
  expect(accountantOut.status).toBe(403);
  const salesOut = await ctx.sales.post('/api/stock/out').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 1,
    reason: 'sales xuat kho',
  });
  expect(salesOut.status).toBe(403);
  for (const agent of [ctx.manager, ctx.warehouse, ctx.accountant, ctx.sales]) {
    const res = await agent.post('/api/warehouses').send({ name: 'Kho cam tao' });
    expect(res.status).toBe(403);
  }
  await mustStockIn(ctx.owner, ctx.whA.id as number, ctx.v1, 20);
  const managerOut = await ctx.manager.post('/api/stock/out').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 5,
    reason: 'manager xuat kho duoc phep',
  });
  expect([200, 201]).toContain(managerOut.status);
});

test('AC-4 warehouse chi thao tac kho duoc gan: ngoai kho gan bi 403, trong kho gan duoc; warehouse_id NULL duoc moi kho', async () => {
  const ctx = await stockCtx();
  const scope = await ctx.owner.patch(`/api/users/${ctx.warehouseId}/scope`).send({
    warehouse_id: ctx.whA.id,
  });
  expect(scope.status).toBe(200);
  expect(asUser(scope).warehouse_id).toBe(ctx.whA.id);
  const inScope = await ctx.warehouse.post('/api/stock/in').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 10,
    reason: 'kho duoc gan nhap',
  });
  expect([200, 201]).toContain(inScope.status);
  const outScope = await ctx.warehouse.post('/api/stock/in').send({
    warehouse_id: ctx.whB.id,
    variant_id: ctx.v1,
    qty: 10,
    reason: 'kho ngoai pham vi nhap',
  });
  expect(outScope.status).toBe(403);
  const outOther = await ctx.warehouse.post('/api/stock/out').send({
    warehouse_id: ctx.whB.id,
    variant_id: ctx.v1,
    qty: 1,
    reason: 'kho ngoai pham vi xuat',
  });
  expect(outOther.status).toBe(403);
  const adjustOther = await ctx.warehouse.post('/api/stock/adjust').send({
    warehouse_id: ctx.whB.id,
    variant_id: ctx.v1,
    qty_change: 1,
    reason: 'kho ngoai pham vi dieu chinh',
  });
  expect(adjustOther.status).toBe(403);
  const reserveOther = await ctx.warehouse.post('/api/stock/reserve').send({
    warehouse_id: ctx.whB.id,
    variant_id: ctx.v1,
    qty: 1,
    reason: 'kho ngoai pham vi giu',
  });
  expect(reserveOther.status).toBe(403);
  // Nhân viên kho chưa gán kho (warehouse_id NULL) được làm ở mọi kho trong org.
  const nullScope = await ctx.warehouseNull.post('/api/stock/in').send({
    warehouse_id: ctx.whB.id,
    variant_id: ctx.v1,
    qty: 5,
    reason: 'kho NULL nhap kho B',
  });
  expect([200, 201]).toContain(nullScope.status);
});

test('AC-4 chuyen kho khi 1 trong 2 kho ngoai pham vi bi 403; warehouse xem levels/movements chi kho duoc gan', async () => {
  const ctx = await stockCtx();
  await mustStockIn(ctx.owner, ctx.whA.id as number, ctx.v1, 50);
  await mustStockIn(ctx.owner, ctx.whB.id as number, ctx.v1, 20);
  const scope = await ctx.owner.patch(`/api/users/${ctx.warehouseId}/scope`).send({
    warehouse_id: ctx.whA.id,
  });
  expect(scope.status).toBe(200);
  const outTransfer = await ctx.warehouse.post('/api/stock/transfer').send({
    from_warehouse_id: ctx.whA.id,
    to_warehouse_id: ctx.whB.id,
    variant_id: ctx.v1,
    qty: 5,
    reason: 'chuyen ra kho ngoai pham vi',
  });
  expect(outTransfer.status).toBe(403);
  const inTransfer = await ctx.warehouse.post('/api/stock/transfer').send({
    from_warehouse_id: ctx.whB.id,
    to_warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 5,
    reason: 'chuyen tu kho ngoai pham vi',
  });
  expect(inTransfer.status).toBe(403);
  const levelsOther = await ctx.warehouse.get(`/api/stock/levels?warehouse_id=${ctx.whB.id as number}`);
  expect(levelsOther.status).toBe(403);
  const levelsAll = await ctx.warehouse.get('/api/stock/levels');
  expect(levelsAll.status).toBe(200);
  expect(asList(levelsAll).length).toBeGreaterThanOrEqual(1);
  expect(asList(levelsAll).every((r) => r.warehouse_id === ctx.whA.id)).toBe(true);
  const movementsOther = await ctx.warehouse.get(`/api/stock/movements?warehouse_id=${ctx.whB.id as number}`);
  expect(movementsOther.status).toBe(403);
  const movementsAll = await ctx.warehouse.get('/api/stock/movements');
  expect(movementsAll.status).toBe(200);
  expect(asList(movementsAll).every((r) => r.warehouse_id === ctx.whA.id)).toBe(true);
  const lowOther = await ctx.warehouse.get(`/api/stock/low-stock?warehouse_id=${ctx.whB.id as number}`);
  expect(lowOther.status).toBe(403);
});

test('AC-4 sales xem movements/low-stock bi 403, accountant xem duoc; sales xem levels duoc', async () => {
  const ctx = await stockCtx();
  await mustStockIn(ctx.owner, ctx.whA.id as number, ctx.v1, 10);
  expect((await ctx.sales.get('/api/stock/movements')).status).toBe(403);
  expect((await ctx.sales.get('/api/stock/low-stock')).status).toBe(403);
  expect((await ctx.accountant.get('/api/stock/movements')).status).toBe(200);
  expect((await ctx.accountant.get('/api/stock/low-stock')).status).toBe(200);
  expect((await ctx.manager.get('/api/stock/movements')).status).toBe(200);
  const levels = await ctx.sales.get('/api/stock/levels');
  expect(levels.status).toBe(200);
  expect(asList(levels).some((r) => r.variant_id === ctx.v1)).toBe(true);
});

test('AC-4 org A tren org B bi 403: ownerB doc/sua kho org A, nhap kho org A, xem levels org A', async () => {
  const ctx = await stockCtx();
  await mustStockIn(ctx.owner, ctx.whA.id as number, ctx.v1, 10);
  const detailB = await ctx.ownerB.get(`/api/warehouses/${ctx.whA.id as number}`);
  expect([403, 404]).toContain(detailB.status);
  const listB = await ctx.ownerB.get('/api/warehouses');
  expect(listB.status).toBe(200);
  expect(asList(listB).some((w) => w.id === ctx.whA.id)).toBe(false);
  const patchB = await ctx.ownerB.patch(`/api/warehouses/${ctx.whA.id as number}`).send({ name: 'Doi trom' });
  expect([403, 404]).toContain(patchB.status);
  const inB = await ctx.ownerB.post('/api/stock/in').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 5,
    reason: 'nhap trom',
  });
  expect([403, 404]).toContain(inB.status);
  const levelsB = await ctx.ownerB.get(`/api/stock/levels?warehouse_id=${ctx.whA.id as number}`);
  expect([403, 404]).toContain(levelsB.status);
  const still = await ctx.owner.get(`/api/warehouses/${ctx.whA.id as number}`);
  expect(still.status).toBe(200);
  expect(asOne(still).name).toBe('Kho A');
});

test('AC-4 gan warehouse_id qua PATCH scope: kho khong ton tai bi 400/403, kho ngoai org bi 400/403, kho hop le duoc', async () => {
  const ctx = await stockCtx();
  const whB = await createWarehouse(ctx.ownerB, 'Kho org B');
  const missing = await ctx.owner.patch(`/api/users/${ctx.warehouseId}/scope`).send({
    warehouse_id: 999999,
  });
  expect([400, 403]).toContain(missing.status);
  const crossOrg = await ctx.owner.patch(`/api/users/${ctx.warehouseId}/scope`).send({
    warehouse_id: whB.id,
  });
  expect([400, 403]).toContain(crossOrg.status);
  const ok = await ctx.owner.patch(`/api/users/${ctx.warehouseId}/scope`).send({
    warehouse_id: ctx.whA.id,
  });
  expect(ok.status).toBe(200);
  expect(asUser(ok).warehouse_id).toBe(ctx.whA.id);
  const cleared = await ctx.owner.patch(`/api/users/${ctx.warehouseId}/scope`).send({
    warehouse_id: null,
  });
  expect(cleared.status).toBe(200);
  expect(asUser(cleared).warehouse_id).toBeNull();
});

test('AC-4 audit log ghi tao/sua kho + nhap/xuat/chuyen/giu voi actor, target_warehouse_id/target_variant_id + before/after', async () => {
  const ctx = await stockCtx();
  const whC = await createWarehouse(ctx.owner, 'Kho audit');
  await ctx.owner.patch(`/api/warehouses/${whC.id as number}`).send({ name: 'Kho audit doi ten' });
  await mustStockIn(ctx.owner, ctx.whA.id as number, ctx.v1, 50);
  await ctx.owner.post('/api/stock/out').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 10,
    reason: 'xuat audit',
  });
  await ctx.owner.post('/api/stock/reserve').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 5,
    reason: 'giu audit',
  });
  await ctx.owner.post('/api/stock/transfer').send({
    from_warehouse_id: ctx.whA.id,
    to_warehouse_id: ctx.whB.id,
    variant_id: ctx.v1,
    qty: 5,
    reason: 'chuyen audit',
  });
  const rows = auditRows(ctx.db, ctx.orgId);
  const stockRows = rows.filter((r) => r.detail.target_warehouse_id !== undefined);
  expect(stockRows.length).toBeGreaterThanOrEqual(6);
  const created = rows.find((r) => r.detail.target_warehouse_id === whC.id);
  expect(created).toBeDefined();
  expect(created?.detail.before).toBeNull();
  expect((created?.detail.after as Record<string, unknown> | undefined)?.name).toBeDefined();
  const inRow = rows.find(
    (r) => r.detail.target_warehouse_id === ctx.whA.id && r.detail.target_variant_id === ctx.v1,
  );
  expect(inRow).toBeDefined();
  expect(inRow?.detail.before).toBeDefined();
  expect(inRow?.detail.after).toBeDefined();
  expect(((inRow?.detail.after as Record<string, unknown> | undefined)?.on_hand as number) ?? -1).toBeGreaterThanOrEqual(0);
  expect(rows.every((r) => r.user_id !== null)).toBe(true);
  expect(rows.some((r) => /stock|warehouse/i.test(r.action))).toBe(true);
  const logRes = await ctx.owner.get('/api/audit-log');
  expect(logRes.status).toBe(200);
  expect(JSON.stringify(logRes.body)).toContain('Kho audit');
  expect((await ctx.sales.get('/api/audit-log')).status).toBe(403);
});

test('AC-4 kho inactive chan thao tac ton moi: in/out/adjust/chuyen vao kho inactive bi 400', async () => {
  const ctx = await stockCtx();
  await mustStockIn(ctx.owner, ctx.whA.id as number, ctx.v1, 50);
  await mustStockIn(ctx.owner, ctx.whB.id as number, ctx.v1, 20);
  const deactivated = await ctx.owner.patch(`/api/warehouses/${ctx.whA.id as number}`).send({ status: 'inactive' });
  expect([200, 201]).toContain(deactivated.status);
  const inInactive = await ctx.owner.post('/api/stock/in').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 5,
    reason: 'nhap vao kho inactive',
  });
  expect(inInactive.status).toBe(400);
  const outInactive = await ctx.owner.post('/api/stock/out').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 5,
    reason: 'xuat tu kho inactive',
  });
  expect(outInactive.status).toBe(400);
  const adjustInactive = await ctx.owner.post('/api/stock/adjust').send({
    warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty_change: 5,
    reason: 'dieu chinh kho inactive',
  });
  expect(adjustInactive.status).toBe(400);
  const transferToInactive = await ctx.owner.post('/api/stock/transfer').send({
    from_warehouse_id: ctx.whB.id,
    to_warehouse_id: ctx.whA.id,
    variant_id: ctx.v1,
    qty: 5,
    reason: 'chuyen vao kho inactive',
  });
  expect(transferToInactive.status).toBe(400);
  const transferFromInactive = await ctx.owner.post('/api/stock/transfer').send({
    from_warehouse_id: ctx.whA.id,
    to_warehouse_id: ctx.whB.id,
    variant_id: ctx.v1,
    qty: 5,
    reason: 'chuyen tu kho inactive',
  });
  expect(transferFromInactive.status).toBe(400);
  expect((await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1))?.on_hand).toBe(50);
  expect((await levelOf(ctx.owner, ctx.whB.id as number, ctx.v1))?.on_hand).toBe(20);
  const detail = await ctx.owner.get(`/api/warehouses/${ctx.whA.id as number}`);
  expect(detail.status).toBe(200);
});
