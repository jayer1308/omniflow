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
 * -> 006 idempotency_keys -> 007 users RBAC (5 vai, status, branch nullable,
 * warehouse_id chuẩn bị; rebuild bảng, remap staff -> sales) -> 008 sản
 * phẩm/giá/CSV (GOAL-003: categories, products, product_variants,
 * product_attributes, product_images, product_prices, price_history).
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
  {
    // GOAL-002: 5 vai, status 3 giá trị, branch_id nullable, warehouse_id
    // chuẩn bị (không FK — bảng warehouses là GOAL-004). SQLite không sửa
    // CHECK bằng ALTER nên rebuild bảng: tạo mới -> copy (staff -> sales)
    // -> đổi tên. Tắt FK trong lúc rebuild vì sessions/audit_log FK tới
    // users; bật lại ngay sau đó.
    version: 7,
    sql: `PRAGMA foreign_keys = OFF;
    CREATE TABLE users_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      branch_id INTEGER REFERENCES branches(id),
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'sales', 'warehouse', 'accountant')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked', 'revoked')),
      warehouse_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO users_new (id, org_id, branch_id, email, password_hash, role, status, created_at)
      SELECT id, org_id, branch_id, email, password_hash,
        CASE WHEN role = 'staff' THEN 'sales' ELSE role END, 'active', created_at FROM users;
    DROP TABLE users;
    ALTER TABLE users_new RENAME TO users;
    PRAGMA foreign_keys = ON;`,
  },
  {
    // GOAL-003: danh mục sản phẩm + giá + CSV. Thứ tự tạo bảng: categories
    // trước products (products.category_id FK tới categories).
    // UNIQUE(org_id, barcode) cho phép nhiều NULL trên SQLite (đúng ý:
    // biến thể không có mã vạch vẫn hợp lệ). UNIQUE trên product_prices có
    // NULL ở variant_id/channel/branch_id KHÔNG chặn trùng trên SQLite nên
    // service phải kiểm tra trùng trong transaction (xem docs/PRICING.md).
    version: 8,
    sql: `CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES categories(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      price INTEGER NOT NULL CHECK (price >= 0),
      min_stock INTEGER NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'discontinued')),
      category_id INTEGER REFERENCES categories(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (org_id, code)
    );
    CREATE TABLE IF NOT EXISTS product_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      sku TEXT NOT NULL,
      name TEXT NOT NULL,
      barcode TEXT,
      price_override INTEGER CHECK (price_override IS NULL OR price_override >= 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (org_id, sku),
      UNIQUE (org_id, barcode)
    );
    CREATE TABLE IF NOT EXISTS product_attributes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      url TEXT NOT NULL,
      alt_text TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS product_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      variant_id INTEGER REFERENCES product_variants(id),
      channel TEXT,
      branch_id INTEGER REFERENCES branches(id),
      price INTEGER NOT NULL CHECK (price >= 0),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (org_id, product_id, variant_id, channel, branch_id)
    );
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      variant_id INTEGER REFERENCES product_variants(id),
      scope TEXT NOT NULL CHECK (scope IN ('base', 'variant_override', 'channel', 'branch', 'channel_branch')),
      channel TEXT,
      branch_id INTEGER REFERENCES branches(id),
      old_price INTEGER,
      new_price INTEGER NOT NULL CHECK (new_price >= 0),
      changed_by INTEGER NOT NULL REFERENCES users(id),
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
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
