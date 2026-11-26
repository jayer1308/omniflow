import { existsSync, readFileSync } from 'node:fs';
import { test, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { migrate, openDb } from '../src/db.js';
import { can, type Actor } from '../src/rbac.js';
import { seed } from '../src/seed.js';

// Mật khẩu GIẢ LẬP chỉ dùng cho test, không phải credential thật.
const OWNER_PASSWORD = 'gia-lap-owner-123';
const STAFF_PASSWORD = 'gia-lap-staff-123';
const INVITE_PASSWORD = 'gia-lap-moi-123';

function freshApp() {
  const db = openDb(':memory:');
  migrate(db);
  const seeded = seed(db, { ownerPassword: OWNER_PASSWORD, staffPassword: STAFF_PASSWORD });
  const app = createApp(db);
  return { db, app, seeded };
}

/** Thêm chi nhánh thứ hai trong cùng org (trực tiếp qua DB, bảng branches không đổi). */
function addBranch(db: ReturnType<typeof openDb>, orgId: number, name: string): number {
  return Number(
    db.prepare('INSERT INTO branches (org_id, name) VALUES (?, ?)').run(orgId, name)
      .lastInsertRowid,
  );
}

/** Tạo org B giả lập với 1 owner (trực tiếp qua DB, dùng role owner hợp lệ ở cả 2 schema). */
async function addOrgB(db: ReturnType<typeof openDb>) {
  const orgBId = Number(
    db.prepare('INSERT INTO orgs (name) VALUES (?)').run('Cong ty B gia lap').lastInsertRowid,
  );
  const branchBId = addBranch(db, orgBId, 'Chi nhanh B');
  const hash = await hashPassword('gia-lap-orgB-123');
  const userBId = Number(
    db
      .prepare(
        'INSERT INTO users (org_id, branch_id, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      )
      .run(orgBId, branchBId, 'owner-b@example.local', hash, 'owner').lastInsertRowid,
  );
  return { orgBId, branchBId, userBId };
}

async function loginAgent(app: ReturnType<typeof createApp>, email: string, password: string) {
  const agent = request.agent(app);
  const res = await agent.post('/login').send({ email, password });
  expect(res.status).toBe(200);
  return agent;
}

async function ownerAgent(app: ReturnType<typeof createApp>, seeded: { ownerEmail: string }) {
  return loginAgent(app, seeded.ownerEmail, OWNER_PASSWORD);
}

interface InviteBody {
  email: string;
  password: string;
  role: string;
  branch_id?: number | null;
  warehouse_id?: number | null;
}

// ---------- AC-1: 5 vai + ma trận quyền ----------

test('AC-1 migration 007 mo role CHECK sang 5 vai va khong con staff', () => {
  const { db } = freshApp();
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get() as { sql: string };
  for (const role of ['owner', 'manager', 'sales', 'warehouse', 'accountant']) {
    expect(row.sql).toContain(`'${role}'`);
  }
  const staff = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'staff'").get() as {
    c: number;
  };
  expect(staff.c).toBe(0);
});

test('AC-1 users co status mac dinh active, branch_id nullable, warehouse_id', () => {
  const { db } = freshApp();
  const cols = db.prepare('PRAGMA table_info(users)').all() as {
    name: string;
    notnull: number;
    dflt_value: string | null;
  }[];
  const byName = new Map(cols.map((c) => [c.name, c]));
  const status = byName.get('status');
  expect(status).toBeDefined();
  expect(status?.dflt_value).toContain('active');
  expect(byName.get('branch_id')?.notnull).toBe(0);
  const warehouse = byName.get('warehouse_id');
  expect(warehouse).toBeDefined();
  expect(warehouse?.notnull).toBe(0);
});

test('AC-1 seed doi staff thanh sales, van 2 user', () => {
  const { db, seeded } = freshApp();
  const users = db.prepare('SELECT email, role FROM users ORDER BY id').all() as {
    email: string;
    role: string;
  }[];
  expect(users.length).toBe(2);
  expect(users.map((u) => u.role)).toEqual(['owner', 'sales']);
  expect(users[1].email).toBe('staff@example.local');
  expect(seeded.staffEmail).toBe('staff@example.local');
});

test('AC-1 docs RBAC.md co du ma tran vai x thao tac x pham vi', () => {
  expect(existsSync('docs/RBAC.md')).toBe(true);
  const doc = readFileSync('docs/RBAC.md', 'utf8');
  for (const word of ['owner', 'manager', 'sales', 'warehouse', 'accountant']) {
    expect(doc).toContain(word);
  }
  expect(doc).toContain('403');
  expect(doc.toLowerCase()).toContain('phạm vi');
});

test('AC-1 can() chan vai sai thao tac', () => {
  const sales: Actor = { id: 3, orgId: 1, branchId: 1, role: 'sales' };
  const accountant: Actor = { id: 4, orgId: 1, branchId: 1, role: 'accountant' };
  const warehouse: Actor = { id: 5, orgId: 1, branchId: 1, role: 'warehouse' };
  const manager: Actor = { id: 2, orgId: 1, branchId: 1, role: 'manager' };
  expect(can(sales, 'invite', { orgId: 1, branchId: 1, role: 'sales' })).toBe(false);
  expect(can(sales, 'lock', { id: 9, orgId: 1, branchId: 1, role: 'sales' })).toBe(false);
  expect(can(sales, 'revoke', { id: 9, orgId: 1, branchId: 1, role: 'sales' })).toBe(false);
  expect(can(accountant, 'view-audit-log', { orgId: 1 })).toBe(false);
  expect(can(warehouse, 'create-branch', { orgId: 1 })).toBe(false);
  expect(can(manager, 'change-role', { id: 3, orgId: 1, branchId: 1, role: 'sales' })).toBe(
    false,
  );
});

test('AC-1 can() chan ngoai org va ngoai branch', () => {
  const owner: Actor = { id: 1, orgId: 1, branchId: null, role: 'owner' };
  const managerB1: Actor = { id: 2, orgId: 1, branchId: 1, role: 'manager' };
  expect(can(owner, 'invite', { orgId: 2, branchId: 5, role: 'sales' })).toBe(false);
  expect(can(owner, 'create-branch', { orgId: 2 })).toBe(false);
  expect(can(managerB1, 'invite', { orgId: 1, branchId: 2, role: 'sales' })).toBe(false);
  expect(can(managerB1, 'lock', { id: 9, orgId: 1, branchId: 2, role: 'sales' })).toBe(false);
  expect(can(managerB1, 'invite', { orgId: 2, branchId: 1, role: 'sales' })).toBe(false);
});

test('AC-1 can() cho phep dung vai dung pham vi', () => {
  const owner: Actor = { id: 1, orgId: 1, branchId: null, role: 'owner' };
  const managerB1: Actor = { id: 2, orgId: 1, branchId: 1, role: 'manager' };
  const managerAll: Actor = { id: 6, orgId: 1, branchId: null, role: 'manager' };
  expect(can(owner, 'invite', { orgId: 1, branchId: 1, role: 'manager' })).toBe(true);
  expect(can(owner, 'create-branch', { orgId: 1 })).toBe(true);
  expect(can(owner, 'view-audit-log', { orgId: 1 })).toBe(true);
  expect(can(managerB1, 'invite', { orgId: 1, branchId: 1, role: 'sales' })).toBe(true);
  expect(can(managerB1, 'list-users', { orgId: 1 })).toBe(true);
  expect(can(managerAll, 'invite', { orgId: 1, branchId: 2, role: 'warehouse' })).toBe(true);
  const locked: Actor = { id: 3, orgId: 1, branchId: 1, role: 'owner', status: 'locked' };
  expect(can(locked, 'invite', { orgId: 1, branchId: 1, role: 'sales' })).toBe(false);
});

// ---------- AC-2: mời / khóa / thu hồi / đổi vai / phạm vi / mật khẩu ----------

test('AC-2 owner moi sales moi duoc 201 va dang nhap duoc', async () => {
  const { app, seeded } = freshApp();
  const owner = await ownerAgent(app, seeded);
  const body: InviteBody = {
    email: 'sales-moi@example.local',
    password: INVITE_PASSWORD,
    role: 'sales',
    branch_id: seeded.branchId,
  };
  const res = await owner.post('/api/users/invite').send(body);
  expect(res.status).toBe(201);
  expect(res.body.user.email).toBe('sales-moi@example.local');
  expect(res.body.user.role).toBe('sales');
  expect(res.body.user.status).toBe('active');
  expect(JSON.stringify(res.body)).not.toContain(INVITE_PASSWORD);
  expect(res.body.user.password_hash).toBeUndefined();
  const login = await request(app)
    .post('/login')
    .send({ email: 'sales-moi@example.local', password: INVITE_PASSWORD });
  expect(login.status).toBe(200);
});

test('AC-2 manager moi owner hoac manager bi 403, email trung bi 409, branch org khac bi 403', async () => {
  const { db, app, seeded } = freshApp();
  const { branchBId } = await addOrgB(db);
  const owner = await ownerAgent(app, seeded);
  const mgr = await owner.post('/api/users/invite').send({
    email: 'manager@example.local',
    password: INVITE_PASSWORD,
    role: 'manager',
    branch_id: seeded.branchId,
  } as InviteBody);
  expect(mgr.status).toBe(201);
  const manager = await loginAgent(app, 'manager@example.local', INVITE_PASSWORD);
  const inviteOwner = await manager.post('/api/users/invite').send({
    email: 'x1@example.local',
    password: INVITE_PASSWORD,
    role: 'owner',
    branch_id: seeded.branchId,
  } as InviteBody);
  expect(inviteOwner.status).toBe(403);
  const inviteManager = await manager.post('/api/users/invite').send({
    email: 'x2@example.local',
    password: INVITE_PASSWORD,
    role: 'manager',
    branch_id: seeded.branchId,
  } as InviteBody);
  expect(inviteManager.status).toBe(403);
  const dup = await owner.post('/api/users/invite').send({
    email: 'manager@example.local',
    password: INVITE_PASSWORD,
    role: 'sales',
    branch_id: seeded.branchId,
  } as InviteBody);
  expect(dup.status).toBe(409);
  const foreign = await owner.post('/api/users/invite').send({
    email: 'x3@example.local',
    password: INVITE_PASSWORD,
    role: 'sales',
    branch_id: branchBId,
  } as InviteBody);
  expect(foreign.status).toBe(403);
});

test('AC-2 khoa xong login tra 403 phan biet 401, session cu bi chan, mo khoa dang nhap lai duoc', async () => {
  const { app, seeded } = freshApp();
  const owner = await ownerAgent(app, seeded);
  const invited = await owner.post('/api/users/invite').send({
    email: 'sales-khoa@example.local',
    password: INVITE_PASSWORD,
    role: 'sales',
    branch_id: seeded.branchId,
  } as InviteBody);
  expect(invited.status).toBe(201);
  const targetId = invited.body.user.id as number;
  const sales = await loginAgent(app, 'sales-khoa@example.local', INVITE_PASSWORD);
  const lock = await owner.post(`/api/users/${targetId}/lock`);
  expect(lock.status).toBe(200);
  expect(lock.body.user.status).toBe('locked');
  const loginLocked = await request(app)
    .post('/login')
    .send({ email: 'sales-khoa@example.local', password: INVITE_PASSWORD });
  expect(loginLocked.status).toBe(403);
  expect(loginLocked.body.error).not.toBe('Email hoặc mật khẩu không đúng');
  const wrongPass = await request(app)
    .post('/login')
    .send({ email: 'sales-khoa@example.local', password: 'sai-mat-khau' });
  expect(wrongPass.status).toBe(401);
  const meOld = await sales.get('/me');
  expect([401, 403]).toContain(meOld.status);
  const unlock = await owner.post(`/api/users/${targetId}/unlock`);
  expect(unlock.status).toBe(200);
  const loginAgain = await request(app)
    .post('/login')
    .send({ email: 'sales-khoa@example.local', password: INVITE_PASSWORD });
  expect(loginAgain.status).toBe(200);
});

test('AC-2 thu hoi la cuoi cung: login 403, API 401/403, row van con, khong mo lai duoc', async () => {
  const { db, app, seeded } = freshApp();
  const owner = await ownerAgent(app, seeded);
  const invited = await owner.post('/api/users/invite').send({
    email: 'sales-thuhoi@example.local',
    password: INVITE_PASSWORD,
    role: 'sales',
    branch_id: seeded.branchId,
  } as InviteBody);
  expect(invited.status).toBe(201);
  const targetId = invited.body.user.id as number;
  const sales = await loginAgent(app, 'sales-thuhoi@example.local', INVITE_PASSWORD);
  const revoke = await owner.post(`/api/users/${targetId}/revoke`);
  expect(revoke.status).toBe(200);
  expect(revoke.body.user.status).toBe('revoked');
  const loginRevoked = await request(app)
    .post('/login')
    .send({ email: 'sales-thuhoi@example.local', password: INVITE_PASSWORD });
  expect(loginRevoked.status).toBe(403);
  const meOld = await sales.get('/me');
  expect([401, 403]).toContain(meOld.status);
  const row = db.prepare('SELECT status FROM users WHERE id = ?').get(targetId) as {
    status: string;
  };
  expect(row.status).toBe('revoked');
  const unlockRevoked = await owner.post(`/api/users/${targetId}/unlock`);
  expect([400, 403]).toContain(unlockRevoked.status);
});

test('AC-2 khong duoc khoa chinh minh va khong khoa owner duy nhat', async () => {
  const { db, app, seeded } = freshApp();
  const owner = await ownerAgent(app, seeded);
  const ownerRow = db.prepare('SELECT id FROM users WHERE email = ?').get(seeded.ownerEmail) as {
    id: number;
  };
  const selfLock = await owner.post(`/api/users/${ownerRow.id}/lock`);
  expect([400, 403]).toContain(selfLock.status);
  const selfRevoke = await owner.post(`/api/users/${ownerRow.id}/revoke`);
  expect([400, 403]).toContain(selfRevoke.status);
});

test('AC-2 chi owner duoc doi vai, manager doi pham vi trong pham vi, doi mat khau theo ma tran', async () => {
  const { db, app, seeded } = freshApp();
  const branch2 = addBranch(db, seeded.orgId, 'Chi nhanh Hai');
  const owner = await ownerAgent(app, seeded);
  const mgrRes = await owner.post('/api/users/invite').send({
    email: 'manager2@example.local',
    password: INVITE_PASSWORD,
    role: 'manager',
    branch_id: seeded.branchId,
  } as InviteBody);
  expect(mgrRes.status).toBe(201);
  const salesRes = await owner.post('/api/users/invite').send({
    email: 'sales-doi@example.local',
    password: INVITE_PASSWORD,
    role: 'sales',
    branch_id: seeded.branchId,
  } as InviteBody);
  expect(salesRes.status).toBe(201);
  const salesId = salesRes.body.user.id as number;
  const manager = await loginAgent(app, 'manager2@example.local', INVITE_PASSWORD);
  const mgrChangeRole = await manager.patch(`/api/users/${salesId}/role`).send({ role: 'warehouse' });
  expect(mgrChangeRole.status).toBe(403);
  const ownerChangeRole = await owner.patch(`/api/users/${salesId}/role`).send({ role: 'warehouse' });
  expect(ownerChangeRole.status).toBe(200);
  expect(ownerChangeRole.body.user.role).toBe('warehouse');
  const mgrScopeOut = await manager.patch(`/api/users/${salesId}/scope`).send({ branch_id: branch2 });
  expect(mgrScopeOut.status).toBe(403);
  const mgrScopeIn = await manager.patch(`/api/users/${salesId}/scope`).send({ branch_id: seeded.branchId });
  expect(mgrScopeIn.status).toBe(200);
  const mgrChangePass = await manager
    .post(`/api/users/${salesId}/change-password`)
    .send({ newPassword: 'mat-khau-moi-456' });
  expect(mgrChangePass.status).toBe(200);
  const loginNew = await request(app)
    .post('/login')
    .send({ email: 'sales-doi@example.local', password: 'mat-khau-moi-456' });
  expect(loginNew.status).toBe(200);
  const sales = await loginAgent(app, 'sales-doi@example.local', 'mat-khau-moi-456');
  const selfWrong = await sales
    .post('/api/users/change-password')
    .send({ currentPassword: 'sai', newPassword: 'mat-khau-moi-789' });
  expect([400, 401]).toContain(selfWrong.status);
  const selfOk = await sales
    .post('/api/users/change-password')
    .send({ currentPassword: 'mat-khau-moi-456', newPassword: 'mat-khau-moi-789' });
  expect(selfOk.status).toBe(200);
  const loginSelf = await request(app)
    .post('/login')
    .send({ email: 'sales-doi@example.local', password: 'mat-khau-moi-789' });
  expect(loginSelf.status).toBe(200);
});

test('AC-2 owner tao chi nhanh duoc, manager tao chi nhanh bi 403, GET users loc theo pham vi', async () => {
  const { db, app, seeded } = freshApp();
  const branch2 = addBranch(db, seeded.orgId, 'Chi nhanh Hai');
  const owner = await ownerAgent(app, seeded);
  const created = await owner.post('/api/branches').send({ name: 'Chi nhanh Ba' });
  expect(created.status).toBe(201);
  expect(created.body.name).toBe('Chi nhanh Ba');
  await owner.post('/api/users/invite').send({
    email: 'manager3@example.local',
    password: INVITE_PASSWORD,
    role: 'manager',
    branch_id: seeded.branchId,
  } as InviteBody);
  await owner.post('/api/users/invite').send({
    email: 'sales-b2@example.local',
    password: INVITE_PASSWORD,
    role: 'sales',
    branch_id: branch2,
  } as InviteBody);
  const manager = await loginAgent(app, 'manager3@example.local', INVITE_PASSWORD);
  const mgrCreate = await manager.post('/api/branches').send({ name: 'Chi nhanh Cam' });
  expect(mgrCreate.status).toBe(403);
  const ownerList = await owner.get('/api/users');
  expect(ownerList.status).toBe(200);
  expect(ownerList.body.some((u: { email: string }) => u.email === 'sales-b2@example.local')).toBe(true);
  expect(ownerList.body.every((u: { password_hash?: string }) => u.password_hash === undefined)).toBe(true);
  const mgrList = await manager.get('/api/users');
  expect(mgrList.status).toBe(200);
  expect(mgrList.body.every((u: { branch_id: number | null }) => u.branch_id === seeded.branchId)).toBe(true);
  expect(mgrList.body.some((u: { email: string }) => u.email === 'sales-b2@example.local')).toBe(false);
  const sales = await loginAgent(app, seeded.staffEmail, STAFF_PASSWORD);
  const salesList = await sales.get('/api/users');
  expect(salesList.status).toBe(403);
});

// ---------- AC-3: audit log ----------

test('AC-3 moi thao tac nhay cam ghi audit_log day du', async () => {
  const { db, app, seeded } = freshApp();
  const owner = await ownerAgent(app, seeded);
  const invited = await owner.post('/api/users/invite').send({
    email: 'sales-log@example.local',
    password: INVITE_PASSWORD,
    role: 'sales',
    branch_id: seeded.branchId,
  } as InviteBody);
  expect(invited.status).toBe(201);
  const targetId = invited.body.user.id as number;
  const lock = await owner.post(`/api/users/${targetId}/lock`);
  expect(lock.status).toBe(200);
  const rows = db
    .prepare("SELECT action, user_id, detail, created_at FROM audit_log WHERE action IN ('invite', 'lock') ORDER BY id")
    .all() as { action: string; user_id: number; detail: string; created_at: string }[];
  expect(rows.length).toBeGreaterThanOrEqual(2);
  for (const row of rows) {
    expect(row.user_id).toBeGreaterThan(0);
    expect(row.created_at).toBeTruthy();
    const detail = JSON.parse(row.detail) as {
      target_user_id: number;
      before: unknown;
      after: unknown;
    };
    expect(detail.target_user_id).toBe(targetId);
    expect(detail.before).toBeDefined();
    expect(detail.after).toBeDefined();
    expect(row.detail).not.toContain(INVITE_PASSWORD);
  }
});

test('AC-3 GET audit-log: owner thay toan org, sales bi 403, manager chi thay trong pham vi', async () => {
  const { db, app, seeded } = freshApp();
  const branch2 = addBranch(db, seeded.orgId, 'Chi nhanh Hai');
  const owner = await ownerAgent(app, seeded);
  const s1 = await owner.post('/api/users/invite').send({
    email: 'sales-c1@example.local',
    password: INVITE_PASSWORD,
    role: 'sales',
    branch_id: seeded.branchId,
  } as InviteBody);
  expect(s1.status).toBe(201);
  const s2 = await owner.post('/api/users/invite').send({
    email: 'sales-c2@example.local',
    password: INVITE_PASSWORD,
    role: 'sales',
    branch_id: branch2,
  } as InviteBody);
  expect(s2.status).toBe(201);
  await owner.post('/api/users/invite').send({
    email: 'manager-log@example.local',
    password: INVITE_PASSWORD,
    role: 'manager',
    branch_id: seeded.branchId,
  } as InviteBody);
  const manager = await loginAgent(app, 'manager-log@example.local', INVITE_PASSWORD);
  const ownerLog = await owner.get('/api/audit-log');
  expect(ownerLog.status).toBe(200);
  expect(Array.isArray(ownerLog.body)).toBe(true);
  expect(ownerLog.body.length).toBeGreaterThanOrEqual(3);
  const sales = await loginAgent(app, 'sales-c1@example.local', INVITE_PASSWORD);
  const salesLog = await sales.get('/api/audit-log');
  expect(salesLog.status).toBe(403);
  const mgrLog = await manager.get('/api/audit-log');
  expect(mgrLog.status).toBe(200);
  const details = (mgrLog.body as { detail: string }[]).map((r) => JSON.parse(r.detail));
  expect(details.some((d) => d.target_user_id === s1.body.user.id)).toBe(true);
  expect(details.some((d) => d.target_user_id === s2.body.user.id)).toBe(false);
  const pageOwner = await owner.get('/audit-log');
  expect(pageOwner.status).toBe(200);
  const pageSales = await sales.get('/audit-log');
  expect(pageSales.status).toBe(403);
});

// ---------- AC-4: chặn truy cập ngoài phạm vi + checks mở rộng ----------

test('AC-4 user org A thao tac tren org B bi 403', async () => {
  const { db, app, seeded } = freshApp();
  const { orgBId, branchBId } = await addOrgB(db);
  const ownerB = await loginAgent(app, 'owner-b@example.local', 'gia-lap-orgB-123');
  const inviteForeign = await ownerB.post('/api/users/invite').send({
    email: 'x-orgb@example.local',
    password: INVITE_PASSWORD,
    role: 'sales',
    branch_id: seeded.branchId,
  } as InviteBody);
  expect(inviteForeign.status).toBe(403);
  const ownerA = db.prepare('SELECT id FROM users WHERE email = ?').get(seeded.ownerEmail) as {
    id: number;
  };
  const lockForeign = await ownerB.post(`/api/users/${ownerA.id}/lock`);
  expect(lockForeign.status).toBe(403);
  const ownerAList = await ownerB.get('/api/audit-log');
  expect(ownerAList.status).toBe(200);
  expect(
    (ownerAList.body as { org_id: number }[]).every((r) => r.org_id === orgBId),
  ).toBe(true);
  expect(branchBId).toBeGreaterThan(0);
});

test('AC-4 user dung vai nhung ngoai branch duoc cap bi 403', async () => {
  const { db, app, seeded } = freshApp();
  const branch2 = addBranch(db, seeded.orgId, 'Chi nhanh Hai');
  const owner = await ownerAgent(app, seeded);
  await owner.post('/api/users/invite').send({
    email: 'manager-b1@example.local',
    password: INVITE_PASSWORD,
    role: 'manager',
    branch_id: seeded.branchId,
  } as InviteBody);
  const s2 = await owner.post('/api/users/invite').send({
    email: 'sales-b2x@example.local',
    password: INVITE_PASSWORD,
    role: 'sales',
    branch_id: branch2,
  } as InviteBody);
  expect(s2.status).toBe(201);
  const manager = await loginAgent(app, 'manager-b1@example.local', INVITE_PASSWORD);
  const lockOut = await manager.post(`/api/users/${s2.body.user.id}/lock`);
  expect(lockOut.status).toBe(403);
  const inviteOut = await manager.post('/api/users/invite').send({
    email: 'x-b2@example.local',
    password: INVITE_PASSWORD,
    role: 'sales',
    branch_id: branch2,
  } as InviteBody);
  expect(inviteOut.status).toBe(403);
});

test('AC-4 vai sai thao tac bi 403 qua HTTP', async () => {
  const { app, seeded } = freshApp();
  const owner = await ownerAgent(app, seeded);
  const invited = await owner.post('/api/users/invite').send({
    email: 'sales-sai@example.local',
    password: INVITE_PASSWORD,
    role: 'sales',
    branch_id: seeded.branchId,
  } as InviteBody);
  expect(invited.status).toBe(201);
  const sales = await loginAgent(app, 'sales-sai@example.local', INVITE_PASSWORD);
  const targetId = invited.body.user.id as number;
  expect((await sales.post('/api/users/invite').send({
    email: 'y@example.local', password: INVITE_PASSWORD, role: 'sales', branch_id: seeded.branchId,
  } as InviteBody)).status).toBe(403);
  expect((await sales.post(`/api/users/${targetId}/lock`)).status).toBe(403);
  expect((await sales.post(`/api/users/${targetId}/revoke`)).status).toBe(403);
  expect((await sales.patch(`/api/users/${targetId}/role`).send({ role: 'manager' })).status).toBe(403);
  expect((await sales.get('/api/audit-log')).status).toBe(403);
  expect((await sales.post('/api/branches').send({ name: 'Chi nhanh X' })).status).toBe(403);
  expect((await sales.get('/api/users')).status).toBe(403);
});

test('AC-4 tai khoan bi khoa dung session cu bi 401, tai khoan bi thu hoi dang nhap lai bi 403', async () => {
  const { app, seeded } = freshApp();
  const owner = await ownerAgent(app, seeded);
  const invited = await owner.post('/api/users/invite').send({
    email: 'sales-cu@example.local',
    password: INVITE_PASSWORD,
    role: 'sales',
    branch_id: seeded.branchId,
  } as InviteBody);
  expect(invited.status).toBe(201);
  const targetId = invited.body.user.id as number;
  const sales = await loginAgent(app, 'sales-cu@example.local', INVITE_PASSWORD);
  const lock = await owner.post(`/api/users/${targetId}/lock`);
  expect(lock.status).toBe(200);
  const meLocked = await sales.get('/me');
  expect([401, 403]).toContain(meLocked.status);
  await owner.post(`/api/users/${targetId}/unlock`);
  const revoke = await owner.post(`/api/users/${targetId}/revoke`);
  expect(revoke.status).toBe(200);
  const loginRevoked = await request(app)
    .post('/login')
    .send({ email: 'sales-cu@example.local', password: INVITE_PASSWORD });
  expect(loginRevoked.status).toBe(403);
  const meRevoked = await sales.get('/me');
  expect([401, 403]).toContain(meRevoked.status);
});

test('AC-4 check.sh va demo.sh mo rong buoc RBAC va giu buoc GOAL-001', () => {
  expect(existsSync('scripts/check.sh')).toBe(true);
  expect(existsSync('scripts/demo.sh')).toBe(true);
  const check = readFileSync('scripts/check.sh', 'utf8');
  const demo = readFileSync('scripts/demo.sh', 'utf8');
  for (const script of [check, demo]) {
    expect(script).toContain('health');
    expect(script).toContain('owner-only');
    expect(script.toLowerCase()).toMatch(/rbac|invite|khoa/);
  }
  expect(demo).toContain('audit');
});
