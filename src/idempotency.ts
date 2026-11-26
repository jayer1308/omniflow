import type { DatabaseSync } from 'node:sqlite';

export interface IdempotencyResult {
  replayed: boolean;
  result: string;
}

export function withIdempotency(
  _db: DatabaseSync,
  _orgId: number,
  _key: string,
  _execute: () => string,
): IdempotencyResult {
  throw new Error('not implemented');
}
