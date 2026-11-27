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
  | 'view-stock-movements'
  // GOAL-005: đơn hàng (xem docs/RBAC.md, ma trận đơn). Phạm vi đơn gate
  // cả chi nhánh (branchId) lẫn kho (warehouseId đã có từ GOAL-004).
  | 'create-order'
  | 'confirm-order'
  | 'process-order'
  | 'complete-order'
  | 'cancel-order'
  | 'view-orders'
  // GOAL-006: thanh toán / hoàn tiền (xem docs/RBAC.md, ma trận thanh
  // toán). Payment theo chi nhánh của đơn (branchId) + kho của đơn
  // (warehouseId) để gate phạm vi sales/warehouse.
  | 'create-payment'
  | 'refund-payment'
  | 'view-payments'
  // GOAL-007: giao hàng / trả hàng (xem docs/RBAC.md, ma trận giao/trả).
  // Phạm vi gate bằng branchId + warehouseId của đơn (kiểu Target đã có).
  | 'request-shipment'
  | 'update-shipment'
  | 'view-shipments'
  | 'request-return'
  | 'review-return'
  | 'receive-return'
  | 'refund-return'
  | 'view-returns'
  // GOAL-008: khách hàng / CRM (xem docs/RBAC.md, ma trận khách/CRM).
  // Phạm vi gate bằng branchId = chi nhánh chính của khách (NULL = chưa
  // gán: sales không thấy); delete-customer là action riêng, chỉ
  // owner/manager (D26).
  | 'create-customer'
  | 'update-customer'
  | 'view-customers'
  | 'earn-points'
  | 'redeem-points'
  | 'add-note'
  | 'merge-customers'
  | 'export-customer'
  | 'delete-customer'
  // GOAL-009 (STUB cua Tester): ma tran khuyen mai (docs/RBAC.md).
  // can() chua co case cho 4 action nay nen mac dinh tra false; Worker
  // implement dung ma tran brief (tao/sua: chi owner/manager; ap ma:
  // owner/manager toan org, sales chi don thuoc chi nhanh minh; xem:
  // owner/manager/accountant toan org, sales chi ma branch_id NULL hoac
  // dung chi nhanh minh, warehouse 403).
  | 'create-promotion'
  | 'update-promotion'
  | 'apply-promotion'
  | 'view-promotions'
  // GOAL-010 (STUB cua Tester): ma tran bao cao (docs/RBAC.md).
  // can() chua co case cho 2 action nay nen mac dinh tra false; Worker
  // implement dung ma tran brief (xem: owner/manager/accountant toan org,
  // sales chi chi nhanh minh, warehouse chi bao cao ton kho duoc gan;
  // xuat CSV: cung pham vi nhu xem, ghi audit 'export-report').
  | 'view-reports'
  | 'export-reports'
  // GOAL-011 (STUB cua Tester): ma tran thong bao/job (docs/RBAC.md, D29).
  // can() chua co case cho 4 action nay nen mac dinh tra false; Worker
  // implement dung ma tran brief-011 yeu cau 11 (owner/manager toan org;
  // sales chi thong bao chi nhanh minh, xem job -> 403; warehouse chi
  // thong bao stock.low kho duoc gan + job low-stock-scan, chay job -> 403;
  // accountant xem thong bao payment/refund toan org, chay job -> 403).
  | 'view-notifications'
  | 'manage-notification-preferences'
  | 'view-jobs'
  | 'run-jobs';

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
    // GOAL-005: ma trận đơn (docs/RBAC.md). Tạo/xác nhận/hủy đơn: owner/
    // manager toàn org, sales chỉ đúng chi nhánh của mình; warehouse và
    // accountant không được. Xử lý/hoàn tất đơn: owner/manager toàn org,
    // warehouse chỉ đơn có warehouse_id trong phạm vi của mình (NULL = mọi
    // kho); sales và accountant không được. Xem đơn: owner/manager/
    // accountant toàn org, sales chỉ chi nhánh mình, warehouse chỉ kho mình.
    case 'create-order':
    case 'confirm-order':
    case 'cancel-order': {
      if (actor.role === 'owner' || actor.role === 'manager') return true;
      if (actor.role !== 'sales') return false;
      return inScope(actor.branchId, targetBranch);
    }
    case 'process-order':
    case 'complete-order': {
      if (actor.role === 'owner' || actor.role === 'manager') return true;
      if (actor.role !== 'warehouse') return false;
      return inWarehouseScope(actor.warehouseId ?? null, target.warehouseId);
    }
    case 'view-orders': {
      if (actor.role === 'owner' || actor.role === 'manager' || actor.role === 'accountant') {
        return true;
      }
      if (actor.role === 'sales') return inScope(actor.branchId, targetBranch);
      if (actor.role === 'warehouse') {
        return inWarehouseScope(actor.warehouseId ?? null, target.warehouseId);
      }
      return false;
    }
    // GOAL-006: ma trận thanh toán (docs/RBAC.md). Ghi nhận thu tiền:
    // owner/manager/accountant toàn org, sales chỉ đơn thuộc chi nhánh
    // mình, warehouse không được. Hoàn tiền: owner/manager/accountant,
    // sales/warehouse không được. Xem: owner/manager/accountant toàn org,
    // sales chỉ chi nhánh mình, warehouse chỉ đơn có kho trong phạm vi.
    case 'create-payment': {
      if (actor.role === 'owner' || actor.role === 'manager' || actor.role === 'accountant') {
        return true;
      }
      if (actor.role !== 'sales') return false;
      return inScope(actor.branchId, targetBranch);
    }
    case 'refund-payment': {
      return actor.role === 'owner' || actor.role === 'manager' || actor.role === 'accountant';
    }
    case 'view-payments': {
      if (actor.role === 'owner' || actor.role === 'manager' || actor.role === 'accountant') {
        return true;
      }
      if (actor.role === 'sales') return inScope(actor.branchId, targetBranch);
      if (actor.role === 'warehouse') {
        return inWarehouseScope(actor.warehouseId ?? null, target.warehouseId);
      }
      return false;
    }
    // GOAL-007: ma trận giao/trả (docs/RBAC.md). Yêu cầu giao/cập nhật
    // trạng thái giao: owner/manager toàn org, warehouse chỉ đơn có
    // warehouse_id trong phạm vi, sales/accountant không được. Xem giao/
    // trả: owner/manager/accountant toàn org, sales chỉ chi nhánh mình,
    // warehouse chỉ kho mình. Yêu cầu trả: owner/manager toàn org, sales
    // chỉ đơn thuộc chi nhánh mình, warehouse/accountant không được.
    // Duyệt/từ chối trả: chỉ owner/manager. Nhận hàng trả: owner/manager
    // toàn org, warehouse chỉ đơn có kho trong phạm vi. Hoàn tiền trả
    // hàng: owner/manager/accountant toàn org.
    case 'request-shipment':
    case 'update-shipment': {
      if (actor.role === 'owner' || actor.role === 'manager') return true;
      if (actor.role !== 'warehouse') return false;
      return inWarehouseScope(actor.warehouseId ?? null, target.warehouseId);
    }
    case 'view-shipments':
    case 'view-returns': {
      if (actor.role === 'owner' || actor.role === 'manager' || actor.role === 'accountant') {
        return true;
      }
      if (actor.role === 'sales') return inScope(actor.branchId, targetBranch);
      if (actor.role === 'warehouse') {
        return inWarehouseScope(actor.warehouseId ?? null, target.warehouseId);
      }
      return false;
    }
    case 'request-return': {
      if (actor.role === 'owner' || actor.role === 'manager') return true;
      if (actor.role !== 'sales') return false;
      return inScope(actor.branchId, targetBranch);
    }
    case 'review-return': {
      return actor.role === 'owner' || actor.role === 'manager';
    }
    case 'receive-return': {
      if (actor.role === 'owner' || actor.role === 'manager') return true;
      if (actor.role !== 'warehouse') return false;
      return inWarehouseScope(actor.warehouseId ?? null, target.warehouseId);
    }
    case 'refund-return': {
      return actor.role === 'owner' || actor.role === 'manager' || actor.role === 'accountant';
    }
    // GOAL-008: ma trận khách/CRM (docs/RBAC.md). Tạo/sửa khách, tích/đổi
    // điểm, ghi chú: owner/manager toàn org, sales chỉ khách thuộc chi
    // nhánh mình (target.branchId NULL = chưa gán -> sales không tới được
    // vì inScope(false)); warehouse/accountant không được tạo/sửa/tích/
    // đổi/ghi. Xem khách: mọi vai theo phạm vi — owner/manager/warehouse/
    // accountant toàn org, sales chỉ chi nhánh mình (kể cả khách chưa gán
    // cũng không thấy). Hợp nhất/xóa: chỉ owner/manager. Xuất: owner/
    // manager/accountant toàn org, sales chỉ chi nhánh mình, warehouse 403.
    case 'create-customer':
    case 'update-customer':
    case 'earn-points':
    case 'redeem-points':
    case 'add-note': {
      if (actor.role === 'owner' || actor.role === 'manager') return true;
      if (actor.role !== 'sales') return false;
      return inScope(actor.branchId, targetBranch);
    }
    case 'view-customers': {
      if (
        actor.role === 'owner' ||
        actor.role === 'manager' ||
        actor.role === 'warehouse' ||
        actor.role === 'accountant'
      ) {
        return true;
      }
      if (actor.role !== 'sales') return false;
      return inScope(actor.branchId, targetBranch);
    }
    case 'merge-customers':
    case 'delete-customer': {
      return actor.role === 'owner' || actor.role === 'manager';
    }
    case 'export-customer': {
      if (actor.role === 'owner' || actor.role === 'manager' || actor.role === 'accountant') {
        return true;
      }
      if (actor.role !== 'sales') return false;
      return inScope(actor.branchId, targetBranch);
    }
    // GOAL-009: ma trận khuyến mãi (docs/RBAC.md, D27). Tạo/sửa/khóa mã:
    // chỉ owner/manager. Áp mã: owner/manager toàn org, sales chỉ đơn
    // thuộc chi nhánh mình. Xem mã: owner/manager/accountant toàn org,
    // sales chỉ mã branch_id NULL (mọi chi nhánh) hoặc đúng chi nhánh
    // mình, warehouse 403.
    case 'create-promotion':
    case 'update-promotion': {
      return actor.role === 'owner' || actor.role === 'manager';
    }
    case 'apply-promotion': {
      if (actor.role === 'owner' || actor.role === 'manager') return true;
      if (actor.role !== 'sales') return false;
      return inScope(actor.branchId, targetBranch);
    }
    case 'view-promotions': {
      if (
        actor.role === 'owner' ||
        actor.role === 'manager' ||
        actor.role === 'accountant'
      ) {
        return true;
      }
      if (actor.role !== 'sales') return false;
      if (targetBranch === null) return true;
      return inScope(actor.branchId, targetBranch);
    }
    // GOAL-010: ma tran bao cao (docs/RBAC.md, D28). Xem/xuat bao cao:
    // owner/manager/accountant toan org; sales chi chi nhanh minh
    // (target.branchId NULL = chua chi chi nhanh cu the: route phai loc
    // ve chi nhanh cua sales truoc khi goi can()); warehouse chi bao cao
    // ton kho duoc gan (target.warehouseId NULL = chua chi kho cu the:
    // route tu loc ve kho duoc gan; chi co route stock moi goi can() voi
    // vai warehouse — cac bao cao khac route chan 403 truoc).
    case 'view-reports':
    case 'export-reports': {
      if (
        actor.role === 'owner' ||
        actor.role === 'manager' ||
        actor.role === 'accountant'
      ) {
        return true;
      }
      if (actor.role === 'sales') return inScope(actor.branchId, targetBranch);
      if (actor.role === 'warehouse') {
        return inWarehouseScope(actor.warehouseId ?? null, target.warehouseId);
      }
      return false;
    }
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
