import type { DatabaseSync } from 'node:sqlite';

// Vitest 2 (Vite 5) chưa nhận `node:sqlite` là builtin nên import tĩnh bị lỗi
// lúc load test; dùng require runtime để Node tự nạp builtin này.
// (Type vẫn lấy từ `import type` ở trên, bị xóa khi biên dịch.)
const { DatabaseSync: DatabaseSyncCtor } = require('node:sqlite') as typeof import('node:sqlite');

export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSyncCtor(path);
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

interface Migration {
  version: number;
  sql: string;
}

/**
 * Migration chạy tuần tự theo version. Mỗi migration tạo một bảng; thứ tự
 * 001 orgs -> 002 branches -> 003 users -> 004 sessions -> 005 audit_log
 * -> 006 idempotency_keys. Đã áp dụng thì bỏ qua (ghi trong schema_migrations).
 * created_at có DEFAULT để insert tối thiểu (chỉ nêu khóa chính) vẫn hợp lệ.
 * idempotency_keys không FK tới orgs: helper idempotency phải dùng được ngay
 * cả khi org chưa được tạo trong cùng giao dịch seed/test.
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `CREATE TABLE IF NOT EXISTS orgs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  {
    version: 2,
    sql: `CREATE TABLE IF NOT EXISTS branches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  {
    version: 3,
    sql: `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  {
    version: 4,
    sql: `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  {
    version: 5,
    sql: `CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  {
    version: 6,
    sql: `CREATE TABLE IF NOT EXISTS idempotency_keys (
      org_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      response TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (org_id, key)
    )`,
  },
];

export function migrate(db: DatabaseSync): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`,
  );
  for (const m of MIGRATIONS) {
    const applied = db
      .prepare('SELECT version FROM schema_migrations WHERE version = ?')
      .get(m.version) as { version: number } | undefined;
    if (applied) continue;
    db.exec(m.sql);
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
      m.version,
      new Date().toISOString(),
    );
  }
}

export function tableNames(db: DatabaseSync): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}
