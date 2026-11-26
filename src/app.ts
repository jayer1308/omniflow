import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import {
  createSession,
  destroySession,
  destroySessionsForUser,
  hashPassword,
  lookupSession,
  verifyPassword,
} from './auth.js';
import type { SessionUser } from './auth.js';
import { withIdempotency } from './idempotency.js';
import { can, ROLES, type Role } from './rbac.js';
import { assertSameOrg, tenantScope, type TenantRequest } from './tenant.js';

const SESSION_COOKIE = 'omniflow_session';

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

interface BranchRow {
  id: number;
  org_id: number;
  name: string;
}

interface UserRow {
  id: number;
  org_id: number;
  branch_id: number | null;
  warehouse_id: number | null;
  email: string;
  password_hash: string;
  role: Role;
  status: 'active' | 'locked' | 'revoked';
  created_at: string;
}

interface AuditRow {
  id: number;
  org_id: number;
  user_id: number | null;
  action: string;
  detail: string | null;
  created_at: string;
}

/** Bản ghi user trả cho client: không bao giờ chứa password_hash. */
function sanitizeUser(row: UserRow): Omit<UserRow, 'password_hash'> {
  const { password_hash: _passwordHash, ...rest } = row;
  return rest;
}

function getUserById(db: DatabaseSync, id: number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

function countActiveOwners(db: DatabaseSync, orgId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM users WHERE org_id = ? AND role = 'owner' AND status = 'active'")
    .get(orgId) as { c: number };
  return row.c;
}

function writeAudit(
  db: DatabaseSync,
  orgId: number,
  actorId: number,
  action: string,
  detail: Record<string, unknown>,
): void {
  db.prepare(
    'INSERT INTO audit_log (org_id, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(orgId, actorId, action, JSON.stringify(detail), new Date().toISOString());
}

/** Lọc audit log theo phạm vi của actor: owner thấy toàn org; manager chỉ thấy
 * bản ghi do mình thực hiện hoặc liên quan user trong phạm vi của mình. */
function visibleAuditRows(db: DatabaseSync, actor: SessionUser): AuditRow[] {
  const rows = db
    .prepare('SELECT * FROM audit_log WHERE org_id = ? ORDER BY id DESC')
    .all(actor.orgId) as unknown as AuditRow[];
  if (actor.role === 'owner') return rows;
  const branchByUser = new Map<number, number | null | undefined>();
  const targetBranch = (targetUserId: number): number | null | undefined => {
    if (!branchByUser.has(targetUserId)) {
      const u = getUserById(db, targetUserId);
      branchByUser.set(targetUserId, u ? u.branch_id : undefined);
    }
    return branchByUser.get(targetUserId);
  };
  return rows.filter((row) => {
    if (row.user_id === actor.id) return true;
    try {
      const detail = JSON.parse(row.detail ?? '{}') as { target_user_id?: number };
      if (typeof detail.target_user_id === 'number') {
        const b = targetBranch(detail.target_user_id);
        if (b === undefined) return false;
        return actor.branchId === null || b === actor.branchId;
      }
    } catch {
      return false;
    }
    return false;
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createApp(db: DatabaseSync): Express {
  const app = express();
  // Đường dẫn views/public tính từ thư mục repo (nơi chạy npm start / vitest).
  const baseDir = process.cwd();
  app.set('view engine', 'ejs');
  app.set('views', join(baseDir, 'views'));
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(express.static(join(baseDir, 'public')));

  // Gắn user từ session cookie (nếu có) vào request.
  app.use((req: TenantRequest, _res: Response, next: NextFunction) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    if (token) {
      const user = lookupSession(db, token);
      if (user) req.user = user;
    }
    next();
  });

  function requireAuth(req: TenantRequest, res: Response, next: NextFunction): void {
    if (!req.user) {
      res.status(401).json({ error: 'Chưa đăng nhập' });
      return;
    }
    next();
  }

  /** Middleware phân quyền theo vai (GOAL-002, R-3): vai không nằm trong danh
   * sách -> 403. Kiểm tra phạm vi chi tiết (đúng vai sai phạm vi -> 403) do
   * helper can() trong từng handler đảm nhiệm. */
  function requireRole(...roles: Role[]) {
    return (req: TenantRequest, res: Response, next: NextFunction): void => {
      if (!req.user) {
        res.status(401).json({ error: 'Chưa đăng nhập' });
        return;
      }
      if (!roles.includes(req.user.role)) {
        res.status(403).json({ error: 'Vai của bạn không được phép thao tác này' });
        return;
      }
      next();
    };
  }

  /** Middleware kiểm tra phạm vi org trên route có :orgId (GOAL-002, R-3). */
  function requireScope(req: TenantRequest, res: Response, next: NextFunction): void {
    if (!req.user) {
      res.status(401).json({ error: 'Chưa đăng nhập' });
      return;
    }
    const orgId = Number(req.params.orgId);
    if (Number.isInteger(orgId) && !assertSameOrg(req, orgId)) {
      res.status(403).json({ error: 'Không được truy cập dữ liệu ngoài doanh nghiệp của bạn' });
      return;
    }
    next();
  }

  function requireOwner(req: TenantRequest, res: Response, next: NextFunction): void {
    if (!req.user) {
      res.status(401).json({ error: 'Chưa đăng nhập' });
      return;
    }
    if (req.user.role !== 'owner') {
      res.status(403).json({ error: 'Chỉ chủ doanh nghiệp mới được phép' });
      return;
    }
    next();
  }

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  app.get('/', (req: TenantRequest, res: Response) => {
    res.render('index', { user: req.user ?? null });
  });

  app.get('/login', (_req: Request, res: Response) => {
    res.render('login', { error: null });
  });

  app.post('/login', async (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: unknown; password?: unknown };
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Thiếu email hoặc mật khẩu' });
      return;
    }
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' });
      return;
    }
    // GOAL-002: khóa/thu hồi trả 403, phân biệt rõ với sai mật khẩu (401).
    if (row.status === 'locked') {
      res.status(403).json({ error: 'Tài khoản đang bị khóa', code: 'account_locked' });
      return;
    }
    if (row.status === 'revoked') {
      res.status(403).json({ error: 'Tài khoản đã bị thu hồi', code: 'account_revoked' });
      return;
    }
    const user: SessionUser = {
      id: row.id,
      email: row.email,
      role: row.role,
      orgId: row.org_id,
      branchId: row.branch_id,
      status: row.status,
    };
    const token = createSession(db, user);
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, path: '/', sameSite: 'lax' });
    res.json({ ok: true, user });
  });

  app.post('/logout', (req: TenantRequest, res: Response) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE];
    if (token) destroySession(db, token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  app.get('/me', requireAuth, (req: TenantRequest, res: Response) => {
    res.json({ user: req.user });
  });

  app.get('/owner-only', requireAuth, requireOwner, (_req: TenantRequest, res: Response) => {
    res.json({ ok: true, role: 'owner' });
  });

  // Mọi query nghiệp vụ qua scope org của user đang đăng nhập.
  app.get('/api/branches', requireAuth, tenantScope, (req: TenantRequest, res: Response) => {
    const orgId = req.user?.orgId as number;
    const rows = db
      .prepare('SELECT id, org_id, name FROM branches WHERE org_id = ? ORDER BY id')
      .all(orgId) as unknown as BranchRow[];
    res.json(rows);
  });

  app.get(
    '/api/orgs/:orgId/branches',
    requireAuth,
    requireScope,
    (req: TenantRequest, res: Response) => {
      const orgId = Number(req.params.orgId);
      const rows = db
        .prepare('SELECT id, org_id, name FROM branches WHERE org_id = ? ORDER BY id')
        .all(orgId) as unknown as BranchRow[];
      res.json(rows);
    },
  );

  // ---------- RBAC: người dùng (GOAL-002) ----------

  app.post('/api/users/invite', requireAuth, async (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const body = req.body as {
      email?: unknown;
      password?: unknown;
      role?: unknown;
      branch_id?: unknown;
      warehouse_id?: unknown;
    };
    if (typeof body.email !== 'string' || !EMAIL_RE.test(body.email)) {
      res.status(400).json({ error: 'Email không hợp lệ' });
      return;
    }
    if (typeof body.password !== 'string' || body.password.length < 6) {
      res.status(400).json({ error: 'Mật khẩu ban đầu phải có ít nhất 6 ký tự' });
      return;
    }
    if (typeof body.role !== 'string' || !(ROLES as string[]).includes(body.role)) {
      res.status(400).json({ error: 'Vai không hợp lệ' });
      return;
    }
    const role = body.role as Role;
    const branchId =
      body.branch_id === undefined || body.branch_id === null ? null : Number(body.branch_id);
    if (branchId !== null && !Number.isInteger(branchId)) {
      res.status(400).json({ error: 'branch_id không hợp lệ' });
      return;
    }
    if (branchId !== null) {
      const branch = db.prepare('SELECT org_id FROM branches WHERE id = ?').get(branchId) as
        | { org_id: number }
        | undefined;
      if (!branch || branch.org_id !== actor.orgId) {
        res.status(403).json({ error: 'Chi nhánh không thuộc doanh nghiệp của bạn' });
        return;
      }
    }
    const warehouseId =
      body.warehouse_id === undefined || body.warehouse_id === null
        ? null
        : Number(body.warehouse_id);
    if (warehouseId !== null && !Number.isInteger(warehouseId)) {
      res.status(400).json({ error: 'warehouse_id không hợp lệ' });
      return;
    }
    if (!can(actor, 'invite', { orgId: actor.orgId, branchId, role })) {
      res.status(403).json({ error: 'Bạn không được phép mời vai này / vào phạm vi này' });
      return;
    }
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(body.email);
    if (existing) {
      res.status(409).json({ error: 'Email đã tồn tại' });
      return;
    }
    const hash = await hashPassword(body.password);
    const now = new Date().toISOString();
    const id = Number(
      db
        .prepare(
          'INSERT INTO users (org_id, branch_id, email, password_hash, role, status, warehouse_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(actor.orgId, branchId, body.email, hash, role, 'active', warehouseId, now)
        .lastInsertRowid,
    );
    const created = getUserById(db, id) as UserRow;
    writeAudit(db, actor.orgId, actor.id, 'invite', {
      target_user_id: id,
      before: null,
      after: { email: body.email, role, branch_id: branchId, warehouse_id: warehouseId, status: 'active' },
    });
    res.status(201).json({ user: sanitizeUser(created) });
  });

  app.get('/api/users', requireAuth, requireRole('owner', 'manager'), (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    let rows: UserRow[];
    if (actor.role === 'owner' || actor.branchId === null) {
      rows = db
        .prepare('SELECT * FROM users WHERE org_id = ? ORDER BY id')
        .all(actor.orgId) as unknown as UserRow[];
    } else {
      rows = db
        .prepare('SELECT * FROM users WHERE org_id = ? AND branch_id = ? ORDER BY id')
        .all(actor.orgId, actor.branchId) as unknown as UserRow[];
    }
    res.json(rows.map(sanitizeUser));
  });

  function changeStatus(action: 'lock' | 'unlock' | 'revoke') {
    return (req: TenantRequest, res: Response): void => {
      const actor = req.user as SessionUser;
      const targetId = Number(req.params.id);
      if (!Number.isInteger(targetId)) {
        res.status(400).json({ error: 'id không hợp lệ' });
        return;
      }
      const target = getUserById(db, targetId);
      if (!target) {
        res.status(404).json({ error: 'Không tìm thấy nhân viên' });
        return;
      }
      if (target.org_id !== actor.orgId) {
        res.status(403).json({ error: 'Không được thao tác trên nhân viên ngoài doanh nghiệp của bạn' });
        return;
      }
      if (
        !can(actor, action, {
          id: target.id,
          orgId: target.org_id,
          branchId: target.branch_id,
          role: target.role,
        })
      ) {
        res.status(403).json({ error: 'Bạn không được phép thao tác này' });
        return;
      }
      if (action === 'unlock' && target.status === 'revoked') {
        res.status(400).json({ error: 'Tài khoản đã bị thu hồi, không mở lại được (mời mới để vào lại)' });
        return;
      }
      if (action === 'lock' && target.status === 'revoked') {
        res.status(400).json({ error: 'Tài khoản đã bị thu hồi' });
        return;
      }
      // Mỗi org luôn còn ít nhất 1 owner đang active.
      if (
        (action === 'lock' || action === 'revoke') &&
        target.role === 'owner' &&
        countActiveOwners(db, actor.orgId) <= 1
      ) {
        res.status(400).json({ error: 'Không thể khóa/thu hồi chủ duy nhất còn lại của doanh nghiệp' });
        return;
      }
      const nextStatus = action === 'unlock' ? 'active' : action === 'lock' ? 'locked' : 'revoked';
      const before = { status: target.status };
      db.prepare('UPDATE users SET status = ? WHERE id = ?').run(nextStatus, target.id);
      if (nextStatus !== 'active') destroySessionsForUser(db, target.id);
      writeAudit(db, actor.orgId, actor.id, action, {
        target_user_id: target.id,
        before,
        after: { status: nextStatus },
      });
      res.json({ user: sanitizeUser(getUserById(db, target.id) as UserRow) });
    };
  }

  app.post('/api/users/:id/lock', requireAuth, changeStatus('lock'));
  app.post('/api/users/:id/unlock', requireAuth, changeStatus('unlock'));
  app.post('/api/users/:id/revoke', requireAuth, changeStatus('revoke'));

  app.patch('/api/users/:id/role', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId)) {
      res.status(400).json({ error: 'id không hợp lệ' });
      return;
    }
    const target = getUserById(db, targetId);
    if (!target) {
      res.status(404).json({ error: 'Không tìm thấy nhân viên' });
      return;
    }
    if (target.org_id !== actor.orgId) {
      res.status(403).json({ error: 'Không được thao tác trên nhân viên ngoài doanh nghiệp của bạn' });
      return;
    }
    if (
      !can(actor, 'change-role', {
        id: target.id,
        orgId: target.org_id,
        branchId: target.branch_id,
        role: target.role,
      })
    ) {
      res.status(403).json({ error: 'Chỉ chủ doanh nghiệp được đổi vai người khác' });
      return;
    }
    const newRole = (req.body as { role?: unknown }).role;
    if (typeof newRole !== 'string' || !(ROLES as string[]).includes(newRole)) {
      res.status(400).json({ error: 'Vai không hợp lệ' });
      return;
    }
    if (target.role === 'owner' && newRole !== 'owner' && countActiveOwners(db, actor.orgId) <= 1) {
      res.status(400).json({ error: 'Không thể đổi vai chủ duy nhất còn lại của doanh nghiệp' });
      return;
    }
    const before = { role: target.role };
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, target.id);
    writeAudit(db, actor.orgId, actor.id, 'change-role', {
      target_user_id: target.id,
      before,
      after: { role: newRole },
    });
    res.json({ user: sanitizeUser(getUserById(db, target.id) as UserRow) });
  });

  app.patch('/api/users/:id/scope', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId)) {
      res.status(400).json({ error: 'id không hợp lệ' });
      return;
    }
    const target = getUserById(db, targetId);
    if (!target) {
      res.status(404).json({ error: 'Không tìm thấy nhân viên' });
      return;
    }
    if (target.org_id !== actor.orgId) {
      res.status(403).json({ error: 'Không được thao tác trên nhân viên ngoài doanh nghiệp của bạn' });
      return;
    }
    const body = req.body as { branch_id?: unknown; warehouse_id?: unknown };
    const newBranch =
      body.branch_id === undefined
        ? target.branch_id
        : body.branch_id === null
          ? null
          : Number(body.branch_id);
    const newWarehouse =
      body.warehouse_id === undefined
        ? target.warehouse_id
        : body.warehouse_id === null
          ? null
          : Number(body.warehouse_id);
    if (newBranch !== null && !Number.isInteger(newBranch)) {
      res.status(400).json({ error: 'branch_id không hợp lệ' });
      return;
    }
    if (newWarehouse !== null && !Number.isInteger(newWarehouse)) {
      res.status(400).json({ error: 'warehouse_id không hợp lệ' });
      return;
    }
    if (newBranch !== null) {
      const branch = db.prepare('SELECT org_id FROM branches WHERE id = ?').get(newBranch) as
        | { org_id: number }
        | undefined;
      if (!branch || branch.org_id !== actor.orgId) {
        res.status(403).json({ error: 'Chi nhánh không thuộc doanh nghiệp của bạn' });
        return;
      }
    }
    if (
      !can(actor, 'change-scope', {
        id: target.id,
        orgId: target.org_id,
        branchId: newBranch,
        role: target.role,
      })
    ) {
      res.status(403).json({ error: 'Bạn không được phép đổi phạm vi này' });
      return;
    }
    const before = { branch_id: target.branch_id, warehouse_id: target.warehouse_id };
    db.prepare('UPDATE users SET branch_id = ?, warehouse_id = ? WHERE id = ?').run(
      newBranch,
      newWarehouse,
      target.id,
    );
    writeAudit(db, actor.orgId, actor.id, 'change-scope', {
      target_user_id: target.id,
      before,
      after: { branch_id: newBranch, warehouse_id: newWarehouse },
    });
    res.json({ user: sanitizeUser(getUserById(db, target.id) as UserRow) });
  });

  // Đổi mật khẩu của mình: route literal phải khai trước route :id.
  app.post('/api/users/change-password', requireAuth, async (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const body = req.body as { currentPassword?: unknown; newPassword?: unknown };
    if (typeof body.currentPassword !== 'string' || typeof body.newPassword !== 'string') {
      res.status(400).json({ error: 'Thiếu mật khẩu hiện tại hoặc mật khẩu mới' });
      return;
    }
    if (body.newPassword.length < 6) {
      res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 6 ký tự' });
      return;
    }
    const me = getUserById(db, actor.id) as UserRow;
    if (!(await verifyPassword(body.currentPassword, me.password_hash))) {
      res.status(400).json({ error: 'Mật khẩu hiện tại không đúng' });
      return;
    }
    const hash = await hashPassword(body.newPassword);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, actor.id);
    writeAudit(db, actor.orgId, actor.id, 'change-password', {
      target_user_id: actor.id,
      before: { password_changed: false },
      after: { password_changed: true },
    });
    res.json({ ok: true });
  });

  app.post('/api/users/:id/change-password', requireAuth, async (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const targetId = Number(req.params.id);
    if (!Number.isInteger(targetId)) {
      res.status(400).json({ error: 'id không hợp lệ' });
      return;
    }
    const target = getUserById(db, targetId);
    if (!target) {
      res.status(404).json({ error: 'Không tìm thấy nhân viên' });
      return;
    }
    if (target.org_id !== actor.orgId) {
      res.status(403).json({ error: 'Không được thao tác trên nhân viên ngoài doanh nghiệp của bạn' });
      return;
    }
    if (
      !can(actor, 'change-password-other', {
        id: target.id,
        orgId: target.org_id,
        branchId: target.branch_id,
        role: target.role,
      })
    ) {
      res.status(403).json({ error: 'Bạn không được phép đổi mật khẩu người này' });
      return;
    }
    const newPassword = (req.body as { newPassword?: unknown }).newPassword;
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      res.status(400).json({ error: 'Mật khẩu mới phải có ít nhất 6 ký tự' });
      return;
    }
    const hash = await hashPassword(newPassword);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, target.id);
    writeAudit(db, actor.orgId, actor.id, 'change-password', {
      target_user_id: target.id,
      before: { password_changed: false },
      after: { password_changed: true },
    });
    res.json({ ok: true });
  });

  // ---------- RBAC: chi nhánh + audit log (GOAL-002) ----------

  app.post('/api/branches', requireAuth, requireRole('owner'), (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const name = (req.body as { name?: unknown }).name;
    if (typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Tên chi nhánh bắt buộc' });
      return;
    }
    const now = new Date().toISOString();
    const id = Number(
      db
        .prepare('INSERT INTO branches (org_id, name, created_at) VALUES (?, ?, ?)')
        .run(actor.orgId, name.trim(), now).lastInsertRowid,
    );
    writeAudit(db, actor.orgId, actor.id, 'create-branch', {
      target_branch_id: id,
      before: null,
      after: { name: name.trim(), org_id: actor.orgId },
    });
    res.status(201).json({ id, org_id: actor.orgId, name: name.trim() });
  });

  app.get('/api/audit-log', requireAuth, requireRole('owner', 'manager'), (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    res.json(visibleAuditRows(db, actor));
  });

  app.get('/audit-log', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    if (actor.role !== 'owner' && actor.role !== 'manager') {
      res.status(403).json({ error: 'Chỉ chủ doanh nghiệp và quản lý được xem nhật ký' });
      return;
    }
    res.render('audit-log', { user: actor, logs: visibleAuditRows(db, actor) });
  });

  app.post(
    '/api/idempotent-demo',
    requireAuth,
    tenantScope,
    (req: TenantRequest, res: Response) => {
      const key = req.headers['idempotency-key'];
      if (typeof key !== 'string' || key.length === 0) {
        res.status(400).json({ error: 'Thiếu header Idempotency-Key' });
        return;
      }
      const orgId = req.user?.orgId as number;
      const userId = req.user?.id as number;
      const body = req.body as { value?: unknown };
      const { replayed, result } = withIdempotency(db, orgId, key, () => {
        const now = new Date().toISOString();
        db.prepare(
          'INSERT INTO audit_log (org_id, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)',
        ).run(orgId, userId, 'idempotent-demo', JSON.stringify({ value: body.value ?? null }), now);
        return JSON.stringify({ ok: true, value: body.value ?? null, executedAt: now });
      });
      res.set('X-Idempotency-Replayed', replayed ? 'true' : 'false');
      res.json(JSON.parse(result) as { ok: boolean; value: unknown; executedAt: string });
    },
  );

  return app;
}
