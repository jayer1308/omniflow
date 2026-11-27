import type { DatabaseSync } from 'node:sqlite';

/**
 * Thong bao (GOAL-011, STUB cua Tester — brief-011.md R-1/R-2/R-3/R-9, D29).
 * Moi ham chi nem 'not implemented': test moi do do dung ly do, Worker
 * implement day du (mau email co dinh tung loai, tao job send-notification
 * trong cung transaction voi cap nhat trang thai goc, kiem tra preferences
 * truoc khi tao job, log append-only vao bang notifications).
 *
 * Hop dong da chot cho Worker:
 * - 1 job send-notification cho 1 nguoi nhan (to_user_id XOR to_email);
 *   job nao cung mang subject/body theo mau D29 trong payload.
 * - Nguoi nhan la user thi kiem tra preferences (thieu dong = BAT);
 *   tat -> enqueueNotification tra null, khong tao job, khong tao
 *   notification, khong tinh failed. Nguoi nhan la khach (email) thi
 *   luon gui neu co email.
 * - event_key UNIQUE: enqueue lan 2 cung event_key + cung nguoi nhan
 *   tra ve job da co, khong tao moi.
 */

export interface NotificationInput {
  orgId: number;
  eventKey: string;
  eventType: string;
  toUserId?: number | null;
  toEmail?: string | null;
  subject: string;
  body: string;
}

export interface NotificationContent {
  subject: string;
  body: string;
}

/** true khi user bat loai thong bao nay (thieu dong = BAT). */
export function isNotificationEnabled(
  _db: DatabaseSync,
  _userId: number,
  _eventType: string,
): boolean {
  throw new Error('not implemented');
}

/**
 * Tao job send-notification cho 1 nguoi nhan (tra id job moi, job da co
 * neu trung event_key + nguoi nhan, hoac null neu nguoi nhan da tat loai
 * nay trong preferences).
 */
export function enqueueNotification(
  _db: DatabaseSync,
  _input: NotificationInput,
): number | null {
  throw new Error('not implemented');
}

/** Mau email co dinh tung loai (D29): subject/body chua ma don / so tien / SKU / kho / ma khuyen mai tuy loai, khong chua thong tin the. */
export function buildNotificationContent(
  _eventType: string,
  _data: Record<string, unknown>,
): NotificationContent {
  throw new Error('not implemented');
}
