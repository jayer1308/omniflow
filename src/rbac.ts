/**
 * RBAC — helper phân quyền `can()` ở tầng service (GOAL-002, xem docs/RBAC.md).
 * Mọi thao tác kiểm tra cả vai VÀ phạm vi: vai sai -> 403, đúng vai sai phạm
 * vi -> 403, ngoài org -> 403. Phạm vi = users.branch_id nullable
 * (NULL = toàn org) + warehouse_id chuẩn bị; 1 user tối đa 1 chi nhánh.
 */

export type Role = 'owner' | 'manager' | 'sales' | 'warehouse' | 'accountant';

export type UserStatus = 'active' | 'locked' | 'revoked';

export const ROLES: Role[] = ['owner', 'manager', 'sales', 'warehouse', 'accountant'];

/** Vai cấp dưới: manager được mời/khóa/thu hồi/đổi phạm vi/đổi mật khẩu. */
export const SUBORDINATE_ROLES: Role[] = ['sales', 'warehouse', 'accountant'];

export interface Actor {
  id: number;
  orgId: number;
  branchId: number | null;
  role: Role;
  status?: UserStatus;
}

export interface Target {
  id?: number;
  orgId: number;
  branchId?: number | null;
  role?: Role;
}

export type Action =
  | 'invite'
  | 'lock'
  | 'unlock'
  | 'revoke'
  | 'change-role'
  | 'change-scope'
  | 'change-password-other'
  | 'list-users'
  | 'view-audit-log'
  | 'create-branch';

/**
 * true khi branch của target nằm trong phạm vi của actor.
 * actor.branchId NULL = toàn org; ngược lại target phải đúng chi nhánh đó.
 * target.branchId NULL/undefined = user toàn org: chỉ actor toàn org mới tới được.
 */
export function inScope(actorBranchId: number | null, targetBranchId: number | null | undefined): boolean {
  if (actorBranchId === null) return true;
  return targetBranchId === actorBranchId;
}

function isSubordinate(role: Role | undefined): boolean {
  return role !== undefined && (SUBORDINATE_ROLES as string[]).includes(role);
}

/**
 * Ma trận quyền (docs/RBAC.md). Không ném lỗi: trả false khi không được phép.
 * - Actor bị khóa/thu hồi không làm gì được.
 * - Ngoài org: luôn false.
 * - Tự thao tác lên chính mình (khóa/mở khóa/thu hồi/đổi vai): luôn false.
 */
export function can(actor: Actor, action: Action, target: Target): boolean {
  if (actor.status !== undefined && actor.status !== 'active') return false;
  if (target.orgId !== actor.orgId) return false;
  if (
    target.id !== undefined &&
    target.id === actor.id &&
    (action === 'lock' || action === 'unlock' || action === 'revoke' || action === 'change-role')
  ) {
    return false;
  }
  const targetBranch = target.branchId ?? null;
  switch (action) {
    case 'invite':
      if (actor.role === 'owner') return true;
      if (actor.role === 'manager') {
        return isSubordinate(target.role) && inScope(actor.branchId, targetBranch);
      }
      return false;
    case 'lock':
    case 'unlock':
    case 'revoke':
      if (actor.role === 'owner') return true;
      if (actor.role === 'manager') {
        return isSubordinate(target.role) && inScope(actor.branchId, targetBranch);
      }
      return false;
    case 'change-role':
      return actor.role === 'owner';
    case 'change-scope':
      if (actor.role === 'owner') return true;
      if (actor.role === 'manager') {
        return isSubordinate(target.role) && inScope(actor.branchId, targetBranch);
      }
      return false;
    case 'change-password-other':
      if (actor.role === 'owner') return true;
      if (actor.role === 'manager') {
        return isSubordinate(target.role) && inScope(actor.branchId, targetBranch);
      }
      return false;
    case 'list-users':
    case 'view-audit-log':
      return actor.role === 'owner' || actor.role === 'manager';
    case 'create-branch':
      return actor.role === 'owner';
    default:
      return false;
  }
}
