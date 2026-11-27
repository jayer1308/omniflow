import { createHash } from 'node:crypto';
import { test, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { migrate, openDb, tableNames } from '../src/db.js';
import { can, type Action, type Role } from '../src/rbac.js';
import { seed } from '../src/seed.js';
import { FakePaymentAdapter, type PaymentResult } from '../src/adapters/index.js';
import { computePaymentSummary, signWebhook } from '../src/payments.js';

// Mat khau GIA LAP chi dung cho test, khong phai credential that.
const OWNER_PASSWORD = 'gia-lap-owner-123';
const STAFF_PASSWORD = 'gia-lap-staff-123';
// Secret webhook GIA LAP chi dung cho test, khong phai secret that.
const WEBHOOK_SECRET = 'test-webhook-secret-gia-lap';

type Db = ReturnType<typeof openDb>;
type App = ReturnType<typeof createApp>;

function freshApp() {
  process.env.OMNIFLOW_WEBHOOK_SECRET = WEBHOOK_SECRET;
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
  const code = (overrides.code as string) ?? `SP-PAY-${rand()}`;
  const res = await agent.post('/api/products').send({
    code,
    name: 'San pham thanh toan gia lap',
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
    sku: `SKU-PAY-${rand()}`,
    name: 'Bien the gia lap',
  });
  expect(res.status).toBe(201);
  const v = (res.body as Record<string, unknown>).variant as Record<string, unknown> | undefined;
  const id = ((v ?? res.body) as Record<string, unknown>).id as number;
  expect(id).toBeDefined();
  return id;
}

/**
 * Boi canh thanh toan: 2 kho (A, B) + 1 san pham/bien the gia 100000.
 * Don mac dinh: 2 x 100000 = 200000, kho A, kenh counter, trang thai draft.
 */
async function payCtx() {
  const ctx = await fullCtx();
  const whA = await createWarehouse(ctx.owner, 'Kho A');
  const whB = await createWarehouse(ctx.owner, 'Kho B');
  const p1 = await createProduct(ctx.owner, { name: 'SP pay 1', price: 100000, min_stock: 0 });
  const v1 = await createVariant(ctx.owner, p1.id);
  return { ...ctx, whA, whB, p1, v1 };
}

type Ctx = Awaited<ReturnType<typeof payCtx>>;

async function mustCreateOrder(
  agent: Agent,
  body: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<Record<string, unknown>> {
  const req = agent.post('/api/orders');
  if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
  const res = await req.send(body);
  expect(res.status).toBe(201);
  const b = res.body as Record<string, unknown>;
  const order = (b.order as Record<string, unknown>) ?? b;
  expect(order.id).toBeDefined();
  expect(order.code).toBeDefined();
  return order;
}

function orderBody(ctx: Ctx, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 2 }],
    ...overrides,
  };
}

/** Tao don 200000 (2 x 100000), bat buoc 201. */
async function mustOrder(ctx: Ctx, agent: Agent = ctx.owner): Promise<Record<string, unknown>> {
  return mustCreateOrder(agent, orderBody(ctx));
}

/** Lay object payment tu response (tra truc tiep hoac boc {payment}). */
function asPayment(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (body.payment as Record<string, unknown>) ?? body;
}

/** Lay danh sach payment tu response list (tra truc tiep hoac boc). */
function asPaymentList(res: { body: unknown }): Record<string, unknown>[] {
  const body = res.body as Record<string, unknown>;
  if (Array.isArray(res.body)) return res.body as Record<string, unknown>[];
  for (const key of ['payments', 'items', 'rows', 'data']) {
    if (Array.isArray(body[key])) return body[key] as Record<string, unknown>[];
  }
  return [];
}

/** Lay tom tat doi soat tu response (order_summary hoac summary). */
function asSummary(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (body.order_summary as Record<string, unknown>) ??
    (body.summary as Record<string, unknown>) ?? {};
}

/** Lay object refund tu response (tra truc tiep hoac boc {refund}). */
function asRefund(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (body.refund as Record<string, unknown>) ?? body;
}

async function mustCreatePayment(
  agent: Agent,
  orderId: number,
  body: Record<string, unknown>,
  idempotencyKey?: string,
) {
  const req = agent.post(`/api/orders/${orderId}/payments`);
  if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
  const res = await req.send(body);
  expect(res.status).toBe(201);
  const payment = asPayment(res);
  expect(payment.id).toBeDefined();
  return { res, payment };
}

/** Chu ky gia lap doc lap (tinh bang node:crypto, khong qua code duoc test). */
function fakeSignature(secret: string, reference: string, status: string, amount: number): string {
  return createHash('sha256')
    .update(`${reference}:${status}:${amount}:${secret}`)
    .digest('hex');
}

function postWebhook(
  app: App,
  body: Record<string, unknown>,
  signature?: string,
) {
  const req = request(app).post('/api/payments/webhook');
  if (signature !== undefined) req.set('X-Fake-Signature', signature);
  return req.send(body);
}

/** Tao payment gateway + webhook paid chot, tra payment da paid. */
async function mustGatewayPaid(
  ctx: Ctx,
  orderId: number,
  amount: number,
  agent: Agent = ctx.owner,
): Promise<Record<string, unknown>> {
  const { payment } = await mustCreatePayment(agent, orderId, { method: 'gateway', amount });
  expect(payment.status).toBe('requested');
  const ref = payment.gateway_reference as string;
  expect(typeof ref).toBe('string');
  const res = await postWebhook(
    ctx.app,
    { gateway_reference: ref, status: 'paid', amount },
    fakeSignature(WEBHOOK_SECRET, ref, 'paid', amount),
  );
  expect(res.status).toBe(200);
  const detail = await ctx.owner.get(`/api/payments/${payment.id as number}`);
  expect(detail.status).toBe(200);
  expect(asPayment(detail).status).toBe('paid');
  return asPayment(detail);
}

function paymentEvents(db: Db, paymentId: number): Record<string, unknown>[] {
  return db
    .prepare('SELECT * FROM payment_events WHERE payment_id = ? ORDER BY id')
    .all(paymentId) as Record<string, unknown>[];
}

function paymentRow(db: Db, paymentId: number): Record<string, unknown> {
  return db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId) as Record<string, unknown>;
}

function refundRows(db: Db, paymentId: number): Record<string, unknown>[] {
  return db
    .prepare('SELECT * FROM refunds WHERE payment_id = ? ORDER BY id')
    .all(paymentId) as Record<string, unknown>[];
}

function auditRows(
  db: Db,
  orgId: number,
): { action: string; detail: Record<string, unknown>; user_id: number | null }[] {
  const rows = db
    .prepare('SELECT * FROM audit_log WHERE org_id = ? ORDER BY id')
    .all(orgId) as { action: string; detail: string | null; user_id: number | null }[];
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
function payActor(
  id: number,
  role: Role,
  branchId: number | null = null,
  warehouseId: number | null = null,
) {
  return { id, orgId: 1, branchId, role, warehouseId };
}

function payTarget(orgId = 1, branchId?: number | null, warehouseId?: number | null) {
  return { orgId, branchId, warehouseId };
}

// ---------- AC-1: thu tien + adapter + schema thanh toan ----------

test('AC-1 migration 011 tao du 3 bang thanh toan + cot + UNIQUE/CHECK, giu du lieu cu', () => {
  const { db, seeded } = freshApp();
  const names = tableNames(db);
  for (const t of ['payments', 'refunds', 'payment_events']) {
    expect(names).toContain(t);
  }
  const versions = (
    db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
      version: number;
    }[]
  ).map((r) => r.version);
  expect(versions).toContain(11);
  const cols = (table: string) =>
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  for (const c of [
    'org_id', 'branch_id', 'order_id', 'method', 'amount', 'currency', 'status',
    'gateway_reference', 'received_by', 'received_at', 'created_at', 'updated_at',
  ]) {
    expect(cols('payments')).toContain(c);
  }
  for (const c of ['payment_id', 'amount', 'reason', 'status', 'created_by', 'created_at']) {
    expect(cols('refunds')).toContain(c);
  }
  for (const c of ['payment_id', 'event_type', 'actor_id', 'detail', 'created_at']) {
    expect(cols('payment_events')).toContain(c);
  }
  const paySql = (
    db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'payments'")
      .get() as { sql: string }
  ).sql;
  expect(paySql).toContain('gateway_reference');
  expect(paySql).toContain('UNIQUE');
  expect(paySql).toContain("'cash'");
  expect(paySql).toContain("'gateway'");
  const refundSql = (
    db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'refunds'")
      .get() as { sql: string }
  ).sql;
  expect(refundSql).toContain('reason');
  // Du lieu cu van con: seed org + 2 user + san pham mau.
  const users = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  expect(users.c).toBeGreaterThanOrEqual(2);
  expect(seeded.orgId).toBeGreaterThan(0);
});

test('AC-1 thu tien mat 201 paid ngay + event paid + audit log + order_summary', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const { res, payment } = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'cash',
    amount: 50000,
  });
  expect(payment.status).toBe('paid');
  expect(payment.method).toBe('cash');
  expect(payment.amount).toBe(50000);
  expect(payment.currency).toBe('VND');
  expect(payment.order_id).toBe(order.id);
  expect(payment.branch_id).toBe(order.branch_id);
  expect(payment.gateway_reference ?? null).toBeNull();
  const summary = asSummary(res);
  expect(summary.order_total).toBe(200000);
  expect(summary.paid_total).toBe(50000);
  expect(summary.outstanding).toBe(150000);
  expect(summary.payment_status).toBe('partially_paid');
  const events = paymentEvents(ctx.db, payment.id as number);
  expect(events.map((e) => e.event_type)).toContain('paid');
  const audits = auditRows(ctx.db, ctx.orgId).filter(
    (r) => r.action === 'create-payment' && r.detail.target_payment_id === payment.id,
  );
  expect(audits.length).toBe(1);
  expect(audits[0]?.detail.order_code).toBe(order.code);
  expect(audits[0]?.detail.amount).toBe(50000);
  expect(audits[0]?.detail.method).toBe('cash');
});

test('AC-1 thu chuyen khoan 201 paid ngay, don draft van thu duoc', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  expect(order.status).toBe('draft');
  const { payment } = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'bank_transfer',
    amount: 200000,
  });
  expect(payment.status).toBe('paid');
  expect(payment.method).toBe('bank_transfer');
  const detail = await ctx.owner.get(`/api/orders/${order.id as number}/payments`);
  expect(detail.status).toBe(200);
  expect(asSummary(detail).payment_status).toBe('paid');
  expect(asSummary(detail).paid_total).toBe(200000);
  expect(asSummary(detail).outstanding).toBe(0);
});

test('AC-1 thu qua cong 201 requested + gateway_reference duy nhat; 2 don cung amount khac reference', async () => {
  const ctx = await payCtx();
  const order1 = await mustOrder(ctx);
  const order2 = await mustOrder(ctx);
  const { payment: p1 } = await mustCreatePayment(ctx.owner, order1.id as number, {
    method: 'gateway',
    amount: 100000,
  });
  expect(p1.status).toBe('requested');
  expect(typeof p1.gateway_reference).toBe('string');
  expect((p1.gateway_reference as string).startsWith('FAKE-PAY-')).toBe(true);
  const { payment: p2 } = await mustCreatePayment(ctx.owner, order2.id as number, {
    method: 'gateway',
    amount: 100000,
  });
  expect(p2.status).toBe('requested');
  expect(p2.gateway_reference).not.toBe(p1.gateway_reference);
  // Ca 2 payment deu doc duoc, tong moi don tinh rieng.
  const list1 = await ctx.owner.get(`/api/orders/${order1.id as number}/payments`);
  expect(asPaymentList(list1).length).toBe(1);
  expect(asSummary(list1).paid_total).toBe(0);
  expect(asSummary(list1).payment_status).toBe('unpaid');
});

test('AC-1 FakePaymentAdapter.charge nhan ma giao dich: khac giao dich khac reference, cung giao dich cung reference', () => {
  const adapter = new FakePaymentAdapter();
  const charge3 = adapter.charge as unknown as (
    amount: number,
    currency: string,
    transactionId: string,
  ) => PaymentResult;
  const a = charge3(100000, 'VND', 'DH-20261127-0001:1');
  const b = charge3(100000, 'VND', 'DH-20261127-0002:2');
  expect(a.simulated).toBe(true);
  expect((a as unknown as { status: string }).status).toBe('success');
  expect(a.reference.startsWith('FAKE-PAY-')).toBe(true);
  expect(a.reference).not.toBe(b.reference);
  expect(charge3(100000, 'VND', 'DH-20261127-0001:1').reference).toBe(a.reference);
  // Khong co ma giao dich: giu hanh vi cu (2 lan cung amount cho cung reference).
  expect(adapter.charge(50000, 'VND')).toEqual(adapter.charge(50000, 'VND'));
});

test('AC-1 FakePaymentAdapter.refund tra FAKE-REF- deterministic theo giao dich + so tien', () => {
  const adapter = new FakePaymentAdapter();
  expect(typeof (adapter as unknown as { refund?: unknown }).refund).toBe('function');
  const refund = (
    adapter as unknown as {
      refund: (paymentReference: string, amount: number) => PaymentResult;
    }
  ).refund;
  const r1 = refund('FAKE-PAY-ABCDEF123456', 50000);
  expect(r1.simulated).toBe(true);
  expect(r1.reference.startsWith('FAKE-REF-')).toBe(true);
  expect(refund('FAKE-PAY-ABCDEF123456', 50000).reference).toBe(r1.reference);
  expect(refund('FAKE-PAY-ABCDEF123456', 60000).reference).not.toBe(r1.reference);
  expect(refund('FAKE-PAY-0123456789AB', 50000).reference).not.toBe(r1.reference);
});

test('AC-1 FakePaymentAdapter.failNext chi dung trong test: lan charge ke tiep failed, sau do lai success', () => {
  expect(typeof (FakePaymentAdapter as unknown as { failNext?: unknown }).failNext).toBe(
    'function',
  );
  (FakePaymentAdapter as unknown as { failNext: () => void }).failNext();
  const failed = new FakePaymentAdapter().charge(100000, 'VND');
  expect((failed as unknown as { status: string }).status).toBe('failed');
  const ok = new FakePaymentAdapter().charge(100000, 'VND');
  expect((ok as unknown as { status: string }).status).toBe('success');
  expect(ok.simulated).toBe(true);
});

test('AC-1 signWebhook truc tiep: sha256 cua reference:status:amount:secret', () => {
  const sig = signWebhook('bi-mat-gia-lap', 'FAKE-PAY-ABCDEF123456', 'paid', 100000);
  const expected = createHash('sha256')
    .update('FAKE-PAY-ABCDEF123456:paid:100000:bi-mat-gia-lap')
    .digest('hex');
  expect(sig).toBe(expected);
  expect(signWebhook('bi-mat-gia-lap', 'FAKE-PAY-ABCDEF123456', 'failed', 100000)).not.toBe(sig);
});

test('AC-1 computePaymentSummary truc tiep: tong don/tong tra/tong hoan/con thieu/trang thai', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const before = computePaymentSummary(ctx.db, order.id as number);
  expect(before.order_total).toBe(200000);
  expect(before.paid_total).toBe(0);
  expect(before.refunded_total).toBe(0);
  expect(before.outstanding).toBe(200000);
  expect(before.payment_status).toBe('unpaid');
  await mustCreatePayment(ctx.owner, order.id as number, { method: 'cash', amount: 50000 });
  const after = computePaymentSummary(ctx.db, order.id as number);
  expect(after.paid_total).toBe(50000);
  expect(after.outstanding).toBe(150000);
  expect(after.payment_status).toBe('partially_paid');
});

test('AC-1 idempotency tao payment: gui lai cung key tra cung payment + replayed true, khong tao moi', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const key = `pay-${rand()}`;
  const first = await mustCreatePayment(
    ctx.owner,
    order.id as number,
    { method: 'cash', amount: 50000 },
    key,
  );
  const againRes = await ctx.owner
    .post(`/api/orders/${order.id as number}/payments`)
    .set('Idempotency-Key', key)
    .send({ method: 'cash', amount: 50000 });
  expect(againRes.status).toBe(201);
  expect((againRes.body as Record<string, unknown>).replayed).toBe(true);
  expect(asPayment(againRes).id).toBe(first.payment.id);
  const list = await ctx.owner.get(`/api/orders/${order.id as number}/payments`);
  expect(asPaymentList(list).length).toBe(1);
  expect(asSummary(list).paid_total).toBe(50000);
  // Key qua body idempotency_key cung replay; key khac tao payment moi; thieu key van thuc thi.
  const bodyKey = `pay-body-${rand()}`;
  const b1 = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'cash',
    amount: 30000,
    idempotency_key: bodyKey,
  });
  const b2 = await ctx.owner
    .post(`/api/orders/${order.id as number}/payments`)
    .send({ method: 'cash', amount: 30000, idempotency_key: bodyKey });
  expect(b2.status).toBe(201);
  expect((b2.body as Record<string, unknown>).replayed).toBe(true);
  expect(asPayment(b2).id).toBe(b1.payment.id);
  const other = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'cash',
    amount: 30000,
    idempotency_key: `pay-khac-${rand()}`,
  });
  expect(other.payment.id).not.toBe(b1.payment.id);
  const noKey = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'cash',
    amount: 10000,
  });
  expect(noKey.payment.id).toBeDefined();
  const list2 = await ctx.owner.get(`/api/orders/${order.id as number}/payments`);
  expect(asPaymentList(list2).length).toBe(4);
});

test('AC-1 tao payment sai dau vao 400, don khong ton tai 404, don da huy 400, ngoai org 403', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const badMethod = await ctx.owner
    .post(`/api/orders/${order.id as number}/payments`)
    .send({ method: 'card', amount: 10000 });
  expect(badMethod.status).toBe(400);
  for (const amount of [0, -1000, 10.5, '10000']) {
    const res = await ctx.owner
      .post(`/api/orders/${order.id as number}/payments`)
      .send({ method: 'cash', amount });
    expect(res.status).toBe(400);
  }
  const missing = await ctx.owner
    .post('/api/orders/999999/payments')
    .send({ method: 'cash', amount: 10000 });
  expect(missing.status).toBe(404);
  const crossOrg = await ctx.ownerB
    .post(`/api/orders/${order.id as number}/payments`)
    .send({ method: 'cash', amount: 10000 });
  expect([403, 404]).toContain(crossOrg.status);
  // Don da huy khong thu tien duoc.
  const cancelled = await mustOrder(ctx);
  const cancelRes = await ctx.owner.post(`/api/orders/${cancelled.id as number}/cancel`).send({});
  expect([200, 201]).toContain(cancelRes.status);
  const payCancelled = await ctx.owner
    .post(`/api/orders/${cancelled.id as number}/payments`)
    .send({ method: 'cash', amount: 10000 });
  expect(payCancelled.status).toBe(400);
  // Don bi huy van xem duoc lich su (trong, chua co payment) — doi soat sau huy.
  const history = await ctx.owner.get(`/api/orders/${cancelled.id as number}/payments`);
  expect(history.status).toBe(200);
  expect(asPaymentList(history).length).toBe(0);
});

// ---------- AC-2: webhook gia lap chot dung mot lan ----------

test('AC-2 webhook paid chot requested thanh paid + event paid + audit log', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const { payment } = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'gateway',
    amount: 120000,
  });
  expect(payment.status).toBe('requested');
  const ref = payment.gateway_reference as string;
  const res = await postWebhook(
    ctx.app,
    { gateway_reference: ref, status: 'paid', amount: 120000 },
    fakeSignature(WEBHOOK_SECRET, ref, 'paid', 120000),
  );
  expect(res.status).toBe(200);
  const detail = await ctx.owner.get(`/api/payments/${payment.id as number}`);
  expect(detail.status).toBe(200);
  expect(asPayment(detail).status).toBe('paid');
  const events = paymentEvents(ctx.db, payment.id as number);
  expect(events.map((e) => e.event_type)).toContain('paid');
  const summary = await ctx.owner.get(`/api/orders/${order.id as number}/payments`);
  expect(asSummary(summary).paid_total).toBe(120000);
  expect(asSummary(summary).payment_status).toBe('partially_paid');
  const audits = auditRows(ctx.db, ctx.orgId).filter(
    (r) => r.action === 'webhook-paid' && r.detail.target_payment_id === payment.id,
  );
  expect(audits.length).toBe(1);
  expect(audits[0]?.user_id).toBeNull();
  expect(String(audits[0]?.detail.gateway_reference)).toBe(ref);
});

test('AC-2 webhook paid gui lap: 200 + duplicate true, khong doi gi, ghi event trung, tong chi tinh 1 lan', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const paid = await mustGatewayPaid(ctx, order.id as number, 100000);
  const ref = paid.gateway_reference as string;
  const dup = await postWebhook(
    ctx.app,
    { gateway_reference: ref, status: 'paid', amount: 100000 },
    fakeSignature(WEBHOOK_SECRET, ref, 'paid', 100000),
  );
  expect(dup.status).toBe(200);
  expect((dup.body as Record<string, unknown>).duplicate).toBe(true);
  const detail = await ctx.owner.get(`/api/payments/${paid.id as number}`);
  expect(asPayment(detail).status).toBe('paid');
  const events = paymentEvents(ctx.db, paid.id as number);
  expect(events.filter((e) => e.event_type === 'paid').length).toBe(1);
  expect(events.map((e) => e.event_type)).toContain('webhook_duplicate_ignored');
  const summary = await ctx.owner.get(`/api/orders/${order.id as number}/payments`);
  expect(asSummary(summary).paid_total).toBe(100000);
});

test('AC-2 webhook dong thoi 2 paid cung reference: chi 1 lan chot, lan con lai duplicate true', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const { payment } = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'gateway',
    amount: 80000,
  });
  const ref = payment.gateway_reference as string;
  const sig = fakeSignature(WEBHOOK_SECRET, ref, 'paid', 80000);
  const [r1, r2] = await Promise.all([
    postWebhook(ctx.app, { gateway_reference: ref, status: 'paid', amount: 80000 }, sig),
    postWebhook(ctx.app, { gateway_reference: ref, status: 'paid', amount: 80000 }, sig),
  ]);
  expect(r1.status).toBe(200);
  expect(r2.status).toBe(200);
  const dups = [r1, r2].filter(
    (r) => (r.body as Record<string, unknown>).duplicate === true,
  );
  expect(dups.length).toBe(1);
  const events = paymentEvents(ctx.db, payment.id as number);
  expect(events.filter((e) => e.event_type === 'paid').length).toBe(1);
  const summary = await ctx.owner.get(`/api/orders/${order.id as number}/payments`);
  expect(asSummary(summary).paid_total).toBe(80000);
  const detail = await ctx.owner.get(`/api/payments/${payment.id as number}`);
  expect(asPayment(detail).status).toBe('paid');
});

test('AC-2 webhook failed sau paid bi bo qua: 200, van paid, ghi event, khong doi paid thanh failed', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const paid = await mustGatewayPaid(ctx, order.id as number, 100000);
  const ref = paid.gateway_reference as string;
  const res = await postWebhook(
    ctx.app,
    { gateway_reference: ref, status: 'failed', amount: 100000 },
    fakeSignature(WEBHOOK_SECRET, ref, 'failed', 100000),
  );
  expect(res.status).toBe(200);
  const detail = await ctx.owner.get(`/api/payments/${paid.id as number}`);
  expect(asPayment(detail).status).toBe('paid');
  const events = paymentEvents(ctx.db, paid.id as number);
  expect(events.map((e) => e.event_type)).toContain('webhook_ignored');
  const summary = await ctx.owner.get(`/api/orders/${order.id as number}/payments`);
  expect(asSummary(summary).paid_total).toBe(100000);
});

test('AC-2 webhook sai thu tu: failed truoc roi paid sau van chot binh thuong', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const { payment } = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'gateway',
    amount: 90000,
  });
  const ref = payment.gateway_reference as string;
  const failed = await postWebhook(
    ctx.app,
    { gateway_reference: ref, status: 'failed', amount: 90000 },
    fakeSignature(WEBHOOK_SECRET, ref, 'failed', 90000),
  );
  expect(failed.status).toBe(200);
  const mid = await ctx.owner.get(`/api/payments/${payment.id as number}`);
  expect(asPayment(mid).status).toBe('failed');
  const paid = await postWebhook(
    ctx.app,
    { gateway_reference: ref, status: 'paid', amount: 90000 },
    fakeSignature(WEBHOOK_SECRET, ref, 'paid', 90000),
  );
  expect(paid.status).toBe(200);
  const detail = await ctx.owner.get(`/api/payments/${payment.id as number}`);
  expect(asPayment(detail).status).toBe('paid');
  const summary = await ctx.owner.get(`/api/orders/${order.id as number}/payments`);
  expect(asSummary(summary).paid_total).toBe(90000);
});

test('AC-2 webhook failed cho requested: payment failed + event failed + audit log', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const { payment } = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'gateway',
    amount: 70000,
  });
  const ref = payment.gateway_reference as string;
  const res = await postWebhook(
    ctx.app,
    { gateway_reference: ref, status: 'failed', amount: 70000 },
    fakeSignature(WEBHOOK_SECRET, ref, 'failed', 70000),
  );
  expect(res.status).toBe(200);
  const detail = await ctx.owner.get(`/api/payments/${payment.id as number}`);
  expect(asPayment(detail).status).toBe('failed');
  const events = paymentEvents(ctx.db, payment.id as number);
  expect(events.map((e) => e.event_type)).toContain('failed');
  const audits = auditRows(ctx.db, ctx.orgId).filter(
    (r) => r.action === 'webhook-failed' && r.detail.target_payment_id === payment.id,
  );
  expect(audits.length).toBe(1);
  expect(audits[0]?.user_id).toBeNull();
});

test('AC-2 webhook sai/thieu chu ky 401; webhook khong can session dang nhap', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const { payment } = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'gateway',
    amount: 60000,
  });
  const ref = payment.gateway_reference as string;
  const body = { gateway_reference: ref, status: 'paid', amount: 60000 };
  // Sai chu ky (ky cho status khac), thieu chu ky, chu ky cua secret khac.
  const wrong = await postWebhook(ctx.app, body, fakeSignature(WEBHOOK_SECRET, ref, 'failed', 60000));
  expect(wrong.status).toBe(401);
  const missing = await postWebhook(ctx.app, body);
  expect(missing.status).toBe(401);
  const otherSecret = await postWebhook(
    ctx.app,
    body,
    fakeSignature('secret-khac-gia-lap', ref, 'paid', 60000),
  );
  expect(otherSecret.status).toBe(401);
  // Payment chua bi chot sai: van requested.
  const detail = await ctx.owner.get(`/api/payments/${payment.id as number}`);
  expect(asPayment(detail).status).toBe('requested');
  // Webhook dung chu ky qua request khong session van duoc (khong 401).
  const ok = await postWebhook(ctx.app, body, fakeSignature(WEBHOOK_SECRET, ref, 'paid', 60000));
  expect(ok.status).toBe(200);
});

test('AC-2 webhook reference khong ton tai 404, amount khac 400, khong chot sai so', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const { payment } = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'gateway',
    amount: 60000,
  });
  const ref = payment.gateway_reference as string;
  const unknown = await postWebhook(
    ctx.app,
    { gateway_reference: 'FAKE-PAY-KHONGTONTAI', status: 'paid', amount: 60000 },
    fakeSignature(WEBHOOK_SECRET, 'FAKE-PAY-KHONGTONTAI', 'paid', 60000),
  );
  expect(unknown.status).toBe(404);
  const wrongAmount = await postWebhook(
    ctx.app,
    { gateway_reference: ref, status: 'paid', amount: 60001 },
    fakeSignature(WEBHOOK_SECRET, ref, 'paid', 60001),
  );
  expect(wrongAmount.status).toBe(400);
  const detail = await ctx.owner.get(`/api/payments/${payment.id as number}`);
  expect(asPayment(detail).status).toBe('requested');
});

test('AC-2 thieu secret webhook: endpoint tra 503, server van chay route khac', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const { payment } = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'gateway',
    amount: 50000,
  });
  const ref = payment.gateway_reference as string;
  const saved = process.env.OMNIFLOW_WEBHOOK_SECRET;
  try {
    delete process.env.OMNIFLOW_WEBHOOK_SECRET;
    // Tao lai app tren cung DB sau khi go secret: dung Worker doc secret luc
    // tao app hay luc xu ly request thi app moi nay deu khong co secret.
    const appNoSecret = createApp(ctx.db);
    const res = await postWebhook(
      appNoSecret,
      { gateway_reference: ref, status: 'paid', amount: 50000 },
      fakeSignature(WEBHOOK_SECRET, ref, 'paid', 50000),
    );
    expect(res.status).toBe(503);
    const health = await request(appNoSecret).get('/health');
    expect(health.status).toBe(200);
    const detail = await ctx.owner.get(`/api/payments/${payment.id as number}`);
    expect(asPayment(detail).status).toBe('requested');
  } finally {
    if (saved !== undefined) process.env.OMNIFLOW_WEBHOOK_SECRET = saved;
    else delete process.env.OMNIFLOW_WEBHOOK_SECRET;
  }
});

// ---------- AC-3: hoan tien + doi soat + lich su giao dich ----------

async function mustRefund(
  agent: Agent,
  paymentId: number,
  body: Record<string, unknown>,
  idempotencyKey?: string,
) {
  const req = agent.post(`/api/payments/${paymentId}/refunds`);
  if (idempotencyKey) req.set('Idempotency-Key', idempotencyKey);
  const res = await req.send(body);
  expect(res.status).toBe(201);
  const refund = asRefund(res);
  expect(refund.id).toBeDefined();
  return { res, refund };
}

test('AC-3 hoan mot phan 201 refund completed + payment partially_refunded + event + audit + summary', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const { payment } = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'cash',
    amount: 200000,
  });
  const { res, refund } = await mustRefund(ctx.owner, payment.id as number, {
    amount: 50000,
    reason: 'khach tra thua mot phan',
  });
  expect(refund.status).toBe('completed');
  expect(refund.amount).toBe(50000);
  expect(refund.payment_id).toBe(payment.id);
  const detail = await ctx.owner.get(`/api/payments/${payment.id as number}`);
  expect(asPayment(detail).status).toBe('partially_refunded');
  const events = paymentEvents(ctx.db, payment.id as number);
  expect(events.map((e) => e.event_type)).toContain('refund_completed');
  const summary = asSummary(res);
  expect(summary.paid_total).toBe(150000);
  expect(summary.refunded_total).toBe(50000);
  expect(summary.outstanding).toBe(50000);
  expect(summary.payment_status).toBe('partially_paid');
  const audits = auditRows(ctx.db, ctx.orgId).filter(
    (r) => r.action === 'refund-payment' && r.detail.target_payment_id === payment.id,
  );
  expect(audits.length).toBe(1);
  expect(audits[0]?.detail.amount).toBe(50000);
});

test('AC-3 hoan du: payment refunded, paid_total ve 0, outstanding ve bang order_total', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const { payment } = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'cash',
    amount: 200000,
  });
  await mustRefund(ctx.owner, payment.id as number, { amount: 200000, reason: 'huy giao dich' });
  const detail = await ctx.owner.get(`/api/payments/${payment.id as number}`);
  expect(asPayment(detail).status).toBe('refunded');
  const summary = await ctx.owner.get(`/api/orders/${order.id as number}/payments`);
  expect(asSummary(summary).paid_total).toBe(0);
  expect(asSummary(summary).refunded_total).toBe(200000);
  expect(asSummary(summary).outstanding).toBe(200000);
  expect(asSummary(summary).payment_status).toBe('refunded');
  // Hoan them sau khi da hoan du -> 400.
  const extra = await ctx.owner
    .post(`/api/payments/${payment.id as number}/refunds`)
    .send({ amount: 1, reason: 'hoan them' });
  expect(extra.status).toBe(400);
});

test('AC-3 hoan vuot so da tra 400, khong tao refund nao', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const { payment } = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'cash',
    amount: 100000,
  });
  const over = await ctx.owner
    .post(`/api/payments/${payment.id as number}/refunds`)
    .send({ amount: 100001, reason: 'vuot' });
  expect(over.status).toBe(400);
  expect(refundRows(ctx.db, payment.id as number).length).toBe(0);
  // Hoan dung so roi hoan tiep phan con lai vuot phan chua hoan cung 400.
  await mustRefund(ctx.owner, payment.id as number, { amount: 60000, reason: 'hoan 60k' });
  const over2 = await ctx.owner
    .post(`/api/payments/${payment.id as number}/refunds`)
    .send({ amount: 40001, reason: 'vuot phan con lai' });
  expect(over2.status).toBe(400);
  expect(refundRows(ctx.db, payment.id as number).length).toBe(1);
});

test('AC-3 hoan sai: payment chua paid 400, reason trong 400, amount <= 0 400, payment khong ton tai 404', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const { payment: requested } = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'gateway',
    amount: 100000,
  });
  const notPaid = await ctx.owner
    .post(`/api/payments/${requested.id as number}/refunds`)
    .send({ amount: 10000, reason: 'chua tra' });
  expect(notPaid.status).toBe(400);
  const { payment: paid } = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'cash',
    amount: 100000,
  });
  for (const body of [
    { amount: 10000, reason: '' },
    { amount: 10000 },
    { amount: 0, reason: 'khong dong' },
    { amount: -5000, reason: 'am' },
    { amount: 10.5, reason: 'le' },
  ]) {
    const res = await ctx.owner
      .post(`/api/payments/${paid.id as number}/refunds`)
      .send(body);
    expect(res.status).toBe(400);
  }
  expect(refundRows(ctx.db, paid.id as number).length).toBe(0);
  const missing = await ctx.owner
    .post('/api/payments/999999/refunds')
    .send({ amount: 1000, reason: 'khong co' });
  expect(missing.status).toBe(404);
  const crossOrg = await ctx.ownerB
    .post(`/api/payments/${paid.id as number}/refunds`)
    .send({ amount: 1000, reason: 'ngoai org' });
  expect([403, 404]).toContain(crossOrg.status);
});

test('AC-3 hoan dong thoi 2 lan vuot so da tra: chi 1 lan thanh cong, lan con lai 400', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const { payment } = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'cash',
    amount: 200000,
  });
  const [r1, r2] = await Promise.all([
    ctx.owner
      .post(`/api/payments/${payment.id as number}/refunds`)
      .send({ amount: 150000, reason: 'dong thoi 1' }),
    ctx.owner
      .post(`/api/payments/${payment.id as number}/refunds`)
      .send({ amount: 150000, reason: 'dong thoi 2' }),
  ]);
  const statuses = [r1.status, r2.status].sort();
  expect(statuses).toEqual([201, 400]);
  expect(refundRows(ctx.db, payment.id as number).length).toBe(1);
  const summary = await ctx.owner.get(`/api/orders/${order.id as number}/payments`);
  expect(asSummary(summary).refunded_total).toBe(150000);
  expect(asSummary(summary).paid_total).toBe(50000);
});

test('AC-3 idempotency hoan tien: gui lai cung key replayed true, khong tao refund moi', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const { payment } = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'cash',
    amount: 200000,
  });
  const key = `refund-${rand()}`;
  const first = await mustRefund(
    ctx.owner,
    payment.id as number,
    { amount: 40000, reason: 'hoan lan 1' },
    key,
  );
  const again = await ctx.owner
    .post(`/api/payments/${payment.id as number}/refunds`)
    .set('Idempotency-Key', key)
    .send({ amount: 40000, reason: 'hoan lan 1' });
  expect(again.status).toBe(201);
  expect((again.body as Record<string, unknown>).replayed).toBe(true);
  expect(asRefund(again).id).toBe(first.refund.id);
  expect(refundRows(ctx.db, payment.id as number).length).toBe(1);
  const summary = await ctx.owner.get(`/api/orders/${order.id as number}/payments`);
  expect(asSummary(summary).refunded_total).toBe(40000);
  // Key khac tao refund moi.
  const other = await mustRefund(ctx.owner, payment.id as number, {
    amount: 10000,
    reason: 'hoan lan 2',
    idempotency_key: `refund-khac-${rand()}`,
  });
  expect(other.refund.id).not.toBe(first.refund.id);
  expect(refundRows(ctx.db, payment.id as number).length).toBe(2);
});

test('AC-3 doi soat dung so hoc: unpaid, partially_paid, paid, overpaid hien ro so thua', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const s0 = await ctx.owner.get(`/api/orders/${order.id as number}/payments`);
  expect(asSummary(s0).payment_status).toBe('unpaid');
  expect(asSummary(s0).paid_total).toBe(0);
  await mustCreatePayment(ctx.owner, order.id as number, { method: 'cash', amount: 50000 });
  const s1 = await ctx.owner.get(`/api/orders/${order.id as number}/payments`);
  expect(asSummary(s1).payment_status).toBe('partially_paid');
  expect(asSummary(s1).outstanding).toBe(150000);
  await mustCreatePayment(ctx.owner, order.id as number, { method: 'cash', amount: 150000 });
  const s2 = await ctx.owner.get(`/api/orders/${order.id as number}/payments`);
  expect(asSummary(s2).payment_status).toBe('paid');
  expect(asSummary(s2).outstanding).toBe(0);
  // Tra thua: outstanding am hien ro, khong bi giau.
  await mustCreatePayment(ctx.owner, order.id as number, { method: 'cash', amount: 50000 });
  const s3 = await ctx.owner.get(`/api/orders/${order.id as number}/payments`);
  expect(asSummary(s3).payment_status).toBe('overpaid');
  expect(asSummary(s3).paid_total).toBe(250000);
  expect(asSummary(s3).outstanding).toBe(-50000);
  // Danh sach payments moi nhat truoc.
  const list = asPaymentList(s3);
  expect(list.length).toBe(3);
  expect((list[0]?.created_at as string) >= (list[2]?.created_at as string)).toBe(true);
});

test('AC-3 luong day du: gateway paid -> hoan mot phan -> hoan not, status chuyen dung, events cu nhat truoc', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const paid = await mustGatewayPaid(ctx, order.id as number, 200000);
  const s1 = await ctx.owner.get(`/api/orders/${order.id as number}/payments`);
  expect(asSummary(s1).payment_status).toBe('paid');
  await mustRefund(ctx.owner, paid.id as number, { amount: 80000, reason: 'hoan mot phan' });
  const mid = await ctx.owner.get(`/api/payments/${paid.id as number}`);
  expect(asPayment(mid).status).toBe('partially_refunded');
  const s2 = await ctx.owner.get(`/api/orders/${order.id as number}/payments`);
  expect(asSummary(s2).paid_total).toBe(120000);
  expect(asSummary(s2).payment_status).toBe('partially_paid');
  await mustRefund(ctx.owner, paid.id as number, { amount: 120000, reason: 'hoan not' });
  const done = await ctx.owner.get(`/api/payments/${paid.id as number}`);
  expect(asPayment(done).status).toBe('refunded');
  const s3 = await ctx.owner.get(`/api/orders/${order.id as number}/payments`);
  expect(asSummary(s3).paid_total).toBe(0);
  expect(asSummary(s3).refunded_total).toBe(200000);
  expect(asSummary(s3).outstanding).toBe(200000);
  expect(asSummary(s3).payment_status).toBe('refunded');
  // GET 1 payment kem refunds + events; events theo thu tu cu nhat truoc.
  const refunds = (asPayment(done).refunds as Record<string, unknown>[]) ?? refundRows(ctx.db, paid.id as number);
  expect(refunds.length).toBe(2);
  const events = paymentEvents(ctx.db, paid.id as number);
  const types = events.map((e) => e.event_type);
  expect(types).toEqual(['created', 'paid', 'refund_completed', 'refund_completed']);
  const detail = await ctx.owner.get(`/api/payments/${paid.id as number}`);
  const bodyEvents = (asPayment(detail).events as Record<string, unknown>[]) ?? [];
  if (bodyEvents.length > 0) {
    expect(bodyEvents.map((e) => e.event_type)).toEqual(types);
  }
  // Don van o trang thai cu (hoan tien khong doi trang thai don).
  const orderRow = ctx.db.prepare('SELECT status FROM orders WHERE id = ?').get(order.id) as {
    status: string;
  };
  expect(orderRow.status).toBe('draft');
});

test('AC-3 payment_events append-only: PATCH/DELETE lich su 404/405 va lich su van nguyen', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const { payment } = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'cash',
    amount: 50000,
  });
  const before = paymentEvents(ctx.db, payment.id as number);
  expect(before.length).toBeGreaterThanOrEqual(1);
  const eventId = before[0]?.id as number;
  const patchRes = await ctx.owner
    .patch(`/api/payments/${payment.id as number}/events/${eventId}`)
    .send({ event_type: 'doi' });
  expect([404, 405]).toContain(patchRes.status);
  const deleteRes = await ctx.owner.delete(
    `/api/payments/${payment.id as number}/events/${eventId}`,
  );
  expect([404, 405]).toContain(deleteRes.status);
  const after = paymentEvents(ctx.db, payment.id as number);
  expect(after).toEqual(before);
});

// ---------- AC-4: RBAC + audit + khong luu the + checks/docs ----------

test('AC-4 can() 3 actions thanh toan theo ma tran (src/rbac.ts)', () => {
  const owner = payActor(1, 'owner', 1);
  const manager = payActor(2, 'manager', null);
  const salesOwn = payActor(3, 'sales', 1);
  const salesOther = payActor(4, 'sales', 2);
  const warehouseOwn = payActor(5, 'warehouse', 1, 10);
  const warehouseOther = payActor(6, 'warehouse', 1, 11);
  const accountant = payActor(7, 'accountant', 1);
  const ownBranch = payTarget(1, 1, 10);
  const otherBranch = payTarget(1, 2, 10);
  const otherWarehouse = payTarget(1, 1, 11);
  const createPayment = 'create-payment' as Action;
  const refundPayment = 'refund-payment' as Action;
  const viewPayments = 'view-payments' as Action;
  // create-payment: owner/manager/sales dung chi nhanh/accountant toan org; warehouse 403.
  expect(can(owner, createPayment, ownBranch)).toBe(true);
  expect(can(manager, createPayment, otherBranch)).toBe(true);
  expect(can(salesOwn, createPayment, ownBranch)).toBe(true);
  expect(can(salesOwn, createPayment, otherBranch)).toBe(false);
  expect(can(accountant, createPayment, ownBranch)).toBe(true);
  expect(can(warehouseOwn, createPayment, ownBranch)).toBe(false);
  expect(can(owner, createPayment, payTarget(2, 1, 10))).toBe(false);
  // refund-payment: owner/manager/accountant; sales/warehouse 403.
  expect(can(owner, refundPayment, ownBranch)).toBe(true);
  expect(can(manager, refundPayment, otherBranch)).toBe(true);
  expect(can(accountant, refundPayment, ownBranch)).toBe(true);
  expect(can(salesOwn, refundPayment, ownBranch)).toBe(false);
  expect(can(warehouseOwn, refundPayment, ownBranch)).toBe(false);
  // view-payments: owner/manager/accountant toan org; sales chi chi nhanh minh; warehouse chi kho minh.
  expect(can(owner, viewPayments, otherBranch)).toBe(true);
  expect(can(manager, viewPayments, otherBranch)).toBe(true);
  expect(can(accountant, viewPayments, ownBranch)).toBe(true);
  expect(can(salesOwn, viewPayments, ownBranch)).toBe(true);
  expect(can(salesOwn, viewPayments, otherBranch)).toBe(false);
  expect(can(warehouseOwn, viewPayments, ownBranch)).toBe(true);
  expect(can(warehouseOwn, viewPayments, otherWarehouse)).toBe(false);
  expect(can(owner, viewPayments, payTarget(2, 1, 10))).toBe(false);
});

test('AC-4 RBAC 403 qua HTTP: warehouse tao payment, sales hoan tien, accountant/manager/sales dung chi nhanh duoc', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const whCreate = await ctx.warehouse
    .post(`/api/orders/${order.id as number}/payments`)
    .send({ method: 'cash', amount: 10000 });
  expect(whCreate.status).toBe(403);
  const { payment } = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'cash',
    amount: 100000,
  });
  const salesRefund = await ctx.sales
    .post(`/api/payments/${payment.id as number}/refunds`)
    .send({ amount: 1000, reason: 'sales hoan' });
  expect(salesRefund.status).toBe(403);
  const whRefund = await ctx.warehouse
    .post(`/api/payments/${payment.id as number}/refunds`)
    .send({ amount: 1000, reason: 'kho hoan' });
  expect(whRefund.status).toBe(403);
  // Duoc phep: sales tao payment dung chi nhanh, manager tao, accountant hoan.
  const salesPay = await ctx.sales
    .post(`/api/orders/${order.id as number}/payments`)
    .send({ method: 'cash', amount: 10000 });
  expect(salesPay.status).toBe(201);
  const managerPay = await ctx.manager
    .post(`/api/orders/${order.id as number}/payments`)
    .send({ method: 'cash', amount: 10000 });
  expect(managerPay.status).toBe(201);
  const accRefund = await ctx.accountant
    .post(`/api/payments/${payment.id as number}/refunds`)
    .send({ amount: 10000, reason: 'ke toan hoan' });
  expect(accRefund.status).toBe(201);
});

test('AC-4 RBAC xem 403: sales ngoai chi nhanh, warehouse ngoai kho gan, user org A doc payment org B', async () => {
  const ctx = await payCtx();
  // Don chi nhanh 1 (kho A) + don chi nhanh 2 (kho B, tao bang sales2).
  const order1 = await mustOrder(ctx);
  const order2 = await mustCreateOrder(ctx.sales2, {
    warehouse_id: ctx.whB.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 1 }],
  });
  const { payment: p1 } = await mustCreatePayment(ctx.owner, order1.id as number, {
    method: 'cash',
    amount: 50000,
  });
  const { payment: p2 } = await mustCreatePayment(ctx.owner, order2.id as number, {
    method: 'cash',
    amount: 50000,
  });
  // sales chi nhanh 1 xem payment don chi nhanh 2 -> 403; xem don minh duoc.
  const sales2View = await ctx.sales.get(`/api/orders/${order2.id as number}/payments`);
  expect(sales2View.status).toBe(403);
  const sales2Payment = await ctx.sales.get(`/api/payments/${p2.id as number}`);
  expect(sales2Payment.status).toBe(403);
  const salesOwn = await ctx.sales.get(`/api/orders/${order1.id as number}/payments`);
  expect(salesOwn.status).toBe(200);
  // warehouse gan kho A: xem don kho A duoc, don kho B 403; tao/hoan van 403 du dung kho.
  const scope = await ctx.owner.patch(`/api/users/${ctx.warehouseId}/scope`).send({
    warehouse_id: ctx.whA.id,
  });
  expect(scope.status).toBe(200);
  const whViewA = await ctx.warehouse.get(`/api/orders/${order1.id as number}/payments`);
  expect(whViewA.status).toBe(200);
  const whViewB = await ctx.warehouse.get(`/api/orders/${order2.id as number}/payments`);
  expect(whViewB.status).toBe(403);
  const whCreateA = await ctx.warehouse
    .post(`/api/orders/${order1.id as number}/payments`)
    .send({ method: 'cash', amount: 1000 });
  expect(whCreateA.status).toBe(403);
  // Org B doc payment org A -> 403.
  const crossList = await ctx.ownerB.get(`/api/orders/${order1.id as number}/payments`);
  expect([403, 404]).toContain(crossList.status);
  const crossOne = await ctx.ownerB.get(`/api/payments/${p1.id as number}`);
  expect([403, 404]).toContain(crossOne.status);
  // Chua dang nhap -> 401.
  const anon = await request(ctx.app).get(`/api/orders/${order1.id as number}/payments`);
  expect(anon.status).toBe(401);
});

test('AC-4 audit log thanh toan: tao/webhook/hoan deu ghi, webhook user_id NULL + ghi ro webhook, sales xem log 403', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const { payment: cash } = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'cash',
    amount: 100000,
  });
  const gateway = await mustGatewayPaid(ctx, order.id as number, 100000);
  await mustRefund(ctx.owner, gateway.id as number, { amount: 20000, reason: 'hoan webhook' });
  const rows = auditRows(ctx.db, ctx.orgId);
  const byPayment = (id: number, action: string) =>
    rows.find((r) => r.action === action && r.detail.target_payment_id === id);
  const createCash = byPayment(cash.id as number, 'create-payment');
  expect(createCash).toBeDefined();
  expect(createCash?.user_id).toBeDefined();
  expect(createCash?.detail.order_code).toBe(order.code);
  expect(createCash?.detail.method).toBe('cash');
  expect(createCash?.detail.amount).toBe(100000);
  const createGw = byPayment(gateway.id as number, 'create-payment');
  expect(createGw?.detail.method).toBe('gateway');
  expect(typeof createGw?.detail.gateway_reference).toBe('string');
  const webhookRow = byPayment(gateway.id as number, 'webhook-paid');
  expect(webhookRow).toBeDefined();
  expect(webhookRow?.user_id).toBeNull();
  expect(String(JSON.stringify(webhookRow?.detail)).toLowerCase()).toContain('webhook');
  const refundRow = byPayment(gateway.id as number, 'refund-payment');
  expect(refundRow).toBeDefined();
  expect(refundRow?.detail.amount).toBe(20000);
  // Xem audit log theo luat GOAL-002: sales 403, owner duoc.
  const salesAudit = await ctx.sales.get('/api/audit-log');
  expect(salesAudit.status).toBe(403);
  const ownerAudit = await ctx.owner.get('/api/audit-log');
  expect(ownerAudit.status).toBe(200);
});

test('AC-4 khong co field the/CVV trong DB, API hay log', async () => {
  const ctx = await payCtx();
  const names = tableNames(ctx.db);
  for (const t of ['payments', 'refunds', 'payment_events']) {
    expect(names).toContain(t);
    const cols = (
      ctx.db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]
    ).map((c) => c.name.toLowerCase());
    for (const c of cols) {
      expect(c).not.toMatch(/card|cvv|cvc|pan|card_number/);
    }
    const sql = (
      ctx.db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(t) as { sql: string }
    ).sql.toLowerCase();
    expect(sql).not.toMatch(/card_number|cvv|cvc/);
  }
  const order = await mustOrder(ctx);
  const { payment } = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'cash',
    amount: 50000,
  });
  await mustRefund(ctx.owner, payment.id as number, { amount: 10000, reason: 'hoan test' });
  const detail = await ctx.owner.get(`/api/payments/${payment.id as number}`);
  expect(detail.status).toBe(200);
  const bodyText = JSON.stringify(detail.body);
  expect(bodyText).not.toMatch(/card_number|cardnumber|\bcvv\b|\bcvc\b/i);
  const list = await ctx.owner.get(`/api/orders/${order.id as number}/payments`);
  expect(JSON.stringify(list.body)).not.toMatch(/card_number|cardnumber|\bcvv\b|\bcvc\b/i);
  const audits = auditRows(ctx.db, ctx.orgId).filter(
    (r) => r.detail.target_payment_id === payment.id,
  );
  expect(audits.length).toBeGreaterThan(0);
  for (const a of audits) {
    expect(JSON.stringify(a.detail)).not.toMatch(/card_number|cardnumber|\bcvv\b|\bcvc\b/i);
  }
  const events = paymentEvents(ctx.db, payment.id as number);
  for (const e of events) {
    expect(String(e.detail ?? '')).not.toMatch(/card_number|cardnumber|\bcvv\b|\bcvc\b/i);
  }
});

test('AC-4 khong co endpoint DELETE payment: DELETE 404/405 va payment van doc duoc', async () => {
  const ctx = await payCtx();
  const order = await mustOrder(ctx);
  const { payment } = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'cash',
    amount: 50000,
  });
  const del = await ctx.owner.delete(`/api/payments/${payment.id as number}`);
  expect([404, 405]).toContain(del.status);
  const detail = await ctx.owner.get(`/api/payments/${payment.id as number}`);
  expect(detail.status).toBe(200);
  expect(asPayment(detail).id).toBe(payment.id);
  expect(paymentRow(ctx.db, payment.id as number).id).toBe(payment.id);
});
