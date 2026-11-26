import { test, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { migrate, openDb } from '../src/db.js';
import { seed } from '../src/seed.js';

// Mat khau GIA LAP chi dung cho test, khong phai credential that.
const OWNER_PASSWORD = 'gia-lap-owner-123';

type Db = ReturnType<typeof openDb>;
type App = ReturnType<typeof createApp>;

function freshApp() {
  const db = openDb(':memory:');
  migrate(db);
  const seeded = seed(db, { ownerPassword: OWNER_PASSWORD, staffPassword: 'gia-lap-staff-123' });
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
  await addUser(db, orgBId, branchBId, 'owner-b@example.local', 'owner');
  return { orgBId, branchBId };
}

async function loginAgent(app: App, email: string, password: string) {
  const agent = request.agent(app);
  const res = await agent.post('/login').send({ email, password });
  expect(res.status).toBe(200);
  return agent;
}

type Agent = Awaited<ReturnType<typeof loginAgent>>;

/** Lay object don tu response (tra truc tiep hoac boc {order}). */
function asOrder(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (body.order as Record<string, unknown>) ?? body;
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
  const code = (overrides.code as string) ?? `SP-R19-${rand()}`;
  const res = await agent.post('/api/products').send({
    code,
    name: 'San pham R-19 gia lap',
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
    sku: `SKU-R19-${rand()}`,
    name: 'Bien the R-19 gia lap',
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
    .send({ warehouse_id: warehouseId, variant_id: variantId, qty, reason: 'nhap gia lap R-19' });
  expect([200, 201]).toContain(res.status);
}

/**
 * Boi canh R-19: org A 2 chi nhanh + 2 kho (A, B) + 2 san pham/bien the
 * (V1 gia 100000, V2 gia 50000) + ton: whA V1 50 / V2 30, whB V1 100;
 * org B co 1 owner rieng (du lieu gia lap 2 org).
 */
async function orderCtx() {
  const { db, app, seeded } = freshApp();
  const orgId = seeded.orgId;
  const branch1 = seeded.branchId;
  const branch2 = addBranch(db, orgId, 'Chi nhanh 2');
  const { orgBId, branchBId } = await addOrgB(db);
  const owner = await loginAgent(app, seeded.ownerEmail, OWNER_PASSWORD);
  const ownerB = await loginAgent(app, 'owner-b@example.local', 'gia-lap-123');
  const whA = await createWarehouse(owner, 'Kho A R-19');
  const whB = await createWarehouse(owner, 'Kho B R-19');
  const p1 = await createProduct(owner, { name: 'SP R-19 1', price: 100000, min_stock: 0 });
  const v1 = await createVariant(owner, p1.id);
  const p2 = await createProduct(owner, { name: 'SP R-19 2', price: 50000, min_stock: 0 });
  const v2 = await createVariant(owner, p2.id);
  await mustStockIn(owner, whA.id as number, v1, 50);
  await mustStockIn(owner, whA.id as number, v2, 30);
  await mustStockIn(owner, whB.id as number, v1, 100);
  return {
    db, app, seeded, orgId, branch1, branch2, orgBId, branchBId,
    owner, ownerB, whA, whB, p1, v1, p2, v2,
  };
}

type Ctx = Awaited<ReturnType<typeof orderCtx>>;

/** Tao don, bat buoc 201; tra don da tao. */
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

/** Chuyen trang thai don; tra response tho (khong bat buoc thanh cong). */
async function transition(
  agent: Agent,
  orderId: number,
  action: 'confirm' | 'process' | 'complete' | 'cancel',
  body: Record<string, unknown> = {},
) {
  return agent.post(`/api/orders/${orderId}/${action}`).send(body);
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

// ---------- AC-1: adopt R-19 — 3 luong tu dong theo vong doi don ----------

test('AC-1 tao don o draft khong giu hang khong tru kho: 2 dong, ton 2 kho khong doi', async () => {
  const ctx = await orderCtx();
  const order = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [
      { variant_id: ctx.v1, qty: 10 },
      { variant_id: ctx.v2, qty: 5 },
    ],
  });
  expect(order.status).toBe('draft');
  expect((order.items as Record<string, unknown>[])).toHaveLength(2);
  // Tao don KHONG giu hang, KHONG tru kho o ca 2 kho.
  const l1 = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(l1?.on_hand).toBe(50);
  expect(l1?.reserved).toBe(0);
  expect(l1?.available).toBe(50);
  const l2 = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v2);
  expect(l2?.on_hand).toBe(30);
  expect(l2?.reserved).toBe(0);
  expect(l2?.available).toBe(30);
  const lB = await levelOf(ctx.owner, ctx.whB.id as number, ctx.v1);
  expect(lB?.on_hand).toBe(100);
  expect(lB?.reserved).toBe(0);
  expect(movementRows(ctx.db, `reference = '${order.code as string}'`)).toHaveLength(0);
  expect(eventsFor(ctx.db, order.id as number)).toHaveLength(1);
  // Don thuoc org A: owner org B khong thay (du lieu 2 org tach biet).
  const cross = await ctx.ownerB.get(`/api/orders/${order.id as number}`);
  expect([403, 404]).toContain(cross.status);
});

test('AC-1 xac nhan giu nguyen tu ca 2 dong: reserved tang dung, on_hand khong doi, 2 movement reserve cung reference, kho B khong doi', async () => {
  const ctx = await orderCtx();
  const order = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [
      { variant_id: ctx.v1, qty: 10 },
      { variant_id: ctx.v2, qty: 5 },
    ],
  });
  const res = await mustTransition(ctx.owner, order.id as number, 'confirm');
  expect(res.status).toBe('confirmed');
  const l1 = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(l1?.on_hand).toBe(50);
  expect(l1?.reserved).toBe(10);
  expect(l1?.available).toBe(40);
  const l2 = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v2);
  expect(l2?.on_hand).toBe(30);
  expect(l2?.reserved).toBe(5);
  expect(l2?.available).toBe(25);
  // Kho B cung org khong bi dong den.
  const lB = await levelOf(ctx.owner, ctx.whB.id as number, ctx.v1);
  expect(lB?.on_hand).toBe(100);
  expect(lB?.reserved).toBe(0);
  expect(lB?.available).toBe(100);
  const moves = movementRows(ctx.db, `reference = '${order.code as string}'`);
  expect(moves).toHaveLength(2);
  expect(moves.map((m) => m.type)).toEqual(['reserve', 'reserve']);
  const byVariant = new Map(moves.map((m) => [m.variant_id as number, m]));
  expect(byVariant.get(ctx.v1)?.reserved_change).toBe(10);
  expect(byVariant.get(ctx.v1)?.qty_change).toBe(0);
  expect(byVariant.get(ctx.v1)?.on_hand_after).toBe(50);
  expect(byVariant.get(ctx.v1)?.reserved_after).toBe(10);
  expect(byVariant.get(ctx.v2)?.reserved_change).toBe(5);
  expect(byVariant.get(ctx.v2)?.qty_change).toBe(0);
  expect(byVariant.get(ctx.v2)?.on_hand_after).toBe(30);
  expect(byVariant.get(ctx.v2)?.reserved_after).toBe(5);
  const events = eventsFor(ctx.db, order.id as number);
  expect(events).toHaveLength(2);
  expect(events[1].from_status).toBe('draft');
  expect(events[1].to_status).toBe('confirmed');
});

test('AC-1 xac nhan thieu ton dong sau 400 insufficient_stock: khong giu dong nao, don o lai draft, khong movement/event moi', async () => {
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
  const l1 = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(l1?.reserved).toBe(0);
  expect(l1?.on_hand).toBe(50);
  expect(l1?.available).toBe(50);
  const l2 = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v2);
  expect(l2?.reserved).toBe(0);
  expect(l2?.on_hand).toBe(30);
  expect(l2?.available).toBe(30);
  expect(orderRow(ctx.db, order.id as number).status).toBe('draft');
  expect(movementRows(ctx.db, `reference = '${order.code as string}'`)).toHaveLength(0);
  expect(eventsFor(ctx.db, order.id as number)).toHaveLength(1);
});

test('AC-1 xac nhan thieu ton dong dau 400 insufficient_stock: reserved khong doi, don o lai draft', async () => {
  const ctx = await orderCtx();
  const order = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [{ variant_id: ctx.v1, qty: 999 }],
  });
  const res = await transition(ctx.owner, order.id as number, 'confirm');
  expect(res.status).toBe(400);
  expect(JSON.stringify(res.body)).toContain('insufficient_stock');
  const level = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(level?.reserved).toBe(0);
  expect(level?.on_hand).toBe(50);
  expect(level?.available).toBe(50);
  expect(orderRow(ctx.db, order.id as number).status).toBe('draft');
  expect(movementRows(ctx.db, `reference = '${order.code as string}'`)).toHaveLength(0);
  expect(eventsFor(ctx.db, order.id as number)).toHaveLength(1);
});

test('AC-1 hoan tat release + out trong 1 transaction: reserved ve 0, on_hand tru dung, 2 movement release + out cung reference', async () => {
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

test('AC-1 hoan tat don 2 dong: moi dong deu release + out, ton tung bien the dung', async () => {
  const ctx = await orderCtx();
  const order = await mustCreateOrder(ctx.owner, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [
      { variant_id: ctx.v1, qty: 10 },
      { variant_id: ctx.v2, qty: 5 },
    ],
  });
  await mustTransition(ctx.owner, order.id as number, 'confirm');
  await mustTransition(ctx.owner, order.id as number, 'process');
  const done = await mustTransition(ctx.owner, order.id as number, 'complete');
  expect(done.status).toBe('completed');
  const l1 = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(l1?.on_hand).toBe(40);
  expect(l1?.reserved).toBe(0);
  expect(l1?.available).toBe(40);
  const l2 = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v2);
  expect(l2?.on_hand).toBe(25);
  expect(l2?.reserved).toBe(0);
  expect(l2?.available).toBe(25);
  const moves = movementRows(ctx.db, `reference = '${order.code as string}'`);
  expect(moves).toHaveLength(6);
  // Hoan tat xu ly theo tung dong: moi dong release roi out (cung 1 transaction).
  for (const variantId of [ctx.v1, ctx.v2]) {
    const perLine = moves.filter((m) => m.variant_id === variantId);
    expect(perLine.map((m) => m.type)).toEqual(['reserve', 'release', 'out']);
  }
  const releases = moves.filter((m) => m.type === 'release');
  expect(releases.map((m) => m.reserved_change).sort()).toEqual([-10, -5]);
  const outs = moves.filter((m) => m.type === 'out');
  expect(outs.map((m) => m.qty_change).sort()).toEqual([-10, -5]);
  // Hoan tat khong de reserved treo o bat ky dong nao.
  for (const m of moves) {
    expect(m.reserved_after).toBeGreaterThanOrEqual(0);
  }
});

test('AC-1 huy tu processing giai phong dung so: reserved ve 0, on_hand khong doi, available ve nhu truoc xac nhan', async () => {
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
  expect(moves[1].reserved_change).toBe(-10);
  expect(moves[1].qty_change).toBe(0);
  const events = eventsFor(ctx.db, order.id as number);
  expect(events[3].from_status).toBe('processing');
  expect(events[3].to_status).toBe('cancelled');
});

test('AC-1 huy tu confirmed giai phong dung so da giu: reserved ve 0, on_hand khong doi', async () => {
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

test('AC-1 huy tu draft chi doi trang thai, khong dong kho', async () => {
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
  expect(level?.available).toBe(50);
  expect(movementRows(ctx.db, `reference = '${order.code as string}'`)).toHaveLength(0);
  const events = eventsFor(ctx.db, order.id as number);
  expect(events).toHaveLength(2);
  expect(events[1].from_status).toBe('draft');
  expect(events[1].to_status).toBe('cancelled');
  expect(events[1].note).toBe('khach doi y');
});

test('AC-1 chuyen sai 400: draft->process, draft->complete, completed->cancel, huy 2 lan; kho va events khong doi', async () => {
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
  // Kho chi thay doi dung 5 cua don 1 da hoan tat, khong them gi khac.
  const level = await levelOf(ctx.owner, ctx.whA.id as number, ctx.v1);
  expect(level?.on_hand).toBe(45);
  expect(level?.reserved).toBe(0);
  expect(level?.available).toBe(45);
});
