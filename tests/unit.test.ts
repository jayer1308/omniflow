import { test, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { migrate, openDb, tableNames } from '../src/db.js';
import { seed } from '../src/seed.js';
import { hashPassword, verifyPassword } from '../src/auth.js';
import { withIdempotency } from '../src/idempotency.js';
import { FakeEmailAdapter, FakePaymentAdapter, FakeShippingAdapter } from '../src/adapters/index.js';

// Mật khẩu GIẢ LẬP chỉ dùng cho test, không phải credential thật.
const OWNER_PASSWORD = 'gia-lap-owner-123';

test('unit migrate tao du bang, moi bang nghiep vu co org_id', () => {
  const db = openDb(':memory:');
  migrate(db);
  const names = tableNames(db);
  for (const t of ['orgs', 'branches', 'users', 'sessions', 'audit_log', 'idempotency_keys']) {
    expect(names).toContain(t);
  }
  for (const t of ['branches', 'users', 'sessions', 'audit_log', 'idempotency_keys']) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[];
    expect(cols.map((c) => c.name)).toContain('org_id');
  }
});

test('unit bcrypt hash va verify dung/sai', async () => {
  const hash = await hashPassword(OWNER_PASSWORD);
  expect(hash).not.toBe(OWNER_PASSWORD);
  expect(await verifyPassword(OWNER_PASSWORD, hash)).toBe(true);
  expect(await verifyPassword('sai-mat-khau', hash)).toBe(false);
});

test('unit idempotency helper chi thuc thi mot lan cho cung key', () => {
  const db = openDb(':memory:');
  migrate(db);
  let runs = 0;
  const first = withIdempotency(db, 1, 'k-1', () => {
    runs += 1;
    return JSON.stringify({ n: runs });
  });
  expect(first.replayed).toBe(false);
  expect(runs).toBe(1);
  const second = withIdempotency(db, 1, 'k-1', () => {
    runs += 1;
    return JSON.stringify({ n: runs });
  });
  expect(second.replayed).toBe(true);
  expect(second.result).toBe(first.result);
  expect(runs).toBe(1);
  withIdempotency(db, 1, 'k-2', () => {
    runs += 1;
    return '{}';
  });
  expect(runs).toBe(2);
});

test('unit seed khong luu mat khau dang plain text', async () => {
  const db = openDb(':memory:');
  migrate(db);
  seed(db, { ownerPassword: OWNER_PASSWORD, staffPassword: 'gia-lap-staff-123' });
  const rows = db.prepare('SELECT password_hash FROM users').all() as { password_hash: string }[];
  expect(rows.length).toBe(2);
  for (const row of rows) {
    expect(row.password_hash).not.toContain(OWNER_PASSWORD);
    expect(row.password_hash.startsWith('$2')).toBe(true);
  }
});

test('unit fake adapters xac dinh va ghi ro gia lap', () => {
  const pay = new FakePaymentAdapter();
  expect(pay.charge(50000, 'VND')).toEqual(pay.charge(50000, 'VND'));
  expect(pay.charge(50000, 'VND').simulated).toBe(true);
  const ship = new FakeShippingAdapter();
  expect(ship.quote(1000, 'TP.HCM')).toEqual(ship.quote(1000, 'TP.HCM'));
  const mail = new FakeEmailAdapter();
  expect(mail.send('a@example.local', 'T', 'B').simulated).toBe(true);
});

test('unit docs ROADMAP va DECISIONS co mat voi du D1-D10', () => {
  expect(existsSync('docs/ROADMAP.md')).toBe(true);
  expect(existsSync('docs/DECISIONS.md')).toBe(true);
  const decisions = readFileSync('docs/DECISIONS.md', 'utf8');
  for (let i = 1; i <= 10; i++) {
    expect(decisions).toContain(`D${i}`);
  }
});
