import type { DatabaseSync } from 'node:sqlite';

export function openDb(_path: string): DatabaseSync {
  throw new Error('not implemented');
}

export function migrate(_db: DatabaseSync): void {
  throw new Error('not implemented');
}

export function tableNames(_db: DatabaseSync): string[] {
  throw new Error('not implemented');
}
