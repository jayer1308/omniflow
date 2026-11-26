import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { createSession, destroySession, lookupSession, verifyPassword } from './auth.js';
import type { SessionUser } from './auth.js';
import { withIdempotency } from './idempotency.js';
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
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as
      | {
          id: number;
          email: string;
          password_hash: string;
          role: string;
          org_id: number;
          branch_id: number;
        }
      | undefined;
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' });
      return;
    }
    const user: SessionUser = {
      id: row.id,
      email: row.email,
      role: row.role,
      orgId: row.org_id,
      branchId: row.branch_id,
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
    tenantScope,
    (req: TenantRequest, res: Response) => {
      const orgId = Number(req.params.orgId);
      if (!Number.isInteger(orgId) || !assertSameOrg(req, orgId)) {
        res.status(403).json({ error: 'Không được truy cập dữ liệu ngoài doanh nghiệp của bạn' });
        return;
      }
      const rows = db
        .prepare('SELECT id, org_id, name FROM branches WHERE org_id = ? ORDER BY id')
        .all(orgId) as unknown as BranchRow[];
      res.json(rows);
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

  return app;
}
