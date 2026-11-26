import { readFileSync } from 'node:fs';
import { test, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { migrate, openDb } from '../src/db.js';
import { effectivePrice, parseProductCsv } from '../src/products.js';
import { can, type Actor } from '../src/rbac.js';
import { seed } from '../src/seed.js';

// Mật khẩu GIẢ LẬP chỉ dùng cho test, không phải credential thật.
const OWNER_PASSWORD = 'gia-lap-owner-123';
const STAFF_PASSWORD = 'gia-lap-staff-123';

type Db = ReturnType<typeof openDb>;
type App = ReturnType<typeof createApp>;

function freshApp() {
  const db = openDb(':memory:');
  migrate(db);
  const seeded = seed(db, { ownerPassword: OWNER_PASSWORD, staffPassword: STAFF_PASSWORD });
  const app = createApp(db);
  return { db, app, seeded };
}

function addBranch(db: Db, orgId: number, name: string): number {
  return Number(
    db.prepare('INSERT INTO branches (org_id, name) VALUES (?, ?)').run(orgId, name)
      .lastInsertRowid,
  );
}

async function addUser(
  db: Db,
  orgId: number,
  branchId: number | null,
  email: string,
  role: string,
): Promise<number> {
  const hash = await hashPassword('gia-lap-123');
  return Number(
    db
      .prepare(
        'INSERT INTO users (org_id, branch_id, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
      )
      .run(orgId, branchId, email, hash, role).lastInsertRowid,
  );
}

async function addOrgB(db: Db) {
  const orgBId = Number(
    db.prepare('INSERT INTO orgs (name) VALUES (?)').run('Cong ty B gia lap').lastInsertRowid,
  );
  const branchBId = addBranch(db, orgBId, 'Chi nhanh B');
  const userBId = await addUser(db, orgBId, branchBId, 'owner-b@example.local', 'owner');
  return { orgBId, branchBId, userBId };
}

async function loginAgent(app: App, email: string, password: string) {
  const agent = request.agent(app);
  const res = await agent.post('/login').send({ email, password });
  expect(res.status).toBe(200);
  return agent;
}

type Agent = Awaited<ReturnType<typeof loginAgent>>;

async function ownerAgent(app: App, seeded: { ownerEmail: string }) {
  return loginAgent(app, seeded.ownerEmail, OWNER_PASSWORD);
}

async function salesAgent(app: App, seeded: { staffEmail: string }) {
  return loginAgent(app, seeded.staffEmail, STAFF_PASSWORD);
}

/** Bối cảnh đầy đủ: org A 2 chi nhánh + đủ 5 vai, org B 1 owner. */
async function fullCtx() {
  const { db, app, seeded } = freshApp();
  const orgId = seeded.orgId;
  const branch1 = seeded.branchId;
  const branch2 = addBranch(db, orgId, 'Chi nhanh 2');
  const managerId = await addUser(db, orgId, null, 'manager@example.local', 'manager');
  const warehouseId = await addUser(db, orgId, branch1, 'kho@example.local', 'warehouse');
  const accountantId = await addUser(db, orgId, branch1, 'ketoan@example.local', 'accountant');
  const sales2Id = await addUser(db, orgId, branch2, 'sales2@example.local', 'sales');
  const { orgBId, branchBId } = await addOrgB(db);
  const owner = await ownerAgent(app, seeded);
  const sales = await salesAgent(app, seeded);
  const manager = await loginAgent(app, 'manager@example.local', 'gia-lap-123');
  const warehouse = await loginAgent(app, 'kho@example.local', 'gia-lap-123');
  const accountant = await loginAgent(app, 'ketoan@example.local', 'gia-lap-123');
  const sales2 = await loginAgent(app, 'sales2@example.local', 'gia-lap-123');
  const ownerB = await loginAgent(app, 'owner-b@example.local', 'gia-lap-123');
  return {
    db, app, seeded, orgId, branch1, branch2, orgBId, branchBId,
    managerId, warehouseId, accountantId, sales2Id,
    owner, sales, manager, warehouse, accountant, sales2, ownerB,
  };
}

/** Lấy object danh mục từ response (trả trực tiếp hoặc bọc {category}). */
function asCategory(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (body.category as Record<string, unknown>) ?? body;
}

/** Lấy object sản phẩm từ response (worker trả trực tiếp hoặc bọc {product}). */
function asProduct(res: { body: unknown }): Record<string, unknown> {
  const body = res.body as Record<string, unknown>;
  return (body.product as Record<string, unknown>) ?? body;
}

/** Lấy mảng từ response (trả trực tiếp hoặc bọc {products}/{items}/{rows}). */
function asList(res: { body: unknown }): Record<string, unknown>[] {
  const body = res.body as Record<string, unknown>;
  if (Array.isArray(res.body)) return res.body as Record<string, unknown>[];
  for (const key of ['products', 'items', 'rows', 'prices', 'history']) {
    if (Array.isArray(body[key])) return body[key] as Record<string, unknown>[];
  }
  return [];
}

async function createProduct(
  agent: Agent,
  overrides: Record<string, unknown> = {},
): Promise<{ id: number; code: string }> {
  const code = (overrides.code as string) ?? `SP-${Math.random().toString(36).slice(2, 8)}`;
  const res = await agent.post('/api/products').send({
    code,
    name: 'San pham gia lap',
    price: 100000,
    unit: 'cai',
    ...overrides,
  });
  expect(res.status).toBe(201);
  const p = asProduct(res);
  expect(p.id).toBeDefined();
  return { id: p.id as number, code: p.code as string };
}

async function createVariant(
  agent: Agent,
  productId: number,
  overrides: Record<string, unknown> = {},
): Promise<number> {
  const sku = (overrides.sku as string) ?? `SKU-${Math.random().toString(36).slice(2, 8)}`;
  const res = await agent.post(`/api/products/${productId}/variants`).send({
    sku,
    name: 'Bien the gia lap',
    ...overrides,
  });
  expect(res.status).toBe(201);
  const v = (res.body as Record<string, unknown>).variant as Record<string, unknown> | undefined;
  const id = ((v ?? res.body) as Record<string, unknown>).id as number;
  expect(id).toBeDefined();
  return id;
}

async function setPrice(
  agent: Agent,
  productId: number,
  body: Record<string, unknown>,
): Promise<ReturnType<Agent['post']> extends never ? never : unknown> {
  return agent.post(`/api/products/${productId}/prices`).send({ reason: 'gia lap', ...body });
}

function csvText(...rows: string[]): string {
  return ['code,name,price,unit,min_stock,status,category,barcode', ...rows].join('\n');
}

// ---------- AC-1: sản phẩm + biến thể + danh mục ----------

test('AC-1 migration 008 tao du 7 bang san pham/gia/CSV', () => {
  const { db } = freshApp();
  const names = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);
  for (const t of [
    'products',
    'product_variants',
    'categories',
    'product_attributes',
    'product_images',
    'product_prices',
    'price_history',
  ]) {
    expect(names).toContain(t);
  }
  const cols = db.prepare('PRAGMA table_info(products)').all() as { name: string }[];
  for (const c of ['org_id', 'code', 'name', 'unit', 'price', 'min_stock', 'status', 'category_id']) {
    expect(cols.map((x) => x.name)).toContain(c);
  }
  const prod = db.prepare('SELECT COUNT(*) AS c FROM products').get() as { c: number };
  expect(prod.c).toBeGreaterThanOrEqual(0);
});

test('AC-1 seed mo rong them san pham mau, van giu 2 user', async () => {
  const { db, app, seeded } = freshApp();
  const users = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  expect(users.c).toBe(2);
  const owner = await ownerAgent(app, seeded);
  const res = await owner.get('/api/products');
  expect(res.status).toBe(200);
  expect(asList(res).length).toBeGreaterThanOrEqual(1);
});

test('AC-1 tao san pham 201, xem chi tiet kem bien the/thuoc tinh/anh', async () => {
  const { app, seeded } = freshApp();
  const owner = await ownerAgent(app, seeded);
  const { id } = await createProduct(owner, { code: 'SP-CHITIET', name: 'Ao thun' });
  const variantId = await createVariant(owner, id, { sku: 'SKU-CHITIET-M' });
  const attr = await owner.post(`/api/products/${id}/attributes`).send({ key: 'mau', value: 'do' });
  expect(attr.status).toBe(201);
  const img = await owner
    .post(`/api/products/${id}/images`)
    .send({ url: 'https://example.local/ao.jpg', alt_text: 'Ao do' });
  expect(img.status).toBe(201);
  const detail = await owner.get(`/api/products/${id}`);
  expect(detail.status).toBe(200);
  const d = asProduct(detail);
  expect(d.code).toBe('SP-CHITIET');
  expect(d.name).toBe('Ao thun');
  const variants = (d.variants as unknown[] | undefined) ?? [];
  expect(variants.length).toBe(1);
  expect((variants[0] as Record<string, unknown>).id).toBe(variantId);
  expect(((d.attributes as unknown[] | undefined) ?? []).length).toBe(1);
  expect(((d.images as unknown[] | undefined) ?? []).length).toBe(1);
});

test('AC-1 tao san pham sai du lieu bi 400: ten rong, gia am, gia khong nguyen, min_stock am', async () => {
  const { app, seeded } = freshApp();
  const owner = await ownerAgent(app, seeded);
  const bad = [
    { code: 'SP-E1', name: '  ', price: 1000, unit: 'cai' },
    { code: 'SP-E2', name: 'X', price: -5, unit: 'cai' },
    { code: 'SP-E3', name: 'X', price: 10.5, unit: 'cai' },
    { code: 'SP-E4', name: 'X', price: 1000, unit: 'cai', min_stock: -1 },
  ];
  for (const body of bad) {
    const res = await owner.post('/api/products').send(body);
    expect(res.status).toBe(400);
  }
});

test('AC-1 trung ma san pham trong org bi 409, ma giong nhau o org khac thi DUOC', async () => {
  const ctx = await fullCtx();
  await createProduct(ctx.owner, { code: 'SP-TRUNG' });
  const dup = await ctx.owner.post('/api/products').send({
    code: 'SP-TRUNG',
    name: 'Trung ma',
    price: 1000,
    unit: 'cai',
  });
  expect(dup.status).toBe(409);
  expect(JSON.stringify(dup.body)).toMatch(/SP-TRUNG/);
  const other = await ctx.ownerB.post('/api/products').send({
    code: 'SP-TRUNG',
    name: 'Ma giong org khac',
    price: 1000,
    unit: 'cai',
  });
  expect(other.status).toBe(201);
});

test('AC-1 trung SKU trong org bi 409, SKU giong nhau o org khac thi DUOC', async () => {
  const ctx = await fullCtx();
  const { id } = await createProduct(ctx.owner, { code: 'SP-SKU1' });
  await createVariant(ctx.owner, id, { sku: 'SKU-DUP' });
  const dup = await ctx.owner.post(`/api/products/${id}/variants`).send({
    sku: 'SKU-DUP',
    name: 'Trung SKU',
  });
  expect(dup.status).toBe(409);
  expect(JSON.stringify(dup.body)).toMatch(/SKU-DUP/);
  const { id: idB } = await createProduct(ctx.ownerB, { code: 'SP-SKU-B' });
  const okB = await ctx.ownerB.post(`/api/products/${idB}/variants`).send({
    sku: 'SKU-DUP',
    name: 'SKU giong org khac',
  });
  expect(okB.status).toBe(201);
});

test('AC-1 trung barcode trong org bi 409, SKU rong va price_override am bi 400', async () => {
  const ctx = await fullCtx();
  const { id } = await createProduct(ctx.owner, { code: 'SP-BC1' });
  await createVariant(ctx.owner, id, { sku: 'SKU-BC1', barcode: '8931234567890' });
  const dupBc = await ctx.owner.post(`/api/products/${id}/variants`).send({
    sku: 'SKU-BC2',
    name: 'Trung barcode',
    barcode: '8931234567890',
  });
  expect(dupBc.status).toBe(409);
  expect(JSON.stringify(dupBc.body)).toMatch(/8931234567890/);
  const emptySku = await ctx.owner.post(`/api/products/${id}/variants`).send({
    sku: '  ',
    name: 'SKU rong',
  });
  expect(emptySku.status).toBe(400);
  const negOverride = await ctx.owner.post(`/api/products/${id}/variants`).send({
    sku: 'SKU-BC3',
    name: 'Override am',
    price_override: -100,
  });
  expect(negOverride.status).toBe(400);
});

test('AC-1 tao bien the cho san pham ngoai org bi 403, san pham khong ton tai bi 404', async () => {
  const ctx = await fullCtx();
  const { id } = await createProduct(ctx.owner, { code: 'SP-NGOAI' });
  const cross = await ctx.ownerB.post(`/api/products/${id}/variants`).send({
    sku: 'SKU-X',
    name: 'Ngoai org',
  });
  expect(cross.status).toBe(403);
  const missing = await ctx.owner.post('/api/products/999999/variants').send({
    sku: 'SKU-Y',
    name: 'Khong ton tai',
  });
  expect(missing.status).toBe(404);
});

test('AC-1 danh muc: tao/liet ke/sua; danh muc cha khac org bi 403; thuoc tinh/anh them xoa duoc', async () => {
  const ctx = await fullCtx();
  const cat = await ctx.owner.post('/api/categories').send({ name: 'Do gia dung' });
  expect(cat.status).toBe(201);
  const catId = asCategory(cat).id as number;
  const catB = await ctx.ownerB.post('/api/categories').send({ name: 'Danh muc B' });
  expect(catB.status).toBe(201);
  const catBId = asCategory(catB).id as number;
  const crossParent = await ctx.owner.post('/api/categories').send({
    name: 'Con cua B',
    parent_id: catBId,
  });
  expect(crossParent.status).toBe(403);
  const child = await ctx.owner.post('/api/categories').send({ name: 'Noi that', parent_id: catId });
  expect(child.status).toBe(201);
  const list = await ctx.owner.get('/api/categories');
  expect(list.status).toBe(200);
  expect(asList(list).some((c) => c.name === 'Do gia dung')).toBe(true);
  expect(asList(list).some((c) => c.name === 'Danh muc B')).toBe(false);
  const patch = await ctx.owner.patch(`/api/categories/${catId}`).send({ name: 'Do gia dung moi' });
  expect(patch.status).toBe(200);
  const { id } = await createProduct(ctx.owner, { code: 'SP-ATTR', category_id: catId });
  const emptyKey = await ctx.owner.post(`/api/products/${id}/attributes`).send({ key: ' ', value: 'x' });
  expect(emptyKey.status).toBe(400);
  const attr = await ctx.owner.post(`/api/products/${id}/attributes`).send({ key: 'chat_lieu', value: 'go' });
  expect(attr.status).toBe(201);
  const attrId = ((attr.body as Record<string, unknown>).attribute as Record<string, unknown> | undefined)?.id
    ?? (attr.body as Record<string, unknown>).id;
  const delAttr = await ctx.owner.delete(`/api/products/${id}/attributes/${attrId as number}`);
  expect([200, 204]).toContain(delAttr.status);
  const img = await ctx.owner.post(`/api/products/${id}/images`).send({ url: '/img/a.png' });
  expect(img.status).toBe(201);
  const imgId = ((img.body as Record<string, unknown>).image as Record<string, unknown> | undefined)?.id
    ?? (img.body as Record<string, unknown>).id;
  const delImg = await ctx.owner.delete(`/api/products/${id}/images/${imgId as number}`);
  expect([200, 204]).toContain(delImg.status);
  const detail = await ctx.owner.get(`/api/products/${id}`);
  expect((((asProduct(detail).attributes as unknown[]) ?? []).length)).toBe(0);
  expect((((asProduct(detail).images as unknown[]) ?? []).length)).toBe(0);
});

test('AC-1 liet ke san pham: loc status/category, tim code/name, phan trang, chi thay org minh', async () => {
  const ctx = await fullCtx();
  const cat = await ctx.owner.post('/api/categories').send({ name: 'Loc danh muc' });
  const catId = asCategory(cat).id as number;
  await createProduct(ctx.owner, { code: 'SP-LOC-A', name: 'Banh mi dac biet', category_id: catId });
  await createProduct(ctx.owner, { code: 'SP-LOC-B', name: 'Sua tuoi', status: 'discontinued' });
  await createProduct(ctx.ownerB, { code: 'SP-LOC-C', name: 'Hang org B' });
  const byStatus = await ctx.owner.get('/api/products?status=discontinued');
  expect(byStatus.status).toBe(200);
  expect(asList(byStatus).every((p) => p.status === 'discontinued')).toBe(true);
  expect(asList(byStatus).some((p) => p.code === 'SP-LOC-B')).toBe(true);
  const byCat = await ctx.owner.get(`/api/products?category_id=${catId}`);
  expect(asList(byCat).some((p) => p.code === 'SP-LOC-A')).toBe(true);
  expect(asList(byCat).some((p) => p.code === 'SP-LOC-B')).toBe(false);
  const search = await ctx.owner.get('/api/products?q=Banh%20mi');
  expect(search.status).toBe(200);
  expect(asList(search).some((p) => p.code === 'SP-LOC-A')).toBe(true);
  const page = await ctx.owner.get('/api/products?limit=1&offset=0');
  expect(asList(page).length).toBeLessThanOrEqual(1);
  const all = await ctx.owner.get('/api/products');
  expect(asList(all).some((p) => p.code === 'SP-LOC-C')).toBe(false);
  const allB = await ctx.ownerB.get('/api/products');
  expect(asList(allB).some((p) => p.code === 'SP-LOC-C')).toBe(true);
  expect(asList(allB).some((p) => p.code === 'SP-LOC-A')).toBe(false);
});

test('AC-1 ngung kinh doanh giu san pham + lich su, cam tao bien the va doi gia, mo ban lai duoc', async () => {
  const ctx = await fullCtx();
  const { id } = await createProduct(ctx.owner, { code: 'SP-NGUNG', price: 50000 });
  const hist0 = await ctx.owner.post(`/api/products/${id}/prices`).send({
    channel: 'web',
    price: 55000,
    reason: 'gia web',
  });
  expect(hist0.status).toBe(201);
  const stop = await ctx.owner.patch(`/api/products/${id}/status`).send({ status: 'discontinued' });
  expect(stop.status).toBe(200);
  const detail = await ctx.owner.get(`/api/products/${id}`);
  expect(detail.status).toBe(200);
  expect(asProduct(detail).status).toBe('discontinued');
  const hist = await ctx.owner.get(`/api/products/${id}/price-history`);
  expect(hist.status).toBe(200);
  expect(asList(hist).length).toBeGreaterThanOrEqual(1);
  const noVariant = await ctx.owner.post(`/api/products/${id}/variants`).send({
    sku: 'SKU-NGUNG',
    name: 'Khong duoc tao',
  });
  expect(noVariant.status).toBe(400);
  const noPrice = await ctx.owner.post(`/api/products/${id}/prices`).send({
    channel: 'web',
    price: 60000,
    reason: 'doi gia khi ngung',
  });
  expect(noPrice.status).toBe(400);
  const reopen = await ctx.owner.patch(`/api/products/${id}/status`).send({ status: 'active' });
  expect(reopen.status).toBe(200);
  const okVariant = await ctx.owner.post(`/api/products/${id}/variants`).send({
    sku: 'SKU-NGUNG',
    name: 'Tao lai duoc',
  });
  expect(okVariant.status).toBe(201);
});

test('AC-1 khong co endpoint DELETE san pham: DELETE tra 404/405 va san pham van doc duoc', async () => {
  const ctx = await fullCtx();
  const { id } = await createProduct(ctx.owner, { code: 'SP-KHONGXOA' });
  const del = await ctx.owner.delete(`/api/products/${id}`);
  expect([404, 405]).toContain(del.status);
  const still = await ctx.owner.get(`/api/products/${id}`);
  expect(still.status).toBe(200);
});

// ---------- AC-2: giá theo kênh/chi nhánh + lịch sử giá ----------

test('AC-2 fallback buoc 1: gia rieng bien the theo kenh + chi nhanh thang', async () => {
  const ctx = await fullCtx();
  const { id } = await createProduct(ctx.owner, { code: 'SP-FB1', price: 100000 });
  const v = await createVariant(ctx.owner, id, { sku: 'SKU-FB1' });
  const set = await setPrice(ctx.owner, id, {
    variant_id: v,
    channel: 'web',
    branch_id: ctx.branch2,
    price: 111000,
  });
  expect(set.status).toBe(201);
  const res = await ctx.owner.get(
    `/api/products/${id}/price?channel=web&branch_id=${ctx.branch2}&variant_id=${v}`,
  );
  expect(res.status).toBe(200);
  expect(res.body.price).toBe(111000);
  expect(res.body.source).toBe('variant_channel_branch');
});

test('AC-2 fallback buoc 2: gia rieng bien the theo kenh (khong co gia kenh+chi nhanh)', async () => {
  const ctx = await fullCtx();
  const { id } = await createProduct(ctx.owner, { code: 'SP-FB2', price: 100000 });
  const v = await createVariant(ctx.owner, id, { sku: 'SKU-FB2' });
  expect((await setPrice(ctx.owner, id, { variant_id: v, channel: 'web', price: 122000 })).status).toBe(201);
  const res = await ctx.owner.get(
    `/api/products/${id}/price?channel=web&branch_id=${ctx.branch2}&variant_id=${v}`,
  );
  expect(res.status).toBe(200);
  expect(res.body.price).toBe(122000);
  expect(res.body.source).toBe('variant_channel');
});

test('AC-2 fallback buoc 3: gia rieng bien the theo chi nhanh', async () => {
  const ctx = await fullCtx();
  const { id } = await createProduct(ctx.owner, { code: 'SP-FB3', price: 100000 });
  const v = await createVariant(ctx.owner, id, { sku: 'SKU-FB3' });
  expect(
    (await setPrice(ctx.owner, id, { variant_id: v, branch_id: ctx.branch2, price: 133000 })).status,
  ).toBe(201);
  const res = await ctx.owner.get(
    `/api/products/${id}/price?channel=web&branch_id=${ctx.branch2}&variant_id=${v}`,
  );
  expect(res.status).toBe(200);
  expect(res.body.price).toBe(133000);
  expect(res.body.source).toBe('variant_branch');
});

test('AC-2 fallback buoc 4: gia rieng san pham theo kenh + chi nhanh', async () => {
  const ctx = await fullCtx();
  const { id } = await createProduct(ctx.owner, { code: 'SP-FB4', price: 100000 });
  expect(
    (await setPrice(ctx.owner, id, { channel: 'web', branch_id: ctx.branch2, price: 144000 })).status,
  ).toBe(201);
  const res = await ctx.owner.get(`/api/products/${id}/price?channel=web&branch_id=${ctx.branch2}`);
  expect(res.status).toBe(200);
  expect(res.body.price).toBe(144000);
  expect(res.body.source).toBe('channel_branch');
});

test('AC-2 fallback buoc 5: gia rieng san pham theo kenh', async () => {
  const ctx = await fullCtx();
  const { id } = await createProduct(ctx.owner, { code: 'SP-FB5', price: 100000 });
  expect((await setPrice(ctx.owner, id, { channel: 'web', price: 155000 })).status).toBe(201);
  const res = await ctx.owner.get(`/api/products/${id}/price?channel=web&branch_id=${ctx.branch2}`);
  expect(res.status).toBe(200);
  expect(res.body.price).toBe(155000);
  expect(res.body.source).toBe('channel');
});

test('AC-2 fallback buoc 6: gia rieng san pham theo chi nhanh', async () => {
  const ctx = await fullCtx();
  const { id } = await createProduct(ctx.owner, { code: 'SP-FB6', price: 100000 });
  expect((await setPrice(ctx.owner, id, { branch_id: ctx.branch2, price: 166000 })).status).toBe(201);
  const res = await ctx.owner.get(`/api/products/${id}/price?channel=web&branch_id=${ctx.branch2}`);
  expect(res.status).toBe(200);
  expect(res.body.price).toBe(166000);
  expect(res.body.source).toBe('branch');
});

test('AC-2 fallback buoc 7: price_override cua bien the khi khong co gia rieng', async () => {
  const ctx = await fullCtx();
  const { id } = await createProduct(ctx.owner, { code: 'SP-FB7', price: 100000 });
  const v = await createVariant(ctx.owner, id, { sku: 'SKU-FB7', price_override: 177000 });
  const res = await ctx.owner.get(
    `/api/products/${id}/price?channel=web&branch_id=${ctx.branch2}&variant_id=${v}`,
  );
  expect(res.status).toBe(200);
  expect(res.body.price).toBe(177000);
  expect(res.body.source).toBe('variant_override');
});

test('AC-2 fallback buoc 8: khong co gia rieng thi ve gia chuan', async () => {
  const ctx = await fullCtx();
  const { id } = await createProduct(ctx.owner, { code: 'SP-FB8', price: 100000 });
  const v = await createVariant(ctx.owner, id, { sku: 'SKU-FB8' });
  const res = await ctx.owner.get(
    `/api/products/${id}/price?channel=web&branch_id=${ctx.branch2}&variant_id=${v}`,
  );
  expect(res.status).toBe(200);
  expect(res.body.price).toBe(100000);
  expect(res.body.source).toBe('base');
});

test('AC-2 effectivePrice tuan thu dung thu tu fallback 8 buoc', () => {
  const base = { basePrice: 100, variantOverride: 70 };
  expect(effectivePrice(base)).toEqual({ price: 70, source: 'variant_override' });
  expect(effectivePrice({ basePrice: 100 })).toEqual({ price: 100, source: 'base' });
  expect(effectivePrice({ ...base, productBranch: 60 })).toEqual({ price: 60, source: 'branch' });
  expect(effectivePrice({ ...base, productBranch: 60, productChannel: 50 })).toEqual({
    price: 50,
    source: 'channel',
  });
  expect(
    effectivePrice({ ...base, productBranch: 60, productChannel: 50, productChannelBranch: 40 }),
  ).toEqual({ price: 40, source: 'channel_branch' });
  expect(
    effectivePrice({ ...base, productChannelBranch: 40, variantBranch: 30 }),
  ).toEqual({ price: 30, source: 'variant_branch' });
  expect(
    effectivePrice({ ...base, variantBranch: 30, variantChannel: 20 }),
  ).toEqual({ price: 20, source: 'variant_channel' });
  expect(
    effectivePrice({ ...base, variantChannel: 20, variantChannelBranch: 10 }),
  ).toEqual({ price: 10, source: 'variant_channel_branch' });
});

test('AC-2 dat gia rieng: thieu reason bi 400, kenh la bi 400, gia am bi 400', async () => {
  const ctx = await fullCtx();
  const { id } = await createProduct(ctx.owner, { code: 'SP-GIA400' });
  const noReason = await ctx.owner.post(`/api/products/${id}/prices`).send({
    channel: 'web',
    price: 120000,
  });
  expect(noReason.status).toBe(400);
  const badChannel = await ctx.owner.post(`/api/products/${id}/prices`).send({
    channel: 'shopee',
    price: 120000,
    reason: 'kenh la',
  });
  expect(badChannel.status).toBe(400);
  const neg = await ctx.owner.post(`/api/products/${id}/prices`).send({
    channel: 'web',
    price: -1,
    reason: 'gia am',
  });
  expect(neg.status).toBe(400);
});

test('AC-2 dat lai gia rieng cung to hop thi ghi de (khong tao dong trung), gia trung bi 400', async () => {
  const ctx = await fullCtx();
  const { id } = await createProduct(ctx.owner, { code: 'SP-GHIDE' });
  expect((await setPrice(ctx.owner, id, { channel: 'web', price: 120000 })).status).toBe(201);
  const overwrite = await setPrice(ctx.owner, id, { channel: 'web', price: 130000 });
  expect(overwrite.status).toBe(201);
  const list = await ctx.owner.get(`/api/products/${id}/prices`);
  expect(list.status).toBe(200);
  const webPrices = asList(list).filter((p) => p.channel === 'web' && p.branch_id == null);
  expect(webPrices.length).toBe(1);
  expect(webPrices[0].price).toBe(130000);
  const same = await setPrice(ctx.owner, id, { channel: 'web', price: 130000 });
  expect(same.status).toBe(400);
});

test('AC-2 doi gia chuan: thieu reason bi 400, gia trung bi 400, gia moi ghi lich su', async () => {
  const ctx = await fullCtx();
  const { id } = await createProduct(ctx.owner, { code: 'SP-DOIGIA', price: 100000 });
  const noReason = await ctx.owner.patch(`/api/products/${id}`).send({ price: 110000 });
  expect(noReason.status).toBe(400);
  const same = await ctx.owner.patch(`/api/products/${id}`).send({ price: 100000, reason: 'trung' });
  expect(same.status).toBe(400);
  const ok = await ctx.owner.patch(`/api/products/${id}`).send({ price: 110000, reason: 'tang gia' });
  expect(ok.status).toBe(200);
  const hist = await ctx.owner.get(`/api/products/${id}/price-history`);
  expect(asList(hist).some((h) => h.new_price === 110000 && h.old_price === 100000)).toBe(true);
});

test('AC-2 lich su gia append-only: doi gia 2 lan co 2 dong moi nhat truoc, khong sua/xoa duoc', async () => {
  const ctx = await fullCtx();
  const { id } = await createProduct(ctx.owner, { code: 'SP-LICHSU', price: 100000 });
  expect(
    (await ctx.owner.patch(`/api/products/${id}`).send({ price: 110000, reason: 'lan 1' })).status,
  ).toBe(200);
  expect(
    (await ctx.owner.patch(`/api/products/${id}`).send({ price: 120000, reason: 'lan 2' })).status,
  ).toBe(200);
  const hist = await ctx.owner.get(`/api/products/${id}/price-history`);
  expect(hist.status).toBe(200);
  const rows = asList(hist);
  expect(rows.length).toBe(2);
  expect(rows[0].new_price).toBe(120000);
  expect(rows[0].old_price).toBe(110000);
  expect(rows[0].reason).toBe('lan 2');
  expect(rows[1].new_price).toBe(110000);
  expect(rows[1].old_price).toBe(100000);
  expect(rows[0].changed_by).toBeDefined();
  const patchHist = await ctx.owner.patch(`/api/products/${id}/price-history`).send({ reason: 'sua' });
  expect([404, 405]).toContain(patchHist.status);
  const delHist = await ctx.owner.delete(`/api/products/${id}/price-history`);
  expect([404, 405]).toContain(delHist.status);
  const again = await ctx.owner.get(`/api/products/${id}/price-history`);
  expect(asList(again).length).toBe(2);
});

test('AC-2 parseProductCsv xu ly BOM, dau phay trong ten co ngoac kep, bo dong trong', () => {
  const parsed = parseProductCsv(
    '\uFEFFcode,name,price,unit\nSP-A,"Ao, thun co tron",100000,cai\n\nSP-B,Quan dai,200000,cai\n',
  );
  expect(parsed.header).toEqual(['code', 'name', 'price', 'unit']);
  expect(parsed.records.length).toBe(2);
  expect(parsed.records[0].name).toBe('Ao, thun co tron');
  expect(parsed.records[1].code).toBe('SP-B');
});

// ---------- AC-3: CSV preview/import/export ----------

test('AC-3 preview bao loi tung dong (so dong + ly do) ma khong ghi dong nao', async () => {
  const ctx = await fullCtx();
  const before = await ctx.owner.get('/api/products');
  const beforeCount = asList(before).length;
  const text = csvText(
    'SP-PV1,,100000,cai',
    'SP-PV2,Quan dai,-5000,cai',
    'SP-PV3,Ao khoac,150000,cai',
  );
  const res = await ctx.owner
    .post('/api/products/import/preview')
    .attach('file', Buffer.from(text, 'utf8'), 'preview.csv');
  expect(res.status).toBe(200);
  expect(Array.isArray(res.body.errors)).toBe(true);
  expect(res.body.errors.length).toBe(2);
  const lines = (res.body.errors as { line: number }[]).map((e) => e.line).sort();
  expect(lines).toEqual([2, 3]);
  expect(res.body.errors.every((e: { reason: string }) => typeof e.reason === 'string' && e.reason.length > 0)).toBe(true);
  expect(Array.isArray(res.body.valid)).toBe(true);
  expect(res.body.valid.length).toBe(1);
  expect(res.body.summary).toBeDefined();
  const after = await ctx.owner.get('/api/products');
  expect(asList(after).length).toBe(beforeCount);
});

test('AC-3 preview: ten chua dau phay duoc chap nhan, dong trong cuoi file bi bo qua', async () => {
  const ctx = await fullCtx();
  const text = csvText('"SP-PV-C","Ao, thun co tron",100000,cai', '', '');
  const res = await ctx.owner
    .post('/api/products/import/preview')
    .attach('file', Buffer.from(text, 'utf8'), 'preview.csv');
  expect(res.status).toBe(200);
  expect(res.body.errors.length).toBe(0);
  expect(res.body.valid.length).toBe(1);
});

test('AC-3 preview: header thieu cot bat buoc bi 400 toan file', async () => {
  const ctx = await fullCtx();
  const text = 'code,name,unit\nSP-X,Ao,cai';
  const res = await ctx.owner
    .post('/api/products/import/preview')
    .attach('file', Buffer.from(text, 'utf8'), 'preview.csv');
  expect(res.status).toBe(400);
});

test('AC-3 preview: ma trung nhau trong cung file thi loi ca hai dong trung', async () => {
  const ctx = await fullCtx();
  const text = csvText(
    'SP-DUPFILE,Ao mot,100000,cai',
    'SP-DUPFILE,Ao hai,120000,cai',
    'SP-RIENG,Ao ba,130000,cai',
  );
  const res = await ctx.owner
    .post('/api/products/import/preview')
    .attach('file', Buffer.from(text, 'utf8'), 'preview.csv');
  expect(res.status).toBe(200);
  const lines = (res.body.errors as { line: number }[]).map((e) => e.line).sort();
  expect(lines).toEqual([2, 3]);
  expect(res.body.valid.length).toBe(1);
});

test('AC-3 import atomic: 1 dong loi trong 3 dong tra 422 va 0 dong duoc ghi', async () => {
  const ctx = await fullCtx();
  const before = await ctx.owner.get('/api/products');
  const beforeCount = asList(before).length;
  const text = csvText(
    'SP-IM1,Ao mot,100000,cai',
    'SP-IM2,Quan hai,-100,cai',
    'SP-IM3,Ao ba,130000,cai',
  );
  const res = await ctx.owner
    .post('/api/products/import')
    .attach('file', Buffer.from(text, 'utf8'), 'import.csv');
  expect(res.status).toBe(422);
  expect(Array.isArray(res.body.errors)).toBe(true);
  expect(res.body.errors.length).toBe(1);
  expect(res.body.errors[0].line).toBe(3);
  const after = await ctx.owner.get('/api/products');
  expect(asList(after).length).toBe(beforeCount);
});

test('AC-3 import file sach tra 201 {imported: n} va ghi du san pham', async () => {
  const ctx = await fullCtx();
  const text = csvText(
    'SP-IMS1,Ao mot,100000,cai',
    'SP-IMS2,Quan hai,200000,cai,5,active,Do gia dung,',
  );
  const res = await ctx.owner
    .post('/api/products/import')
    .attach('file', Buffer.from(text, 'utf8'), 'import.csv');
  expect(res.status).toBe(201);
  expect(res.body.imported).toBe(2);
  const list = await ctx.owner.get('/api/products');
  expect(asList(list).some((p) => p.code === 'SP-IMS1')).toBe(true);
  expect(asList(list).some((p) => p.code === 'SP-IMS2')).toBe(true);
});

test('AC-3 import trung ma voi DB tra 422 theo dong va khong ghi dong nao', async () => {
  const ctx = await fullCtx();
  await createProduct(ctx.owner, { code: 'SP-IMDUP' });
  const text = csvText('SP-IMDUP,Ao trung,100000,cai', 'SP-IMMOI,Ao moi,120000,cai');
  const before = await ctx.owner.get('/api/products');
  const beforeCount = asList(before).length;
  const res = await ctx.owner
    .post('/api/products/import')
    .attach('file', Buffer.from(text, 'utf8'), 'import.csv');
  expect(res.status).toBe(422);
  expect(res.body.errors[0].line).toBe(2);
  const after = await ctx.owner.get('/api/products');
  expect(asList(after).length).toBe(beforeCount);
});

test('AC-3 import vuot 1000 dong bi 400', async () => {
  const ctx = await fullCtx();
  const rows: string[] = [];
  for (let i = 0; i < 1001; i++) rows.push(`SP-LIM-${i},San pham ${i},1000,cai`);
  const res = await ctx.owner
    .post('/api/products/import')
    .attach('file', Buffer.from(csvText(...rows), 'utf8'), 'import.csv');
  expect(res.status).toBe(400);
});

test('AC-3 export khop du lieu hien tai, loc theo org/status, org rong van tra header', async () => {
  const ctx = await fullCtx();
  await createProduct(ctx.owner, { code: 'SP-EXP1', name: 'Hang xuat 1', price: 100000 });
  await createProduct(ctx.owner, { code: 'SP-EXP2', name: 'Hang xuat 2', price: 200000, status: 'discontinued' });
  await createProduct(ctx.ownerB, { code: 'SP-EXP-B', name: 'Hang org B' });
  const res = await ctx.owner.get('/api/products/export');
  expect(res.status).toBe(200);
  expect(res.text).toContain('code,name,price,unit,min_stock,status,category,barcode');
  expect(res.text).toContain('SP-EXP1');
  expect(res.text).toContain('SP-EXP2');
  expect(res.text).not.toContain('SP-EXP-B');
  const filtered = await ctx.owner.get('/api/products/export?status=discontinued');
  expect(filtered.text).toContain('SP-EXP2');
  expect(filtered.text).not.toContain('SP-EXP1');
  // Org C mới toanh, chưa có sản phẩm nào: export vẫn trả header + 0 dòng.
  const orgCId = Number(
    ctx.db.prepare('INSERT INTO orgs (name) VALUES (?)').run('Cong ty C gia lap').lastInsertRowid,
  );
  const branchCId = addBranch(ctx.db, orgCId, 'Chi nhanh C');
  await addUser(ctx.db, orgCId, branchCId, 'owner-c@example.local', 'owner');
  const ownerC = await loginAgent(ctx.app, 'owner-c@example.local', 'gia-lap-123');
  const empty = await ownerC.get('/api/products/export');
  expect(empty.status).toBe(200);
  const linesB = empty.text.trim().split('\n');
  expect(linesB[0]).toContain('code,name,price,unit,min_stock,status,category,barcode');
  expect(linesB.length).toBe(1);
});

test('AC-3 export round-trip: preview file vua export bao trung ma voi DB', async () => {
  const ctx = await fullCtx();
  await createProduct(ctx.owner, { code: 'SP-RT1', name: 'Hang round-trip', price: 100000 });
  const exported = await ctx.owner.get('/api/products/export');
  expect(exported.status).toBe(200);
  const preview = await ctx.owner
    .post('/api/products/import/preview')
    .attach('file', Buffer.from(exported.text, 'utf8'), 'roundtrip.csv');
  expect(preview.status).toBe(200);
  expect(preview.body.errors.length).toBeGreaterThanOrEqual(1);
  expect(
    (preview.body.errors as { reason: string }[]).some((e) => /trùng/i.test(e.reason)),
  ).toBe(true);
});

// ---------- AC-4: RBAC + audit + docs + checks ----------

test('AC-4 can() cho phep dung vai dung pham vi voi 8 actions moi', () => {
  const owner: Actor = { id: 1, orgId: 1, branchId: null, role: 'owner', status: 'active' };
  const manager: Actor = { id: 2, orgId: 1, branchId: null, role: 'manager', status: 'active' };
  const accountant: Actor = { id: 3, orgId: 1, branchId: 1, role: 'accountant', status: 'active' };
  const sales: Actor = { id: 4, orgId: 1, branchId: 1, role: 'sales', status: 'active' };
  const org = { orgId: 1 };
  expect(can(owner, 'create-product', org)).toBe(true);
  expect(can(owner, 'discontinue-product', org)).toBe(true);
  expect(can(owner, 'manage-category', org)).toBe(true);
  expect(can(owner, 'change-price', org)).toBe(true);
  expect(can(owner, 'view-price-history', org)).toBe(true);
  expect(can(owner, 'import-csv', org)).toBe(true);
  expect(can(owner, 'export-csv', org)).toBe(true);
  expect(can(manager, 'create-product', org)).toBe(true);
  expect(can(manager, 'change-price', org)).toBe(true);
  expect(can(manager, 'import-csv', org)).toBe(true);
  expect(can(accountant, 'view-price-history', org)).toBe(true);
  expect(can(accountant, 'export-csv', org)).toBe(true);
  expect(can(sales, 'export-csv', org)).toBe(true);
  expect(can(sales, 'update-product', org)).toBe(true);
});

test('AC-4 RBAC 403 qua HTTP: sales doi gia, warehouse tao san pham, sales ngung kinh doanh, sales import CSV', async () => {
  const ctx = await fullCtx();
  const { id } = await createProduct(ctx.owner, { code: 'SP-RBAC1' });
  const salesPrice = await ctx.sales.post(`/api/products/${id}/prices`).send({
    channel: 'web',
    price: 120000,
    reason: 'sales doi gia',
  });
  expect(salesPrice.status).toBe(403);
  const whCreate = await ctx.warehouse.post('/api/products').send({
    code: 'SP-RBAC-WH',
    name: 'Kho tao',
    price: 1000,
    unit: 'cai',
  });
  expect(whCreate.status).toBe(403);
  const salesStop = await ctx.sales.patch(`/api/products/${id}/status`).send({ status: 'discontinued' });
  expect(salesStop.status).toBe(403);
  const text = csvText('SP-RBAC-CSV,Ao,100000,cai');
  const salesImport = await ctx.sales
    .post('/api/products/import')
    .attach('file', Buffer.from(text, 'utf8'), 'import.csv');
  expect(salesImport.status).toBe(403);
  const salesCategory = await ctx.sales.post('/api/categories').send({ name: 'Sales tao danh muc' });
  expect(salesCategory.status).toBe(403);
  const acctCreate = await ctx.accountant.post('/api/products').send({
    code: 'SP-RBAC-AC',
    name: 'Ke toan tao',
    price: 1000,
    unit: 'cai',
  });
  expect(acctCreate.status).toBe(403);
});

test('AC-4 lich su gia: accountant xem duoc, warehouse bi 403, sales bi 403', async () => {
  const ctx = await fullCtx();
  const { id } = await createProduct(ctx.owner, { code: 'SP-RBAC2', price: 100000 });
  expect(
    (await ctx.owner.patch(`/api/products/${id}`).send({ price: 110000, reason: 'doi gia' })).status,
  ).toBe(200);
  expect((await ctx.accountant.get(`/api/products/${id}/price-history`)).status).toBe(200);
  expect((await ctx.manager.get(`/api/products/${id}/price-history`)).status).toBe(200);
  expect((await ctx.warehouse.get(`/api/products/${id}/price-history`)).status).toBe(403);
  expect((await ctx.sales.get(`/api/products/${id}/price-history`)).status).toBe(403);
});

test('AC-4 user org A doc/xem/sua san pham org B bi 403', async () => {
  const ctx = await fullCtx();
  const { id } = await createProduct(ctx.owner, { code: 'SP-RBAC3' });
  expect((await ctx.ownerB.get(`/api/products/${id}`)).status).toBe(403);
  expect(
    (await ctx.ownerB.patch(`/api/products/${id}`).send({ name: 'Sua trom', reason: 'x' })).status,
  ).toBe(403);
  expect((await ctx.ownerB.get(`/api/products/${id}/prices`)).status).toBe(403);
  expect((await ctx.ownerB.get(`/api/products/${id}/price-history`)).status).toBe(403);
});

test('AC-4 gia rieng theo chi nhanh: sales/accountant chi nhanh 1 khong xem duoc gia chi nhanh 2', async () => {
  const ctx = await fullCtx();
  const { id } = await createProduct(ctx.owner, { code: 'SP-RBAC4', price: 100000 });
  expect(
    (await setPrice(ctx.owner, id, { channel: 'web', branch_id: ctx.branch2, price: 222000 })).status,
  ).toBe(201);
  expect(
    (await setPrice(ctx.owner, id, { channel: 'web', branch_id: ctx.branch1, price: 211000 })).status,
  ).toBe(201);
  // Sales chi nhánh 1 hỏi giá chi nhánh 2 -> 403; hỏi giá chi nhánh mình -> 200.
  expect(
    (await ctx.sales.get(`/api/products/${id}/price?channel=web&branch_id=${ctx.branch2}`)).status,
  ).toBe(403);
  const ownBranch = await ctx.sales.get(`/api/products/${id}/price?channel=web&branch_id=${ctx.branch1}`);
  expect(ownBranch.status).toBe(200);
  expect(ownBranch.body.price).toBe(211000);
  // Accountant chi nhánh 1 cũng không xem được giá chi nhánh 2.
  expect(
    (await ctx.accountant.get(`/api/products/${id}/price?channel=web&branch_id=${ctx.branch2}`)).status,
  ).toBe(403);
  // Danh sách giá riêng của sales chi nhánh 1 không lộ giá chi nhánh 2.
  const list = await ctx.sales.get(`/api/products/${id}/prices`);
  expect(list.status).toBe(200);
  expect(asList(list).some((p) => p.branch_id === ctx.branch2)).toBe(false);
  expect(asList(list).some((p) => p.branch_id === ctx.branch1)).toBe(true);
  // Owner (dù branch_id = 1) và manager toàn org xem được giá mọi chi nhánh.
  const ownerPrice = await ctx.owner.get(`/api/products/${id}/price?channel=web&branch_id=${ctx.branch2}`);
  expect(ownerPrice.status).toBe(200);
  expect(ownerPrice.body.price).toBe(222000);
  const mgrPrice = await ctx.manager.get(`/api/products/${id}/price?channel=web&branch_id=${ctx.branch2}`);
  expect(mgrPrice.status).toBe(200);
  expect(mgrPrice.body.price).toBe(222000);
});

test('AC-4 export CSV duoc phep voi moi vai, xem san pham duoc phep voi moi vai', async () => {
  const ctx = await fullCtx();
  await createProduct(ctx.owner, { code: 'SP-RBAC5' });
  for (const agent of [ctx.sales, ctx.warehouse, ctx.accountant, ctx.manager]) {
    expect((await agent.get('/api/products/export')).status).toBe(200);
    expect((await agent.get('/api/products')).status).toBe(200);
  }
});

test('AC-4 audit log ghi tao/sua/doi gia/import CSV voi actor va target_product_id', async () => {
  const ctx = await fullCtx();
  const { id } = await createProduct(ctx.owner, { code: 'SP-AUDIT', price: 100000 });
  expect(
    (await ctx.owner.patch(`/api/products/${id}`).send({ price: 115000, reason: 'audit doi gia' })).status,
  ).toBe(200);
  const text = csvText('SP-AUDIT-CSV,Ao audit,90000,cai');
  const imp = await ctx.owner
    .post('/api/products/import')
    .attach('file', Buffer.from(text, 'utf8'), 'import.csv');
  expect(imp.status).toBe(201);
  const rows = ctx.db.prepare("SELECT * FROM audit_log WHERE org_id = ?").all(ctx.orgId) as {
    user_id: number;
    action: string;
    detail: string | null;
    created_at: string;
  }[];
  expect(rows.length).toBeGreaterThanOrEqual(3);
  const details = rows.map((r) => {
    try {
      return JSON.parse(r.detail ?? '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  });
  expect(details.some((d) => d.target_product_id === id)).toBe(true);
  expect(rows.every((r) => r.user_id !== null && r.created_at !== undefined)).toBe(true);
  expect(rows.some((r) => r.action.includes('import') || /import/i.test(r.action))).toBe(true);
  const logRes = await ctx.owner.get('/api/audit-log');
  expect(logRes.status).toBe(200);
  expect(JSON.stringify(logRes.body)).toContain('SP-AUDIT');
  expect((await ctx.sales.get('/api/audit-log')).status).toBe(403);
});

test('AC-4 docs: RBAC.md co ma tran san pham/gia/CSV, PRICING.md co fallback 8 buoc, DECISIONS co D15/D16', () => {
  const rbac = readFileSync('docs/RBAC.md', 'utf8');
  for (const word of ['create-product', 'change-price', 'import-csv', 'export-csv', 'view-price-history']) {
    expect(rbac).toContain(word);
  }
  expect(rbac.toLowerCase()).toContain('phạm vi');
  const pricing = readFileSync('docs/PRICING.md', 'utf8');
  expect(pricing).toContain('8 bước');
  for (const src of ['variant_channel_branch', 'variant_override', 'base']) {
    expect(pricing).toContain(src);
  }
  expect(pricing.toLowerCase()).toContain('trùng giá');
  const decisions = readFileSync('docs/DECISIONS.md', 'utf8');
  expect(decisions).toContain('D15');
  expect(decisions).toContain('D16');
  const readme = readFileSync('README.md', 'utf8');
  expect(readme).toContain('/api/products');
  const setup = readFileSync('docs/SETUP.md', 'utf8');
  expect(setup).toContain('/api/products');
});

test('AC-4 check.sh va demo.sh mo rong buoc san pham/gia/CSV va giu buoc GOAL-001/002', () => {
  const check = readFileSync('scripts/check.sh', 'utf8');
  const demo = readFileSync('scripts/demo.sh', 'utf8');
  for (const script of [check, demo]) {
    expect(script).toContain('san-pham');
    expect(script).toContain('RBAC');
    expect(script).toContain('npm ci');
  }
  expect(check).toContain('smoke');
});
