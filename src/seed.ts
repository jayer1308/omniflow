import type { DatabaseSync } from 'node:sqlite';

export interface SeedResult {
  orgId: number;
  branchId: number;
  ownerEmail: string;
  staffEmail: string;
}

export interface SeedPasswords {
  ownerPassword: string;
  staffPassword: string;
}

export function seed(_db: DatabaseSync, _passwords: SeedPasswords): SeedResult {
  throw new Error('not implemented');
}
