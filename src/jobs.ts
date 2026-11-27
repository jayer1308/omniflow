import type { DatabaseSync } from 'node:sqlite';

/**
 * Hang doi job trong tien trinh (GOAL-011, STUB cua Tester — brief-011.md
 * R-4/R-5/R-6/R-7/R-8, D29). Moi ham chi nem 'not implemented': test moi
 * do do dung ly do, Worker implement day du.
 *
 * Hop dong da chot cho Worker:
 * - processDueJobs(db, now): lay job pending co next_run_at <= now theo
 *   created_at, chay TUAN TU tung job, moi job trong transaction rieng.
 *   Tra {processed, done, failed}: failed dem job loi trong lan chay nay
 *   (ke ca job ve pending cho retry, lan 3 -> failed han).
 * - Retry: fail -> attempts + 1, ve pending voi next_run_at = now +
 *   60 x 2^(attempts-1) giay (+60s lan 1, +120s lan 2); het 3 lan ->
 *   failed + last_error + audit job-failed + notification-failed.
 * - enqueueScanJob: dedupe theo period_key = ngay Asia/Ho_Chi_Minh;
 *   da co job scan cung loai + cung period_key o pending/running/done
 *   thi tra {created: false}, khong tao them.
 * - runLowStockScan / runPromoExpiryScan: quet va tao job
 *   send-notification (1 job / 1 nguoi nhan / 1 event_key); chay lai
 *   cung ngay khong tao them nho event_key UNIQUE. Tra so job moi tao.
 * - recoverRunningJobs(db, now): dua moi job running ve pending
 *   (attempts giu nguyen, next_run_at = now); tra so job da khoi phuc.
 *   Server goi ham nay khi start.
 */

export type JobType = 'send-notification' | 'low-stock-scan' | 'promo-expiry-scan';

export interface JobRunResult {
  processed: number;
  done: number;
  failed: number;
}

export interface ScanJobResult {
  created: boolean;
  jobId: number | null;
}

export interface ScanRunResult {
  created: number;
}

export function processDueJobs(_db: DatabaseSync, _now: Date): JobRunResult {
  throw new Error('not implemented');
}

export function recoverRunningJobs(_db: DatabaseSync, _now: Date): number {
  throw new Error('not implemented');
}

export function enqueueScanJob(
  _db: DatabaseSync,
  _type: JobType,
  _now: Date,
): ScanJobResult {
  throw new Error('not implemented');
}

export function runLowStockScan(_db: DatabaseSync, _now: Date): ScanRunResult {
  throw new Error('not implemented');
}

export function runPromoExpiryScan(_db: DatabaseSync, _now: Date): ScanRunResult {
  throw new Error('not implemented');
}
