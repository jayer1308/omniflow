import type { DatabaseSync } from 'node:sqlite';

export interface SessionUser {
  id: number;
  email: string;
  role: string;
  orgId: number;
  branchId: number;
}

export function hashPassword(_password: string): Promise<string> {
  throw new Error('not implemented');
}

export function verifyPassword(_password: string, _hash: string): Promise<boolean> {
  throw new Error('not implemented');
}

export function createSession(_db: DatabaseSync, user: SessionUser): string {
  throw new Error('not implemented');
}

export function lookupSession(_db: DatabaseSync, _token: string): SessionUser | null {
  throw new Error('not implemented');
}

export function destroySession(_db: DatabaseSync, _token: string): void {
  throw new Error('not implemented');
}
