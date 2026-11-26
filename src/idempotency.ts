import type { DatabaseSync } from 'node:sqlite';

export interface IdempotencyResult {
  replayed: boolean;
  result: string;
}

/**
 * Gửi lại cùng key (trong cùng org) thì trả kết quả đã lưu, không thực thi
 * lại. Key khác nhau thì thực thi bình thường. Kết quả là chuỗi JSON do
 * người gọi tự serialise, để replay trả đúng byte cũ.
 */
export function withIdempotency(
  db: DatabaseSync,
  orgId: number,
  key: string,
  execute: () => string,
): IdempotencyResult {
  const row = db
    .prepare('SELECT response FROM idempotency_keys WHERE org_id = ? AND key = ?')
    .get(orgId, key) as { response: string } | undefined;
  if (row) return { replayed: true, result: row.response };
  const result = execute();
  db.prepare(
    'INSERT INTO idempotency_keys (org_id, key, response, created_at) VALUES (?, ?, ?, ?)',
  ).run(orgId, key, result, new Date().toISOString());
  return { replayed: false, result };
}
