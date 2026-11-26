import type { NextFunction, Request, Response } from 'express';
import type { SessionUser } from './auth.js';

export interface TenantRequest extends Request {
  user?: SessionUser;
}

/**
 * Middleware đa tenant ở mức khung: yêu cầu request đã gắn user (do auth
 * middleware gắn từ session); mọi handler phía sau chỉ query qua
 * req.user.orgId / req.user.branchId.
 */
export function tenantScope(req: TenantRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Chưa đăng nhập' });
    return;
  }
  next();
}

/** true khi orgId yêu cầu đúng là org của user đang đăng nhập. */
export function assertSameOrg(req: TenantRequest, orgId: number): boolean {
  return req.user !== undefined && req.user.orgId === orgId;
}
