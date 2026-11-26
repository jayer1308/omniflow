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
  /** Kho được gán (GOAL-004): NULL = làm ở mọi kho trong org. */
  warehouseId?: number | null;
}

export interface Target {
  id?: number;
  orgId: number;
  branchId?: number | null;
  role?: Role;
  /** Kho mục tiêu (GOAL-004): kiểm tra phạm vi kho của vai warehouse. */
  warehouseId?: number | null;
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
  | 'create-branch'
  // GOAL-003: sản phẩm / giá / CSV (xem docs/RBAC.md, ma trận sản phẩm).
  | 'create-product'
  | 'update-product'
  | 'discontinue-product'
  | 'manage-category'
  | 'change-price'
  | 'view-price-history'
  | 'import-csv'
  | 'export-csv'
  // Xem giá riêng của đúng một chi nhánh (dùng cho GET /price + lọc
  // GET /prices): owner/manager xem mọi chi nhánh, vai còn lại chỉ xem
  // chi nhánh của mình (inScope).
  | 'view-branch-price'
  // GOAL-004: kho / tồn (xem docs/RBAC.md, ma trận kho). Phạm vi kho gate
  // bằng users.warehouse_id: NULL = mọi kho trong org.
  | 'create-warehouse'
  | 'manage-warehouse'
  | 'stock-in'
  | 'stock-out'
  | 'stock-adjust'
  | 'stock-count'
  | 'stock-transfer'
  | 'stock-reserve'
  | 'stock-release'
  | 'view-stock'
  | 'view-stock-movements';

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
    // GOAL-003: ma trận sản phẩm/giá/CSV (docs/RBAC.md). Sản phẩm là dữ
    // liệu cấp org nên tạo/sửa sản phẩm không gate theo chi nhánh; phạm vi
    // chi nhánh chỉ gate giá riêng (xem 'view-branch-price' ở dưới).
    case 'create-product':
    case 'update-product':
      return actor.role === 'owner' || actor.role === 'manager' || actor.role === 'sales';
    case 'discontinue-product':
    case 'manage-category':
    case 'change-price':
    case 'import-csv':
      return actor.role === 'owner' || actor.role === 'manager';
    case 'view-price-history':
      return (
        actor.role === 'owner' || actor.role === 'manager' || actor.role === 'accountant'
      );
    case 'export-csv':
      return true;
    case 'view-branch-price':
      // Owner/manager xem giá riêng mọi chi nhánh; vai còn lại chỉ xem giá
      // của đúng chi nhánh của mình. target.branchId NULL = giá áp cho mọi
      // chi nhánh thì ai cũng xem được.
      if (actor.role === 'owner' || actor.role === 'manager') return true;
      if (targetBranch === null) return true;
      return inScope(actor.branchId, targetBranch);
    // GOAL-004: ma trận kho (docs/RBAC.md). Kho là cấp org nên phạm vi chi
    // nhánh KHÔNG gate thao tác kho; phạm vi kho gate bằng warehouse_id.
    // target.warehouseId không nêu = chưa chỉ kho cụ thể: vai warehouse
    // được phép ở mức "xem/thao tác" nhưng route phải lọc về kho được gán
    // (warehouse_id NULL = mọi kho; có giá trị = chỉ đúng kho đó).
    case 'create-warehouse':
    case 'manage-warehouse':
      return actor.role === 'owner';
    case 'stock-in':
    case 'stock-out':
    case 'stock-adjust':
    case 'stock-count':
    case 'stock-transfer':
    case 'stock-reserve':
    case 'stock-release': {
      if (actor.role === 'owner' || actor.role === 'manager') return true;
      if (actor.role !== 'warehouse') return false;
      return inWarehouseScope(actor.warehouseId ?? null, target.warehouseId);
    }
    case 'view-stock':
      // Mọi vai đều xem được mức tồn (sales xem để bán hàng, accountant xem
      // để đối soát); vai warehouse chỉ thấy kho được gán (target có kho cụ
      // thể thì gate; chưa chỉ kho thì route tự lọc về kho được gán).
      if (actor.role === 'warehouse') {
        return inWarehouseScope(actor.warehouseId ?? null, target.warehouseId);
      }
      return true;
    case 'view-stock-movements':
      if (actor.role === 'sales') return false;
      if (actor.role === 'warehouse') {
        return inWarehouseScope(actor.warehouseId ?? null, target.warehouseId);
      }
      return actor.role === 'owner' || actor.role === 'manager' || actor.role === 'accountant';
    default:
      return false;
  }
}

/**
 * true khi kho mục tiêu nằm trong phạm vi kho của actor.
 * actorWarehouseId NULL = làm ở mọi kho trong org; ngược lại target phải
 * đúng kho đó. targetWarehouseId NULL/undefined = chưa chỉ kho cụ thể
 * (route đọc sẽ tự lọc về kho được gán) nên cho qua ở mức can().
 */
export function inWarehouseScope(
  actorWarehouseId: number | null,
  targetWarehouseId: number | null | undefined,
): boolean {
  if (actorWarehouseId === null) return true;
  if (targetWarehouseId === null || targetWarehouseId === undefined) return true;
  return targetWarehouseId === actorWarehouseId;
}
