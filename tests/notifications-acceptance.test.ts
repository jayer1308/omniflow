import { test, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { migrate, openDb } from '../src/db.js';
import { can, type Action, type Actor, type Role, type Target } from '../src/rbac.js';
import { seed } from '../src/seed.js';
import { computePaymentSummary, signWebhook } from '../src/payments.js';
import { FakeEmailAdapter } from '../src/adapters/index.js';
import { buildNotificationContent } from '../src/notifications.js';
import {
  enqueueScanJob,
  processDueJobs,
  recoverRunningJobs,
  runLowStockScan,
  runPromoExpiryScan,
} from '../src/jobs.js';

/**
 * GOAL-011 — thong bao + cong viec nen (brief-011.md, D29).
 *
 * HOP DONG DA CHOT CHO WORKER (test nay khoa hop dong, Worker viet code
 * theo dung cac cho nay):
 * - 1 job send-notification cho 1 nguoi nhan: payload JSON
 *   {event_key, event_type, to_user_id|null, to_email, subject, body}.
 *   Nguoi nhan la user thi kiem tra preferences (thieu dong = BAT);
 *   tat -> khong tao job, khong tao notification. Khach (email) luon
 *   gui neu co email.
 * - event_key UNIQUE: gui lai cung event_key + cung nguoi nhan khong tao
 *   ban ghi moi; no-op (gui lai cung trang thai, D24) khong tao job moi.
 * - Shipment: in_transit -> shipment.shipped; delivered ->
 *   shipment.delivered; failed (kem reason) -> shipment.failed.
 * - API: GET/PATCH /api/notification-preferences
 *   {event_type, enabled, user_id?} (user_id vang = chinh minh);
 *   GET /api/notifications?event_type=&status=&from=&to= tra
 *   {notifications, total, page, limit};
 *   GET /api/jobs?status=&type= tra {jobs, total, page, limit};
 *   POST /api/jobs/run tra {processed, done, failed} (failed dem job
 *   loi trong lan chay nay, ke ca job ve pending cho retry);
 *   POST /api/jobs/:id/retry: failed -> pending, attempts 0,
 *   next_run_at = now, last_error NULL + audit job-retried; chua failed
 *   -> 400.
 * - processDueJobs(db, now: Date) chay TUAN TU theo created_at, moi job
 *   1 transaction rieng; retry backoff 60 x 2^(attempts-1) giay (+60s,
 *   +120s, lan 3 -> failed); FakeEmailAdapter.failNext() lam send() ke
 *   tiep nem loi (chi dung trong test).
 * - Scan dedupe theo period_key = ngay Asia/Ho_Chi_Minh; low-stock-scan
 *   tao 1 job / 1 nguoi nhan / 1 cap (variant, warehouse) co available <
 *   min_stock; promo-expiry-scan chi nhac ma active co valid_to trong
 *   3 ngay toi (da het han / inactive khong nhac).
 * - Audit CHI cho that bai cuoi + retry tay (notification-failed /
 *   job-failed / job-retried); detail KHONG chua email khach hay noi
 *   dung email. Gui thanh cong KHONG ghi audit.
 * - can() them 4 action: view-notifications / manage-notification-
 *   preferences / view-jobs / run-jobs theo ma tran brief yeu cau 11
 *   (xem test AC-3 can()).
 *
 * Luu y ve do do: moi test deu co it nhat 1 assert chi xanh khi nghiep
 * vu that ton tai (job/notification duoc tao, route tra 200/403 dung,
 * ham stub nem 'not implemented'). Cac assert "khong co" (khong tao job,
 * khong tang audit) luon di kem assert "co" trong cung test de khong
 * xanh vo tren stub.
 */

// Mat khau + secret GIA LAP chi dung cho test, khong phai credential that.
const OWNER_PASSWORD = 'gia-lap-owner-123';
const STAFF_PASSWORD = 'gia-lap-staff-123';
const WEBHOOK_SECRET = 'bi-mat-webhook-gia-lap';

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
  const { orgBId, branchBId, userBId } = await addOrgB(db);
  const owner = await ownerAgent(app, seeded);
  const sales = await salesAgent(app, seeded);
  const manager = await loginAgent(app, 'manager@example.local', 'gia-lap-123');
  const warehouse = await loginAgent(app, 'kho@example.local', 'gia-lap-123');
  const accountant = await loginAgent(app, 'ketoan@example.local', 'gia-lap-123');
  const sales2 = await loginAgent(app, 'sales2@example.local', 'gia-lap-123');
  const ownerB = await loginAgent(app, 'owner-b@example.local', 'gia-lap-123');
  return {
    db, app, seeded, orgId, branch1, branch2, orgBId, branchBId, userBId,
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

function userIdOf(db: Db, orgId: number, role: string): number {
  const row = db
    .prepare('SELECT id FROM users WHERE org_id = ? AND role = ? ORDER BY id LIMIT 1')
    .get(orgId, role) as { id: number };
  return row.id;
}

function userEmailOf(db: Db, userId: number): string {
  const row = db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string };
  return row.email;
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
  const code = (overrides.code as string) ?? `SP-TB-${rand()}`;
  const res = await agent.post('/api/products').send({
    code,
    name: 'San pham thong bao gia lap',
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
    sku: `SKU-TB-${rand()}`,
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
 * Boi canh thong bao: 2 kho (A, B) + 2 san pham/bien the (V1 gia 100000,
 * V2 gia 50000) + ton: whA V1 200 / V2 100, whB V1 100.
 */
async function notifCtx() {
  const ctx = await fullCtx();
  const whA = await createWarehouse(ctx.owner, 'Kho A');
  const whB = await createWarehouse(ctx.owner, 'Kho B');
  const p1 = await createProduct(ctx.owner, { name: 'SP TB 1', price: 100000, min_stock: 0 });
  const v1 = await createVariant(ctx.owner, p1.id);
  const p2 = await createProduct(ctx.owner, { name: 'SP TB 2', price: 50000, min_stock: 0 });
  const v2 = await createVariant(ctx.owner, p2.id);
  await mustStockIn(ctx.owner, whA.id as number, v1, 200);
  await mustStockIn(ctx.owner, whA.id as number, v2, 100);
  await mustStockIn(ctx.owner, whB.id as number, v1, 100);
  return { ...ctx, whA, whB, p1, v1, p2, v2 };
}

type Ctx = Awaited<ReturnType<typeof notifCtx>>;

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

function asPayment(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (body.payment as Record<string, unknown>) ?? body;
}

function asCustomer(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (body.customer as Record<string, unknown>) ?? body;
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
  const payment = asPayment(res);
  expect(payment.id).toBeDefined();
  return payment;
}

async function mustCreatePayment(
  agent: Agent,
  orderId: number,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await agent.post(`/api/orders/${orderId}/payments`).send(body);
  expect(res.status).toBe(201);
  const payment = asPayment(res);
  expect(payment.id).toBeDefined();
  return payment;
}

function postWebhook(app: App, body: Record<string, unknown>, signature?: string) {
  const req = request(app).post('/api/payments/webhook');
  if (signature !== undefined) req.set('X-Fake-Signature', signature);
  return req.send(body);
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

async function mustCreateShipment(
  agent: Agent,
  orderId: number,
): Promise<Record<string, unknown>> {
  const res = await agent
    .post(`/api/orders/${orderId}/shipments`)
    .send({ carrier: 'GHN-fake', destination: 'TP.HCM' });
  expect(res.status).toBe(201);
  const shipment = asShipment(res);
  expect(shipment.id).toBeDefined();
  return shipment;
}

async function mustUpdateShipment(
  agent: Agent,
  shipmentId: number,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await agent.post(`/api/shipments/${shipmentId}/status`).send(body);
  expect(res.status).toBe(200);
  return asShipment(res);
}

async function mustCreateReturn(
  agent: Agent,
  orderId: number,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await agent.post(`/api/orders/${orderId}/returns`).send(body);
  expect(res.status).toBe(201);
  const ret = asReturn(res);
  expect(ret.id).toBeDefined();
  return ret;
}

/** Luong tra day du toi received + refund: tao -> duyet -> nhan -> hoan tien. */
async function mustReturnAndRefund(
  ctx: Ctx,
  orderId: number,
  variantId: number,
  qty: number,
): Promise<void> {
  const ret = await mustCreateReturn(ctx.owner, orderId, {
    items: [{ variant_id: variantId, qty, condition: 'resalable' }],
    reason: 'tra gia lap',
  });
  expect((await ctx.owner.post(`/api/returns/${ret.id as number}/approve`).send({})).status).toBe(200);
  expect((await ctx.owner.post(`/api/returns/${ret.id as number}/receive`).send({})).status).toBe(200);
  expect((await ctx.owner.post(`/api/returns/${ret.id as number}/refund`).send({})).status).toBe(200);
}

// ---------- Doc truc tiep bang jobs / notifications / audit_log ----------

interface JobRow {
  id: number;
  type: string;
  payload: string;
  status: string;
  attempts: number;
  max_attempts: number;
  next_run_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

interface NotificationRow {
  id: number;
  org_id: number;
  event_key: string;
  event_type: string;
  channel: string;
  recipient_user_id: number | null;
  recipient_email: string;
  subject: string;
  body: string;
  status: string;
  error: string | null;
  message_id: string | null;
  created_at: string;
}

function jobsByEventKey(db: Db, eventKey: string): { job: JobRow; payload: Record<string, unknown> }[] {
  const rows = db.prepare('SELECT * FROM jobs ORDER BY id').all() as JobRow[];
  return rows
    .map((job) => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(job.payload) as Record<string, unknown>;
      } catch {
        payload = {};
      }
      return { job, payload };
    })
    .filter((r) => r.payload.event_key === eventKey);
}

function allJobs(db: Db): JobRow[] {
  return db.prepare('SELECT * FROM jobs ORDER BY id').all() as JobRow[];
}

function jobById(db: Db, id: number): JobRow | undefined {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
}

function notificationsByEventKey(db: Db, eventKey: string): NotificationRow[] {
  return db
    .prepare('SELECT * FROM notifications WHERE event_key = ? ORDER BY id')
    .all(eventKey) as NotificationRow[];
}

function allNotifications(db: Db): NotificationRow[] {
  return db.prepare('SELECT * FROM notifications ORDER BY id').all() as NotificationRow[];
}

function auditRows(
  db: Db,
  orgId: number,
): { action: string; detail: Record<string, unknown>; rawDetail: string; user_id: number | null }[] {
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
    return { action: r.action, detail, rawDetail: r.detail ?? '', user_id: r.user_id };
  });
}

/** Chen truc tiep 1 job send-notification due ngay (setup test, khong qua hook). */
function insertDueJob(
  db: Db,
  overrides: Record<string, unknown> = {},
): number {
  const now = new Date().toISOString();
  const payload = JSON.stringify({
    event_key: 'order.completed:DH-20261128-0001',
    event_type: 'order.completed',
    to_user_id: null,
    to_email: 'owner@example.local',
    subject: 'Don DH-20261128-0001 da hoan tat',
    body: 'Don DH-20261128-0001 da hoan tat.',
    ...(overrides.payload as Record<string, unknown> | undefined),
  });
  return Number(
    db
      .prepare(
        `INSERT INTO jobs (type, payload, status, attempts, max_attempts, next_run_at, last_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        (overrides.type as string | undefined) ?? 'send-notification',
        payload,
        (overrides.status as string | undefined) ?? 'pending',
        (overrides.attempts as number | undefined) ?? 0,
        3,
        (overrides.next_run_at as string | undefined) ?? now,
        (overrides.last_error as string | null | undefined) ?? null,
        now,
        now,
      ).lastInsertRowid,
  );
}

/** Chen truc tiep 1 notification (setup test RBAC, khong qua runner). */
function insertNotification(
  db: Db,
  row: {
    org_id: number;
    event_key: string;
    event_type: string;
    recipient_user_id?: number | null;
    recipient_email: string;
    subject?: string;
    body?: string;
    status?: string;
    message_id?: string | null;
  },
): number {
  return Number(
    db
      .prepare(
        `INSERT INTO notifications (org_id, event_key, event_type, channel, recipient_user_id, recipient_email, subject, body, status, error, message_id, created_at)
         VALUES (?, ?, ?, 'email', ?, ?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(
        row.org_id,
        row.event_key,
        row.event_type,
        row.recipient_user_id ?? null,
        row.recipient_email,
        row.subject ?? `Thong bao ${row.event_type}`,
        row.body ?? `Su kien ${row.event_type}`,
        row.status ?? 'sent',
        row.message_id ?? 'FAKE-MAIL-TEST000001',
        new Date().toISOString(),
      ).lastInsertRowid,
  );
}

function assignWarehouse(db: Db, userId: number, warehouseId: number): void {
  db.prepare('UPDATE users SET warehouse_id = ? WHERE id = ?').run(warehouseId, userId);
}

// ---------- AC-1: su kien thong bao + gui + khong trung ----------

test('AC-1 don xac nhan sinh job order.confirmed cho owner (don khong co khach)', async () => {
  const ctx = await notifCtx();
  const ownerId = userIdOf(ctx.db, ctx.orgId, 'owner');
  const order = await mustOrder250(ctx);
  await mustTransition(ctx.owner, order.id as number, 'confirm');
  const code = order.code as string;
  const jobs = jobsByEventKey(ctx.db, `order.confirmed:${code}`);
  expect(jobs.length).toBe(1);
  expect(jobs[0].payload.event_type).toBe('order.confirmed');
  expect(jobs[0].payload.to_user_id).toBe(ownerId);
  expect(jobs[0].payload.to_email).toBe(ctx.seeded.ownerEmail);
  expect(jobs[0].job.type).toBe('send-notification');
  expect(jobs[0].job.status).toBe('pending');
});

test('AC-1 don co khach co email sinh job cho ca khach va owner', async () => {
  const ctx = await notifCtx();
  const ownerId = userIdOf(ctx.db, ctx.orgId, 'owner');
  const customerEmail = `khach-${rand().toLowerCase()}@example.local`;
  const customer = await mustCreateCustomer(ctx.owner, {
    name: 'Khach TB',
    phone: randPhone(),
    email: customerEmail,
    branch_id: ctx.branch1,
  });
  const order = await mustOrder250(ctx, { customer_id: customer.id });
  await mustTransition(ctx.owner, order.id as number, 'confirm');
  const code = order.code as string;
  const jobs = jobsByEventKey(ctx.db, `order.confirmed:${code}`);
  expect(jobs.length).toBe(2);
  const byUser = jobs.filter((j) => j.payload.to_user_id === ownerId);
  const byEmail = jobs.filter((j) => j.payload.to_email === customerEmail);
  expect(byUser.length).toBe(1);
  expect(byEmail.length).toBe(1);
  expect(byEmail[0].payload.to_user_id).toBeNull();
});

test('AC-1 don khong co customer_id hoac khach khong co email chi gui cho owner khong loi', async () => {
  const ctx = await notifCtx();
  const ownerId = userIdOf(ctx.db, ctx.orgId, 'owner');
  const orderA = await mustOrder250(ctx);
  const resA = await transition(ctx.owner, orderA.id as number, 'confirm');
  expect(resA.status).toBe(200);
  const jobsA = jobsByEventKey(ctx.db, `order.confirmed:${orderA.code as string}`);
  expect(jobsA.length).toBe(1);
  expect(jobsA[0].payload.to_user_id).toBe(ownerId);
  const customer = await mustCreateCustomer(ctx.owner, {
    name: 'Khach khong email',
    phone: randPhone(),
    branch_id: ctx.branch1,
  });
  expect(customer.email ?? null).toBeNull();
  const orderB = await mustOrder250(ctx, { customer_id: customer.id });
  const resB = await transition(ctx.owner, orderB.id as number, 'confirm');
  expect(resB.status).toBe(200);
  const jobsB = jobsByEventKey(ctx.db, `order.confirmed:${orderB.code as string}`);
  expect(jobsB.length).toBe(1);
  expect(jobsB[0].payload.to_user_id).toBe(ownerId);
});

test('AC-1 don hoan tat sinh job order.completed va chay job 2 lan chi co 1 notification', async () => {
  const ctx = await notifCtx();
  const order = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order.id as number);
  const code = order.code as string;
  const jobs = jobsByEventKey(ctx.db, `order.completed:${code}`);
  expect(jobs.length).toBe(1);
  const now = new Date();
  const run1 = processDueJobs(ctx.db, now);
  expect(run1.processed).toBeGreaterThanOrEqual(1);
  expect(run1.done).toBeGreaterThanOrEqual(1);
  const notes1 = notificationsByEventKey(ctx.db, `order.completed:${code}`);
  expect(notes1.length).toBe(1);
  expect(notes1[0].status).toBe('sent');
  expect(notes1[0].message_id?.startsWith('FAKE-MAIL-')).toBe(true);
  const run2 = processDueJobs(ctx.db, now);
  expect(run2.processed).toBe(0);
  const notes2 = notificationsByEventKey(ctx.db, `order.completed:${code}`);
  expect(notes2.length).toBe(1);
});

test('AC-1 don huy sinh job order.cancelled; gui lai cung trang thai no-op khong tao job moi', async () => {
  const ctx = await notifCtx();
  const order = await mustOrder250(ctx);
  const res = await transition(ctx.owner, order.id as number, 'cancel');
  expect(res.status).toBe(200);
  const code = order.code as string;
  const jobs = jobsByEventKey(ctx.db, `order.cancelled:${code}`);
  expect(jobs.length).toBe(1);
  const again = await transition(ctx.owner, order.id as number, 'cancel');
  expect(again.status).toBe(400);
  const jobsAfter = jobsByEventKey(ctx.db, `order.cancelled:${code}`);
  expect(jobsAfter.length).toBe(1);
});

test('AC-1 webhook paid chot sinh job payment.paid; webhook failed sinh job payment.failed', async () => {
  const ctx = await notifCtx();
  const ownerId = userIdOf(ctx.db, ctx.orgId, 'owner');
  const accountantId = userIdOf(ctx.db, ctx.orgId, 'accountant');
  const order1 = await mustOrder250(ctx);
  const pay1 = await mustCreatePayment(ctx.owner, order1.id as number, {
    method: 'gateway',
    amount: 90000,
  });
  const ref1 = pay1.gateway_reference as string;
  const paid = await postWebhook(
    ctx.app,
    { gateway_reference: ref1, status: 'paid', amount: 90000 },
    signWebhook(WEBHOOK_SECRET, ref1, 'paid', 90000),
  );
  expect(paid.status).toBe(200);
  const code1 = order1.code as string;
  const jobsPaid = jobsByEventKey(ctx.db, `payment.paid:${code1}`);
  expect(jobsPaid.length).toBe(2);
  const recipientsPaid = jobsPaid.map((j) => j.payload.to_user_id);
  expect(recipientsPaid).toContain(ownerId);
  expect(recipientsPaid).toContain(accountantId);
  const order2 = await mustOrder250(ctx);
  const pay2 = await mustCreatePayment(ctx.owner, order2.id as number, {
    method: 'gateway',
    amount: 70000,
  });
  const ref2 = pay2.gateway_reference as string;
  const failed = await postWebhook(
    ctx.app,
    { gateway_reference: ref2, status: 'failed', amount: 70000 },
    signWebhook(WEBHOOK_SECRET, ref2, 'failed', 70000),
  );
  expect(failed.status).toBe(200);
  const code2 = order2.code as string;
  const jobsFailed = jobsByEventKey(ctx.db, `payment.failed:${code2}`);
  expect(jobsFailed.length).toBe(2);
  const recipientsFailed = jobsFailed.map((j) => j.payload.to_user_id);
  expect(recipientsFailed).toContain(ownerId);
  expect(recipientsFailed).toContain(accountantId);
});

test('AC-1 hoan tien sinh job payment.refunded cho owner va accountant', async () => {
  const ctx = await notifCtx();
  const ownerId = userIdOf(ctx.db, ctx.orgId, 'owner');
  const accountantId = userIdOf(ctx.db, ctx.orgId, 'accountant');
  const order = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order.id as number);
  const payment = await mustPayCash(ctx, order.id as number, 250000);
  const res = await ctx.owner
    .post(`/api/payments/${payment.id as number}/refunds`)
    .send({ amount: 100000, reason: 'hoan gia lap' });
  expect(res.status).toBe(201);
  const code = order.code as string;
  const jobs = jobsByEventKey(ctx.db, `payment.refunded:${code}`);
  expect(jobs.length).toBe(2);
  const recipients = jobs.map((j) => j.payload.to_user_id);
  expect(recipients).toContain(ownerId);
  expect(recipients).toContain(accountantId);
});

test('AC-1 giao hang in_transit/delivered/failed sinh job shipment.shipped/delivered/failed', async () => {
  const ctx = await notifCtx();
  const order1 = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order1.id as number);
  const ship1 = await mustCreateShipment(ctx.owner, order1.id as number);
  const upd1 = await mustUpdateShipment(ctx.owner, ship1.id as number, { status: 'in_transit' });
  expect(upd1.status).toBe('in_transit');
  const code1 = order1.code as string;
  const jobsShipped = jobsByEventKey(ctx.db, `shipment.shipped:${code1}`);
  expect(jobsShipped.length).toBe(1);
  const upd2 = await mustUpdateShipment(ctx.owner, ship1.id as number, { status: 'delivered' });
  expect(upd2.status).toBe('delivered');
  const jobsDelivered = jobsByEventKey(ctx.db, `shipment.delivered:${code1}`);
  expect(jobsDelivered.length).toBe(1);
  const order2 = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order2.id as number);
  const ship2 = await mustCreateShipment(ctx.owner, order2.id as number);
  const upd3 = await mustUpdateShipment(ctx.owner, ship2.id as number, {
    status: 'failed',
    reason: 'khach vang nha gia lap',
  });
  expect(upd3.status).toBe('failed');
  const code2 = order2.code as string;
  const jobsFailed = jobsByEventKey(ctx.db, `shipment.failed:${code2}`);
  expect(jobsFailed.length).toBe(1);
});

test('AC-1 tra hang tao/duyet/tu choi/nhan sinh job return.requested/approved/rejected/received', async () => {
  const ctx = await notifCtx();
  const salesId = userIdOf(ctx.db, ctx.orgId, 'sales');
  const order1 = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order1.id as number);
  const ret1 = await mustCreateReturn(ctx.owner, order1.id as number, {
    items: [{ variant_id: ctx.v1, qty: 1, condition: 'resalable' }],
    reason: 'khach doi y gia lap',
  });
  const code1 = order1.code as string;
  const jobsRequested = jobsByEventKey(ctx.db, `return.requested:${code1}`);
  expect(jobsRequested.length).toBeGreaterThanOrEqual(1);
  const approved = await ctx.owner.post(`/api/returns/${ret1.id as number}/approve`).send({});
  expect(approved.status).toBe(200);
  const jobsApproved = jobsByEventKey(ctx.db, `return.approved:${code1}`);
  expect(jobsApproved.length).toBeGreaterThanOrEqual(1);
  const approvedRecipients = jobsApproved.map((j) => j.payload.to_user_id);
  expect(approvedRecipients).toContain(salesId);
  const received = await ctx.owner.post(`/api/returns/${ret1.id as number}/receive`).send({});
  expect(received.status).toBe(200);
  const jobsReceived = jobsByEventKey(ctx.db, `return.received:${code1}`);
  expect(jobsReceived.length).toBeGreaterThanOrEqual(1);
  const order2 = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order2.id as number);
  const ret2 = await mustCreateReturn(ctx.owner, order2.id as number, {
    items: [{ variant_id: ctx.v1, qty: 1, condition: 'resalable' }],
    reason: 'hang loi gia lap',
  });
  const rejected = await ctx.owner
    .post(`/api/returns/${ret2.id as number}/reject`)
    .send({ reason: 'khong du dieu kien gia lap' });
  expect(rejected.status).toBe(200);
  const code2 = order2.code as string;
  const jobsRejected = jobsByEventKey(ctx.db, `return.rejected:${code2}`);
  expect(jobsRejected.length).toBeGreaterThanOrEqual(1);
});

test('AC-1 GET notifications voi status la tra 400; PATCH preferences voi event_type la tra 400', async () => {
  const ctx = await notifCtx();
  const badStatus = await ctx.owner.get('/api/notifications?status=senttt');
  expect(badStatus.status).toBe(400);
  const badType = await ctx.owner
    .patch('/api/notification-preferences')
    .send({ event_type: 'khong-co-loai-nay', enabled: false });
  expect(badType.status).toBe(400);
  const badEvent = await ctx.owner.get('/api/notifications?event_type=khong-co-loai-nay');
  expect(badEvent.status).toBe(400);
});

test('AC-1 noi dung email theo mau: subject/body chua ma don, message_id FakeEmailAdapter, khong chua thong tin the', async () => {
  const ctx = await notifCtx();
  const order = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order.id as number);
  await mustPayCash(ctx, order.id as number, 100000);
  const code = order.code as string;
  processDueJobs(ctx.db, new Date());
  const notes = notificationsByEventKey(ctx.db, `order.completed:${code}`);
  expect(notes.length).toBe(1);
  expect(notes[0].status).toBe('sent');
  expect(notes[0].channel).toBe('email');
  expect(notes[0].subject).toContain(code);
  expect(notes[0].body).toContain(code);
  expect(notes[0].message_id?.startsWith('FAKE-MAIL-')).toBe(true);
  expect(notes[0].body).not.toContain('4111');
  expect(notes[0].body).not.toContain('4242');
  const paidNotes = notificationsByEventKey(ctx.db, `payment.paid:${code}`);
  expect(paidNotes.length).toBeGreaterThanOrEqual(1);
  expect(paidNotes[0].subject).toContain(code);
});

test('AC-1 buildNotificationContent truc tiep tra subject/body theo mau D29', () => {
  const content = buildNotificationContent('order.completed', {
    orderCode: 'DH-20261128-0001',
    total: 250000,
  });
  expect(content.subject).toContain('DH-20261128-0001');
  expect(content.body).toContain('DH-20261128-0001');
  expect(content.body).toContain('250000');
});

// ---------- AC-2: hang doi job + retry/backoff + scheduler + scan ----------

test('AC-2 processDueJobs chay job send-notification pending thanh done va tao notification sent; job chua due khong chay', async () => {
  const { db } = freshApp();
  const ownerId = userIdOf(db, 1, 'owner');
  const dueId = insertDueJob(db, {
    payload: {
      event_key: 'order.completed:DH-20261128-0001',
      event_type: 'order.completed',
      to_user_id: ownerId,
      to_email: 'owner@example.local',
      subject: 'Don DH-20261128-0001 da hoan tat',
      body: 'Don DH-20261128-0001 da hoan tat.',
    },
  });
  const futureId = insertDueJob(db, {
    next_run_at: '2999-01-01T00:00:00.000Z',
    payload: {
      event_key: 'order.completed:DH-20261128-0002',
      event_type: 'order.completed',
      to_user_id: ownerId,
      to_email: 'owner@example.local',
      subject: 'Don DH-20261128-0002 da hoan tat',
      body: 'Don DH-20261128-0002 da hoan tat.',
    },
  });
  const result = processDueJobs(db, new Date());
  expect(result.processed).toBe(1);
  expect(result.done).toBe(1);
  expect(result.failed).toBe(0);
  expect(jobById(db, dueId)?.status).toBe('done');
  expect(jobById(db, futureId)?.status).toBe('pending');
  const notes = notificationsByEventKey(db, 'order.completed:DH-20261128-0001');
  expect(notes.length).toBe(1);
  expect(notes[0].status).toBe('sent');
  expect(notes[0].recipient_user_id).toBe(ownerId);
  expect(notes[0].recipient_email).toBe('owner@example.local');
  expect(notes[0].message_id?.startsWith('FAKE-MAIL-')).toBe(true);
  expect(notificationsByEventKey(db, 'order.completed:DH-20261128-0002').length).toBe(0);
});

test('AC-2 job fail lan 1 attempts 1 next_run_at +60s; lan 2 +120s; lan 3 failed (khong cho that)', async () => {
  const { db } = freshApp();
  const t0 = new Date('2026-11-28T10:00:00.000Z');
  const jobId = insertDueJob(db, {
    next_run_at: t0.toISOString(),
    payload: {
      event_key: 'order.completed:DH-20261128-0001',
      event_type: 'order.completed',
      to_user_id: null,
      to_email: 'owner@example.local',
      subject: 'Don DH-20261128-0001 da hoan tat',
      body: 'Don DH-20261128-0001 da hoan tat.',
    },
  });
  FakeEmailAdapter.failNext();
  const run1 = processDueJobs(db, t0);
  expect(run1.processed).toBe(1);
  expect(run1.done).toBe(0);
  const after1 = jobById(db, jobId);
  expect(after1?.status).toBe('pending');
  expect(after1?.attempts).toBe(1);
  expect(new Date(after1?.next_run_at ?? '').getTime()).toBe(t0.getTime() + 60 * 1000);
  expect(notificationsByEventKey(db, 'order.completed:DH-20261128-0001').length).toBe(0);
  const t1 = new Date(t0.getTime() + 60 * 1000);
  db.prepare('UPDATE jobs SET next_run_at = ? WHERE id = ?').run(t1.toISOString(), jobId);
  FakeEmailAdapter.failNext();
  const run2 = processDueJobs(db, t1);
  expect(run2.processed).toBe(1);
  expect(run2.done).toBe(0);
  const after2 = jobById(db, jobId);
  expect(after2?.status).toBe('pending');
  expect(after2?.attempts).toBe(2);
  expect(new Date(after2?.next_run_at ?? '').getTime()).toBe(t1.getTime() + 120 * 1000);
  const t2 = new Date(t1.getTime() + 120 * 1000);
  db.prepare('UPDATE jobs SET next_run_at = ? WHERE id = ?').run(t2.toISOString(), jobId);
  FakeEmailAdapter.failNext();
  const run3 = processDueJobs(db, t2);
  expect(run3.processed).toBe(1);
  expect(run3.done).toBe(0);
  expect(run3.failed).toBe(1);
  const after3 = jobById(db, jobId);
  expect(after3?.status).toBe('failed');
  expect(after3?.attempts).toBe(3);
  expect((after3?.last_error ?? '').length).toBeGreaterThan(0);
  expect(notificationsByEventKey(db, 'order.completed:DH-20261128-0001').length).toBe(0);
});

test('AC-2 scheduler dedupe: enqueueScanJob 2 lan cung ngay chi tao 1 job; ngay khac tao moi', async () => {
  const { db } = freshApp();
  const now = new Date();
  const first = enqueueScanJob(db, 'low-stock-scan', now);
  expect(first.created).toBe(true);
  expect(first.jobId).not.toBeNull();
  const second = enqueueScanJob(db, 'low-stock-scan', now);
  expect(second.created).toBe(false);
  expect(second.jobId).toBe(first.jobId);
  const scans = allJobs(db).filter((j) => j.type === 'low-stock-scan');
  expect(scans.length).toBe(1);
  expect(JSON.parse(scans[0].payload) as Record<string, unknown>).toMatchObject({
    period_key: hcmToday(),
  });
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const third = enqueueScanJob(db, 'low-stock-scan', tomorrow);
  expect(third.created).toBe(true);
  expect(allJobs(db).filter((j) => j.type === 'low-stock-scan').length).toBe(2);
  const promoFirst = enqueueScanJob(db, 'promo-expiry-scan', now);
  expect(promoFirst.created).toBe(true);
  const promoSecond = enqueueScanJob(db, 'promo-expiry-scan', now);
  expect(promoSecond.created).toBe(false);
});

test('AC-2 low-stock-scan tao job stock.low dung SKU kho available min_stock shortage; cap du ton khong sinh; scan lai khong trung', async () => {
  const ctx = await notifCtx();
  const whLow = await createWarehouse(ctx.owner, 'Kho Thap');
  const pLow = await createProduct(ctx.owner, { name: 'SP thap', price: 100000, min_stock: 10 });
  const vLow = await createVariant(ctx.owner, pLow.id);
  const skuRow = ctx.db
    .prepare('SELECT sku FROM product_variants WHERE id = ?')
    .get(vLow) as { sku: string };
  await mustStockIn(ctx.owner, whLow.id as number, vLow, 4);
  assignWarehouse(ctx.db, ctx.warehouseId, whLow.id as number);
  const now = new Date();
  const scan1 = runLowStockScan(ctx.db, now);
  expect(scan1.created).toBeGreaterThanOrEqual(2);
  const today = hcmToday();
  const eventKey = `stock.low:variant:${vLow}:warehouse:${whLow.id as number}:${today}`;
  const jobs = jobsByEventKey(ctx.db, eventKey);
  expect(jobs.length).toBe(2);
  const recipients = jobs.map((j) => j.payload.to_user_id);
  expect(recipients).toContain(ctx.warehouseId);
  expect(recipients).toContain(ctx.managerId);
  for (const j of jobs) {
    expect(j.payload.event_type).toBe('stock.low');
    expect(j.payload.subject as string).toContain(skuRow.sku);
    expect(j.payload.body as string).toContain(skuRow.sku);
    expect(j.payload.body as string).toContain('Kho Thap');
  }
  const enoughKey = `stock.low:variant:${ctx.v1}:warehouse:${ctx.whA.id as number}:${today}`;
  expect(jobsByEventKey(ctx.db, enoughKey).length).toBe(0);
  const scan2 = runLowStockScan(ctx.db, now);
  expect(scan2.created).toBe(0);
  expect(jobsByEventKey(ctx.db, eventKey).length).toBe(2);
  processDueJobs(ctx.db, new Date());
  const notes = notificationsByEventKey(ctx.db, eventKey);
  expect(notes.length).toBe(2);
  expect(notes.every((n) => n.status === 'sent')).toBe(true);
  const noteRecipients = notes.map((n) => n.recipient_user_id);
  expect(noteRecipients).toContain(ctx.warehouseId);
  expect(noteRecipients).toContain(ctx.managerId);
});

test('AC-2 promo-expiry-scan: ma het han trong 2 ngay duoc nhac; ma da het han va inactive khong nhac', async () => {
  const ctx = await notifCtx();
  const ownerId = userIdOf(ctx.db, ctx.orgId, 'owner');
  const now = new Date();
  const validFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const validTo = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const expiring = await mustCreatePromo(ctx.owner, {
    code: 'SAPHH',
    type: 'percent',
    value: 10,
    valid_from: validFrom,
    valid_to: validTo,
  });
  const nowIso = now.toISOString();
  const expiredId = Number(
    ctx.db
      .prepare(
        `INSERT INTO promotions (org_id, code, type, value, cap, min_order_total, channels, branch_id, valid_from, valid_to, usage_limit, per_customer_limit, status, created_at, updated_at)
         VALUES (?, ?, 'fixed', 5000, NULL, 0, NULL, NULL, '2020-01-01T00:00:00.000Z', '2020-01-02T00:00:00.000Z', NULL, NULL, 'active', ?, ?)`,
      )
      .run(ctx.orgId, 'DAHETHAN', nowIso, nowIso).lastInsertRowid,
  );
  const lockedId = Number(
    ctx.db
      .prepare(
        `INSERT INTO promotions (org_id, code, type, value, cap, min_order_total, channels, branch_id, valid_from, valid_to, usage_limit, per_customer_limit, status, created_at, updated_at)
         VALUES (?, ?, 'fixed', 5000, NULL, 0, NULL, NULL, ?, ?, NULL, NULL, 'locked', ?, ?)`,
      )
      .run(ctx.orgId, 'BIKHOA', validFrom, validTo, nowIso, nowIso).lastInsertRowid,
  );
  const scan1 = runPromoExpiryScan(ctx.db, now);
  expect(scan1.created).toBeGreaterThanOrEqual(2);
  const validToDate = hcmDate(new Date(validTo));
  const expiringKey = `promotion.expiring:${expiring.id as number}:${validToDate}`;
  const jobs = jobsByEventKey(ctx.db, expiringKey);
  expect(jobs.length).toBe(2);
  const recipients = jobs.map((j) => j.payload.to_user_id);
  expect(recipients).toContain(ownerId);
  expect(recipients).toContain(ctx.managerId);
  for (const j of jobs) {
    expect(j.payload.body as string).toContain('SAPHH');
    expect(j.payload.body as string).toContain(validToDate);
  }
  expect(jobsByEventKey(ctx.db, `promotion.expiring:${expiredId}:2020-01-02`).length).toBe(0);
  expect(jobsByEventKey(ctx.db, `promotion.expiring:${lockedId}:${validToDate}`).length).toBe(0);
  const scan2 = runPromoExpiryScan(ctx.db, now);
  expect(scan2.created).toBe(0);
  expect(jobsByEventKey(ctx.db, expiringKey).length).toBe(2);
  processDueJobs(ctx.db, new Date());
  const notes = notificationsByEventKey(ctx.db, expiringKey);
  expect(notes.length).toBe(2);
  expect(notes.every((n) => n.status === 'sent')).toBe(true);
});

test('AC-2 khoi phuc job running ve pending khi khoi dong giu attempts next_run_at bang now', async () => {
  const { db } = freshApp();
  const now = new Date('2026-11-28T10:00:00.000Z');
  const runningId = insertDueJob(db, {
    status: 'running',
    attempts: 2,
    next_run_at: '2999-01-01T00:00:00.000Z',
  });
  const doneId = insertDueJob(db, {
    status: 'done',
    attempts: 1,
    payload: {
      event_key: 'order.completed:DH-20261128-0002',
      event_type: 'order.completed',
      to_user_id: null,
      to_email: 'owner@example.local',
      subject: 'Don DH-20261128-0002 da hoan tat',
      body: 'Don DH-20261128-0002 da hoan tat.',
    },
  });
  const recovered = recoverRunningJobs(db, now);
  expect(recovered).toBe(1);
  const running = jobById(db, runningId);
  expect(running?.status).toBe('pending');
  expect(running?.attempts).toBe(2);
  expect(new Date(running?.next_run_at ?? '').getTime()).toBe(now.getTime());
  const done = jobById(db, doneId);
  expect(done?.status).toBe('done');
  expect(done?.attempts).toBe(1);
  expect(recoverRunningJobs(db, now)).toBe(0);
});

test('AC-2 processDueJobs chay tuan tu theo created_at: job dau fail thi job sau van done', async () => {
  const { db } = freshApp();
  const ownerId = userIdOf(db, 1, 'owner');
  const firstId = insertDueJob(db, {
    payload: {
      event_key: 'order.completed:DH-20261128-0001',
      event_type: 'order.completed',
      to_user_id: ownerId,
      to_email: 'owner@example.local',
      subject: 'Don DH-20261128-0001 da hoan tat',
      body: 'Don DH-20261128-0001 da hoan tat.',
    },
  });
  const secondId = insertDueJob(db, {
    payload: {
      event_key: 'order.completed:DH-20261128-0002',
      event_type: 'order.completed',
      to_user_id: ownerId,
      to_email: 'owner@example.local',
      subject: 'Don DH-20261128-0002 da hoan tat',
      body: 'Don DH-20261128-0002 da hoan tat.',
    },
  });
  FakeEmailAdapter.failNext();
  const result = processDueJobs(db, new Date());
  expect(result.processed).toBe(2);
  expect(result.done).toBe(1);
  const first = jobById(db, firstId);
  expect(first?.status).toBe('pending');
  expect(first?.attempts).toBe(1);
  const second = jobById(db, secondId);
  expect(second?.status).toBe('done');
  expect(notificationsByEventKey(db, 'order.completed:DH-20261128-0001').length).toBe(0);
  expect(notificationsByEventKey(db, 'order.completed:DH-20261128-0002').length).toBe(1);
});

// ---------- AC-3: preferences + API + RBAC + audit ----------

test('AC-3 PATCH preferences tat order.completed thi don hoan tat khong tao job cho user do', async () => {
  const ctx = await notifCtx();
  const ownerId = userIdOf(ctx.db, ctx.orgId, 'owner');
  const orderA = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, orderA.id as number);
  const jobsA = jobsByEventKey(ctx.db, `order.completed:${orderA.code as string}`);
  expect(jobsA.length).toBe(1);
  expect(jobsA[0].payload.to_user_id).toBe(ownerId);
  const patched = await ctx.owner
    .patch('/api/notification-preferences')
    .send({ event_type: 'order.completed', enabled: false });
  expect(patched.status).toBe(200);
  const prefBody = patched.body as Record<string, unknown>;
  const pref = (prefBody.preference as Record<string, unknown>) ?? prefBody;
  expect(pref.event_type).toBe('order.completed');
  expect(pref.enabled).toBe(false);
  const listed = await ctx.owner.get('/api/notification-preferences');
  expect(listed.status).toBe(200);
  const prefs = ((listed.body as Record<string, unknown>).preferences as Record<string, unknown>[]) ?? [];
  expect(prefs.some((p) => p.event_type === 'order.completed' && p.enabled === false)).toBe(true);
  const orderB = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, orderB.id as number);
  const jobsB = jobsByEventKey(ctx.db, `order.completed:${orderB.code as string}`);
  expect(jobsB.filter((j) => j.payload.to_user_id === ownerId).length).toBe(0);
  const repatched = await ctx.owner
    .patch('/api/notification-preferences')
    .send({ event_type: 'order.completed', enabled: true });
  expect(repatched.status).toBe(200);
  const orderC = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, orderC.id as number);
  const jobsC = jobsByEventKey(ctx.db, `order.completed:${orderC.code as string}`);
  expect(jobsC.filter((j) => j.payload.to_user_id === ownerId).length).toBe(1);
});

test('AC-3 GET notifications phan trang va loc theo event_type status; GET jobs loc theo status type', async () => {
  const ctx = await notifCtx();
  const ownerId = userIdOf(ctx.db, ctx.orgId, 'owner');
  const n1 = insertNotification(ctx.db, {
    org_id: ctx.orgId,
    event_key: 'order.completed:DH-20261128-0001',
    event_type: 'order.completed',
    recipient_user_id: ownerId,
    recipient_email: ctx.seeded.ownerEmail,
  });
  insertNotification(ctx.db, {
    org_id: ctx.orgId,
    event_key: 'payment.paid:DH-20261128-0001',
    event_type: 'payment.paid',
    recipient_user_id: ownerId,
    recipient_email: ctx.seeded.ownerEmail,
    status: 'failed',
  });
  const j1 = insertDueJob(ctx.db, { status: 'pending' });
  const j2 = insertDueJob(ctx.db, {
    status: 'failed',
    type: 'low-stock-scan',
    payload: { event_key: '', event_type: '', period_key: hcmToday() },
  });
  void j1;
  void j2;
  const byEvent = await ctx.owner.get('/api/notifications?event_type=order.completed');
  expect(byEvent.status).toBe(200);
  const byEventBody = byEvent.body as Record<string, unknown>;
  expect(byEventBody.total).toBe(1);
  expect((byEventBody.notifications as Record<string, unknown>[]).length).toBe(1);
  expect((byEventBody.notifications as Record<string, unknown>[])[0].event_type).toBe('order.completed');
  expect(byEventBody.page).toBe(1);
  expect(byEventBody.limit).toBeDefined();
  const byStatus = await ctx.owner.get('/api/notifications?status=failed');
  expect(byStatus.status).toBe(200);
  expect((byStatus.body as Record<string, unknown>).total).toBe(1);
  const one = await ctx.owner.get(`/api/notifications/${n1}`);
  expect(one.status).toBe(200);
  const oneBody = one.body as Record<string, unknown>;
  const oneRow = (oneBody.notification as Record<string, unknown>) ?? oneBody;
  expect(oneRow.event_key).toBe('order.completed:DH-20261128-0001');
  const jobsFailed = await ctx.owner.get('/api/jobs?status=failed');
  expect(jobsFailed.status).toBe(200);
  expect((jobsFailed.body as Record<string, unknown>).total).toBe(1);
  expect(((jobsFailed.body as Record<string, unknown>).jobs as Record<string, unknown>[])[0].type).toBe(
    'low-stock-scan',
  );
  const jobsSend = await ctx.owner.get('/api/jobs?type=send-notification');
  expect(jobsSend.status).toBe(200);
  expect((jobsSend.body as Record<string, unknown>).total).toBe(1);
  const jobOne = await ctx.owner.get(`/api/jobs/${j1}`);
  expect(jobOne.status).toBe(200);
  const jobOneBody = jobOne.body as Record<string, unknown>;
  const jobOneRow = (jobOneBody.job as Record<string, unknown>) ?? jobOneBody;
  expect(jobOneRow.status).toBe('pending');
});

test('AC-3 POST jobs/run chay job due tra processed done failed dung so; job chua due khong chay', async () => {
  const ctx = await notifCtx();
  const dueId = insertDueJob(ctx.db, {});
  const futureId = insertDueJob(ctx.db, {
    next_run_at: '2999-01-01T00:00:00.000Z',
    payload: {
      event_key: 'order.completed:DH-20261128-0002',
      event_type: 'order.completed',
      to_user_id: null,
      to_email: 'owner@example.local',
      subject: 'Don DH-20261128-0002 da hoan tat',
      body: 'Don DH-20261128-0002 da hoan tat.',
    },
  });
  const res = await ctx.owner.post('/api/jobs/run').send({});
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ processed: 1, done: 1, failed: 0 });
  expect(jobById(ctx.db, dueId)?.status).toBe('done');
  expect(jobById(ctx.db, futureId)?.status).toBe('pending');
  expect(notificationsByEventKey(ctx.db, 'order.completed:DH-20261128-0001').length).toBe(1);
});

test('AC-3 POST jobs/:id/retry dua job failed ve pending attempts 0 next_run_at now last_error NULL; retry job chua failed 400', async () => {
  const ctx = await notifCtx();
  const ownerId = userIdOf(ctx.db, ctx.orgId, 'owner');
  const failedId = insertDueJob(ctx.db, {
    status: 'failed',
    attempts: 3,
    last_error: 'gia lap loi gui',
  });
  const before = Date.now();
  const res = await ctx.owner.post(`/api/jobs/${failedId}/retry`).send({});
  expect(res.status).toBe(200);
  const after = jobById(ctx.db, failedId);
  expect(after?.status).toBe('pending');
  expect(after?.attempts).toBe(0);
  expect(after?.last_error).toBeNull();
  expect(new Date(after?.next_run_at ?? '').getTime()).toBeGreaterThanOrEqual(before - 5000);
  expect(new Date(after?.next_run_at ?? '').getTime()).toBeLessThanOrEqual(Date.now() + 5000);
  const audits = auditRows(ctx.db, ctx.orgId).filter((r) => r.action === 'job-retried');
  expect(audits.length).toBe(1);
  expect(audits[0].detail.job_id).toBe(failedId);
  expect(audits[0].detail.job_type).toBe('send-notification');
  const pendingId = insertDueJob(ctx.db, {
    payload: {
      event_key: 'order.completed:DH-20261128-0002',
      event_type: 'order.completed',
      to_user_id: ownerId,
      to_email: 'owner@example.local',
      subject: 'Don DH-20261128-0002 da hoan tat',
      body: 'Don DH-20261128-0002 da hoan tat.',
    },
  });
  const bad = await ctx.owner.post(`/api/jobs/${pendingId}/retry`).send({});
  expect(bad.status).toBe(400);
  const notFound = await ctx.owner.post('/api/jobs/999999/retry').send({});
  expect(notFound.status).toBe(404);
});

test('AC-3 can() view-notifications va view-jobs theo ma tran brief', () => {
  const owner: Actor = { id: 1, orgId: 1, branchId: null, role: 'owner' };
  const manager: Actor = { id: 2, orgId: 1, branchId: null, role: 'manager' };
  const sales1: Actor = { id: 3, orgId: 1, branchId: 1, role: 'sales' };
  const warehouseA: Actor = { id: 4, orgId: 1, branchId: 1, role: 'warehouse', warehouseId: 10 };
  const accountant: Actor = { id: 5, orgId: 1, branchId: 1, role: 'accountant' };
  const otherOrg: Actor = { id: 6, orgId: 2, branchId: 1, role: 'owner' };
  const org: Target = { orgId: 1 };
  const branch1: Target = { orgId: 1, branchId: 1 };
  const branch2: Target = { orgId: 1, branchId: 2 };
  const noBranch: Target = { orgId: 1, branchId: null };
  const wh10: Target = { orgId: 1, warehouseId: 10 };
  const wh99: Target = { orgId: 1, warehouseId: 99 };
  expect(can(owner, 'view-notifications', org)).toBe(true);
  expect(can(manager, 'view-notifications', org)).toBe(true);
  expect(can(accountant, 'view-notifications', org)).toBe(true);
  expect(can(sales1, 'view-notifications', branch1)).toBe(true);
  expect(can(sales1, 'view-notifications', branch2)).toBe(false);
  expect(can(sales1, 'view-notifications', noBranch)).toBe(false);
  expect(can(warehouseA, 'view-notifications', wh10)).toBe(true);
  expect(can(warehouseA, 'view-notifications', wh99)).toBe(false);
  expect(can(otherOrg, 'view-notifications', org)).toBe(false);
  expect(can(owner, 'view-jobs', org)).toBe(true);
  expect(can(manager, 'view-jobs', org)).toBe(true);
  expect(can(sales1, 'view-jobs', branch1)).toBe(false);
  expect(can(warehouseA, 'view-jobs', wh10)).toBe(true);
  expect(can(accountant, 'view-jobs', org)).toBe(false);
  expect(can(otherOrg, 'view-jobs', org)).toBe(false);
});

test('AC-3 can() run-jobs va manage-notification-preferences theo ma tran brief', () => {
  const owner: Actor = { id: 1, orgId: 1, branchId: null, role: 'owner' };
  const manager: Actor = { id: 2, orgId: 1, branchId: null, role: 'manager' };
  const sales1: Actor = { id: 3, orgId: 1, branchId: 1, role: 'sales' };
  const warehouseA: Actor = { id: 4, orgId: 1, branchId: 1, role: 'warehouse', warehouseId: 10 };
  const accountant: Actor = { id: 5, orgId: 1, branchId: 1, role: 'accountant' };
  const org: Target = { orgId: 1 };
  const otherOrg: Target = { orgId: 2 };
  expect(can(owner, 'run-jobs', org)).toBe(true);
  expect(can(manager, 'run-jobs', org)).toBe(true);
  expect(can(sales1, 'run-jobs', org)).toBe(false);
  expect(can(warehouseA, 'run-jobs', org)).toBe(false);
  expect(can(accountant, 'run-jobs', org)).toBe(false);
  expect(can(owner, 'run-jobs', otherOrg)).toBe(false);
  const selfSales: Target = { orgId: 1, id: 3 };
  const otherSales: Target = { orgId: 1, id: 1 };
  expect(can(sales1, 'manage-notification-preferences', selfSales)).toBe(true);
  expect(can(sales1, 'manage-notification-preferences', otherSales)).toBe(false);
  expect(can(warehouseA, 'manage-notification-preferences', otherSales)).toBe(false);
  expect(can(accountant, 'manage-notification-preferences', otherSales)).toBe(false);
  expect(can(owner, 'manage-notification-preferences', otherSales)).toBe(true);
  expect(can(manager, 'manage-notification-preferences', { orgId: 1, id: 3, branchId: 1 })).toBe(true);
  expect(can(owner, 'manage-notification-preferences', otherOrg)).toBe(false);
  const action: Action = 'view-notifications';
  const role: Role = 'owner';
  expect(action).toBe('view-notifications');
  expect(role).toBe('owner');
});

test('AC-3 RBAC 403 sales xem thong bao chi nhanh khac, sales xem job, warehouse xem thong bao khong phai ton kho, warehouse va accountant chay job', async () => {
  const ctx = await notifCtx();
  const ownerId = userIdOf(ctx.db, ctx.orgId, 'owner');
  const order1 = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order1.id as number);
  const code1 = order1.code as string;
  // Don chi nhanh 2 phai do sales2 (chi nhanh 2) tao: owner seed gan
  // chi nhanh 1 nen gui branch_id khac bi 403 (hanh vi khoa GOAL-005).
  const order2 = await mustCreateOrder(ctx.sales2, {
    warehouse_id: ctx.whA.id,
    channel: 'counter',
    items: [
      { variant_id: ctx.v1, qty: 2 },
      { variant_id: ctx.v2, qty: 1 },
    ],
  });
  await mustCompletedOrder(ctx, order2.id as number);
  const code2 = order2.code as string;
  const n1 = insertNotification(ctx.db, {
    org_id: ctx.orgId,
    event_key: `order.completed:${code1}`,
    event_type: 'order.completed',
    recipient_user_id: ownerId,
    recipient_email: ctx.seeded.ownerEmail,
  });
  const n2 = insertNotification(ctx.db, {
    org_id: ctx.orgId,
    event_key: `order.completed:${code2}`,
    event_type: 'order.completed',
    recipient_user_id: ownerId,
    recipient_email: ctx.seeded.ownerEmail,
  });
  const own = await ctx.sales.get(`/api/notifications/${n1}`);
  expect(own.status).toBe(200);
  const other = await ctx.sales.get(`/api/notifications/${n2}`);
  expect(other.status).toBe(403);
  const salesJobs = await ctx.sales.get('/api/jobs');
  expect(salesJobs.status).toBe(403);
  const salesJobOne = await ctx.sales.get('/api/jobs/1');
  expect(salesJobOne.status).toBe(403);
  const whNotif = await ctx.warehouse.get(`/api/notifications/${n1}`);
  expect(whNotif.status).toBe(403);
  const whRun = await ctx.warehouse.post('/api/jobs/run').send({});
  expect(whRun.status).toBe(403);
  const failedId = insertDueJob(ctx.db, { status: 'failed', attempts: 3, last_error: 'gia lap' });
  const whRetry = await ctx.warehouse.post(`/api/jobs/${failedId}/retry`).send({});
  expect(whRetry.status).toBe(403);
  const accRun = await ctx.accountant.post('/api/jobs/run').send({});
  expect(accRun.status).toBe(403);
  const accRetry = await ctx.accountant.post(`/api/jobs/${failedId}/retry`).send({});
  expect(accRetry.status).toBe(403);
});

test('AC-3 RBAC 403 user org A doc thong bao org B; org B khong thay job org A', async () => {
  const ctx = await notifCtx();
  const nB = insertNotification(ctx.db, {
    org_id: ctx.orgBId,
    event_key: 'order.completed:DH-ORGB-0001',
    event_type: 'order.completed',
    recipient_user_id: ctx.userBId,
    recipient_email: 'owner-b@example.local',
  });
  const ownB = await ctx.ownerB.get(`/api/notifications/${nB}`);
  expect(ownB.status).toBe(200);
  const crossA = await ctx.owner.get(`/api/notifications/${nB}`);
  expect(crossA.status).toBe(403);
  const orderA = await mustOrder250(ctx);
  await mustTransition(ctx.owner, orderA.id as number, 'confirm');
  const codeA = orderA.code as string;
  const jobRows = jobsByEventKey(ctx.db, `order.confirmed:${codeA}`);
  expect(jobRows.length).toBeGreaterThanOrEqual(1);
  const jobId = jobRows[0].job.id;
  const crossJob = await ctx.ownerB.get(`/api/jobs/${jobId}`);
  expect(crossJob.status).toBe(403);
  const listB = await ctx.ownerB.get('/api/jobs');
  expect(listB.status).toBe(200);
  const listBBody = listB.body as Record<string, unknown>;
  const idsB = ((listBBody.jobs as Record<string, unknown>[]) ?? []).map((j) => j.id);
  expect(idsB).not.toContain(jobId);
  const listBNotif = await ctx.ownerB.get('/api/notifications');
  expect(listBNotif.status).toBe(200);
  expect((listBNotif.body as Record<string, unknown>).total).toBe(1);
});

test('AC-3 audit job fail 3 lan dung 1 notification-failed + 1 job-failed, detail khong chua email khach hay noi dung email', async () => {
  const { db } = freshApp();
  const orgId = 1;
  const customerEmail = 'khach-that-bai@example.local';
  const t0 = new Date('2026-11-28T10:00:00.000Z');
  const jobId = insertDueJob(db, {
    next_run_at: t0.toISOString(),
    payload: {
      event_key: 'order.completed:DH-20261128-0001',
      event_type: 'order.completed',
      to_user_id: null,
      to_email: customerEmail,
      subject: 'Don DH-20261128-0001 da hoan tat',
      body: 'Don DH-20261128-0001 da hoan tat.',
    },
  });
  const auditBefore = auditRows(db, orgId);
  expect(auditBefore.filter((r) => r.action === 'notification-failed').length).toBe(0);
  expect(auditBefore.filter((r) => r.action === 'job-failed').length).toBe(0);
  let now = t0;
  for (let i = 0; i < 3; i++) {
    FakeEmailAdapter.failNext();
    processDueJobs(db, now);
    const row = jobById(db, jobId);
    if (row && row.status === 'pending') {
      now = new Date(new Date(row.next_run_at).getTime());
      db.prepare('UPDATE jobs SET next_run_at = ? WHERE id = ?').run(now.toISOString(), jobId);
    }
  }
  expect(jobById(db, jobId)?.status).toBe('failed');
  const auditAfter = auditRows(db, orgId);
  const notifFailed = auditAfter.filter((r) => r.action === 'notification-failed');
  const jobFailed = auditAfter.filter((r) => r.action === 'job-failed');
  expect(notifFailed.length).toBe(1);
  expect(jobFailed.length).toBe(1);
  expect(notifFailed[0].detail.event_key).toBe('order.completed:DH-20261128-0001');
  expect(notifFailed[0].detail.event_type).toBe('order.completed');
  expect(notifFailed[0].rawDetail).not.toContain(customerEmail);
  expect(notifFailed[0].detail).not.toHaveProperty('subject');
  expect(notifFailed[0].detail).not.toHaveProperty('body');
  expect(notifFailed[0].detail).not.toHaveProperty('recipient_email');
  expect(jobFailed[0].detail.job_id).toBe(jobId);
  expect(jobFailed[0].detail.job_type).toBe('send-notification');
  expect((jobFailed[0].detail.last_error as string).length).toBeGreaterThan(0);
});

test('AC-3 gui thanh cong khong tang so ban ghi audit', async () => {
  const ctx = await notifCtx();
  const before = auditRows(ctx.db, ctx.orgId).length;
  const order = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order.id as number);
  const code = order.code as string;
  expect(jobsByEventKey(ctx.db, `order.completed:${code}`).length).toBe(1);
  processDueJobs(ctx.db, new Date());
  expect(notificationsByEventKey(ctx.db, `order.completed:${code}`).length).toBe(1);
  expect(notificationsByEventKey(ctx.db, `order.completed:${code}`)[0].status).toBe('sent');
  const after = auditRows(ctx.db, ctx.orgId).length;
  expect(after).toBe(before);
});

test('AC-3 preferences: owner/manager sua cho user trong org; sales sua cua nguoi khac 403; event_type la 400', async () => {
  const ctx = await notifCtx();
  const salesId = userIdOf(ctx.db, ctx.orgId, 'sales');
  const ownerId = userIdOf(ctx.db, ctx.orgId, 'owner');
  const byOwner = await ctx.owner
    .patch('/api/notification-preferences')
    .send({ user_id: salesId, event_type: 'order.completed', enabled: false });
  expect(byOwner.status).toBe(200);
  const byManager = await ctx.manager
    .patch('/api/notification-preferences')
    .send({ user_id: salesId, event_type: 'payment.paid', enabled: false });
  expect(byManager.status).toBe(200);
  const getByOwner = await ctx.owner.get(`/api/notification-preferences?user_id=${salesId}`);
  expect(getByOwner.status).toBe(200);
  const prefs = ((getByOwner.body as Record<string, unknown>).preferences as Record<string, unknown>[]) ?? [];
  expect(prefs.some((p) => p.event_type === 'order.completed' && p.enabled === false)).toBe(true);
  const bySalesOther = await ctx.sales
    .patch('/api/notification-preferences')
    .send({ user_id: ownerId, event_type: 'order.completed', enabled: false });
  expect(bySalesOther.status).toBe(403);
  const bySalesGetOther = await ctx.sales.get(`/api/notification-preferences?user_id=${ownerId}`);
  expect(bySalesGetOther.status).toBe(403);
  const selfSales = await ctx.sales
    .patch('/api/notification-preferences')
    .send({ event_type: 'order.completed', enabled: true });
  expect(selfSales.status).toBe(200);
  const badType = await ctx.owner
    .patch('/api/notification-preferences')
    .send({ event_type: 'khong-co-loai-nay', enabled: false });
  expect(badType.status).toBe(400);
});

test('AC-3 warehouse chi xem thong bao stock.low kho duoc gan va job low-stock-scan; xem job khac 403', async () => {
  const ctx = await notifCtx();
  assignWarehouse(ctx.db, ctx.warehouseId, ctx.whA.id as number);
  const today = hcmToday();
  const stockKey = `stock.low:variant:${ctx.v1}:warehouse:${ctx.whA.id as number}:${today}`;
  insertNotification(ctx.db, {
    org_id: ctx.orgId,
    event_key: stockKey,
    event_type: 'stock.low',
    recipient_user_id: ctx.warehouseId,
    recipient_email: 'kho@example.local',
  });
  const order = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order.id as number);
  const code = order.code as string;
  const otherId = insertNotification(ctx.db, {
    org_id: ctx.orgId,
    event_key: `order.completed:${code}`,
    event_type: 'order.completed',
    recipient_user_id: userIdOf(ctx.db, ctx.orgId, 'owner'),
    recipient_email: ctx.seeded.ownerEmail,
  });
  void otherId;
  const list = await ctx.warehouse.get('/api/notifications');
  expect(list.status).toBe(200);
  const listBody = list.body as Record<string, unknown>;
  const rows = (listBody.notifications as Record<string, unknown>[]) ?? [];
  expect(rows.length).toBeGreaterThanOrEqual(1);
  expect(rows.every((r) => r.event_type === 'stock.low')).toBe(true);
  expect(rows.some((r) => r.event_key === stockKey)).toBe(true);
  const scanJobId = insertDueJob(ctx.db, {
    type: 'low-stock-scan',
    payload: { period_key: today },
  });
  const jobsList = await ctx.warehouse.get('/api/jobs?type=low-stock-scan');
  expect(jobsList.status).toBe(200);
  const jobsBody = jobsList.body as Record<string, unknown>;
  const jobRows = (jobsBody.jobs as Record<string, unknown>[]) ?? [];
  expect(jobRows.some((j) => j.id === scanJobId)).toBe(true);
  const sendJobId = insertDueJob(ctx.db, {});
  const otherJob = await ctx.warehouse.get(`/api/jobs/${sendJobId}`);
  expect(otherJob.status).toBe(403);
});

// ---------- AC-4: test moi + giu nguyen hanh vi da khoa ----------

test('AC-4 demo flow don 250k counter xac nhan hoan tat thu 100k chay job notification order.completed + payment.paid sent', async () => {
  const ctx = await notifCtx();
  const order = await mustOrder250(ctx);
  await mustTransition(ctx.owner, order.id as number, 'confirm');
  await mustTransition(ctx.owner, order.id as number, 'process');
  const done = await mustTransition(ctx.owner, order.id as number, 'complete');
  expect(done.status).toBe('completed');
  await mustPayCash(ctx, order.id as number, 100000);
  const code = order.code as string;
  const run = await ctx.owner.post('/api/jobs/run').send({});
  expect(run.status).toBe(200);
  const runBody = run.body as Record<string, number>;
  expect(runBody.processed).toBeGreaterThanOrEqual(2);
  expect(runBody.done).toBeGreaterThanOrEqual(2);
  expect(runBody.failed).toBe(0);
  const completedNotes = notificationsByEventKey(ctx.db, `order.completed:${code}`);
  expect(completedNotes.length).toBe(1);
  expect(completedNotes[0].status).toBe('sent');
  const paidNotes = notificationsByEventKey(ctx.db, `payment.paid:${code}`);
  expect(paidNotes.length).toBeGreaterThanOrEqual(1);
  expect(paidNotes.every((n) => n.status === 'sent')).toBe(true);
  const runAgain = await ctx.owner.post('/api/jobs/run').send({});
  expect(runAgain.status).toBe(200);
  expect((runAgain.body as Record<string, number>).processed).toBe(0);
  expect(notificationsByEventKey(ctx.db, `order.completed:${code}`).length).toBe(1);
});

test('AC-4 webhook paid gui 2 lan van chi chot 1 lan va chi co 1 job payment.paid (giu hanh vi GOAL-006)', async () => {
  const ctx = await notifCtx();
  const order = await mustOrder250(ctx);
  const payment = await mustCreatePayment(ctx.owner, order.id as number, {
    method: 'gateway',
    amount: 90000,
  });
  const ref = payment.gateway_reference as string;
  const body = { gateway_reference: ref, status: 'paid', amount: 90000 };
  const sig = signWebhook(WEBHOOK_SECRET, ref, 'paid', 90000);
  const first = await postWebhook(ctx.app, body, sig);
  expect(first.status).toBe(200);
  const second = await postWebhook(ctx.app, body, sig);
  expect(second.status).toBe(200);
  const detail = await ctx.owner.get(`/api/payments/${payment.id as number}`);
  expect(detail.status).toBe(200);
  expect(asPayment(detail).status).toBe('paid');
  const summary = computePaymentSummary(ctx.db, order.id as number);
  expect(summary.paid_total).toBe(90000);
  const code = order.code as string;
  const jobs = jobsByEventKey(ctx.db, `payment.paid:${code}`);
  expect(jobs.length).toBe(2);
});

test('AC-4 hoan tien giu nguyen computePaymentSummary D22/D25 va sinh dung 1 job payment.refunded', async () => {
  const ctx = await notifCtx();
  const order = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order.id as number);
  await mustPayCash(ctx, order.id as number, 250000);
  const paymentRes = await ctx.owner.get(`/api/orders/${order.id as number}/payments`);
  expect(paymentRes.status).toBe(200);
  const payments = ((paymentRes.body as Record<string, unknown>).payments as Record<string, unknown>[]) ?? [];
  expect(payments.length).toBe(1);
  const paymentId = payments[0].id as number;
  const refund = await ctx.owner
    .post(`/api/payments/${paymentId}/refunds`)
    .send({ amount: 100000, reason: 'hoan truc tiep gia lap' });
  expect(refund.status).toBe(201);
  const summary = computePaymentSummary(ctx.db, order.id as number);
  expect(summary.paid_total).toBe(150000);
  expect(summary.refunded_total).toBe(100000);
  expect(summary.outstanding).toBe(100000);
  expect(summary.payment_status).toBe('partially_paid');
  const code = order.code as string;
  const refundJobs = jobsByEventKey(ctx.db, `payment.refunded:${code}`);
  expect(refundJobs.length).toBe(2);
  const order2 = await mustOrder250(ctx);
  await mustCompletedOrder(ctx, order2.id as number);
  await mustPayCash(ctx, order2.id as number, 250000);
  await mustReturnAndRefund(ctx, order2.id as number, ctx.v1, 1);
  const summary2 = computePaymentSummary(ctx.db, order2.id as number);
  expect(summary2.payment_status).toBe('partially_refunded');
  expect(summary2.refunded_total).toBe(100000);
  expect(summary2.paid_total).toBe(150000);
  expect(summary2.outstanding).toBe(100000);
  // Luu y cho Worker/coordinator: test KHONG assert job payment.refunded
  // cho luong tra-hang-hoan-tien (return refund, GOAL-007) vi brief chi
  // ghi hook "(c) refund tao (GOAL-006)"; co hook return-refund hay khong
  // la quyet dinh cua Worker theo R-9, khong khoa o day.
});
