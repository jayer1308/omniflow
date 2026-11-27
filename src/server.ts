import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrate, openDb } from './db.js';
import { seed } from './seed.js';
import { createApp } from './app.js';
import { recoverRunningJobs, startNotificationScheduler } from './jobs.js';

const dbPath = process.env.OMNIFLOW_DB ?? 'data/omniflow.db';
mkdirSync(dirname(dbPath), { recursive: true });
const db = openDb(dbPath);
migrate(db);

const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
if (userCount.c === 0) {
  const ownerPassword =
    process.env.OMNIFLOW_SEED_OWNER_PASSWORD ?? randomBytes(12).toString('base64url');
  const staffPassword =
    process.env.OMNIFLOW_SEED_STAFF_PASSWORD ?? randomBytes(12).toString('base64url');
  const result = seed(db, { ownerPassword, staffPassword });
  console.log(`Seed: owner ${result.ownerEmail} / staff ${result.staffEmail}`);
  if (process.env.OMNIFLOW_SEED_OWNER_PASSWORD === undefined) {
    console.log(`Mat khau owner (sinh ngau nhien, chi hien 1 lan): ${ownerPassword}`);
  }
  if (process.env.OMNIFLOW_SEED_STAFF_PASSWORD === undefined) {
    console.log(`Mat khau staff (sinh ngau nhien, chi hien 1 lan): ${staffPassword}`);
  }
}

const app = createApp(db);
const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`OmniFlow chay o http://localhost:${port}`);
});

// GOAL-011 (R-4/R-6): job dang running cua tien trinh cu (chet giua
// chung, vd VM restart) ve pending khi khoi dong; scheduler lich scan
// 60 phut/loai (setInterval trong tien trinh, khong chay trong test vi
// test chi goi createApp, khong chay server.ts).
const recovered = recoverRunningJobs(db, new Date());
if (recovered > 0) console.log(`Khoi phuc ${recovered} job dang do ve pending`);
startNotificationScheduler(db);
