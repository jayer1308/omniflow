import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';

export function createApp(_db: DatabaseSync): Express {
  throw new Error('not implemented');
}
