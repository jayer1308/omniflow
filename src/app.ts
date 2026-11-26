import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { stringify } from 'csv-stringify/sync';
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
import {
  createOrderTx,
  getOrderDetail,
  listOrders,
  transitionOrderTx,
  type OrderAction,
} from './orders.js';
import { isAllowedChannel, parseProductCsvWithLines, resolveEffectivePrice } from './products.js';
import { can, ROLES, type Role } from './rbac.js';
import {
  applyMovement,
  runStockTransaction,
  stockLevel,
  withStockIdempotency,
  type StockLevelRow,
  type StockMovementType,
} from './stock.js';
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
    // Bản ghi không gắn target_user_id (kho, sản phẩm/giá/CSV...): manager
    // thấy khi người thực hiện (row.user_id) nằm trong phạm vi chi nhánh
    // của mình — theo luật GOAL-002 (bản ghi liên quan user trong phạm vi
    // + do mình làm). Owner thấy toàn org (đã trả ở trên).
    if (row.user_id !== null) {
      const b = targetBranch(row.user_id);
      if (b === undefined) return false;
      return actor.branchId === null || b === actor.branchId;
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
      warehouseId: row.warehouse_id,
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
    // GOAL-004 / D18: warehouse_id phải trỏ tới kho tồn tại trong cùng org
    // (kiểm tra ở tầng service khi gán; không tồn tại -> 400, ngoài org -> 403).
    if (newWarehouse !== null) {
      const warehouse = db.prepare('SELECT org_id FROM warehouses WHERE id = ?').get(newWarehouse) as
        | { org_id: number }
        | undefined;
      if (!warehouse) {
        res.status(400).json({ error: 'Kho không tồn tại' });
        return;
      }
      if (warehouse.org_id !== actor.orgId) {
        res.status(403).json({ error: 'Kho không thuộc doanh nghiệp của bạn' });
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

  // ---------- Sản phẩm / giá / CSV (GOAL-003) ----------

  const uploadCsv = multer({ storage: multer.memoryStorage() });

  interface ProductRow {
    id: number;
    org_id: number;
    code: string;
    name: string;
    unit: string;
    price: number;
    min_stock: number;
    status: 'active' | 'discontinued';
    category_id: number | null;
    created_at: string;
    updated_at: string;
  }

  interface VariantRow {
    id: number;
    org_id: number;
    product_id: number;
    sku: string;
    name: string;
    barcode: string | null;
    price_override: number | null;
    created_at: string;
    updated_at: string;
  }

  interface CategoryRow {
    id: number;
    org_id: number;
    name: string;
    parent_id: number | null;
    created_at: string;
    updated_at: string;
  }

  interface PriceRow {
    id: number;
    org_id: number;
    product_id: number;
    variant_id: number | null;
    channel: string | null;
    branch_id: number | null;
    price: number;
    created_at: string;
    updated_at: string;
  }

  function getProductById(db: DatabaseSync, id: number): ProductRow | undefined {
    return db.prepare('SELECT * FROM products WHERE id = ?').get(id) as ProductRow | undefined;
  }

  function getVariantById(db: DatabaseSync, id: number): VariantRow | undefined {
    return db.prepare('SELECT * FROM product_variants WHERE id = ?').get(id) as
      | VariantRow
      | undefined;
  }

  function getCategoryById(db: DatabaseSync, id: number): CategoryRow | undefined {
    return db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow | undefined;
  }

  function isIntMoney(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
  }

  function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function productDetail(db: DatabaseSync, product: ProductRow): Record<string, unknown> {
    const variants = db
      .prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY id')
      .all(product.id) as unknown as VariantRow[];
    const attributes = db
      .prepare('SELECT * FROM product_attributes WHERE product_id = ? ORDER BY id')
      .all(product.id) as unknown as Record<string, unknown>[];
    const images = db
      .prepare('SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order, id')
      .all(product.id) as unknown as Record<string, unknown>[];
    const category =
      product.category_id === null ? null : (getCategoryById(db, product.category_id) ?? null);
    return { ...product, category, variants, attributes, images };
  }

  /** Scope lịch sử giá theo kênh/chi nhánh (biến thể phân biệt bằng cột variant_id). */
  function priceScope(
    channel: string | null,
    branchId: number | null,
  ): 'channel' | 'branch' | 'channel_branch' {
    if (channel !== null && branchId !== null) return 'channel_branch';
    if (channel !== null) return 'channel';
    return 'branch';
  }

  function writePriceHistory(
    db: DatabaseSync,
    orgId: number,
    productId: number,
    variantId: number | null,
    scope: string,
    channel: string | null,
    branchId: number | null,
    oldPrice: number | null,
    newPrice: number,
    changedBy: number,
    reason: string,
  ): void {
    db.prepare(
      `INSERT INTO price_history
        (org_id, product_id, variant_id, scope, channel, branch_id, old_price, new_price, changed_by, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      orgId,
      productId,
      variantId,
      scope,
      channel,
      branchId,
      oldPrice,
      newPrice,
      changedBy,
      reason,
      new Date().toISOString(),
    );
  }

  /** Lấy sản phẩm + kiểm tra tồn tại / cùng org. Trả false khi đã respond. */
  function loadProductFor(
    req: TenantRequest,
    res: Response,
    action: Parameters<typeof can>[1],
  ): ProductRow | null {
    const actor = req.user as SessionUser;
    const productId = Number(req.params.id);
    if (!Number.isInteger(productId)) {
      res.status(400).json({ error: 'id không hợp lệ' });
      return null;
    }
    const product = getProductById(db, productId);
    if (!product) {
      res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
      return null;
    }
    if (!can(actor, action, { orgId: product.org_id })) {
      res.status(403).json({ error: 'Bạn không được phép thao tác này' });
      return null;
    }
    return product;
  }

  // CSV import/export phải khai TRƯỚC route /api/products/:id để Express
  // không nhầm 'import'/'export' thành :id.
  app.post('/api/categories', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    if (!can(actor, 'manage-category', { orgId: actor.orgId })) {
      res.status(403).json({ error: 'Bạn không được phép quản lý danh mục' });
      return;
    }
    const body = req.body as { name?: unknown; parent_id?: unknown };
    if (!isNonEmptyString(body.name)) {
      res.status(400).json({ error: 'Tên danh mục bắt buộc' });
      return;
    }
    let parentId: number | null = null;
    if (body.parent_id !== undefined && body.parent_id !== null) {
      parentId = Number(body.parent_id);
      if (!Number.isInteger(parentId)) {
        res.status(400).json({ error: 'parent_id không hợp lệ' });
        return;
      }
      const parent = getCategoryById(db, parentId);
      if (!parent) {
        res.status(404).json({ error: 'Không tìm thấy danh mục cha' });
        return;
      }
      if (parent.org_id !== actor.orgId) {
        res.status(403).json({ error: 'Danh mục cha không thuộc doanh nghiệp của bạn' });
        return;
      }
      if (parent.parent_id !== null) {
        res.status(400).json({ error: 'Danh mục chỉ có tối đa 1 cấp cha' });
        return;
      }
    }
    const now = new Date().toISOString();
    const id = Number(
      db
        .prepare(
          'INSERT INTO categories (org_id, name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(actor.orgId, (body.name as string).trim(), parentId, now, now).lastInsertRowid,
    );
    const created = getCategoryById(db, id) as CategoryRow;
    writeAudit(db, actor.orgId, actor.id, 'create-category', {
      target_product_id: null,
      before: null,
      after: { category_id: id, name: created.name, parent_id: parentId },
    });
    res.status(201).json(created);
  });

  app.get('/api/categories', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const rows = db
      .prepare('SELECT * FROM categories WHERE org_id = ? ORDER BY id')
      .all(actor.orgId) as unknown as CategoryRow[];
    res.json(rows);
  });

  app.patch('/api/categories/:id', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const categoryId = Number(req.params.id);
    if (!Number.isInteger(categoryId)) {
      res.status(400).json({ error: 'id không hợp lệ' });
      return;
    }
    const category = getCategoryById(db, categoryId);
    if (!category) {
      res.status(404).json({ error: 'Không tìm thấy danh mục' });
      return;
    }
    if (
      !can(actor, 'manage-category', { orgId: category.org_id })
    ) {
      res.status(403).json({ error: 'Bạn không được phép quản lý danh mục' });
      return;
    }
    const body = req.body as { name?: unknown; parent_id?: unknown };
    const before = { name: category.name, parent_id: category.parent_id };
    let nextName = category.name;
    if (body.name !== undefined) {
      if (!isNonEmptyString(body.name)) {
        res.status(400).json({ error: 'Tên danh mục bắt buộc' });
        return;
      }
      nextName = (body.name as string).trim();
    }
    let nextParent = category.parent_id;
    if (body.parent_id !== undefined) {
      if (body.parent_id === null) {
        nextParent = null;
      } else {
        nextParent = Number(body.parent_id);
        if (!Number.isInteger(nextParent)) {
          res.status(400).json({ error: 'parent_id không hợp lệ' });
          return;
        }
        const parent = getCategoryById(db, nextParent);
        if (!parent) {
          res.status(404).json({ error: 'Không tìm thấy danh mục cha' });
          return;
        }
        if (parent.org_id !== actor.orgId) {
          res.status(403).json({ error: 'Danh mục cha không thuộc doanh nghiệp của bạn' });
          return;
        }
        if (parent.parent_id !== null || nextParent === category.id) {
          res.status(400).json({ error: 'Danh mục chỉ có tối đa 1 cấp cha' });
          return;
        }
      }
    }
    db.prepare('UPDATE categories SET name = ?, parent_id = ?, updated_at = ? WHERE id = ?').run(
      nextName,
      nextParent,
      new Date().toISOString(),
      category.id,
    );
    writeAudit(db, actor.orgId, actor.id, 'update-category', {
      target_product_id: null,
      before,
      after: { name: nextName, parent_id: nextParent },
    });
    res.json(getCategoryById(db, category.id) as CategoryRow);
  });

  app.post('/api/products', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    if (!can(actor, 'create-product', { orgId: actor.orgId })) {
      res.status(403).json({ error: 'Bạn không được phép tạo sản phẩm' });
      return;
    }
    const body = req.body as {
      code?: unknown;
      name?: unknown;
      unit?: unknown;
      price?: unknown;
      min_stock?: unknown;
      status?: unknown;
      category_id?: unknown;
    };
    if (!isNonEmptyString(body.code)) {
      res.status(400).json({ error: 'Mã sản phẩm bắt buộc' });
      return;
    }
    if (!isNonEmptyString(body.name)) {
      res.status(400).json({ error: 'Tên sản phẩm bắt buộc' });
      return;
    }
    if (!isNonEmptyString(body.unit)) {
      res.status(400).json({ error: 'Đơn vị tính bắt buộc' });
      return;
    }
    if (!isIntMoney(body.price)) {
      res.status(400).json({ error: 'Giá bán phải là số nguyên đồng >= 0' });
      return;
    }
    let minStock = 0;
    if (body.min_stock !== undefined) {
      if (!isIntMoney(body.min_stock)) {
        res.status(400).json({ error: 'min_stock phải là số nguyên >= 0' });
        return;
      }
      minStock = body.min_stock as number;
    }
    let status: 'active' | 'discontinued' = 'active';
    if (body.status !== undefined) {
      if (body.status !== 'active' && body.status !== 'discontinued') {
        res.status(400).json({ error: 'status không hợp lệ' });
        return;
      }
      status = body.status;
    }
    let categoryId: number | null = null;
    if (body.category_id !== undefined && body.category_id !== null) {
      categoryId = Number(body.category_id);
      if (!Number.isInteger(categoryId)) {
        res.status(400).json({ error: 'category_id không hợp lệ' });
        return;
      }
      const category = getCategoryById(db, categoryId);
      if (!category) {
        res.status(404).json({ error: 'Không tìm thấy danh mục' });
        return;
      }
      if (category.org_id !== actor.orgId) {
        res.status(403).json({ error: 'Danh mục không thuộc doanh nghiệp của bạn' });
        return;
      }
    }
    const code = (body.code as string).trim();
    const dup = db
      .prepare('SELECT id FROM products WHERE org_id = ? AND code = ?')
      .get(actor.orgId, code);
    if (dup) {
      res.status(409).json({ error: `Mã sản phẩm ${code} đã tồn tại trong doanh nghiệp` });
      return;
    }
    const now = new Date().toISOString();
    const id = Number(
      db
        .prepare(
          `INSERT INTO products (org_id, code, name, unit, price, min_stock, status, category_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          actor.orgId,
          code,
          (body.name as string).trim(),
          (body.unit as string).trim(),
          body.price,
          minStock,
          status,
          categoryId,
          now,
          now,
        ).lastInsertRowid,
    );
    const created = getProductById(db, id) as ProductRow;
    writeAudit(db, actor.orgId, actor.id, 'create-product', {
      target_product_id: id,
      before: null,
      after: { code, name: created.name, price: created.price, unit: created.unit, status },
    });
    res.status(201).json(created);
  });

  app.get('/api/products', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const categoryId =
      typeof req.query.category_id === 'string' ? Number(req.query.category_id) : undefined;
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : undefined;
    const limit =
      typeof req.query.limit === 'string' && Number.isInteger(Number(req.query.limit))
        ? Math.max(0, Number(req.query.limit))
        : 1000;
    const offset =
      typeof req.query.offset === 'string' && Number.isInteger(Number(req.query.offset))
        ? Math.max(0, Number(req.query.offset))
        : 0;
    let sql = 'SELECT * FROM products WHERE org_id = ?';
    const params: (string | number)[] = [actor.orgId];
    if (status !== undefined) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (categoryId !== undefined && Number.isInteger(categoryId)) {
      sql += ' AND category_id = ?';
      params.push(categoryId);
    }
    if (q !== undefined && q.length > 0) {
      sql += ' AND (code LIKE ? OR name LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    sql += ' ORDER BY id LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const rows = db.prepare(sql).all(...params) as unknown as ProductRow[];
    res.json(rows);
  });

  // ---------- Giá theo kênh/chi nhánh + CSV (khai trước GET /:id) ----------

  app.post('/api/products/:id/prices', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const product = loadProductFor(req, res, 'change-price');
    if (!product) return;
    if (product.status === 'discontinued') {
      res.status(400).json({ error: 'Sản phẩm đã ngừng kinh doanh, không được đổi giá mới' });
      return;
    }
    const body = req.body as {
      variant_id?: unknown;
      channel?: unknown;
      branch_id?: unknown;
      price?: unknown;
      reason?: unknown;
    };
    if (!isNonEmptyString(body.reason)) {
      res.status(400).json({ error: 'Đổi giá phải kèm lý do (reason)' });
      return;
    }
    if (!isIntMoney(body.price)) {
      res.status(400).json({ error: 'Giá phải là số nguyên đồng >= 0' });
      return;
    }
    let variantId: number | null = null;
    if (body.variant_id !== undefined && body.variant_id !== null) {
      variantId = Number(body.variant_id);
      if (!Number.isInteger(variantId)) {
        res.status(400).json({ error: 'variant_id không hợp lệ' });
        return;
      }
      const variant = getVariantById(db, variantId);
      if (!variant || variant.product_id !== product.id) {
        res.status(404).json({ error: 'Không tìm thấy biến thể' });
        return;
      }
    }
    let channel: string | null = null;
    if (body.channel !== undefined && body.channel !== null) {
      if (typeof body.channel !== 'string' || !isAllowedChannel(body.channel)) {
        res.status(400).json({ error: 'Kênh bán không hợp lệ (chỉ counter/web/api)' });
        return;
      }
      channel = body.channel;
    }
    let branchId: number | null = null;
    if (body.branch_id !== undefined && body.branch_id !== null) {
      branchId = Number(body.branch_id);
      if (!Number.isInteger(branchId)) {
        res.status(400).json({ error: 'branch_id không hợp lệ' });
        return;
      }
      const branch = db.prepare('SELECT org_id FROM branches WHERE id = ?').get(branchId) as
        | { org_id: number }
        | undefined;
      if (!branch || branch.org_id !== actor.orgId) {
        res.status(403).json({ error: 'Chi nhánh không thuộc doanh nghiệp của bạn' });
        return;
      }
    }
    if (channel === null && branchId === null) {
      res.status(400).json({ error: 'Giá riêng phải ghi rõ kênh hoặc chi nhánh (hoặc cả hai)' });
      return;
    }
    const price = body.price as number;
    const reason = (body.reason as string).trim();
    // UNIQUE + NULL trên SQLite không chặn trùng tổ hợp (variant/channel/
    // branch) nên kiểm tra trùng ở tầng service trong cùng transaction.
    const existing = (
      db.prepare('SELECT * FROM product_prices WHERE product_id = ?').all(product.id) as unknown as PriceRow[]
    ).find(
      (r) =>
        (r.variant_id ?? null) === variantId &&
        (r.channel ?? null) === channel &&
        (r.branch_id ?? null) === branchId,
    );
    const now = new Date().toISOString();
    const scope = priceScope(channel, branchId);
    if (existing) {
      if (existing.price === price) {
        res.status(400).json({ error: 'Giá mới trùng giá hiện tại' });
        return;
      }
      db.prepare('UPDATE product_prices SET price = ?, updated_at = ? WHERE id = ?').run(
        price,
        now,
        existing.id,
      );
      writePriceHistory(
        db, actor.orgId, product.id, variantId, scope, channel, branchId,
        existing.price, price, actor.id, reason,
      );
      writeAudit(db, actor.orgId, actor.id, 'change-price', {
        target_product_id: product.id,
        before: { variant_id: variantId, channel, branch_id: branchId, price: existing.price },
        after: { variant_id: variantId, channel, branch_id: branchId, price, reason },
      });
      const updated = db.prepare('SELECT * FROM product_prices WHERE id = ?').get(existing.id) as unknown as PriceRow;
      res.status(201).json(updated);
      return;
    }
    const id = Number(
      db
        .prepare(
          `INSERT INTO product_prices (org_id, product_id, variant_id, channel, branch_id, price, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(actor.orgId, product.id, variantId, channel, branchId, price, now, now).lastInsertRowid,
    );
    writePriceHistory(
      db, actor.orgId, product.id, variantId, scope, channel, branchId,
      null, price, actor.id, reason,
    );
    writeAudit(db, actor.orgId, actor.id, 'change-price', {
      target_product_id: product.id,
      before: { variant_id: variantId, channel, branch_id: branchId, price: null },
      after: { variant_id: variantId, channel, branch_id: branchId, price, reason },
    });
    const created = db.prepare('SELECT * FROM product_prices WHERE id = ?').get(id) as unknown as PriceRow;
    res.status(201).json(created);
  });

  app.get('/api/products/:id/prices', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const productId = Number(req.params.id);
    if (!Number.isInteger(productId)) {
      res.status(400).json({ error: 'id không hợp lệ' });
      return;
    }
    const product = getProductById(db, productId);
    if (!product) {
      res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
      return;
    }
    if (product.org_id !== actor.orgId) {
      res.status(403).json({ error: 'Không được truy cập dữ liệu ngoài doanh nghiệp của bạn' });
      return;
    }
    let rows = db
      .prepare('SELECT * FROM product_prices WHERE product_id = ? ORDER BY id')
      .all(product.id) as unknown as PriceRow[];
    // User bị giới hạn chi nhánh chỉ thấy giá áp mọi chi nhánh + giá đúng
    // chi nhánh của mình; owner/manager thấy mọi chi nhánh.
    if (actor.role !== 'owner' && actor.role !== 'manager' && actor.branchId !== null) {
      rows = rows.filter((r) => r.branch_id === null || r.branch_id === actor.branchId);
    }
    res.json(rows);
  });

  app.get('/api/products/:id/price', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const productId = Number(req.params.id);
    if (!Number.isInteger(productId)) {
      res.status(400).json({ error: 'id không hợp lệ' });
      return;
    }
    const product = getProductById(db, productId);
    if (!product) {
      res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
      return;
    }
    if (product.org_id !== actor.orgId) {
      res.status(403).json({ error: 'Không được truy cập dữ liệu ngoài doanh nghiệp của bạn' });
      return;
    }
    const channel = typeof req.query.channel === 'string' ? req.query.channel : null;
    let branchId: number | null = null;
    if (req.query.branch_id !== undefined) {
      branchId = Number(req.query.branch_id);
      if (!Number.isInteger(branchId)) {
        res.status(400).json({ error: 'branch_id không hợp lệ' });
        return;
      }
      if (!can(actor, 'view-branch-price', { orgId: actor.orgId, branchId })) {
        res.status(403).json({ error: 'Bạn không được xem giá riêng của chi nhánh này' });
        return;
      }
    }
    let variantId: number | null = null;
    let variant: VariantRow | undefined;
    if (req.query.variant_id !== undefined) {
      variantId = Number(req.query.variant_id);
      if (!Number.isInteger(variantId)) {
        res.status(400).json({ error: 'variant_id không hợp lệ' });
        return;
      }
      variant = getVariantById(db, variantId);
      if (!variant || variant.product_id !== product.id) {
        res.status(404).json({ error: 'Không tìm thấy biến thể' });
        return;
      }
    }
    // Gia hieu dung qua ham resolve dung chung (D20): route gia va luong
    // tao don (snapshot gia) cung dung resolveEffectivePrice().
    const result = resolveEffectivePrice(db, {
      productId: product.id,
      basePrice: product.price,
      variantId,
      variantOverride: variant?.price_override ?? null,
      channel,
      branchId,
    });
    res.json({
      product_id: product.id,
      variant_id: variantId,
      channel,
      branch_id: branchId,
      price: result.price,
      source: result.source,
    });
  });

  app.get('/api/products/:id/price-history', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const product = loadProductFor(req, res, 'view-price-history');
    if (!product) return;
    const rows = db
      .prepare('SELECT * FROM price_history WHERE product_id = ? ORDER BY id DESC')
      .all(product.id) as unknown as Record<string, unknown>[];
    res.json(rows);
  });

  interface CsvImportRow {
    code: string;
    name: string;
    price: number;
    unit: string;
    min_stock: number;
    status: 'active' | 'discontinued';
    category: string;
    barcode: string;
  }

  interface CsvRowError {
    line: number;
    reason: string;
  }

  function parseIntCell(value: string | undefined): number | null {
    if (value === undefined) return null;
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) return null;
    return Number(trimmed);
  }

  /** Validate toàn bộ dòng CSV trước khi ghi. Trả valid + lỗi từng dòng. */
  function validateCsvRows(
    db: DatabaseSync,
    orgId: number,
    rows: { line: number; record: Record<string, string> }[],
  ): { valid: (CsvImportRow & { line: number })[]; errors: CsvRowError[] } {
    const errors: CsvRowError[] = [];
    const codeCounts = new Map<string, number>();
    for (const { record } of rows) {
      const code = (record.code ?? '').trim();
      if (code !== '') codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
    }
    const existingCodes = new Set(
      (
        db.prepare('SELECT code FROM products WHERE org_id = ?').all(orgId) as { code: string }[]
      ).map((r) => r.code),
    );
    const valid: (CsvImportRow & { line: number })[] = [];
    for (const { line, record } of rows) {
      const code = (record.code ?? '').trim();
      const name = (record.name ?? '').trim();
      const unit = (record.unit ?? '').trim();
      const priceRaw = (record.price ?? '').trim();
      const minStockRaw = (record.min_stock ?? '').trim();
      const statusRaw = (record.status ?? '').trim();
      const category = (record.category ?? '').trim();
      const barcode = (record.barcode ?? '').trim();
      const rowErrors: string[] = [];
      if (code === '') rowErrors.push('thiếu mã sản phẩm (code)');
      else if ((codeCounts.get(code) ?? 0) > 1) rowErrors.push(`mã ${code} trùng nhau trong file`);
      else if (existingCodes.has(code)) rowErrors.push(`mã ${code} đã tồn tại trong doanh nghiệp (trùng mã)`);
      if (name === '') rowErrors.push('thiếu tên sản phẩm (name)');
      const price = parseIntCell(priceRaw);
      if (price === null) rowErrors.push(`giá ${priceRaw === '' ? '(trống)' : priceRaw} không phải số nguyên`);
      else if (price < 0) rowErrors.push(`giá ${price} âm, phải >= 0`);
      if (unit === '') rowErrors.push('thiếu đơn vị tính (unit)');
      let minStock = 0;
      if (minStockRaw !== '') {
        const parsed = parseIntCell(minStockRaw);
        if (parsed === null || parsed < 0) rowErrors.push(`min_stock ${minStockRaw} phải là số nguyên >= 0`);
        else minStock = parsed;
      }
      let status: 'active' | 'discontinued' = 'active';
      if (statusRaw !== '') {
        if (statusRaw !== 'active' && statusRaw !== 'discontinued') {
          rowErrors.push(`status ${statusRaw} không hợp lệ (chỉ active/discontinued)`);
        } else {
          status = statusRaw;
        }
      }
      if (rowErrors.length > 0) {
        for (const reason of rowErrors) errors.push({ line, reason });
        continue;
      }
      valid.push({
        line, code, name, price: price as number, unit, min_stock: minStock, status, category, barcode,
      });
    }
    return { valid, errors };
  }

  const CSV_REQUIRED_COLUMNS = ['code', 'name', 'price', 'unit'];

  function readCsvUpload(
    req: TenantRequest,
    res: Response,
  ): { header: string[]; rows: { line: number; record: Record<string, string> }[] } | null {
    const file = (req as unknown as { file?: { buffer: Buffer; originalname: string } }).file;
    if (!file) {
      res.status(400).json({ error: 'Thiếu file CSV (multipart field file)' });
      return null;
    }
    const text = file.buffer.toString('utf8');
    if (text.trim() === '') {
      res.status(400).json({ error: 'File CSV rỗng' });
      return null;
    }
    let parsed: { header: string[]; rows: { line: number; record: Record<string, string> }[] };
    try {
      parsed = parseProductCsvWithLines(text);
    } catch {
      res.status(400).json({ error: 'File CSV không đọc được' });
      return null;
    }
    const missing = CSV_REQUIRED_COLUMNS.filter((c) => !parsed.header.includes(c));
    if (missing.length > 0) {
      res.status(400).json({ error: `Header thiếu cột bắt buộc: ${missing.join(', ')}` });
      return null;
    }
    return parsed;
  }

  app.post(
    '/api/products/import/preview',
    requireAuth,
    uploadCsv.single('file'),
    (req: TenantRequest, res: Response) => {
      const actor = req.user as SessionUser;
      if (!can(actor, 'import-csv', { orgId: actor.orgId })) {
        res.status(403).json({ error: 'Bạn không được phép nhập CSV' });
        return;
      }
      const parsed = readCsvUpload(req, res);
      if (!parsed) return;
      const { valid, errors } = validateCsvRows(db, actor.orgId, parsed.rows);
      res.json({
        valid,
        errors,
        summary: { total: parsed.rows.length, valid: valid.length, errors: errors.length },
      });
    },
  );

  app.post(
    '/api/products/import',
    requireAuth,
    uploadCsv.single('file'),
    (req: TenantRequest, res: Response) => {
      const actor = req.user as SessionUser;
      if (!can(actor, 'import-csv', { orgId: actor.orgId })) {
        res.status(403).json({ error: 'Bạn không được phép nhập CSV' });
        return;
      }
      const parsed = readCsvUpload(req, res);
      if (!parsed) return;
      if (parsed.rows.length > 1000) {
        res.status(400).json({ error: 'File CSV vượt quá 1000 dòng' });
        return;
      }
      const { valid, errors } = validateCsvRows(db, actor.orgId, parsed.rows);
      if (errors.length > 0) {
        res.status(422).json({ errors });
        return;
      }
      const filename =
        (req as unknown as { file?: { originalname: string } }).file?.originalname ?? 'import.csv';
      const now = new Date().toISOString();
      const importedCodes: string[] = [];
      try {
        db.exec('BEGIN IMMEDIATE');
        for (const row of valid) {
          let categoryId: number | null = null;
          if (row.category !== '') {
            const found = db
              .prepare('SELECT id FROM categories WHERE org_id = ? AND name = ?')
              .get(actor.orgId, row.category) as { id: number } | undefined;
            if (found) {
              categoryId = found.id;
            } else {
              categoryId = Number(
                db
                  .prepare(
                    'INSERT INTO categories (org_id, name, parent_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)',
                  )
                  .run(actor.orgId, row.category, now, now).lastInsertRowid,
              );
            }
          }
          db.prepare(
            `INSERT INTO products (org_id, code, name, unit, price, min_stock, status, category_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            actor.orgId, row.code, row.name, row.unit, row.price,
            row.min_stock, row.status, categoryId, now, now,
          );
          importedCodes.push(row.code);
        }
        writeAudit(db, actor.orgId, actor.id, 'import-csv', {
          target_product_id: null,
          before: null,
          after: { imported: valid.length, filename, codes: importedCodes },
        });
        db.exec('COMMIT');
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // Đã rollback hoặc chưa BEGIN: bỏ qua.
        }
        throw err;
      }
      res.status(201).json({ imported: valid.length });
    },
  );

  app.get('/api/products/export', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    if (!can(actor, 'export-csv', { orgId: actor.orgId })) {
      res.status(403).json({ error: 'Bạn không được phép xuất CSV' });
      return;
    }
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const categoryId =
      typeof req.query.category_id === 'string' ? Number(req.query.category_id) : undefined;
    let sql = 'SELECT * FROM products WHERE org_id = ?';
    const params: (string | number)[] = [actor.orgId];
    if (status !== undefined) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (categoryId !== undefined && Number.isInteger(categoryId)) {
      sql += ' AND category_id = ?';
      params.push(categoryId);
    }
    sql += ' ORDER BY id';
    const products = db.prepare(sql).all(...params) as unknown as ProductRow[];
    const rows = products.map((p) => {
      const category =
        p.category_id === null ? '' : (getCategoryById(db, p.category_id)?.name ?? '');
      const barcodeRow = db
        .prepare(
          'SELECT barcode FROM product_variants WHERE product_id = ? AND barcode IS NOT NULL ORDER BY id LIMIT 1',
        )
        .get(p.id) as { barcode: string } | undefined;
      return {
        code: p.code,
        name: p.name,
        price: p.price,
        unit: p.unit,
        min_stock: p.min_stock,
        status: p.status,
        category,
        barcode: barcodeRow?.barcode ?? '',
      };
    });
    const csv = stringify(rows, {
      header: true,
      columns: ['code', 'name', 'price', 'unit', 'min_stock', 'status', 'category', 'barcode'],
    });
    res.type('text/csv; charset=utf-8').send(csv);
  });

  app.get('/api/products/:id', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const productId = Number(req.params.id);
    if (!Number.isInteger(productId)) {
      res.status(400).json({ error: 'id không hợp lệ' });
      return;
    }
    const product = getProductById(db, productId);
    if (!product) {
      res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
      return;
    }
    if (product.org_id !== actor.orgId) {
      res.status(403).json({ error: 'Không được truy cập dữ liệu ngoài doanh nghiệp của bạn' });
      return;
    }
    res.json(productDetail(db, product));
  });

  app.patch('/api/products/:id', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const product = loadProductFor(req, res, 'update-product');
    if (!product) return;
    const body = req.body as {
      name?: unknown;
      unit?: unknown;
      price?: unknown;
      min_stock?: unknown;
      category_id?: unknown;
      reason?: unknown;
    };
    const before: Record<string, unknown> = {
      name: product.name,
      unit: product.unit,
      price: product.price,
      min_stock: product.min_stock,
      category_id: product.category_id,
    };
    let nextName = product.name;
    let nextUnit = product.unit;
    let nextMinStock = product.min_stock;
    let nextCategoryId = product.category_id;
    let nextPrice = product.price;
    let priceChanged = false;
    if (body.name !== undefined) {
      if (!isNonEmptyString(body.name)) {
        res.status(400).json({ error: 'Tên sản phẩm bắt buộc' });
        return;
      }
      nextName = (body.name as string).trim();
    }
    if (body.unit !== undefined) {
      if (!isNonEmptyString(body.unit)) {
        res.status(400).json({ error: 'Đơn vị tính bắt buộc' });
        return;
      }
      nextUnit = (body.unit as string).trim();
    }
    if (body.min_stock !== undefined) {
      if (!isIntMoney(body.min_stock)) {
        res.status(400).json({ error: 'min_stock phải là số nguyên >= 0' });
        return;
      }
      nextMinStock = body.min_stock as number;
    }
    if (body.category_id !== undefined) {
      if (body.category_id === null) {
        nextCategoryId = null;
      } else {
        nextCategoryId = Number(body.category_id);
        if (!Number.isInteger(nextCategoryId)) {
          res.status(400).json({ error: 'category_id không hợp lệ' });
          return;
        }
        const category = getCategoryById(db, nextCategoryId);
        if (!category) {
          res.status(404).json({ error: 'Không tìm thấy danh mục' });
          return;
        }
        if (category.org_id !== actor.orgId) {
          res.status(403).json({ error: 'Danh mục không thuộc doanh nghiệp của bạn' });
          return;
        }
      }
    }
    if (body.price !== undefined) {
      if (!isIntMoney(body.price)) {
        res.status(400).json({ error: 'Giá bán phải là số nguyên đồng >= 0' });
        return;
      }
      if (!isNonEmptyString(body.reason)) {
        res.status(400).json({ error: 'Đổi giá bán phải kèm lý do (reason)' });
        return;
      }
      if (product.status === 'discontinued') {
        res.status(400).json({ error: 'Sản phẩm đã ngừng kinh doanh, không được đổi giá mới' });
        return;
      }
      if (body.price === product.price) {
        res.status(400).json({ error: 'Giá mới trùng giá hiện tại' });
        return;
      }
      nextPrice = body.price as number;
      priceChanged = true;
    }
    db.prepare(
      'UPDATE products SET name = ?, unit = ?, price = ?, min_stock = ?, category_id = ?, updated_at = ? WHERE id = ?',
    ).run(nextName, nextUnit, nextPrice, nextMinStock, nextCategoryId, new Date().toISOString(), product.id);
    const after = { name: nextName, unit: nextUnit, price: nextPrice, min_stock: nextMinStock, category_id: nextCategoryId };
    if (priceChanged) {
      writePriceHistory(
        db,
        actor.orgId,
        product.id,
        null,
        'base',
        null,
        null,
        product.price,
        nextPrice,
        actor.id,
        (body.reason as string).trim(),
      );
      writeAudit(db, actor.orgId, actor.id, 'change-price', {
        target_product_id: product.id,
        before: { price: product.price },
        after: { price: nextPrice, reason: (body.reason as string).trim() },
      });
    } else {
      writeAudit(db, actor.orgId, actor.id, 'update-product', {
        target_product_id: product.id,
        before,
        after,
      });
    }
    res.json(getProductById(db, product.id) as ProductRow);
  });

  app.patch('/api/products/:id/status', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const product = loadProductFor(req, res, 'discontinue-product');
    if (!product) return;
    const status = (req.body as { status?: unknown }).status;
    if (status !== 'active' && status !== 'discontinued') {
      res.status(400).json({ error: 'status phải là active hoặc discontinued' });
      return;
    }
    const before = { status: product.status };
    db.prepare('UPDATE products SET status = ?, updated_at = ? WHERE id = ?').run(
      status,
      new Date().toISOString(),
      product.id,
    );
    writeAudit(db, actor.orgId, actor.id, status === 'discontinued' ? 'discontinue-product' : 'reopen-product', {
      target_product_id: product.id,
      before,
      after: { status },
    });
    res.json(getProductById(db, product.id) as ProductRow);
  });

  app.post('/api/products/:id/variants', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const product = loadProductFor(req, res, 'create-product');
    if (!product) return;
    if (product.status === 'discontinued') {
      res.status(400).json({ error: 'Sản phẩm đã ngừng kinh doanh, không được tạo biến thể mới' });
      return;
    }
    const body = req.body as { sku?: unknown; name?: unknown; barcode?: unknown; price_override?: unknown };
    if (!isNonEmptyString(body.sku)) {
      res.status(400).json({ error: 'SKU bắt buộc' });
      return;
    }
    if (!isNonEmptyString(body.name)) {
      res.status(400).json({ error: 'Tên biến thể bắt buộc' });
      return;
    }
    let priceOverride: number | null = null;
    if (body.price_override !== undefined && body.price_override !== null) {
      if (!isIntMoney(body.price_override)) {
        res.status(400).json({ error: 'price_override phải là số nguyên đồng >= 0' });
        return;
      }
      priceOverride = body.price_override as number;
    }
    let barcode: string | null = null;
    if (body.barcode !== undefined && body.barcode !== null) {
      if (typeof body.barcode !== 'string' || body.barcode.trim().length === 0) {
        res.status(400).json({ error: 'barcode không hợp lệ' });
        return;
      }
      barcode = (body.barcode as string).trim();
    }
    const sku = (body.sku as string).trim();
    const dupSku = db
      .prepare('SELECT id FROM product_variants WHERE org_id = ? AND sku = ?')
      .get(actor.orgId, sku);
    if (dupSku) {
      res.status(409).json({ error: `SKU ${sku} đã tồn tại trong doanh nghiệp` });
      return;
    }
    if (barcode !== null) {
      const dupBarcode = db
        .prepare('SELECT id FROM product_variants WHERE org_id = ? AND barcode = ?')
        .get(actor.orgId, barcode);
      if (dupBarcode) {
        res.status(409).json({ error: `Mã vạch ${barcode} đã tồn tại trong doanh nghiệp` });
        return;
      }
    }
    const now = new Date().toISOString();
    const id = Number(
      db
        .prepare(
          `INSERT INTO product_variants (org_id, product_id, sku, name, barcode, price_override, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(actor.orgId, product.id, sku, (body.name as string).trim(), barcode, priceOverride, now, now)
        .lastInsertRowid,
    );
    const created = getVariantById(db, id) as VariantRow;
    writeAudit(db, actor.orgId, actor.id, 'create-variant', {
      target_product_id: product.id,
      before: null,
      after: { variant_id: id, sku, name: created.name, barcode, price_override: priceOverride },
    });
    res.status(201).json(created);
  });

  app.get('/api/products/:id/variants', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const productId = Number(req.params.id);
    if (!Number.isInteger(productId)) {
      res.status(400).json({ error: 'id không hợp lệ' });
      return;
    }
    const product = getProductById(db, productId);
    if (!product) {
      res.status(404).json({ error: 'Không tìm thấy sản phẩm' });
      return;
    }
    if (product.org_id !== actor.orgId) {
      res.status(403).json({ error: 'Không được truy cập dữ liệu ngoài doanh nghiệp của bạn' });
      return;
    }
    const rows = db
      .prepare('SELECT * FROM product_variants WHERE product_id = ? ORDER BY id')
      .all(product.id) as unknown as VariantRow[];
    res.json(rows);
  });

  app.patch(
    '/api/products/:id/variants/:variantId',
    requireAuth,
    (req: TenantRequest, res: Response) => {
      const actor = req.user as SessionUser;
      const product = loadProductFor(req, res, 'update-product');
      if (!product) return;
      const variantId = Number(req.params.variantId);
      if (!Number.isInteger(variantId)) {
        res.status(400).json({ error: 'variantId không hợp lệ' });
        return;
      }
      const variant = getVariantById(db, variantId);
      if (!variant || variant.product_id !== product.id) {
        res.status(404).json({ error: 'Không tìm thấy biến thể' });
        return;
      }
      const body = req.body as { name?: unknown; barcode?: unknown; price_override?: unknown };
      let nextName = variant.name;
      let nextBarcode = variant.barcode;
      let nextOverride = variant.price_override;
      let overrideChanged = false;
      if (body.name !== undefined) {
        if (!isNonEmptyString(body.name)) {
          res.status(400).json({ error: 'Tên biến thể bắt buộc' });
          return;
        }
        nextName = (body.name as string).trim();
      }
      if (body.barcode !== undefined) {
        if (body.barcode === null) {
          nextBarcode = null;
        } else {
          if (typeof body.barcode !== 'string' || body.barcode.trim().length === 0) {
            res.status(400).json({ error: 'barcode không hợp lệ' });
            return;
          }
          nextBarcode = (body.barcode as string).trim();
          if (nextBarcode !== variant.barcode) {
            const dup = db
              .prepare('SELECT id FROM product_variants WHERE org_id = ? AND barcode = ? AND id <> ?')
              .get(actor.orgId, nextBarcode, variant.id);
            if (dup) {
              res.status(409).json({ error: `Mã vạch ${nextBarcode} đã tồn tại trong doanh nghiệp` });
              return;
            }
          }
        }
      }
      if (body.price_override !== undefined) {
        if (body.price_override === null) {
          nextOverride = null;
        } else {
          if (!isIntMoney(body.price_override)) {
            res.status(400).json({ error: 'price_override phải là số nguyên đồng >= 0' });
            return;
          }
          nextOverride = body.price_override as number;
        }
        if (nextOverride !== variant.price_override) {
          if (product.status === 'discontinued') {
            res.status(400).json({ error: 'Sản phẩm đã ngừng kinh doanh, không được đổi giá mới' });
            return;
          }
          overrideChanged = true;
        }
      }
      db.prepare(
        'UPDATE product_variants SET name = ?, barcode = ?, price_override = ?, updated_at = ? WHERE id = ?',
      ).run(nextName, nextBarcode, nextOverride, new Date().toISOString(), variant.id);
      if (overrideChanged && nextOverride !== null) {
        writePriceHistory(
          db,
          actor.orgId,
          product.id,
          variant.id,
          'variant_override',
          null,
          null,
          variant.price_override,
          nextOverride,
          actor.id,
          'đổi giá override biến thể',
        );
        writeAudit(db, actor.orgId, actor.id, 'change-price', {
          target_product_id: product.id,
          before: { variant_id: variant.id, price_override: variant.price_override },
          after: { variant_id: variant.id, price_override: nextOverride },
        });
      } else {
        writeAudit(db, actor.orgId, actor.id, 'update-variant', {
          target_product_id: product.id,
          before: { name: variant.name, barcode: variant.barcode, price_override: variant.price_override },
          after: { name: nextName, barcode: nextBarcode, price_override: nextOverride },
        });
      }
      res.json(getVariantById(db, variant.id) as VariantRow);
    },
  );

  app.post('/api/products/:id/attributes', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const product = loadProductFor(req, res, 'update-product');
    if (!product) return;
    const body = req.body as { key?: unknown; value?: unknown };
    if (!isNonEmptyString(body.key)) {
      res.status(400).json({ error: 'key thuộc tính bắt buộc' });
      return;
    }
    if (typeof body.value !== 'string') {
      res.status(400).json({ error: 'value thuộc tính bắt buộc' });
      return;
    }
    const now = new Date().toISOString();
    const id = Number(
      db
        .prepare('INSERT INTO product_attributes (product_id, key, value, created_at) VALUES (?, ?, ?, ?)')
        .run(product.id, (body.key as string).trim(), body.value as string, now).lastInsertRowid,
    );
    const created = db.prepare('SELECT * FROM product_attributes WHERE id = ?').get(id) as Record<
      string,
      unknown
    >;
    writeAudit(db, actor.orgId, actor.id, 'update-product', {
      target_product_id: product.id,
      before: null,
      after: { attribute_id: id, key: (body.key as string).trim(), value: body.value },
    });
    res.status(201).json(created);
  });

  app.delete(
    '/api/products/:id/attributes/:attrId',
    requireAuth,
    (req: TenantRequest, res: Response) => {
      const actor = req.user as SessionUser;
      const product = loadProductFor(req, res, 'update-product');
      if (!product) return;
      const attrId = Number(req.params.attrId);
      if (!Number.isInteger(attrId)) {
        res.status(400).json({ error: 'attrId không hợp lệ' });
        return;
      }
      const attr = db.prepare('SELECT * FROM product_attributes WHERE id = ?').get(attrId) as
        | { id: number; product_id: number; key: string }
        | undefined;
      if (!attr || attr.product_id !== product.id) {
        res.status(404).json({ error: 'Không tìm thấy thuộc tính' });
        return;
      }
      db.prepare('DELETE FROM product_attributes WHERE id = ?').run(attrId);
      writeAudit(db, actor.orgId, actor.id, 'update-product', {
        target_product_id: product.id,
        before: { attribute_id: attrId, key: attr.key },
        after: null,
      });
      res.json({ ok: true });
    },
  );

  app.post('/api/products/:id/images', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const product = loadProductFor(req, res, 'update-product');
    if (!product) return;
    const body = req.body as { url?: unknown; alt_text?: unknown; sort_order?: unknown };
    if (!isNonEmptyString(body.url)) {
      res.status(400).json({ error: 'url ảnh bắt buộc (chỉ metadata/đường dẫn, không upload file)' });
      return;
    }
    const altText =
      body.alt_text === undefined || body.alt_text === null ? null : String(body.alt_text);
    let sortOrder = 0;
    if (body.sort_order !== undefined) {
      if (typeof body.sort_order !== 'number' || !Number.isInteger(body.sort_order)) {
        res.status(400).json({ error: 'sort_order phải là số nguyên' });
        return;
      }
      sortOrder = body.sort_order;
    }
    const now = new Date().toISOString();
    const id = Number(
      db
        .prepare(
          'INSERT INTO product_images (product_id, url, alt_text, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(product.id, (body.url as string).trim(), altText, sortOrder, now).lastInsertRowid,
    );
    const created = db.prepare('SELECT * FROM product_images WHERE id = ?').get(id) as Record<
      string,
      unknown
    >;
    writeAudit(db, actor.orgId, actor.id, 'update-product', {
      target_product_id: product.id,
      before: null,
      after: { image_id: id, url: (body.url as string).trim() },
    });
    res.status(201).json(created);
  });

  app.delete(
    '/api/products/:id/images/:imageId',
    requireAuth,
    (req: TenantRequest, res: Response) => {
      const actor = req.user as SessionUser;
      const product = loadProductFor(req, res, 'update-product');
      if (!product) return;
      const imageId = Number(req.params.imageId);
      if (!Number.isInteger(imageId)) {
        res.status(400).json({ error: 'imageId không hợp lệ' });
        return;
      }
      const image = db.prepare('SELECT * FROM product_images WHERE id = ?').get(imageId) as
        | { id: number; product_id: number; url: string }
        | undefined;
      if (!image || image.product_id !== product.id) {
        res.status(404).json({ error: 'Không tìm thấy ảnh' });
        return;
      }
      db.prepare('DELETE FROM product_images WHERE id = ?').run(imageId);
      writeAudit(db, actor.orgId, actor.id, 'update-product', {
        target_product_id: product.id,
        before: { image_id: imageId, url: image.url },
        after: null,
      });
      res.json({ ok: true });
    },
  );

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

  // ---------- Kho / tồn (GOAL-004) ----------
  // KHÔNG có endpoint DELETE kho và KHÔNG có API sửa/xóa lịch sử biến động
  // (PATCH/DELETE /api/stock/movements/:id): gọi các route đó trả 404 mặc
  // định của Express. Mọi thao tác tồn chạy trong transaction BEGIN
  // IMMEDIATE (xem src/stock.ts) + audit_log.

  interface WarehouseRow {
    id: number;
    org_id: number;
    name: string;
    branch_id: number | null;
    status: 'active' | 'inactive';
    created_at: string;
    updated_at: string;
  }

  function getWarehouseById(id: number): WarehouseRow | undefined {
    return db.prepare('SELECT * FROM warehouses WHERE id = ?').get(id) as WarehouseRow | undefined;
  }

  function isPosInt(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
  }

  function parseQueryInt(value: unknown): number | null {
    if (typeof value !== 'string') return null;
    const n = Number(value);
    return Number.isInteger(n) ? n : null;
  }

  /** Ảnh chụp mức tồn (dùng cho audit before/after); chưa có dòng tồn = 0/0. */
  function levelSnapshot(level: StockLevelRow | null): { on_hand: number; reserved: number } {
    return level ? { on_hand: level.on_hand, reserved: level.reserved } : { on_hand: 0, reserved: 0 };
  }

  function auditStockOp(
    actor: SessionUser,
    action: string,
    warehouseId: number,
    variantId: number,
    before: { on_hand: number; reserved: number } | null,
    after: { on_hand: number; reserved: number },
    extra: Record<string, unknown> = {},
  ): void {
    writeAudit(db, actor.orgId, actor.id, action, {
      target_warehouse_id: warehouseId,
      target_variant_id: variantId,
      before,
      after,
      ...extra,
    });
  }

  /** Tải kho theo id thô (body): thiếu/không nguyên -> 400, không thấy -> 404, ngoài org -> 403. */
  function loadWarehouse(res: Response, actor: SessionUser, raw: unknown): WarehouseRow | null {
    if (typeof raw !== 'number' || !Number.isInteger(raw)) {
      res.status(400).json({ error: 'warehouse_id không hợp lệ' });
      return null;
    }
    const wh = getWarehouseById(raw);
    if (!wh) {
      res.status(404).json({ error: 'Không tìm thấy kho' });
      return null;
    }
    if (wh.org_id !== actor.orgId) {
      res.status(403).json({ error: 'Kho không thuộc doanh nghiệp của bạn' });
      return null;
    }
    return wh;
  }

  /** Tải biến thể theo id thô (body): thiếu -> 400, không thấy -> 404, ngoài org -> 403. */
  function loadVariant(res: Response, actor: SessionUser, raw: unknown): VariantRow | null {
    if (raw === undefined || raw === null) {
      res.status(400).json({ error: 'variant_id bắt buộc (tồn theo biến thể, không có biến thể thì không nhập kho được)' });
      return null;
    }
    if (typeof raw !== 'number' || !Number.isInteger(raw)) {
      res.status(400).json({ error: 'variant_id không hợp lệ' });
      return null;
    }
    const variant = getVariantById(db, raw);
    if (!variant) {
      res.status(404).json({ error: 'Không tìm thấy biến thể' });
      return null;
    }
    if (variant.org_id !== actor.orgId) {
      res.status(403).json({ error: 'Biến thể không thuộc doanh nghiệp của bạn' });
      return null;
    }
    return variant;
  }

  /** Map lỗi nghiệp vụ kho (xem src/stock.ts) sang HTTP. */
  function stockFail(res: Response, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('insufficient_stock')) {
      res.status(400).json({ error: msg, code: 'insufficient_stock' });
      return;
    }
    if (msg.startsWith('invalid_stock')) {
      res.status(400).json({ error: msg, code: 'invalid_stock' });
      return;
    }
    if (msg.startsWith('not_found')) {
      res.status(404).json({ error: msg });
      return;
    }
    res.status(500).json({ error: 'Lỗi hệ thống khi xử lý tồn kho' });
  }

  /** Key idempotency có tên miền stock:<loại>:<key>, từ header hoặc body. */
  function stockKey(req: TenantRequest, op: string): string | null {
    const header = req.headers['idempotency-key'];
    const body = req.body as { idempotency_key?: unknown };
    const raw =
      (typeof header === 'string' && header.length > 0 ? header : null) ??
      (typeof body.idempotency_key === 'string' && body.idempotency_key.length > 0
        ? body.idempotency_key
        : null);
    return raw === null ? null : `stock:${op}:${raw}`;
  }

  /** Chạy thao tác tồn: có key thì qua withStockIdempotency (kiểm tra + thực
   * thi + ghi key trong 1 transaction), không key thì chỉ bọc transaction. */
  function runStockOp<T>(
    actor: SessionUser,
    key: string | null,
    execute: () => T,
  ): { replayed: boolean; result: T } {
    if (key !== null) return withStockIdempotency(db, actor.orgId, key, execute);
    return { replayed: false, result: runStockTransaction(db, execute) };
  }

  function respondStock(res: Response, outcome: { replayed: boolean; result: unknown }): void {
    res.json(
      outcome.replayed ? { ...(outcome.result as Record<string, unknown>), replayed: true } : outcome.result,
    );
  }

  /**
   * Tiền kiểm tra chung cho thao tác tồn 1 kho: kho + biến thể tồn tại
   * trong org, đúng vai + đúng phạm vi kho (can), kho đang active.
   */
  function stockPrelude(
    res: Response,
    actor: SessionUser,
    action: 'stock-in' | 'stock-out' | 'stock-adjust' | 'stock-count' | 'stock-reserve' | 'stock-release',
    body: { warehouse_id?: unknown; variant_id?: unknown },
  ): { wh: WarehouseRow; variant: VariantRow } | null {
    const wh = loadWarehouse(res, actor, body.warehouse_id);
    if (!wh) return null;
    const variant = loadVariant(res, actor, body.variant_id);
    if (!variant) return null;
    if (!can(actor, action, { orgId: actor.orgId, warehouseId: wh.id })) {
      res.status(403).json({ error: 'Bạn không được phép thao tác tồn kho này' });
      return null;
    }
    if (wh.status !== 'active') {
      res.status(400).json({ error: 'Kho không hoạt động, không nhận thao tác tồn mới', code: 'warehouse_inactive' });
      return null;
    }
    return { wh, variant };
  }

  /** Thực thi 1 biến động tồn (1 kho) + audit, trả mức tồn mới. */
  function execSingleMovement(
    actor: SessionUser,
    ctx: { wh: WarehouseRow; variant: VariantRow },
    type: StockMovementType,
    action: string,
    qtyChange: number,
    reservedChange: number,
    reason: string,
    reference: string | null,
  ): StockLevelRow {
    const before = levelSnapshot(stockLevel(db, actor.orgId, ctx.wh.id, ctx.variant.id));
    const level = applyMovement(db, actor.orgId, actor.id, {
      warehouse_id: ctx.wh.id,
      variant_id: ctx.variant.id,
      type,
      qty_change: qtyChange,
      reserved_change: reservedChange,
      reason,
      reference,
    });
    auditStockOp(actor, action, ctx.wh.id, ctx.variant.id, before, {
      on_hand: level.on_hand,
      reserved: level.reserved,
    }, { reason: reason.trim(), reference });
    return level;
  }

  // ----- Kho: tạo / liệt kê / chi tiết / sửa (chỉ owner tạo/sửa) -----

  app.post('/api/warehouses', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    if (!can(actor, 'create-warehouse', { orgId: actor.orgId })) {
      res.status(403).json({ error: 'Chỉ chủ doanh nghiệp được tạo kho' });
      return;
    }
    const body = req.body as { name?: unknown; branch_id?: unknown; status?: unknown };
    if (!isNonEmptyString(body.name)) {
      res.status(400).json({ error: 'Tên kho bắt buộc' });
      return;
    }
    let branchId: number | null = null;
    if (body.branch_id !== undefined && body.branch_id !== null) {
      if (typeof body.branch_id !== 'number' || !Number.isInteger(body.branch_id)) {
        res.status(400).json({ error: 'branch_id không hợp lệ' });
        return;
      }
      branchId = body.branch_id;
      const branch = db.prepare('SELECT org_id FROM branches WHERE id = ?').get(branchId) as
        | { org_id: number }
        | undefined;
      if (!branch) {
        res.status(404).json({ error: 'Không tìm thấy chi nhánh' });
        return;
      }
      if (branch.org_id !== actor.orgId) {
        res.status(403).json({ error: 'Chi nhánh không thuộc doanh nghiệp của bạn' });
        return;
      }
    }
    let status: 'active' | 'inactive' = 'active';
    if (body.status !== undefined) {
      if (body.status !== 'active' && body.status !== 'inactive') {
        res.status(400).json({ error: 'status không hợp lệ (chỉ active/inactive)' });
        return;
      }
      status = body.status;
    }
    const now = new Date().toISOString();
    const id = Number(
      db
        .prepare(
          'INSERT INTO warehouses (org_id, name, branch_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(actor.orgId, (body.name as string).trim(), branchId, status, now, now).lastInsertRowid,
    );
    const created = getWarehouseById(id) as WarehouseRow;
    writeAudit(db, actor.orgId, actor.id, 'create-warehouse', {
      target_warehouse_id: id,
      before: null,
      after: { name: created.name, branch_id: created.branch_id, status: created.status, org_id: created.org_id },
    });
    res.status(201).json(created);
  });

  app.get('/api/warehouses', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const branchId = parseQueryInt(req.query.branch_id);
    let sql = 'SELECT * FROM warehouses WHERE org_id = ?';
    const params: (number | string)[] = [actor.orgId];
    if (status !== undefined) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (branchId !== null) {
      sql += ' AND branch_id = ?';
      params.push(branchId);
    }
    sql += ' ORDER BY id';
    const rows = db.prepare(sql).all(...params) as unknown as WarehouseRow[];
    res.json(rows);
  });

  app.get('/api/warehouses/:id', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'id không hợp lệ' });
      return;
    }
    const wh = getWarehouseById(id);
    if (!wh) {
      res.status(404).json({ error: 'Không tìm thấy kho' });
      return;
    }
    if (wh.org_id !== actor.orgId) {
      res.status(403).json({ error: 'Kho không thuộc doanh nghiệp của bạn' });
      return;
    }
    res.json(wh);
  });

  app.patch('/api/warehouses/:id', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'id không hợp lệ' });
      return;
    }
    const wh = getWarehouseById(id);
    if (!wh) {
      res.status(404).json({ error: 'Không tìm thấy kho' });
      return;
    }
    if (wh.org_id !== actor.orgId) {
      res.status(403).json({ error: 'Kho không thuộc doanh nghiệp của bạn' });
      return;
    }
    if (!can(actor, 'manage-warehouse', { orgId: actor.orgId, warehouseId: wh.id })) {
      res.status(403).json({ error: 'Chỉ chủ doanh nghiệp được sửa kho' });
      return;
    }
    const body = req.body as { name?: unknown; status?: unknown; branch_id?: unknown };
    const before = { name: wh.name, status: wh.status, branch_id: wh.branch_id };
    let nextName = wh.name;
    if (body.name !== undefined) {
      if (!isNonEmptyString(body.name)) {
        res.status(400).json({ error: 'Tên kho bắt buộc' });
        return;
      }
      nextName = (body.name as string).trim();
    }
    let nextStatus = wh.status;
    if (body.status !== undefined) {
      if (body.status !== 'active' && body.status !== 'inactive') {
        res.status(400).json({ error: 'status không hợp lệ (chỉ active/inactive)' });
        return;
      }
      nextStatus = body.status;
    }
    let nextBranch = wh.branch_id;
    if (body.branch_id !== undefined) {
      if (body.branch_id === null) {
        nextBranch = null;
      } else {
        if (typeof body.branch_id !== 'number' || !Number.isInteger(body.branch_id)) {
          res.status(400).json({ error: 'branch_id không hợp lệ' });
          return;
        }
        nextBranch = body.branch_id;
        const branch = db.prepare('SELECT org_id FROM branches WHERE id = ?').get(nextBranch) as
          | { org_id: number }
          | undefined;
        if (!branch) {
          res.status(404).json({ error: 'Không tìm thấy chi nhánh' });
          return;
        }
        if (branch.org_id !== actor.orgId) {
          res.status(403).json({ error: 'Chi nhánh không thuộc doanh nghiệp của bạn' });
          return;
        }
      }
    }
    db.prepare('UPDATE warehouses SET name = ?, status = ?, branch_id = ?, updated_at = ? WHERE id = ?').run(
      nextName,
      nextStatus,
      nextBranch,
      new Date().toISOString(),
      wh.id,
    );
    writeAudit(db, actor.orgId, actor.id, 'update-warehouse', {
      target_warehouse_id: wh.id,
      before,
      after: { name: nextName, status: nextStatus, branch_id: nextBranch },
    });
    res.json(getWarehouseById(wh.id) as WarehouseRow);
  });

  // ----- Nhập / xuất kho -----

  function stockInOut(type: 'in' | 'out') {
    return (req: TenantRequest, res: Response): void => {
      const actor = req.user as SessionUser;
      const body = req.body as {
        warehouse_id?: unknown;
        variant_id?: unknown;
        qty?: unknown;
        reason?: unknown;
        reference?: unknown;
        idempotency_key?: unknown;
      };
      const ctx = stockPrelude(res, actor, type === 'in' ? 'stock-in' : 'stock-out', body);
      if (!ctx) return;
      const qty = body.qty;
      if (!isPosInt(qty)) {
        res.status(400).json({ error: 'qty phải là số nguyên > 0' });
        return;
      }
      const reason = body.reason;
      if (!isNonEmptyString(reason)) {
        res.status(400).json({ error: 'reason bắt buộc' });
        return;
      }
      const reference = typeof body.reference === 'string' ? body.reference : null;
      try {
        const outcome = runStockOp(actor, stockKey(req, type), () =>
          execSingleMovement(
            actor,
            ctx,
            type,
            type === 'in' ? 'stock-in' : 'stock-out',
            type === 'in' ? qty : -qty,
            0,
            reason,
            reference,
          ),
        );
        respondStock(res, outcome);
      } catch (err) {
        stockFail(res, err);
      }
    };
  }

  app.post('/api/stock/in', requireAuth, stockInOut('in'));
  app.post('/api/stock/out', requireAuth, stockInOut('out'));

  // ----- Điều chỉnh / kiểm kê -----

  app.post('/api/stock/adjust', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const body = req.body as {
      warehouse_id?: unknown;
      variant_id?: unknown;
      qty_change?: unknown;
      reason?: unknown;
      reference?: unknown;
      idempotency_key?: unknown;
    };
    const ctx = stockPrelude(res, actor, 'stock-adjust', body);
    if (!ctx) return;
    const delta = body.qty_change;
    if (typeof delta !== 'number' || !Number.isInteger(delta) || delta === 0) {
      res.status(400).json({ error: 'qty_change phải là số nguyên khác 0' });
      return;
    }
    const reason = body.reason;
    if (!isNonEmptyString(reason)) {
      res.status(400).json({ error: 'reason bắt buộc' });
      return;
    }
    const reference = typeof body.reference === 'string' ? body.reference : null;
    try {
      const outcome = runStockOp(actor, stockKey(req, 'adjust'), () =>
        execSingleMovement(actor, ctx, 'adjust', 'stock-adjust', delta, 0, reason, reference),
      );
      respondStock(res, outcome);
    } catch (err) {
      stockFail(res, err);
    }
  });

  app.post('/api/stock/count', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const body = req.body as {
      warehouse_id?: unknown;
      variant_id?: unknown;
      counted_qty?: unknown;
      reason?: unknown;
      reference?: unknown;
      idempotency_key?: unknown;
    };
    const ctx = stockPrelude(res, actor, 'stock-count', body);
    if (!ctx) return;
    const counted = body.counted_qty;
    if (typeof counted !== 'number' || !Number.isInteger(counted) || counted < 0) {
      res.status(400).json({ error: 'counted_qty phải là số nguyên >= 0' });
      return;
    }
    const reason = body.reason;
    if (!isNonEmptyString(reason)) {
      res.status(400).json({ error: 'reason bắt buộc' });
      return;
    }
    const reference = typeof body.reference === 'string' ? body.reference : null;
    try {
      const outcome = runStockOp(actor, stockKey(req, 'count'), () => {
        const before = levelSnapshot(stockLevel(db, actor.orgId, ctx.wh.id, ctx.variant.id));
        const level = applyMovement(db, actor.orgId, actor.id, {
          warehouse_id: ctx.wh.id,
          variant_id: ctx.variant.id,
          type: 'count',
          qty_change: counted - before.on_hand,
          reason,
          reference,
        });
        auditStockOp(actor, 'stock-count', ctx.wh.id, ctx.variant.id, before, {
          on_hand: level.on_hand,
          reserved: level.reserved,
        }, { reason: reason.trim(), reference, counted_qty: counted });
        return level;
      });
      respondStock(res, outcome);
    } catch (err) {
      stockFail(res, err);
    }
  });

  // ----- Chuyển kho nguyên tử (1 transaction, 2 movement) -----

  app.post('/api/stock/transfer', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const body = req.body as {
      from_warehouse_id?: unknown;
      to_warehouse_id?: unknown;
      variant_id?: unknown;
      qty?: unknown;
      reason?: unknown;
      idempotency_key?: unknown;
    };
    const fromRaw = body.from_warehouse_id;
    const toRaw = body.to_warehouse_id;
    if (
      typeof fromRaw !== 'number' ||
      !Number.isInteger(fromRaw) ||
      typeof toRaw !== 'number' ||
      !Number.isInteger(toRaw)
    ) {
      res.status(400).json({ error: 'from_warehouse_id và to_warehouse_id bắt buộc' });
      return;
    }
    if (fromRaw === toRaw) {
      res.status(400).json({ error: 'Hai kho chuyển phải khác nhau' });
      return;
    }
    const from = loadWarehouse(res, actor, fromRaw);
    if (!from) return;
    const to = loadWarehouse(res, actor, toRaw);
    if (!to) return;
    const variant = loadVariant(res, actor, body.variant_id);
    if (!variant) return;
    if (
      !can(actor, 'stock-transfer', { orgId: actor.orgId, warehouseId: from.id }) ||
      !can(actor, 'stock-transfer', { orgId: actor.orgId, warehouseId: to.id })
    ) {
      res.status(403).json({ error: 'Bạn không được phép chuyển kho này (một trong hai kho ngoài phạm vi của bạn)' });
      return;
    }
    const qty = body.qty;
    if (!isPosInt(qty)) {
      res.status(400).json({ error: 'qty phải là số nguyên > 0' });
      return;
    }
    const reason = body.reason;
    if (!isNonEmptyString(reason)) {
      res.status(400).json({ error: 'reason bắt buộc' });
      return;
    }
    if (from.status !== 'active' || to.status !== 'active') {
      res.status(400).json({ error: 'Kho không hoạt động, không nhận thao tác tồn mới', code: 'warehouse_inactive' });
      return;
    }
    try {
      const outcome = runStockOp(actor, stockKey(req, 'transfer'), () => {
        const beforeFrom = levelSnapshot(stockLevel(db, actor.orgId, from.id, variant.id));
        const beforeTo = levelSnapshot(stockLevel(db, actor.orgId, to.id, variant.id));
        const levelFrom = applyMovement(db, actor.orgId, actor.id, {
          warehouse_id: from.id,
          variant_id: variant.id,
          type: 'transfer_out',
          qty_change: -qty,
          reason,
        });
        const levelTo = applyMovement(db, actor.orgId, actor.id, {
          warehouse_id: to.id,
          variant_id: variant.id,
          type: 'transfer_in',
          qty_change: qty,
          reason,
        });
        const extra = {
          reason: reason.trim(),
          transfer_from_warehouse_id: from.id,
          transfer_to_warehouse_id: to.id,
        };
        auditStockOp(actor, 'stock-transfer', from.id, variant.id, beforeFrom, {
          on_hand: levelFrom.on_hand,
          reserved: levelFrom.reserved,
        }, extra);
        auditStockOp(actor, 'stock-transfer', to.id, variant.id, beforeTo, {
          on_hand: levelTo.on_hand,
          reserved: levelTo.reserved,
        }, extra);
        return { ...levelFrom, to_warehouse: levelTo };
      });
      respondStock(res, outcome);
    } catch (err) {
      stockFail(res, err);
    }
  });

  // ----- Giữ / giải phóng hàng (chỉ đổi reserved) -----

  function stockReserveRelease(type: 'reserve' | 'release') {
    return (req: TenantRequest, res: Response): void => {
      const actor = req.user as SessionUser;
      const body = req.body as {
        warehouse_id?: unknown;
        variant_id?: unknown;
        qty?: unknown;
        reason?: unknown;
        reference?: unknown;
        idempotency_key?: unknown;
      };
      const ctx = stockPrelude(res, actor, type === 'reserve' ? 'stock-reserve' : 'stock-release', body);
      if (!ctx) return;
      const qty = body.qty;
      if (!isPosInt(qty)) {
        res.status(400).json({ error: 'qty phải là số nguyên > 0' });
        return;
      }
      const reason = body.reason;
      if (!isNonEmptyString(reason)) {
        res.status(400).json({ error: 'reason bắt buộc' });
        return;
      }
      const reference = typeof body.reference === 'string' ? body.reference : null;
      try {
        const outcome = runStockOp(actor, stockKey(req, type), () =>
          execSingleMovement(
            actor,
            ctx,
            type,
            type === 'reserve' ? 'stock-reserve' : 'stock-release',
            0,
            type === 'reserve' ? qty : -qty,
            reason,
            reference,
          ),
        );
        respondStock(res, outcome);
      } catch (err) {
        stockFail(res, err);
      }
    };
  }

  app.post('/api/stock/reserve', requireAuth, stockReserveRelease('reserve'));
  app.post('/api/stock/release', requireAuth, stockReserveRelease('release'));

  // ----- Đọc tồn -----

  /**
   * Phạm vi đọc tồn: kho chỉ định qua query (không thấy -> 404, ngoài org
   * -> 403, ngoài phạm vi kho được gán -> 403); không chỉ kho thì vai
   * warehouse chỉ thấy kho được gán, các vai khác thấy toàn org.
   */
  function resolveStockScope(
    req: TenantRequest,
    res: Response,
    actor: SessionUser,
    action: 'view-stock' | 'view-stock-movements',
  ): { warehouseId: number | null } | null {
    const raw = req.query.warehouse_id;
    if (raw !== undefined) {
      const wid = parseQueryInt(raw);
      if (wid === null) {
        res.status(400).json({ error: 'warehouse_id không hợp lệ' });
        return null;
      }
      const wh = getWarehouseById(wid);
      if (!wh) {
        res.status(404).json({ error: 'Không tìm thấy kho' });
        return null;
      }
      if (wh.org_id !== actor.orgId) {
        res.status(403).json({ error: 'Kho không thuộc doanh nghiệp của bạn' });
        return null;
      }
      if (!can(actor, action, { orgId: actor.orgId, warehouseId: wid })) {
        res.status(403).json({ error: 'Bạn không được xem tồn kho này' });
        return null;
      }
      return { warehouseId: wid };
    }
    if (!can(actor, action, { orgId: actor.orgId })) {
      res.status(403).json({ error: 'Bạn không được phép xem tồn kho' });
      return null;
    }
    if (actor.role === 'warehouse' && actor.warehouseId !== null && actor.warehouseId !== undefined) {
      return { warehouseId: actor.warehouseId };
    }
    return { warehouseId: null };
  }

  interface LevelQueryRow {
    org_id: number;
    warehouse_id: number;
    variant_id: number;
    product_id: number;
    sku: string;
    min_stock: number;
    on_hand: number;
    reserved: number;
  }

  function queryLevels(
    actor: SessionUser,
    scope: { warehouseId: number | null },
    variantId: number | null,
    lowFilter: boolean | null,
    limit: number,
    offset: number,
  ): (LevelQueryRow & { available: number; low_stock: boolean })[] {
    let sql = `SELECT sl.org_id AS org_id, sl.warehouse_id AS warehouse_id, sl.variant_id AS variant_id,
      pv.product_id AS product_id, pv.sku AS sku, p.min_stock AS min_stock,
      sl.on_hand AS on_hand, sl.reserved AS reserved
      FROM stock_levels sl
      JOIN product_variants pv ON pv.id = sl.variant_id
      JOIN products p ON p.id = pv.product_id
      WHERE sl.org_id = ?`;
    const params: (number | string)[] = [actor.orgId];
    if (scope.warehouseId !== null) {
      sql += ' AND sl.warehouse_id = ?';
      params.push(scope.warehouseId);
    }
    if (variantId !== null) {
      sql += ' AND sl.variant_id = ?';
      params.push(variantId);
    }
    if (lowFilter === true) sql += ' AND (sl.on_hand - sl.reserved) < p.min_stock';
    if (lowFilter === false) sql += ' AND (sl.on_hand - sl.reserved) >= p.min_stock';
    sql += ' ORDER BY sl.warehouse_id, sl.variant_id LIMIT ? OFFSET ?';
    params.push(Math.max(0, limit), Math.max(0, offset));
    const rows = db.prepare(sql).all(...params) as unknown as LevelQueryRow[];
    return rows.map((r) => ({
      ...r,
      available: r.on_hand - r.reserved,
      low_stock: r.on_hand - r.reserved < r.min_stock,
    }));
  }

  app.get('/api/stock/levels', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const scope = resolveStockScope(req, res, actor, 'view-stock');
    if (!scope) return;
    let variantId: number | null = null;
    if (req.query.variant_id !== undefined) {
      variantId = parseQueryInt(req.query.variant_id);
      if (variantId === null) {
        res.status(400).json({ error: 'variant_id không hợp lệ' });
        return;
      }
    }
    let lowFilter: boolean | null = null;
    if (req.query.low_stock === 'true') lowFilter = true;
    else if (req.query.low_stock === 'false') lowFilter = false;
    const limit = parseQueryInt(req.query.limit) ?? 1000;
    const offset = parseQueryInt(req.query.offset) ?? 0;
    res.json(queryLevels(actor, scope, variantId, lowFilter, limit, offset));
  });

  app.get('/api/stock/movements', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const scope = resolveStockScope(req, res, actor, 'view-stock-movements');
    if (!scope) return;
    let variantId: number | null = null;
    if (req.query.variant_id !== undefined) {
      variantId = parseQueryInt(req.query.variant_id);
      if (variantId === null) {
        res.status(400).json({ error: 'variant_id không hợp lệ' });
        return;
      }
    }
    const type = typeof req.query.type === 'string' ? req.query.type : undefined;
    const limit = parseQueryInt(req.query.limit) ?? 1000;
    const offset = parseQueryInt(req.query.offset) ?? 0;
    let sql = 'SELECT * FROM stock_movements WHERE org_id = ?';
    const params: (number | string)[] = [actor.orgId];
    if (scope.warehouseId !== null) {
      sql += ' AND warehouse_id = ?';
      params.push(scope.warehouseId);
    }
    if (variantId !== null) {
      sql += ' AND variant_id = ?';
      params.push(variantId);
    }
    if (type !== undefined) {
      sql += ' AND type = ?';
      params.push(type);
    }
    sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    params.push(Math.max(0, limit), Math.max(0, offset));
    const rows = db.prepare(sql).all(...params) as unknown as Record<string, unknown>[];
    res.json(rows);
  });

  app.get('/api/stock/low-stock', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const scope = resolveStockScope(req, res, actor, 'view-stock-movements');
    if (!scope) return;
    res.json(queryLevels(actor, scope, null, true, 1000, 0));
  });

  // ---------- Don hang da kenh (GOAL-005) ----------
  // Khong co endpoint DELETE don (chi huy bang trang thai, giu lich su)
  // va khong co API sua/xoa order_events (append-only) — goi cac route do
  // tra 404 mac dinh cua Express. Tao don + chuyen trang thai dung
  // withStockIdempotency qua runStockOp (ten mien order:create:<key> /
  // order:<hanh dong>:<key>); gui lai tra response cu kem replayed: true.

  /** Key idempotency cho don, tu header hoac body (thieu key van chay). */
  function orderKey(req: TenantRequest, op: string): string | null {
    const header = req.headers['idempotency-key'];
    const body = (req.body ?? {}) as { idempotency_key?: unknown };
    const raw =
      (typeof header === 'string' && header.length > 0 ? header : null) ??
      (typeof body.idempotency_key === 'string' && body.idempotency_key.length > 0
        ? body.idempotency_key
        : null);
    return raw === null ? null : `order:${op}:${raw}`;
  }

  /** Map loi nghiep vu don (xem src/orders.ts) sang HTTP. */
  function orderFail(res: Response, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('insufficient_stock')) {
      res.status(400).json({ error: msg, code: 'insufficient_stock' });
      return;
    }
    if (msg.startsWith('invalid_stock')) {
      res.status(400).json({ error: msg, code: 'invalid_stock' });
      return;
    }
    if (msg.startsWith('not_found')) {
      res.status(404).json({ error: msg });
      return;
    }
    if (msg.startsWith('forbidden')) {
      res.status(403).json({ error: msg });
      return;
    }
    if (msg.startsWith('bad_request')) {
      res.status(400).json({ error: msg });
      return;
    }
    res.status(500).json({ error: 'Lỗi hệ thống khi xử lý đơn hàng' });
  }

  app.post('/api/orders', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const body = (req.body ?? {}) as {
      branch_id?: unknown;
      warehouse_id?: unknown;
      channel?: unknown;
      customer_name?: unknown;
      items?: unknown;
    };
    try {
      const outcome = runStockOp(actor, orderKey(req, 'create'), () =>
        createOrderTx(db, actor, body),
      );
      if (outcome.replayed) res.status(201).json({ ...outcome.result, replayed: true });
      else res.status(201).json(outcome.result);
    } catch (err) {
      orderFail(res, err);
    }
  });

  app.get('/api/orders', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    try {
      const { orders, total } = listOrders(db, actor, req.query);
      res.json({ orders, total });
    } catch (err) {
      orderFail(res, err);
    }
  });

  app.get('/api/orders/:id', requireAuth, (req: TenantRequest, res: Response) => {
    const actor = req.user as SessionUser;
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId)) {
      res.status(400).json({ error: 'id không hợp lệ' });
      return;
    }
    try {
      res.json(getOrderDetail(db, actor, orderId));
    } catch (err) {
      orderFail(res, err);
    }
  });

  function orderTransition(action: OrderAction) {
    return (req: TenantRequest, res: Response): void => {
      const actor = req.user as SessionUser;
      const orderId = Number(req.params.id);
      if (!Number.isInteger(orderId)) {
        res.status(400).json({ error: 'id không hợp lệ' });
        return;
      }
      const body = (req.body ?? {}) as { note?: unknown };
      const note = typeof body.note === 'string' ? body.note : null;
      try {
        const outcome = runStockOp(actor, orderKey(req, action), () =>
          transitionOrderTx(db, actor, orderId, action, note),
        );
        if (outcome.replayed) res.json({ ...outcome.result, replayed: true });
        else res.json(outcome.result);
      } catch (err) {
        orderFail(res, err);
      }
    };
  }

  app.post('/api/orders/:id/confirm', requireAuth, orderTransition('confirm'));
  app.post('/api/orders/:id/process', requireAuth, orderTransition('process'));
  app.post('/api/orders/:id/complete', requireAuth, orderTransition('complete'));
  app.post('/api/orders/:id/cancel', requireAuth, orderTransition('cancel'));

  return app;
}
