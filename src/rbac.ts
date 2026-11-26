export type Action = 'owner' | 'manager' | 'sales' | 'warehouse' | 'accountant';

export type UserStatus = 'active' | 'locked' | 'revoked';

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

/** Stub: Tester khai entry, Worker cài đặt sau. */
export function can(_actor: Actor, _action: Action, _target: Target): boolean {
  throw new Error('not implemented');
}
