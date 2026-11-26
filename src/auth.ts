import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcrypt';

export interface SessionUser {
  id: number;
  email: string;
  role: string;
  orgId: number;
  branchId: number;
}

/** Session sống 24 giờ (tính bằng giây). */
const SESSION_TTL_SECONDS = 24 * 60 * 60;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function createSession(db: DatabaseSync, user: SessionUser): string {
  const token = randomBytes(32).toString('hex');
  const nowSeconds = Math.floor(Date.now() / 1000);
  db.prepare(
    'INSERT INTO sessions (id, user_id, org_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(token, user.id, user.orgId, nowSeconds + SESSION_TTL_SECONDS, new Date().toISOString());
  return token;
}

export function lookupSession(db: DatabaseSync, token: string): SessionUser | null {
  const row = db
    .prepare(
      `SELECT s.expires_at AS expiresAt, u.id AS id, u.email AS email, u.role AS role,
              u.org_id AS orgId, u.branch_id AS branchId
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
    )
    .get(token) as
    | { expiresAt: number; id: number; email: string; role: string; orgId: number; branchId: number }
    | undefined;
  if (!row) return null;
  if (row.expiresAt <= Math.floor(Date.now() / 1000)) return null;
  return { id: row.id, email: row.email, role: row.role, orgId: row.orgId, branchId: row.branchId };
}

export function destroySession(db: DatabaseSync, token: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
}
