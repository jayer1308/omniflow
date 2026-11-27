/**
 * Helper van hanh thong bao/job cho scripts/check.sh + scripts/demo.sh
 * (GOAL-011, D29). Khong co API kich hoat scan truc tiep (POST
 * /api/jobs/run CHI chay job due, khong enqueue scan — test khoa AC-3
 * doi processed chinh xac) va FakeEmailAdapter.failNext() CHI dung
 * trong tien trinh (khong goi duoc tu HTTP) nen 2 tac vu nay lam truc
 * tiep tren file DB (cung code src/jobs.ts / src/notifications.ts nhu
 * server, chi khac tien trinh). Chi dung cho demo/smoke local, DB tam.
 *
 *   OMNIFLOW_DB=<duong dan db> npx tsx scripts/notif-ops.ts <lenh>
 * Lenh:
 *   low-stock-scan     chay quet ton thap, in created=N
 *   promo-expiry-scan  chay quet ma sap het han, in created=N
 *   fail-job           chen 1 job send-notification due roi cho fail
 *                      3 lan (failNext + now gia lap, khong cho that),
 *                      in failed_job_id=N (de retry tay qua API sau do)
 */
import { openDb } from '../src/db.js';
import { FakeEmailAdapter } from '../src/adapters/index.js';
import { processDueJobs, runLowStockScan, runPromoExpiryScan } from '../src/jobs.js';

const dbPath = process.env.OMNIFLOW_DB;
if (!dbPath) {
  console.error('OMNIFLOW_DB chua dat');
  process.exit(1);
}
const db = openDb(dbPath);
const cmd = process.argv[2];

if (cmd === 'low-stock-scan') {
  const result = runLowStockScan(db, new Date());
  console.log(`created=${result.created}`);
} else if (cmd === 'promo-expiry-scan') {
  const result = runPromoExpiryScan(db, new Date());
  console.log(`created=${result.created}`);
} else if (cmd === 'fail-job') {
  const now = new Date();
  const nowIso = now.toISOString();
  const payload = JSON.stringify({
    event_key: 'order.completed:DH-SMOKE-FAIL-0001',
    event_type: 'order.completed',
    to_user_id: null,
    to_email: 'owner@example.local',
    subject: 'Don DH-SMOKE-FAIL-0001 da hoan tat',
    body: 'Don DH-SMOKE-FAIL-0001 da hoan tat.',
  });
  const jobId = Number(
    db
      .prepare(
        `INSERT INTO jobs (type, payload, status, attempts, max_attempts, next_run_at, last_error, created_at, updated_at)
         VALUES ('send-notification', ?, 'pending', 0, 3, ?, NULL, ?, ?)`,
      )
      .run(payload, nowIso, nowIso, nowIso).lastInsertRowid,
  );
  let at = now;
  for (let i = 0; i < 3; i++) {
    FakeEmailAdapter.failNext();
    processDueJobs(db, at);
    const row = db.prepare('SELECT status, next_run_at FROM jobs WHERE id = ?').get(jobId) as {
      status: string;
      next_run_at: string;
    };
    if (row.status === 'pending') at = new Date(row.next_run_at);
    else break;
  }
  const finalRow = db.prepare('SELECT status FROM jobs WHERE id = ?').get(jobId) as {
    status: string;
  };
  if (finalRow.status !== 'failed') {
    console.error(`job ${jobId} khong ve failed (status=${finalRow.status})`);
    process.exit(1);
  }
  console.log(`failed_job_id=${jobId}`);
} else {
  console.error(`lenh khong hop le: ${cmd ?? ''} (low-stock-scan | promo-expiry-scan | fail-job)`);
  process.exit(1);
}
