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
  {
    // GOAL-004: kho đa kho + tồn. warehouses cấp org (branch_id NULL
    // optional, chỉ để hiển thị, không gate quyền); stock_levels tồn theo
    // biến thể (UNIQUE org/warehouse/variant, CHECK reserved <= on_hand);
    // stock_movements append-only (chỉ INSERT, không API sửa/xóa).
    version: 9,
    sql: `CREATE TABLE IF NOT EXISTS warehouses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      name TEXT NOT NULL,
      branch_id INTEGER REFERENCES branches(id),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS stock_levels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
      variant_id INTEGER NOT NULL REFERENCES product_variants(id),
      on_hand INTEGER NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
      reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (org_id, warehouse_id, variant_id),
      CHECK (reserved <= on_hand)
    );
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
      variant_id INTEGER NOT NULL REFERENCES product_variants(id),
      type TEXT NOT NULL CHECK (type IN ('in', 'out', 'adjust', 'count', 'transfer_in', 'transfer_out', 'reserve', 'release')),
      qty_change INTEGER NOT NULL,
      reserved_change INTEGER NOT NULL DEFAULT 0,
      on_hand_after INTEGER NOT NULL,
      reserved_after INTEGER NOT NULL,
      reason TEXT NOT NULL,
      reference TEXT,
      actor_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
  },
  {
    // GOAL-005: đơn hàng đa kênh + vòng đời. orders cấp org (branch_id +
    // warehouse_id NOT NULL, code DH-YYYYMMDD-NNNN UNIQUE trong org,
    // channel counter/web/api, status state machine, total nguyên đồng);
    // order_items snapshot giá tại thời điểm đặt (UNIQUE đơn/biến thể);
    // order_events append-only (from_status NULL khi tạo đơn).
    version: 10,
    sql: `CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
      code TEXT NOT NULL,
      channel TEXT NOT NULL CHECK (channel IN ('counter', 'web', 'api')),
      customer_name TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'processing', 'completed', 'cancelled')),
      total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (org_id, code)
    );
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      variant_id INTEGER NOT NULL REFERENCES product_variants(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      sku TEXT NOT NULL,
      name TEXT NOT NULL,
      unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
      price_source TEXT NOT NULL,
      qty INTEGER NOT NULL CHECK (qty > 0),
      line_total INTEGER NOT NULL CHECK (line_total >= 0),
      UNIQUE (order_id, variant_id)
    );
    CREATE TABLE IF NOT EXISTS order_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id),
      from_status TEXT,
      to_status TEXT NOT NULL,
      actor_id INTEGER NOT NULL REFERENCES users(id),
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
  },
  {
    // GOAL-006: thanh toan + hoan tien + lich su giao dich (D22).
    // payments: gateway_reference UNIQUE khi co gia tri (NULL khong xung
    // dot tren SQLite); refunds: ban ghi rieng, khong sua payment goc;
    // payment_events append-only (chi INSERT, khong API sua/xoa).
    version: 11,
    sql: `CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      branch_id INTEGER NOT NULL REFERENCES branches(id),
      order_id INTEGER NOT NULL REFERENCES orders(id),
      method TEXT NOT NULL CHECK (method IN ('cash', 'bank_transfer', 'gateway')),
      amount INTEGER NOT NULL CHECK (amount > 0),
      currency TEXT NOT NULL DEFAULT 'VND',
      status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'paid', 'failed', 'refunded', 'partially_refunded')),
      gateway_reference TEXT UNIQUE,
      received_by INTEGER NOT NULL REFERENCES users(id),
      received_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id INTEGER NOT NULL REFERENCES payments(id),
      amount INTEGER NOT NULL CHECK (amount > 0),
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('requested', 'completed', 'failed')),
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS payment_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id INTEGER NOT NULL REFERENCES payments(id),
      event_type TEXT NOT NULL,
      actor_id INTEGER REFERENCES users(id),
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
  },
  {
    // GOAL-007: giao hang + tra hang (D24/D25). shipments cap org gan don
    // (tracking_code UNIQUE toan cuc — deterministic theo shipment id nen
    // khong trung giua 2 lan giao); shipment_events/return_events
    // append-only (chi INSERT, khong API sua/xoa); returns ma TH-YYYYMMDD-
    // NNNN UNIQUE trong org; return_items snapshot gia tu order_items,
    // UNIQUE(return_id, variant_id).
    version: 12,
    sql: `CREATE TABLE IF NOT EXISTS shipments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      order_id INTEGER NOT NULL REFERENCES orders(id),
      carrier TEXT NOT NULL,
      tracking_code TEXT NOT NULL UNIQUE,
      destination TEXT NOT NULL,
      fee INTEGER NOT NULL CHECK (fee >= 0),
      eta_days INTEGER NOT NULL CHECK (eta_days > 0),
      status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'in_transit', 'delivered', 'failed')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS shipment_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shipment_id INTEGER NOT NULL REFERENCES shipments(id),
      event_type TEXT NOT NULL,
      actor_id INTEGER REFERENCES users(id),
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      order_id INTEGER NOT NULL REFERENCES orders(id),
      code TEXT NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'approved', 'rejected', 'received', 'refunded')),
      reviewed_by INTEGER REFERENCES users(id),
      received_by INTEGER REFERENCES users(id),
      review_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (org_id, code)
    );
    CREATE TABLE IF NOT EXISTS return_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_id INTEGER NOT NULL REFERENCES returns(id),
      variant_id INTEGER NOT NULL REFERENCES product_variants(id),
      qty INTEGER NOT NULL CHECK (qty > 0),
      condition TEXT NOT NULL CHECK (condition IN ('resalable', 'damaged')),
      unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
      UNIQUE (return_id, variant_id)
    );
    CREATE TABLE IF NOT EXISTS return_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_id INTEGER NOT NULL REFERENCES returns(id),
      event_type TEXT NOT NULL,
      actor_id INTEGER REFERENCES users(id),
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`,
  },
  {
    // GOAL-008: khách hàng + CRM (D26). customers cấp org, branch_id NULL
    // là chi nhánh chính chưa gán; UNIQUE(org_id, phone) cho phép nhiều
    // NULL trên SQLite; customer_points/customer_notes append-only (chỉ
    // INSERT, không API sửa/xóa); orders thêm customer_id NULL FK +
    // points_discount mặc định 0 (đơn cũ giữ NULL/0, hành vi không đổi).
    // Không có cột segment (tính ở service) và không có cột expires_at
    // (điểm không hết hạn).
    version: 13,
    sql: `CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      branch_id INTEGER REFERENCES branches(id),
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'merged')),
      merged_into_id INTEGER REFERENCES customers(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (org_id, phone)
    );
    CREATE TABLE IF NOT EXISTS customer_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      type TEXT NOT NULL CHECK (type IN ('earn', 'redeem')),
      points INTEGER NOT NULL CHECK (points > 0),
      reason TEXT NOT NULL,
      order_id INTEGER REFERENCES orders(id),
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS customer_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      org_id INTEGER NOT NULL REFERENCES orgs(id),
      author_id INTEGER NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    ALTER TABLE orders ADD COLUMN customer_id INTEGER NULL REFERENCES customers(id);
    ALTER TABLE orders ADD COLUMN points_discount INTEGER NOT NULL DEFAULT 0 CHECK (points_discount >= 0);`,
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
