import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcrypt';
import { migrate, openDb } from './db.js';

export interface SeedResult {
  orgId: number;
  branchId: number;
  ownerEmail: string;
  staffEmail: string;
}

export interface SeedPasswords {
  ownerPassword: string;
  staffPassword: string;
}

const OWNER_EMAIL = 'owner@example.local';
const STAFF_EMAIL = 'staff@example.local';

/**
 * Seed dữ liệu GIẢ LẬP tối thiểu: 1 org, 1 branch, 1 owner + 1 sales
 * (GOAL-002 remap staff cũ thành sales, giữ email staff@example.local).
 * Mật khẩu do người gọi cấp (biến môi trường hoặc sinh ngẫu nhiên ở CLI),
 * không có mật khẩu thật nào commit trong repo. Chạy lại thì không tạo trùng.
 */
export function seed(db: DatabaseSync, passwords: SeedPasswords): SeedResult {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  if (existing.c > 0) {
    const org = db.prepare('SELECT id FROM orgs ORDER BY id LIMIT 1').get() as { id: number };
    const branch = db.prepare('SELECT id FROM branches ORDER BY id LIMIT 1').get() as {
      id: number;
    };
    return { orgId: org.id, branchId: branch.id, ownerEmail: OWNER_EMAIL, staffEmail: STAFF_EMAIL };
  }
  const now = new Date().toISOString();
  const orgId = Number(
    db.prepare('INSERT INTO orgs (name, created_at) VALUES (?, ?)').run('Công ty Giả Lập', now)
      .lastInsertRowid,
  );
  const branchId = Number(
    db
      .prepare('INSERT INTO branches (org_id, name, created_at) VALUES (?, ?, ?)')
      .run(orgId, 'Chi nhánh Chính', now).lastInsertRowid,
  );
  // hashSync để giữ seed đồng bộ; login dùng hash/compare async ở auth.ts.
  // Cả hai đều là bcrypt cost 10.
  const ownerHash: string = bcrypt.hashSync(passwords.ownerPassword, 10);
  const staffHash: string = bcrypt.hashSync(passwords.staffPassword, 10);
  const ownerId = Number(
    db.prepare(
      'INSERT INTO users (org_id, branch_id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(orgId, branchId, OWNER_EMAIL, ownerHash, 'owner', now).lastInsertRowid,
  );
  db.prepare(
    'INSERT INTO users (org_id, branch_id, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(orgId, branchId, STAFF_EMAIL, staffHash, 'sales', now);
  seedSampleProducts(db, orgId, branchId, ownerId);
  return { orgId, branchId, ownerEmail: OWNER_EMAIL, staffEmail: STAFF_EMAIL };
}

/**
 * Sản phẩm mẫu GIẢ LẬP (GOAL-003): 2 danh mục, 2 sản phẩm, 1 biến thể,
 * 1 giá riêng theo kênh. Chỉ chạy khi migration 008 đã tạo bảng products
 * (DB cũ chưa migrate thì bỏ qua, không vỡ seed).
 * Kho mẫu (GOAL-004): 2 kho + mức tồn mẫu cho biến thể SP-SEED-01 — Kho
 * Chính chỉ có 3 (dưới min_stock 5 → tồn thấp để demo thấy được), Kho Phụ
 * có 20. Chỉ ghi stock_levels (không ghi stock_movements ở seed: movement
 * có actor_id FK tới users, test khóa GOAL-001 xóa users khi kiểm tra
 * backup/restore sẽ vỡ FK).
 */
function seedSampleProducts(db: DatabaseSync, orgId: number, branchId: number, ownerId: number): void {
  const hasProducts = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'products'")
    .get() as { name: string } | undefined;
  if (!hasProducts) return;
  const now = new Date().toISOString();
  const catClothes = Number(
    db
      .prepare('INSERT INTO categories (org_id, name, parent_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)')
      .run(orgId, 'Quần áo', now, now).lastInsertRowid,
  );
  const catHome = Number(
    db
      .prepare('INSERT INTO categories (org_id, name, parent_id, created_at, updated_at) VALUES (?, ?, NULL, ?, ?)')
      .run(orgId, 'Đồ gia dụng', now, now).lastInsertRowid,
  );
  const shirtId = Number(
    db
      .prepare(
        `INSERT INTO products (org_id, code, name, unit, price, min_stock, status, category_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      )
      .run(orgId, 'SP-SEED-01', 'Áo thun giả lập', 'cái', 150000, 5, catClothes, now, now)
      .lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO products (org_id, code, name, unit, price, min_stock, status, category_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
  ).run(orgId, 'SP-SEED-02', 'Nồi cơm điện giả lập', 'cái', 850000, 2, catHome, now, now);
  const variantId = Number(
    db.prepare(
      `INSERT INTO product_variants (org_id, product_id, sku, name, barcode, price_override, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
    ).run(orgId, shirtId, 'SKU-SEED-01-M', 'Size M', '8930000000011', now, now).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO product_prices (org_id, product_id, variant_id, channel, branch_id, price, created_at, updated_at)
     VALUES (?, ?, NULL, 'web', NULL, ?, ?, ?)`,
  ).run(orgId, shirtId, 160000, now, now);
  seedSampleStock(db, orgId, branchId, ownerId, variantId, now);
}

/** Kho + mức tồn mẫu (GOAL-004). Bỏ qua khi bảng warehouses chưa có. */
function seedSampleStock(
  db: DatabaseSync,
  orgId: number,
  branchId: number,
  _ownerId: number,
  variantId: number,
  now: string,
): void {
  const hasWarehouses = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'warehouses'")
    .get() as { name: string } | undefined;
  if (!hasWarehouses) return;
  const seedLevels: { name: string; onHand: number }[] = [
    { name: 'Kho Chính', onHand: 3 },
    { name: 'Kho Phụ', onHand: 20 },
  ];
  for (const seedLevel of seedLevels) {
    const warehouseId = Number(
      db
        .prepare(
          'INSERT INTO warehouses (org_id, name, branch_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(orgId, seedLevel.name, branchId, 'active', now, now).lastInsertRowid,
    );
    db.prepare(
      'INSERT INTO stock_levels (org_id, warehouse_id, variant_id, on_hand, reserved, updated_at) VALUES (?, ?, ?, ?, 0, ?)',
    ).run(orgId, warehouseId, variantId, seedLevel.onHand, now);
  }
}

const isMain = process.argv[1] !== undefined && process.argv[1].endsWith('seed.ts');
if (isMain) {
  const dbPath = process.env.OMNIFLOW_DB ?? 'data/omniflow.db';
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = openDb(dbPath);
  migrate(db);
  const ownerPassword =
    process.env.OMNIFLOW_SEED_OWNER_PASSWORD ?? randomBytes(12).toString('base64url');
  const staffPassword =
    process.env.OMNIFLOW_SEED_STAFF_PASSWORD ?? randomBytes(12).toString('base64url');
  const result = seed(db, { ownerPassword, staffPassword });
  console.log(`Seed xong: org ${result.orgId}, branch ${result.branchId}`);
  console.log(`  owner: ${result.ownerEmail}`);
  console.log(`  staff: ${result.staffEmail}`);
  if (process.env.OMNIFLOW_SEED_OWNER_PASSWORD === undefined) {
    console.log(`  mat khau owner (sinh ngau nhien, chi hien 1 lan): ${ownerPassword}`);
  }
  if (process.env.OMNIFLOW_SEED_STAFF_PASSWORD === undefined) {
    console.log(`  mat khau staff (sinh ngau nhien, chi hien 1 lan): ${staffPassword}`);
  }
  db.close();
}
