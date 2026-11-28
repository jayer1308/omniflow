import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { migrate, openDb } from '../src/db.js';
import { can, type Action, type Actor, type Role, type Target } from '../src/rbac.js';
import { seed } from '../src/seed.js';

// Mat khau GIA LAP chi dung cho test, khong phai credential that.
const OWNER_PASSWORD = 'gia-lap-owner-012';
const STAFF_PASSWORD = 'gia-lap-sales-012';

type Db = ReturnType<typeof openDb>;
type App = ReturnType<typeof createApp>;
type Agent = Awaited<ReturnType<typeof loginAgent>>;

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
  warehouseId: number | null = null,
): Promise<number> {
  const hash = await hashPassword('gia-lap-123');
  return Number(
    db
      .prepare(
        'INSERT INTO users (org_id, branch_id, email, password_hash, role, warehouse_id) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(orgId, branchId, email, hash, role, warehouseId).lastInsertRowid,
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

async function ownerAgent(app: App, seeded: { ownerEmail: string }) {
  return loginAgent(app, seeded.ownerEmail, OWNER_PASSWORD);
}

async function salesAgent(app: App, seeded: { staffEmail: string }) {
  return loginAgent(app, seeded.staffEmail, STAFF_PASSWORD);
}

/** Boi canh day du: org A 2 chi nhanh + du 5 vai, org B 1 owner, 2 kho, 2 kenh. */
async function fullCtx() {
  const { db, app, seeded } = freshApp();
  const orgId = seeded.orgId;
  const branch1 = seeded.branchId;
  const branch2 = addBranch(db, orgId, 'Chi nhanh 2');
  const managerId = await addUser(db, orgId, null, 'manager@example.local', 'manager');
  const accountantId = await addUser(db, orgId, branch1, 'ketoan@example.local', 'accountant');
  const sales2Id = await addUser(db, orgId, branch2, 'sales2@example.local', 'sales');
  const { orgBId, branchBId } = await addOrgB(db);
  const owner = await ownerAgent(app, seeded);
  const sales = await salesAgent(app, seeded);
  const manager = await loginAgent(app, 'manager@example.local', 'gia-lap-123');
  const accountant = await loginAgent(app, 'ketoan@example.local', 'gia-lap-123');
  const sales2 = await loginAgent(app, 'sales2@example.local', 'gia-lap-123');
  const ownerB = await loginAgent(app, 'owner-b@example.local', 'gia-lap-123');
  // 2 kho qua API (kho A + kho B) de co warehouse_id that cho RBAC kho.
  const whA = await createWarehouse(owner, 'Kho A');
  const whB = await createWarehouse(owner, 'Kho B');
  const warehouseId = await addUser(
    db, orgId, branch1, 'kho@example.local', 'warehouse', whA.id as number,
  );
  const warehouse = await loginAgent(app, 'kho@example.local', 'gia-lap-123');
  return {
    db, app, seeded, orgId, branch1, branch2, orgBId, branchBId,
    managerId, accountantId, sales2Id, warehouseId,
    owner, sales, manager, warehouse, accountant, sales2, ownerB, whA, whB,
  };
}

type Ctx = Awaited<ReturnType<typeof fullCtx>>;

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

/** Dinh dang tien Viet nhu brief (vd 250.000). */
function vnd(n: number): string {
  return n.toLocaleString('vi-VN');
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
  const code = (overrides.code as string) ?? `SP-012-${rand()}`;
  const res = await agent.post('/api/products').send({
    code,
    name: 'San pham dashboard gia lap',
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
    sku: `SKU-012-${rand()}`,
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

function asOrder(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (body.order as Record<string, unknown>) ?? body;
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

async function mustTransition(
  agent: Agent,
  orderId: number,
  action: 'confirm' | 'process' | 'complete' | 'cancel',
): Promise<Record<string, unknown>> {
  const res = await agent.post(`/api/orders/${orderId}/${action}`).send({});
  expect([200, 201]).toContain(res.status);
  return asOrder(res);
}

/** Boi canh bao cao: kho A + 2 bien the (V1 100000, V2 50000) + ton du. */
async function reportCtx() {
  const ctx = await fullCtx();
  const p1 = await createProduct(ctx.owner, { name: 'SP DB 1', price: 100000, min_stock: 0 });
  const v1 = await createVariant(ctx.owner, p1.id);
  const p2 = await createProduct(ctx.owner, { name: 'SP DB 2', price: 50000, min_stock: 0 });
  const v2 = await createVariant(ctx.owner, p2.id);
  await mustStockIn(ctx.owner, ctx.whA.id as number, v1, 200);
  await mustStockIn(ctx.owner, ctx.whA.id as number, v2, 100);
  return { ...ctx, p1, v1, p2, v2 };
}

type RCtx = Awaited<ReturnType<typeof reportCtx>>;

/** Don draft 2 x V1 + 1 x V2 = 250000, kenh counter, chi nhanh 1. */
async function mustOrder250(ctx: RCtx, overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
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

async function mustCompletedOrder(
  ctx: RCtx,
  orderId: number,
  agent: Agent = ctx.owner,
): Promise<Record<string, unknown>> {
  await mustTransition(agent, orderId, 'confirm');
  await mustTransition(agent, orderId, 'process');
  const done = await mustTransition(agent, orderId, 'complete');
  expect(done.status).toBe('completed');
  return done;
}

async function mustPayCash(ctx: RCtx, orderId: number, amount: number): Promise<void> {
  const res = await ctx.owner.post(`/api/orders/${orderId}/payments`).send({ method: 'cash', amount });
  expect(res.status).toBe(201);
}

async function mustCreateCustomer(agent: Agent, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const res = await agent.post('/api/customers').send(body);
  expect(res.status).toBe(201);
  const c = (res.body as Record<string, unknown>).customer as Record<string, unknown> | undefined;
  const row = c ?? (res.body as Record<string, unknown>);
  expect(row.id).toBeDefined();
  return row;
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

async function mustCreateShipment(agent: Agent, orderId: number): Promise<Record<string, unknown>> {
  const res = await agent
    .post(`/api/orders/${orderId}/shipments`)
    .send({ carrier: 'GHN-fake', destination: 'TP.HCM' });
  expect(res.status).toBe(201);
  const s = (res.body as Record<string, unknown>).shipment as Record<string, unknown> | undefined;
  const row = s ?? (res.body as Record<string, unknown>);
  expect(row.id).toBeDefined();
  expect(row.tracking_code).toBeDefined();
  return row;
}

async function mustCreateReturn(
  agent: Agent,
  orderId: number,
  variantId: number,
  reason: string,
): Promise<Record<string, unknown>> {
  const res = await agent.post(`/api/orders/${orderId}/returns`).send({
    items: [{ variant_id: variantId, qty: 1, condition: 'resalable' }],
    reason,
  });
  expect(res.status).toBe(201);
  const r = (res.body as Record<string, unknown>).return as Record<string, unknown> | undefined;
  const row = r ?? (res.body as Record<string, unknown>);
  expect(row.id).toBeDefined();
  return row;
}

/** Chen job failed truc tiep vao DB (setup test, theo mau GOAL-011). */
function insertFailedJob(db: Db): number {
  const now = new Date().toISOString();
  const payload = JSON.stringify({
    event_key: `order.completed:DH-012-FAIL-${rand()}`,
    event_type: 'order.completed',
    to_user_id: null,
    to_email: 'owner@example.local',
    subject: 'Don gia lap da hoan tat',
    body: 'Don gia lap da hoan tat.',
  });
  return Number(
    db
      .prepare(
        `INSERT INTO jobs (type, payload, status, attempts, max_attempts, next_run_at, last_error, created_at, updated_at)
         VALUES ('send-notification', ?, 'failed', 3, 3, ?, 'gui that bai gia lap', ?, ?)`,
      )
      .run(payload, now, now, now).lastInsertRowid,
  );
}

function revenueTotals(body: unknown): Record<string, number> {
  return (body as Record<string, unknown>).totals as Record<string, number>;
}

// ---------- AC-1: dashboard + man hinh tong quan ----------

test('AC-1 dashboard doanh thu hom nay/thang nay khop API bao cao cung khoang, dinh dang Viet', async () => {
  const ctx = await reportCtx();
  const order = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order.id as number);
  await mustPayCash(ctx, order.id as number, 100000);
  const today = hcmToday();
  const from = hcmFirstOfMonth();
  const dayRes = await ctx.owner.get(`/api/reports/revenue?from=${today}&to=${today}&group_by=day`);
  expect(dayRes.status).toBe(200);
  const dayTotal = revenueTotals(dayRes.body).gross_revenue;
  expect(dayTotal).toBe(250000);
  const monthRes = await ctx.owner.get(`/api/reports/revenue?from=${from}&to=${today}&group_by=day`);
  expect(monthRes.status).toBe(200);
  const monthTotal = revenueTotals(monthRes.body).gross_revenue;
  expect(monthTotal).toBe(250000);
  const res = await ctx.owner.get('/dashboard');
  expect(res.status).toBe(200);
  const html = res.text;
  expect(html).toContain(vnd(dayTotal));
  expect(html).toContain(vnd(monthTotal));
  expect(html).toContain('250.000');
});

test('AC-1 dashboard don cho xu ly theo tung trang thai draft/confirmed/processing khop API don', async () => {
  const ctx = await reportCtx();
  const draft = await mustOrder250(ctx, { channel: 'web' });
  const confirmed = await mustOrder250(ctx, { channel: 'web' });
  await mustTransition(ctx.owner, confirmed.id as number, 'confirm');
  const processing = await mustOrder250(ctx, { channel: 'web' });
  await mustTransition(ctx.owner, processing.id as number, 'confirm');
  await mustTransition(ctx.owner, processing.id as number, 'process');
  for (const status of ['draft', 'confirmed', 'processing'] as const) {
    const list = await ctx.owner.get(`/api/orders?status=${status}`);
    expect(list.status).toBe(200);
    expect((list.body as Record<string, unknown>).total).toBe(1);
  }
  const res = await ctx.owner.get('/dashboard');
  expect(res.status).toBe(200);
  const html = res.text;
  expect(html).toContain(String(draft.code));
  expect(html).toContain(String(confirmed.code));
  expect(html).toContain(String(processing.code));
});

test('AC-1 dashboard ton thap khop API low-stock (cap seed + cap moi tao)', async () => {
  const ctx = await reportCtx();
  const lowRes = await ctx.owner.get('/api/stock/low-stock');
  expect(lowRes.status).toBe(200);
  const lowBefore = lowRes.body as Record<string, unknown>[];
  expect(lowBefore.length).toBeGreaterThanOrEqual(1);
  // Cap seed: Kho Chinh SKU-SEED-01-M 3 < min_stock 5.
  expect(lowBefore.some((l) => l.sku === 'SKU-SEED-01-M')).toBe(true);
  const pLow = await createProduct(ctx.owner, { name: 'SP ton thap', price: 10000, min_stock: 10 });
  const vLow = await createVariant(ctx.owner, pLow.id);
  await mustStockIn(ctx.owner, ctx.whA.id as number, vLow, 4);
  const lowAfter = (await ctx.owner.get('/api/stock/low-stock')).body as Record<string, unknown>[];
  expect(lowAfter.length).toBe(lowBefore.length + 1);
  const res = await ctx.owner.get('/dashboard');
  expect(res.status).toBe(200);
  expect(res.text).toContain('SKU-SEED-01-M');
});

test('AC-1 dashboard thong bao chua doc: sau khi hoan tat + chay job co notification sent', async () => {
  const ctx = await reportCtx();
  const order = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order.id as number);
  const run = await ctx.owner.post('/api/jobs/run').send({});
  expect(run.status).toBe(200);
  const notifs = await ctx.owner.get('/api/notifications?status=sent');
  expect(notifs.status).toBe(200);
  expect((notifs.body as Record<string, unknown>).total as number).toBeGreaterThanOrEqual(1);
  const res = await ctx.owner.get('/dashboard');
  expect(res.status).toBe(200);
  expect(res.text).toContain('order.completed');
});

test('AC-1 man hinh giao/tra: don dang giao kem ma van don + tra cho duyet kem ly do + tra vua nhan', async () => {
  const ctx = await reportCtx();
  const shipOrder = await mustOrder250(ctx, { channel: 'web' });
  await mustCompletedOrder(ctx, shipOrder.id as number);
  const shipment = await mustCreateShipment(ctx.owner, shipOrder.id as number);
  const upd = await ctx.owner
    .post(`/api/shipments/${shipment.id as number}/status`)
    .send({ status: 'in_transit' });
  expect(upd.status).toBe(200);
  const retOrder = await mustOrder250(ctx, { channel: 'web' });
  await mustCompletedOrder(ctx, retOrder.id as number);
  const pendingReturn = await mustCreateReturn(
    ctx.owner, retOrder.id as number, ctx.v1, 'khach doi y gia lap',
  );
  expect(pendingReturn.status).toBe('requested');
  const recvOrder = await mustOrder250(ctx, { channel: 'web' });
  await mustCompletedOrder(ctx, recvOrder.id as number);
  const recvReturn = await mustCreateReturn(ctx.owner, recvOrder.id as number, ctx.v1, 'tra gia lap');
  expect((await ctx.owner.post(`/api/returns/${recvReturn.id as number}/approve`).send({})).status).toBe(200);
  expect((await ctx.owner.post(`/api/returns/${recvReturn.id as number}/receive`).send({})).status).toBe(200);
  const res = await ctx.owner.get('/dashboard/shipments');
  expect(res.status).toBe(200);
  const html = res.text;
  expect(html).toContain(String(shipment.tracking_code));
  expect(html).toContain('GHN-fake');
  expect(html).toContain('in_transit');
  expect(html).toContain('khach doi y gia lap');
  expect(html).toContain('tra gia lap');
  expect(html).toContain(String(shipOrder.code));
  expect(html).toContain(String(retOrder.code));
  expect(html).toMatch(/\/api\/orders\/\d+|\/orders\/\d+/);
});

test('AC-1 man hinh khach/diem: khach VIP + diem da doi trong thang + khach moi trong thang', async () => {
  const ctx = await reportCtx();
  const vipProduct = await createProduct(ctx.owner, { name: 'SP VIP 5tr', price: 5000000, min_stock: 0 });
  const vipVariant = await createVariant(ctx.owner, vipProduct.id);
  await mustStockIn(ctx.owner, ctx.whA.id as number, vipVariant, 5);
  const vip = await mustCreateCustomer(ctx.owner, {
    name: 'Khach VIP gia lap', phone: randPhone(), branch_id: ctx.branch1,
  });
  const vipOrder = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    customer_id: vip.id,
    items: [{ variant_id: vipVariant, qty: 1 }],
  });
  expect(vipOrder.total).toBe(5000000);
  await mustCompletedOrder(ctx, vipOrder.id as number);
  const got = await ctx.owner.get(`/api/customers/${vip.id as number}`);
  expect(got.status).toBe(200);
  const gotBody = got.body as Record<string, unknown>;
  const gotCust = (gotBody.customer as Record<string, unknown>) ?? gotBody;
  expect(gotCust.segment).toBe('vip');
  // Doi 10 diem tren don draft 250k -> giam 1000d (10 x 100d).
  const draft = await mustOrder250(ctx, { customer_id: vip.id });
  grantPoints(ctx.db, ctx.orgId, vip.id as number, 10);
  const redeem = await ctx.owner
    .post(`/api/customers/${vip.id as number}/points/redeem`)
    .send({ order_id: draft.id, points: 10 });
  expect(redeem.status).toBe(201);
  const res = await ctx.owner.get('/dashboard/customers');
  expect(res.status).toBe(200);
  const html = res.text;
  expect(html).toContain('Khach VIP gia lap');
  expect(html).toContain('1.000');
});

test('AC-1 man hinh thong bao/job: 10 thong bao moi nhat + job failed kem link retry', async () => {
  const ctx = await reportCtx();
  const order = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order.id as number);
  await ctx.owner.post('/api/jobs/run').send({});
  const failedId = insertFailedJob(ctx.db);
  const res = await ctx.owner.get('/dashboard/notifications');
  expect(res.status).toBe(200);
  const html = res.text;
  expect(html).toContain('order.completed');
  expect(html).toContain(`/api/jobs/${failedId}/retry`);
  expect(html).toContain('failed');
});

// ---------- AC-2: health + sao luu/khoi phuc + audit ----------

test('AC-2 health mo rong tra du field db/version/uptime_seconds, giu status ok', async () => {
  const { app } = freshApp();
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.body.status).toBe('ok');
  expect(res.body.db).toBe('ok');
  expect(res.body.version).toBe(pkg.version);
  expect(typeof res.body.uptime_seconds).toBe('number');
  expect(Number.isInteger(res.body.uptime_seconds)).toBe(true);
  expect(res.body.uptime_seconds).toBeGreaterThanOrEqual(0);
});

test('AC-2 backup qua API roi doi du lieu roi restore qua API ve dung trang thai truoc backup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'omniflow-012-'));
  const dbPath = join(dir, 'test.db');
  const db = openDb(dbPath);
  migrate(db);
  const seeded = seed(db, { ownerPassword: OWNER_PASSWORD, staffPassword: STAFF_PASSWORD });
  const app = createApp(db);
  const owner = await ownerAgent(app, seeded);
  const before = await createProduct(owner, { name: 'SP truoc backup gia lap', price: 100000 });
  const backup = await owner.post('/api/ops/backup').send({});
  expect([200, 201]).toContain(backup.status);
  const backupBody = backup.body as Record<string, unknown>;
  expect(backupBody.file).toBeDefined();
  expect(backupBody.size).toBeDefined();
  expect(Number(backupBody.size)).toBeGreaterThan(0);
  expect(backupBody.created_at).toBeDefined();
  const fileValue = String(backupBody.file);
  // Doi du lieu sau backup: them san pham moi.
  const after = await createProduct(owner, { name: 'SP sau backup gia lap', price: 200000 });
  const changed = db
    .prepare('SELECT COUNT(*) AS c FROM products WHERE id = ?')
    .get(after.id) as { c: number };
  expect(changed.c).toBe(1);
  const restore = await owner.post('/api/ops/restore').send({ file: fileValue, confirm: true });
  expect([200, 201]).toContain(restore.status);
  // Mo lai DB tu file (ket noi cu co the thay file cu sau khi cp): kiem tra tren ket noi moi.
  db.close();
  const db2 = openDb(dbPath);
  const kept = db2
    .prepare('SELECT COUNT(*) AS c FROM products WHERE id = ?')
    .get(before.id) as { c: number };
  expect(kept.c).toBe(1);
  const gone = db2
    .prepare('SELECT COUNT(*) AS c FROM products WHERE id = ?')
    .get(after.id) as { c: number };
  expect(gone.c).toBe(0);
  // Trang ops hien ten file backup vua tao.
  const app2 = createApp(db2);
  const owner2 = await ownerAgent(app2, seeded);
  const page = await owner2.get('/ops/backup');
  expect(page.status).toBe(200);
  expect(page.text).toContain(fileValue.split('/').pop() as string);
  db2.close();
  // Don dep: xoa file backup (neu nam trong repo) + thu muc tam.
  const resolved = fileValue.startsWith('/') ? fileValue : join(process.cwd(), fileValue);
  if (existsSync(resolved)) unlinkSync(resolved);
  rmSync(dir, { recursive: true, force: true });
});

test('AC-2 restore thieu/sai confirm 400, file khong ton tai 404, file ngoai thu muc backup 400', async () => {
  const { db, app, seeded } = freshApp();
  void db;
  const owner = await ownerAgent(app, seeded);
  expect((await owner.post('/api/ops/restore').send({ file: 'khong-co.db' })).status).toBe(400);
  expect((await owner.post('/api/ops/restore').send({ file: 'khong-co.db', confirm: false })).status).toBe(400);
  expect((await owner.post('/api/ops/restore').send({ file: 'khong-co.db', confirm: true })).status).toBe(404);
  expect(
    (await owner.post('/api/ops/restore').send({ file: '../ngoai-thu-muc.db', confirm: true })).status,
  ).toBe(400);
  expect(
    (await owner.post('/api/ops/restore').send({ file: '/tmp/ngoai-thu-muc.db', confirm: true })).status,
  ).toBe(400);
});

test('AC-2 backup sai vai 403: sales/accountant/manager goi backup/restore, sales xem ops', async () => {
  const ctx = await fullCtx();
  expect((await ctx.sales.post('/api/ops/backup').send({})).status).toBe(403);
  expect((await ctx.accountant.post('/api/ops/backup').send({})).status).toBe(403);
  expect((await ctx.manager.post('/api/ops/backup').send({})).status).toBe(403);
  expect(
    (await ctx.accountant.post('/api/ops/restore').send({ file: 'x.db', confirm: true })).status,
  ).toBe(403);
  expect((await ctx.sales.get('/ops/backup')).status).toBe(403);
  expect((await ctx.warehouse.get('/ops/backup')).status).toBe(403);
  const page = await ctx.owner.get('/ops/backup');
  expect(page.status).toBe(200);
  expect(page.text.toLowerCase()).toContain('sao lưu');
});

test('AC-2 audit-log loc theo actor va action dung', async () => {
  const ctx = await fullCtx();
  const branchRes = await ctx.owner.post('/api/branches').send({ name: 'Chi nhanh Audit' });
  expect(branchRes.status).toBe(201);
  const ownerRow = ctx.db
    .prepare("SELECT id FROM users WHERE org_id = ? AND role = 'owner' ORDER BY id LIMIT 1")
    .get(ctx.orgId) as { id: number };
  const byActor = await ctx.owner.get(`/audit-log?actor=${ownerRow.id}`);
  expect(byActor.status).toBe(200);
  expect(byActor.text).toContain('create-branch');
  const byOtherActor = await ctx.owner.get(`/audit-log?actor=${ctx.managerId}`);
  expect(byOtherActor.status).toBe(200);
  expect(byOtherActor.text).not.toContain('create-branch');
  const byAction = await ctx.owner.get('/audit-log?action=create-branch');
  expect(byAction.status).toBe(200);
  expect(byAction.text).toContain('create-branch');
  const byOtherAction = await ctx.owner.get('/audit-log?action=invite');
  expect(byOtherAction.status).toBe(200);
  expect(byOtherAction.text).not.toContain('create-branch');
});

test('AC-2 audit-log loc theo khoang thoi gian va phan trang dung', async () => {
  const ctx = await fullCtx();
  for (const name of ['Chi nhanh A1', 'Chi nhanh A2', 'Chi nhanh A3']) {
    expect((await ctx.owner.post('/api/branches').send({ name })).status).toBe(201);
  }
  const today = hcmToday();
  const inRange = await ctx.owner.get(`/audit-log?from=${today}&to=${today}`);
  expect(inRange.status).toBe(200);
  expect(inRange.text).toContain('create-branch');
  const outRange = await ctx.owner.get('/audit-log?from=2999-01-01&to=2999-12-31');
  expect(outRange.status).toBe(200);
  expect(outRange.text).not.toContain('create-branch');
  const maxRow = ctx.db
    .prepare('SELECT MAX(id) AS m FROM audit_log WHERE org_id = ?')
    .get(ctx.orgId) as { m: number };
  const secondRow = ctx.db
    .prepare('SELECT id FROM audit_log WHERE org_id = ? ORDER BY id DESC LIMIT 1 OFFSET 1')
    .get(ctx.orgId) as { id: number };
  const page1 = await ctx.owner.get('/audit-log?limit=1&page=1');
  expect(page1.status).toBe(200);
  const tbody1 = page1.text.split('<tbody>')[1]?.split('</tbody>')[0] ?? '';
  expect((tbody1.match(/<tr>/g) ?? []).length).toBe(1);
  expect(page1.text).toContain(`>${maxRow.m}<`);
  const page2 = await ctx.owner.get('/audit-log?limit=1&page=2');
  expect(page2.status).toBe(200);
  const tbody2 = page2.text.split('<tbody>')[1]?.split('</tbody>')[0] ?? '';
  expect((tbody2.match(/<tr>/g) ?? []).length).toBe(1);
  expect(page2.text).toContain(`>${secondRow.id}<`);
  expect(page2.text).not.toContain(`>${maxRow.m}<`);
});

test('AC-2 audit-log loc sai gia tri 400; sales xem audit-log 403', async () => {
  const ctx = await fullCtx();
  expect((await ctx.owner.get('/audit-log?from=khong-phai-ngay')).status).toBe(400);
  expect((await ctx.owner.get('/audit-log?page=0')).status).toBe(400);
  expect((await ctx.owner.get('/audit-log?limit=101')).status).toBe(400);
  expect((await ctx.owner.get('/audit-log?limit=abc')).status).toBe(400);
  expect((await ctx.sales.get('/audit-log')).status).toBe(403);
});

// ---------- AC-3: EJS + RBAC ----------

function actor(id: number, role: Role, branchId: number | null = null, warehouseId?: number | null): Actor {
  return { id, orgId: 1, branchId, role, warehouseId: warehouseId ?? null };
}

function target(orgId = 1, branchId?: number | null, warehouseId?: number | null): Target {
  return { orgId, branchId, warehouseId };
}

test('AC-3 can() 3 action moi view-dashboard/view-ops/run-backup theo ma tran brief', () => {
  const owner = actor(1, 'owner');
  const manager = actor(2, 'manager');
  const salesB1 = actor(3, 'sales', 1);
  const warehouse = actor(4, 'warehouse', 1, 10);
  const accountant = actor(5, 'accountant', 1);
  // view-dashboard: owner/manager/accountant toan org; sales chi chi nhanh minh.
  expect(can(owner, 'view-dashboard' as Action, target())).toBe(true);
  expect(can(manager, 'view-dashboard' as Action, target())).toBe(true);
  expect(can(accountant, 'view-dashboard' as Action, target())).toBe(true);
  expect(can(salesB1, 'view-dashboard' as Action, target(1, 1))).toBe(true);
  expect(can(salesB1, 'view-dashboard' as Action, target(1, 2))).toBe(false);
  expect(can(salesB1, 'view-dashboard' as Action, target(1, null))).toBe(false);
  expect(can(warehouse, 'view-dashboard' as Action, target())).toBe(false);
  expect(can(owner, 'view-dashboard' as Action, target(2))).toBe(false);
  // view-ops: owner/manager; sales/warehouse/accountant khong.
  expect(can(owner, 'view-ops' as Action, target())).toBe(true);
  expect(can(manager, 'view-ops' as Action, target())).toBe(true);
  expect(can(salesB1, 'view-ops' as Action, target())).toBe(false);
  expect(can(warehouse, 'view-ops' as Action, target())).toBe(false);
  expect(can(accountant, 'view-ops' as Action, target())).toBe(false);
  // run-backup: chi owner (R-6/AC-2: backup owner-only).
  expect(can(owner, 'run-backup' as Action, target())).toBe(true);
  expect(can(salesB1, 'run-backup' as Action, target())).toBe(false);
  expect(can(warehouse, 'run-backup' as Action, target())).toBe(false);
  expect(can(accountant, 'run-backup' as Action, target())).toBe(false);
});

test('AC-3 RBAC HTTP 403 theo ma tran: sales dashboard toan org, sales/warehouse xem van hanh, warehouse xem doanh thu', async () => {
  const ctx = await fullCtx();
  // Sales xem dashboard chi nhanh minh duoc, xem chi nhanh khac / toan org thi 403.
  expect((await ctx.sales.get('/dashboard')).status).toBe(200);
  expect((await ctx.sales.get(`/dashboard?branch_id=${ctx.branch2}`)).status).toBe(403);
  expect((await ctx.sales.get('/ops/backup')).status).toBe(403);
  // Warehouse xem dashboard doanh thu 403; man hinh giao hang thuoc pham vi kho thi duoc.
  expect((await ctx.warehouse.get('/dashboard')).status).toBe(403);
  expect((await ctx.warehouse.get('/dashboard/shipments')).status).toBe(200);
  expect((await ctx.warehouse.get('/ops/backup')).status).toBe(403);
  // Accountant xem dashboard doanh thu duoc, chay backup/restore thi 403.
  expect((await ctx.accountant.get('/dashboard')).status).toBe(200);
  expect((await ctx.accountant.post('/api/ops/backup').send({})).status).toBe(403);
});

test('AC-3 RBAC HTTP 403: user org A xem dashboard org B; chua dang nhap 401', async () => {
  const ctx = await reportCtx();
  const order = await mustOrder250(ctx);
  expect((await ctx.ownerB.get(`/dashboard?branch_id=${ctx.branch1}`)).status).toBe(403);
  const ownB = await ctx.ownerB.get('/dashboard');
  expect(ownB.status).toBe(200);
  expect(ownB.text).not.toContain(String(order.code));
  expect((await request(ctx.app).get('/dashboard')).status).toBe(401);
  expect((await request(ctx.app).get('/dashboard/shipments')).status).toBe(401);
  expect((await request(ctx.app).post('/api/ops/backup').send({})).status).toBe(401);
});

test('AC-3 trang thai rong: DB seed toi thieu dashboard hien 0/empty, khong crash', async () => {
  const { app, seeded } = freshApp();
  const owner = await ownerAgent(app, seeded);
  const dash = await owner.get('/dashboard');
  expect(dash.status).toBe(200);
  expect(dash.text).toContain('0');
  expect(dash.text).not.toContain('Error:');
  for (const path of ['/dashboard/shipments', '/dashboard/customers', '/dashboard/notifications']) {
    const res = await owner.get(path);
    expect(res.status).toBe(200);
    expect(res.text).toContain('/style.css');
    expect(res.text).not.toContain('Error:');
  }
});


// ---------- AC-4: test + checks/docs (demo flow tong hop) ----------

test('AC-4 demo flow don 250k hoan tat thu 100k dashboard khop API bao cao + man hinh thong bao co job', async () => {
  const ctx = await reportCtx();
  const order = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order.id as number);
  await mustPayCash(ctx, order.id as number, 100000);
  const today = hcmToday();
  const apiRes = await ctx.owner.get(`/api/reports/revenue?from=${today}&to=${today}&group_by=day`);
  expect(apiRes.status).toBe(200);
  expect(revenueTotals(apiRes.body).gross_revenue).toBe(250000);
  expect(revenueTotals(apiRes.body).paid_total).toBe(100000);
  await ctx.owner.post('/api/jobs/run').send({});
  const dash = await ctx.owner.get('/dashboard');
  expect(dash.status).toBe(200);
  expect(dash.text).toContain('250.000');
  expect(dash.text).toContain(String(order.code));
  const notifs = await ctx.owner.get('/dashboard/notifications');
  expect(notifs.status).toBe(200);
  expect(notifs.text).toContain('order.completed');
});

test('AC-3 EJS dung chung style.css, tieng Viet, mobile-first, dung duoc bang ban phim', async () => {
  const ctx = await reportCtx();
  const order = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order.id as number);
  const res = await ctx.owner.get('/dashboard');
  expect(res.status).toBe(200);
  const html = res.text;
  expect(html).toContain('/style.css');
  expect(html).toContain('width=device-width');
  expect(html).toContain('<a href=');
  expect(html).not.toContain('onclick=');
  expect(html).not.toContain('Error:');
  expect(html).not.toContain(' at ');
});
