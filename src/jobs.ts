import type { DatabaseSync } from 'node:sqlite';
import { FakeEmailAdapter } from './adapters/index.js';
import {
  buildNotificationContent,
  deriveJobOrg,
  enqueueNotification,
  findNotificationJobId,
  firstOrgId,
  hcmDateString,
  isNotificationEnabled,
  userIdsByRole,
  warehouseUserIdsOf,
} from './notifications.js';
import { runStockTransaction } from './stock.js';

/**
 * Hang doi job trong tien trinh (GOAL-011, brief-011.md R-4/R-5/R-6/R-7/R-8, D29).
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
 *   cung ngay khong tao them nho event_key UNIQUE + dedupe job.
 *   Tra so job moi tao.
 * - recoverRunningJobs(db, now): dua moi job running ve pending
 *   (attempts giu nguyen, next_run_at = now); tra so job da khoi phuc.
 *   Server goi ham nay khi start.
 * - startNotificationScheduler: setInterval 60 phut/loai scan khi server
 *   chay that (KHONG chay trong test tru khi goi tuong minh).
 */

export type JobType = 'send-notification' | 'low-stock-scan' | 'promo-expiry-scan';

export const JOB_TYPES: JobType[] = ['send-notification', 'low-stock-scan', 'promo-expiry-scan'];

export const JOB_STATUSES = ['pending', 'running', 'done', 'failed'] as const;

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

interface JobRow {
  id: number;
  type: string;
  payload: string;
  status: string;
  attempts: number;
  max_attempts: number;
  next_run_at: string;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

function parsePayload(job: JobRow): Record<string, unknown> {
  try {
    return JSON.parse(job.payload) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeAudit(
  db: DatabaseSync,
  orgId: number,
  actorId: number | null,
  action: string,
  detail: Record<string, unknown>,
): void {
  db.prepare(
    'INSERT INTO audit_log (org_id, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(orgId, actorId, action, JSON.stringify(detail), new Date().toISOString());
}

/** Tao job send-notification neu chua co (dem job MOI tao, khong dem job da co / da tat preferences). */
function enqueueCounted(
  db: DatabaseSync,
  input: {
    orgId: number;
    eventKey: string;
    eventType: string;
    toUserId: number | null;
    subject: string;
    body: string;
  },
): boolean {
  const toEmail =
    input.toUserId !== null
      ? ((db.prepare('SELECT email FROM users WHERE id = ?').get(input.toUserId) as
          | { email: string }
          | undefined)?.email ?? null)
      : null;
  if (input.toUserId !== null && toEmail === null) return false;
  if (
    findNotificationJobId(db, input.eventKey, input.toUserId, toEmail ?? '') !== null
  ) {
    return false;
  }
  return (
    enqueueNotification(db, {
      orgId: input.orgId,
      eventKey: input.eventKey,
      eventType: input.eventType,
      toUserId: input.toUserId,
      subject: input.subject,
      body: input.body,
    }) !== null
  );
}

/** Gui 1 job send-notification: gui qua FakeEmailAdapter + ghi log append-only trong cung transaction. */
function executeSendNotification(db: DatabaseSync, job: JobRow, now: Date): void {
  const payload = parsePayload(job);
  const eventKey = typeof payload.event_key === 'string' ? payload.event_key : '';
  const eventType = typeof payload.event_type === 'string' ? payload.event_type : '';
  const toUserId =
    typeof payload.to_user_id === 'number' ? (payload.to_user_id as number) : null;
  const toEmail = typeof payload.to_email === 'string' ? payload.to_email : '';
  const subject = typeof payload.subject === 'string' ? payload.subject : '';
  const body = typeof payload.body === 'string' ? payload.body : '';
  if (eventKey === '' || eventType === '' || toEmail === '' || subject === '') {
    throw new Error('payload job thong bao khong hop le');
  }
  // Nguoi nhan tat loai nay sau khi job duoc tao: bo qua ngay, KHONG tao
  // notification, KHONG tinh failed (R-3).
  if (toUserId !== null && !isNotificationEnabled(db, toUserId, eventType)) return;
  const orgId = deriveJobOrg(db, payload) ?? firstOrgId(db);
  if (orgId === null) throw new Error('khong xac dinh duoc org cua job thong bao');
  // Da co log cho (event_key + nguoi nhan) thi khong gui lai (chong trung).
  const existing = db
    .prepare(
      'SELECT id FROM notifications WHERE org_id = ? AND event_key = ? AND recipient_email = ?',
    )
    .get(orgId, eventKey, toEmail) as { id: number } | undefined;
  if (existing) return;
  const result = new FakeEmailAdapter().send(toEmail, subject, body);
  const nowIso = now.toISOString();
  try {
    db.prepare(
      `INSERT INTO notifications (org_id, event_key, event_type, channel, recipient_user_id, recipient_email, subject, body, status, error, message_id, created_at)
       VALUES (?, ?, ?, 'email', ?, ?, ?, ?, 'sent', NULL, ?, ?)`,
    ).run(orgId, eventKey, eventType, toUserId, toEmail, subject, body, result.messageId, nowIso);
  } catch (err) {
    // Trung UNIQUE (org_id, event_key, recipient_email) do job khac vua
    // ghi trong cung luc: coi nhu da gui, khong gui lai, khong retry.
    if (String(err).includes('UNIQUE constraint')) return;
    throw err;
  }
}

function executeJob(db: DatabaseSync, job: JobRow, now: Date): void {
  if (job.type === 'send-notification') {
    executeSendNotification(db, job, now);
    return;
  }
  if (job.type === 'low-stock-scan') {
    runLowStockScan(db, now);
    return;
  }
  if (job.type === 'promo-expiry-scan') {
    runPromoExpiryScan(db, now);
    return;
  }
  throw new Error(`loai job khong ho tro: ${job.type}`);
}

/** Chay 1 job trong transaction rieng; tra 'done' khi xong, 'failed' khi loi (ke ca ve pending cho retry). */
function runJobOnce(db: DatabaseSync, job: JobRow, now: Date): 'done' | 'failed' {
  const nowIso = now.toISOString();
  return runStockTransaction(db, () => {
    const current = db.prepare('SELECT * FROM jobs WHERE id = ?').get(job.id) as
      | JobRow
      | undefined;
    if (!current || current.status !== 'pending') return 'done';
    db.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run(
      'running',
      nowIso,
      job.id,
    );
    try {
      executeJob(db, current, now);
      db.prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?').run(
        'done',
        nowIso,
        job.id,
      );
      return 'done';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = current.attempts + 1;
      if (attempts >= current.max_attempts) {
        db.prepare(
          'UPDATE jobs SET status = ?, attempts = ?, last_error = ?, updated_at = ? WHERE id = ?',
        ).run('failed', attempts, message, nowIso, job.id);
        const orgId = deriveJobOrg(db, parsePayload(current)) ?? firstOrgId(db);
        if (orgId !== null) {
          if (current.type === 'send-notification') {
            const payload = parsePayload(current);
            const detail: Record<string, unknown> = {
              event_key: payload.event_key ?? '',
              event_type: payload.event_type ?? '',
              error: message,
            };
            if (typeof payload.to_user_id === 'number') {
              detail.recipient_user_id = payload.to_user_id;
            }
            writeAudit(db, orgId, null, 'notification-failed', detail);
          }
          writeAudit(db, orgId, null, 'job-failed', {
            job_id: current.id,
            job_type: current.type,
            last_error: message,
          });
        }
      } else {
        const backoffSec = 60 * 2 ** (attempts - 1);
        const nextRunAt = new Date(now.getTime() + backoffSec * 1000).toISOString();
        db.prepare(
          'UPDATE jobs SET status = ?, attempts = ?, next_run_at = ?, last_error = ?, updated_at = ? WHERE id = ?',
        ).run('pending', attempts, nextRunAt, message, nowIso, job.id);
      }
      return 'failed';
    }
  });
}

export function processDueJobs(db: DatabaseSync, now: Date): JobRunResult {
  const nowIso = now.toISOString();
  const due = db
    .prepare(
      "SELECT * FROM jobs WHERE status = 'pending' AND next_run_at <= ? ORDER BY created_at, id",
    )
    .all(nowIso) as unknown as JobRow[];
  let processed = 0;
  let done = 0;
  let failed = 0;
  for (const job of due) {
    processed += 1;
    if (runJobOnce(db, job, now) === 'done') done += 1;
    else failed += 1;
  }
  return { processed, done, failed };
}

export function recoverRunningJobs(db: DatabaseSync, now: Date): number {
  const nowIso = now.toISOString();
  const result = db
    .prepare("UPDATE jobs SET status = 'pending', next_run_at = ?, updated_at = ? WHERE status = 'running'")
    .run(nowIso, nowIso);
  return Number(result.changes);
}

export function enqueueScanJob(
  db: DatabaseSync,
  type: JobType,
  now: Date,
): ScanJobResult {
  const periodKey = hcmDateString(now);
  return runStockTransaction(db, () => {
    const rows = db.prepare('SELECT id, payload FROM jobs WHERE type = ?').all(type) as {
      id: number;
      payload: string;
    }[];
    for (const row of rows) {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(row.payload) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (payload.period_key !== periodKey) continue;
      const statusRow = db.prepare('SELECT status FROM jobs WHERE id = ?').get(row.id) as {
        status: string;
      };
      if (['pending', 'running', 'done'].includes(statusRow.status)) {
        return { created: false, jobId: row.id };
      }
    }
    const nowIso = now.toISOString();
    const jobId = Number(
      db
        .prepare(
          `INSERT INTO jobs (type, payload, status, attempts, max_attempts, next_run_at, last_error, created_at, updated_at)
           VALUES (?, ?, 'pending', 0, 3, ?, NULL, ?, ?)`,
        )
        .run(type, JSON.stringify({ period_key: periodKey }), nowIso, nowIso, nowIso)
        .lastInsertRowid,
    );
    return { created: true, jobId };
  });
}

export function runLowStockScan(db: DatabaseSync, now: Date): ScanRunResult {
  return runStockTransaction(db, () => {
    const today = hcmDateString(now);
    // Chi quet cap (variant, warehouse) DA CO dong stock_levels: cap chua
    // tung nhap kho khong co dong ton thi khong tinh la "cap ton thap"
    // (available mac dinh 0 chi co nghia khi da co dong ton theo doi).
    const rows = db
      .prepare(
        `SELECT sl.org_id AS org_id, sl.warehouse_id AS warehouse_id, sl.variant_id AS variant_id,
                (sl.on_hand - sl.reserved) AS available,
                p.min_stock AS min_stock, p.name AS product_name, v.sku AS sku, w.name AS warehouse_name
         FROM stock_levels sl
         JOIN product_variants v ON v.id = sl.variant_id
         JOIN products p ON p.id = v.product_id
         JOIN warehouses w ON w.id = sl.warehouse_id
         WHERE (sl.on_hand - sl.reserved) < p.min_stock
         ORDER BY sl.org_id, sl.warehouse_id, sl.variant_id`,
      )
      .all() as {
      org_id: number;
      warehouse_id: number;
      variant_id: number;
      available: number;
      min_stock: number;
      product_name: string;
      sku: string;
      warehouse_name: string;
    }[];
    let created = 0;
    for (const row of rows) {
      const eventKey = `stock.low:variant:${row.variant_id}:warehouse:${row.warehouse_id}:${today}`;
      const shortage = row.min_stock - row.available;
      const content = buildNotificationContent('stock.low', {
        sku: row.sku,
        productName: row.product_name,
        warehouseName: row.warehouse_name,
        available: row.available,
        minStock: row.min_stock,
        shortage,
      });
      const recipients = [
        ...warehouseUserIdsOf(db, row.org_id, row.warehouse_id),
        ...userIdsByRole(db, row.org_id, 'manager'),
      ];
      for (const userId of recipients) {
        if (
          enqueueCounted(db, {
            orgId: row.org_id,
            eventKey,
            eventType: 'stock.low',
            toUserId: userId,
            subject: content.subject,
            body: content.body,
          })
        ) {
          created += 1;
        }
      }
    }
    return { created };
  });
}

export function runPromoExpiryScan(db: DatabaseSync, now: Date): ScanRunResult {
  return runStockTransaction(db, () => {
    const today = hcmDateString(now);
    const in3Days = hcmDateString(new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000));
    const promos = db
      .prepare("SELECT * FROM promotions WHERE status = 'active' AND valid_to IS NOT NULL")
      .all() as {
      id: number;
      org_id: number;
      code: string;
      valid_to: string;
      usage_limit: number | null;
    }[];
    let created = 0;
    for (const promo of promos) {
      const validToDate = hcmDateString(new Date(promo.valid_to));
      if (validToDate < today || validToDate > in3Days) continue;
      const usedRow = db
        .prepare(
          "SELECT COUNT(*) AS c FROM promotion_usages WHERE promotion_id = ? AND status = 'used'",
        )
        .get(promo.id) as { c: number };
      const eventKey = `promotion.expiring:${promo.id}:${validToDate}`;
      const content = buildNotificationContent('promotion.expiring', {
        promoCode: promo.code,
        validTo: validToDate,
        usedCount: usedRow.c,
        usageLimit: promo.usage_limit,
      });
      const recipients = [
        ...userIdsByRole(db, promo.org_id, 'owner'),
        ...userIdsByRole(db, promo.org_id, 'manager'),
      ];
      for (const userId of recipients) {
        if (
          enqueueCounted(db, {
            orgId: promo.org_id,
            eventKey,
            eventType: 'promotion.expiring',
            toUserId: userId,
            subject: content.subject,
            body: content.body,
          })
        ) {
          created += 1;
        }
      }
    }
    return { created };
  });
}

/**
 * Scheduler lich scan trong tien trinh (R-6): moi 60 phut tao job scan
 * moi loai (dedupe theo period_key) roi chay job due. Chi goi o server
 * that (src/server.ts); test khong goi nen khong chay trong test.
 * Interval duoc unref de khong giu tien trinh song them.
 */
export interface NotificationScheduler {
  stop(): void;
}

export function startNotificationScheduler(
  db: DatabaseSync,
  intervalMs = 60 * 60 * 1000,
): NotificationScheduler {
  const tick = (type: JobType): void => {
    try {
      const now = new Date();
      enqueueScanJob(db, type, now);
      processDueJobs(db, now);
    } catch (err) {
      console.error(`scheduler ${type} loi:`, err instanceof Error ? err.message : String(err));
    }
  };
  const lowTimer = setInterval(() => tick('low-stock-scan'), intervalMs);
  const promoTimer = setInterval(() => tick('promo-expiry-scan'), intervalMs);
  lowTimer.unref();
  promoTimer.unref();
  return {
    stop: () => {
      clearInterval(lowTimer);
      clearInterval(promoTimer);
    },
  };
}
