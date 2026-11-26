import type { NextFunction, Request, Response } from 'express';
import type { SessionUser } from './auth.js';

export interface TenantRequest extends Request {
  user?: SessionUser;
}

export function tenantScope(_req: TenantRequest, _res: Response, _next: NextFunction): void {
  throw new Error('not implemented');
}

export function assertSameOrg(_req: TenantRequest, _orgId: number): boolean {
  throw new Error('not implemented');
}
