import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { migrate, openDb } from '../src/db.js';
import { seed } from '../src/seed.js';

// Mật khẩu GIẢ LẬP chỉ dùng cho test, không phải credential thật.
const OWNER_PASSWORD = 'gia-lap-owner-123';

test('AC-5 backup tao file, restore dua du lieu ve dung trang thai', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omniflow-backup-'));
  try {
    const dbPath = join(dir, 'omniflow.db');
    const backupPath = join(dir, 'backup.db');
    const db = openDb(dbPath);
    migrate(db);
    seed(db, { ownerPassword: OWNER_PASSWORD, staffPassword: 'gia-lap-staff-123' });
    const before = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
    expect(before.c).toBe(2);
    db.close();
    execFileSync('bash', ['scripts/backup.sh', dbPath, backupPath], { stdio: 'pipe' });
    expect(existsSync(backupPath)).toBe(true);
    const db2 = openDb(dbPath);
    db2.prepare('DELETE FROM users').run();
    const afterDelete = db2.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
    expect(afterDelete.c).toBe(0);
    db2.close();
    execFileSync('bash', ['scripts/restore.sh', backupPath, dbPath], { stdio: 'pipe' });
    const db3 = openDb(dbPath);
    const afterRestore = db3.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
    expect(afterRestore.c).toBe(2);
    db3.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AC-1 luan chay day du: seed roi dang nhap roi goi owner-only', async () => {
  const db = openDb(':memory:');
  migrate(db);
  const seeded = seed(db, { ownerPassword: OWNER_PASSWORD, staffPassword: 'gia-lap-staff-123' });
  const app = createApp(db);
  const agent = request.agent(app);
  const login = await agent
    .post('/login')
    .send({ email: seeded.ownerEmail, password: OWNER_PASSWORD });
  expect(login.status).toBe(200);
  const health = await request(app).get('/health');
  expect(health.body).toEqual({ status: 'ok' });
  const ownerOnly = await agent.get('/owner-only');
  expect(ownerOnly.status).toBe(200);
});
