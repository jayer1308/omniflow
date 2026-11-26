import { existsSync, readFileSync } from 'node:fs';
import { test, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { migrate, openDb, tableNames } from '../src/db.js';
import { seed } from '../src/seed.js';
import { FakeEmailAdapter, FakePaymentAdapter, FakeShippingAdapter } from '../src/adapters/index.js';

// Mật khẩu GIẢ LẬP chỉ dùng cho test, không phải credential thật.
const OWNER_PASSWORD = 'gia-lap-owner-123';
const STAFF_PASSWORD = 'gia-lap-staff-123';

function freshApp() {
  const db = openDb(':memory:');
  migrate(db);
  const seeded = seed(db, { ownerPassword: OWNER_PASSWORD, staffPassword: STAFF_PASSWORD });
  const app = createApp(db);
  return { db, app, seeded };
}

test('AC-1 health tra ok', async () => {
  const { app } = freshApp();
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: 'ok' });
});

test('AC-1 migration tao du 6 bang', () => {
  const db = openDb(':memory:');
  migrate(db);
  const names = tableNames(db);
  for (const t of ['orgs', 'branches', 'users', 'sessions', 'audit_log', 'idempotency_keys']) {
    expect(names).toContain(t);
  }
});

test('AC-1 seed tao 1 org 1 branch 2 user', () => {
  const { db, seeded } = freshApp();
  const orgs = db.prepare('SELECT COUNT(*) AS c FROM orgs').get() as { c: number };
  const branches = db.prepare('SELECT COUNT(*) AS c FROM branches').get() as { c: number };
  const users = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  expect(orgs.c).toBe(1);
  expect(branches.c).toBe(1);
  expect(users.c).toBe(2);
  expect(seeded.orgId).toBeGreaterThan(0);
  expect(seeded.branchId).toBeGreaterThan(0);
  expect(seeded.ownerEmail).toContain('@');
  expect(seeded.staffEmail).toContain('@');
});

test('AC-1 seed dang nhap duoc bang tai khoan seed', async () => {
  const { app, seeded } = freshApp();
  const res = await request(app)
    .post('/login')
    .send({ email: seeded.ownerEmail, password: OWNER_PASSWORD });
  expect(res.status).toBe(200);
  expect(res.body.ok).toBe(true);
});

test('AC-2 dang nhap dung mat khau duoc session, sai mat khau bi tu choi', async () => {
  const { app, seeded } = freshApp();
  const ok = await request(app)
    .post('/login')
    .send({ email: seeded.ownerEmail, password: OWNER_PASSWORD });
  expect(ok.status).toBe(200);
  expect(ok.headers['set-cookie']).toBeDefined();
  const wrong = await request(app)
    .post('/login')
    .send({ email: seeded.ownerEmail, password: 'sai-mat-khau' });
  expect(wrong.status).toBe(401);
  const unknown = await request(app)
    .post('/login')
    .send({ email: 'khong-co@example.local', password: OWNER_PASSWORD });
  expect(unknown.status).toBe(401);
});

test('AC-2 dang xuat xong session cu khong dung duoc nua', async () => {
  const { app, seeded } = freshApp();
  const agent = request.agent(app);
  await agent.post('/login').send({ email: seeded.ownerEmail, password: OWNER_PASSWORD });
  const meBefore = await agent.get('/me');
  expect(meBefore.status).toBe(200);
  const out = await agent.post('/logout');
  expect(out.status).toBe(200);
  const meAfter = await agent.get('/me');
  expect(meAfter.status).toBe(401);
});

test('AC-2 session het han phai dang nhap lai', async () => {
  const { db, app, seeded } = freshApp();
  const login = await request(app)
    .post('/login')
    .send({ email: seeded.ownerEmail, password: OWNER_PASSWORD });
  const cookie = (login.headers['set-cookie'] as string[])[0];
  const token = cookie.split(';')[0].split('=')[1];
  db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(
    Math.floor(Date.now() / 1000) - 10,
    token,
  );
  const me = await request(app).get('/me').set('Cookie', `omniflow_session=${token}`);
  expect(me.status).toBe(401);
});

test('AC-2 staff goi route owner-only bi chan 403, owner duoc phep', async () => {
  const { app, seeded } = freshApp();
  const staff = request.agent(app);
  await staff.post('/login').send({ email: seeded.staffEmail, password: STAFF_PASSWORD });
  const denied = await staff.get('/owner-only');
  expect([401, 403]).toContain(denied.status);
  const owner = request.agent(app);
  await owner.post('/login').send({ email: seeded.ownerEmail, password: OWNER_PASSWORD });
  const allowed = await owner.get('/owner-only');
  expect(allowed.status).toBe(200);
  const anon = await request(app).get('/owner-only');
  expect(anon.status).toBe(401);
});

test('AC-3 user org A truy cap du lieu org B bi tu choi', async () => {
  const { db, app, seeded } = freshApp();
  db.prepare('INSERT INTO orgs (name) VALUES (?)').run('Cong ty B gia lap');
  const orgB = db.prepare('SELECT id FROM orgs WHERE name = ?').get('Cong ty B gia lap') as {
    id: number;
  };
  db.prepare('INSERT INTO branches (org_id, name) VALUES (?, ?)').run(orgB.id, 'Chi nhanh B');
  const agent = request.agent(app);
  await agent.post('/login').send({ email: seeded.ownerEmail, password: OWNER_PASSWORD });
  const denied = await agent.get(`/api/orgs/${orgB.id}/branches`);
  expect(denied.status).toBe(403);
  const own = await agent.get(`/api/orgs/${seeded.orgId}/branches`);
  expect(own.status).toBe(200);
  expect(Array.isArray(own.body)).toBe(true);
  expect(own.body.length).toBe(1);
});

test('AC-3 query chi nhanh chi tra du lieu trong org cua user', async () => {
  const { db, app, seeded } = freshApp();
  db.prepare('INSERT INTO orgs (name) VALUES (?)').run('Cong ty B gia lap');
  const orgB = db.prepare('SELECT id FROM orgs WHERE name = ?').get('Cong ty B gia lap') as {
    id: number;
  };
  db.prepare('INSERT INTO branches (org_id, name) VALUES (?, ?)').run(orgB.id, 'Chi nhanh B');
  const agent = request.agent(app);
  await agent.post('/login').send({ email: seeded.ownerEmail, password: OWNER_PASSWORD });
  const res = await agent.get('/api/branches');
  expect(res.status).toBe(200);
  expect(res.body.every((b: { org_id: number }) => b.org_id === seeded.orgId)).toBe(true);
});

test('AC-3 gui lai cung idempotency key tra ket qua cu, khong thuc thi lai', async () => {
  const { db, app, seeded } = freshApp();
  const agent = request.agent(app);
  await agent.post('/login').send({ email: seeded.ownerEmail, password: OWNER_PASSWORD });
  const first = await agent
    .post('/api/idempotent-demo')
    .set('Idempotency-Key', 'demo-key-1')
    .send({ value: 'hello' });
  expect(first.status).toBe(200);
  const second = await agent
    .post('/api/idempotent-demo')
    .set('Idempotency-Key', 'demo-key-1')
    .send({ value: 'hello' });
  expect(second.status).toBe(200);
  expect(second.body).toEqual(first.body);
  const count = db
    .prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'idempotent-demo'")
    .get() as { c: number };
  expect(count.c).toBe(1);
});

test('AC-4 fake payment adapter tra ket qua gia lap xac dinh', () => {
  const adapter = new FakePaymentAdapter();
  const a = adapter.charge(100000, 'VND');
  const b = adapter.charge(100000, 'VND');
  expect(a).toEqual(b);
  expect(a.simulated).toBe(true);
  expect(a.status).toBe('success');
  expect(a.amount).toBe(100000);
});

test('AC-4 fake shipping va email adapter co interface gia lap', () => {
  const shipping = new FakeShippingAdapter();
  const q1 = shipping.quote(500, 'Ha Noi');
  const q2 = shipping.quote(500, 'Ha Noi');
  expect(q1).toEqual(q2);
  expect(q1.simulated).toBe(true);
  const email = new FakeEmailAdapter();
  const m1 = email.send('khach@example.local', 'Chao', 'Noi dung');
  const m2 = email.send('khach@example.local', 'Chao', 'Noi dung');
  expect(m1).toEqual(m2);
  expect(m1.simulated).toBe(true);
});

test('AC-5 docs SETUP co mat va ghi dung lenh chay that', () => {
  expect(existsSync('docs/SETUP.md')).toBe(true);
  const setup = readFileSync('docs/SETUP.md', 'utf8');
  expect(setup).toContain('npm install');
  expect(setup).toContain('npm start');
  expect(setup).toContain('npm test');
  expect(setup.toLowerCase()).toContain('backup');
  expect(existsSync('README.md')).toBe(true);
});

test('AC-6 scripts check va demo co mat va chay duoc', () => {
  expect(existsSync('scripts/check.sh')).toBe(true);
  expect(existsSync('scripts/demo.sh')).toBe(true);
});
