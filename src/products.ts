/**
 * Sản phẩm / giá / CSV (GOAL-003).
 * - effectivePrice(): giá bán hiệu dụng theo fallback 8 bước (docs/PRICING.md).
 * - parseProductCsv(): parse CSV thô (BOM, dấu phẩy trong ô ngoặc kép, dòng trống).
 * - parseProductCsvWithLines(): như trên, kèm số dòng vật lý (header là dòng 1)
 *   để báo lỗi từng dòng khi validate import.
 */
import type { DatabaseSync } from 'node:sqlite';
import { parse } from 'csv-parse/sync';

export type PriceSource =
  | 'variant_channel_branch'
  | 'variant_channel'
  | 'variant_branch'
  | 'channel_branch'
  | 'channel'
  | 'branch'
  | 'variant_override'
  | 'base';

export interface EffectivePriceInput {
  basePrice: number;
  variantOverride?: number | null;
  variantChannelBranch?: number | null;
  variantChannel?: number | null;
  variantBranch?: number | null;
  productChannelBranch?: number | null;
  productChannel?: number | null;
  productBranch?: number | null;
}

/**
 * Giá bán hiệu dụng theo đúng thứ tự fallback 8 bước (docs/PRICING.md):
 * (1) variant kênh+chi nhánh, (2) variant kênh, (3) variant chi nhánh,
 * (4) sản phẩm kênh+chi nhánh, (5) sản phẩm kênh, (6) sản phẩm chi nhánh,
 * (7) variant_override, (8) giá chuẩn sản phẩm.
 */
export function effectivePrice(input: EffectivePriceInput): { price: number; source: PriceSource } {
  const pick = (value: number | null | undefined, source: PriceSource) =>
    value === null || value === undefined ? null : { price: value, source };
  return (
    pick(input.variantChannelBranch, 'variant_channel_branch') ??
    pick(input.variantChannel, 'variant_channel') ??
    pick(input.variantBranch, 'variant_branch') ??
    pick(input.productChannelBranch, 'channel_branch') ??
    pick(input.productChannel, 'channel') ??
    pick(input.productBranch, 'branch') ??
    pick(input.variantOverride, 'variant_override') ?? { price: input.basePrice, source: 'base' as const }
  );
}

export interface CsvRecord {
  [column: string]: string;
}

const CSV_OPTIONS = {
  columns: true,
  skip_empty_lines: true,
  trim: true,
  bom: true,
  relax_quotes: true,
  // Dòng có thể thiếu các cột optional ở cuối (min_stock/status/category/
  // barcode trống): không bắt đủ số cột như header.
  relax_column_count: true,
} as const;

/** Parse CSV sản phẩm thành header + từng dòng dữ liệu dạng record thô. */
export function parseProductCsv(text: string): { header: string[]; records: CsvRecord[] } {
  const records = parse(text, CSV_OPTIONS) as CsvRecord[];
  const header = records.length > 0 ? Object.keys(records[0] as CsvRecord) : headerOf(text);
  return { header, records };
}

/** Header của file CSV rỗng (không có dòng dữ liệu nào): đọc dòng đầu tiên. */
function headerOf(text: string): string[] {
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/)[0] ?? '';
  if (firstLine.trim() === '') return [];
  const parsed = parse(firstLine, { trim: true, bom: true }) as string[][];
  return parsed[0] ?? [];
}

export interface CsvRowWithLine {
  line: number;
  record: CsvRecord;
}

/**
 * Parse CSV kèm số dòng vật lý của từng dòng dữ liệu (header là dòng 1).
 * Đếm dòng bằng cách quét ký tự và theo dõi trạng thái trong/ngoài ngoặc kép
 * để ô chứa xuống dòng không làm lệch số dòng.
 */
export function parseProductCsvWithLines(text: string): { header: string[]; rows: CsvRowWithLine[] } {
  const { header, records } = parseProductCsv(text);
  const clean = text.replace(/^\uFEFF/, '');
  const starts: number[] = [];
  let line = 1;
  let inQuotes = false;
  let atRecordStart = true;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') i++;
        else inQuotes = false;
      }
      continue;
    }
    if (ch === '"') {
      if (atRecordStart) {
        const endOfLine = clean.indexOf('\n', i);
        const lineText = clean.slice(i, endOfLine === -1 ? clean.length : endOfLine);
        if (lineText.trim() !== '') starts.push(line);
        atRecordStart = false;
      }
      inQuotes = true;
      continue;
    }
    if (ch === '\n') {
      line++;
      atRecordStart = true;
      continue;
    }
    if (ch === '\r') continue;
    if (atRecordStart) {
      // Dòng trống (chỉ khoảng trắng) không phải dòng dữ liệu: csv-parse bỏ qua.
      const endOfLine = clean.indexOf('\n', i);
      const lineText = clean.slice(i, endOfLine === -1 ? clean.length : endOfLine);
      if (lineText.trim() !== '') starts.push(line);
      atRecordStart = false;
    }
  }
  // starts[0] là dòng header; các dòng dữ liệu bắt đầu từ starts[1].
  const rows = records.map((record, idx) => ({
    line: starts[idx + 1] ?? idx + 2,
    record,
  }));
  return { header, rows };
}

/** Các kênh bán cho phép (chốt ở D15, ghi trong docs/PRICING.md). */
export const ALLOWED_CHANNELS = ['counter', 'web', 'api'] as const;

export type AllowedChannel = (typeof ALLOWED_CHANNELS)[number];

export function isAllowedChannel(channel: string): channel is AllowedChannel {
  return (ALLOWED_CHANNELS as readonly string[]).includes(channel);
}

export interface EffectivePriceLookup {
  productId: number;
  basePrice: number;
  variantId: number | null;
  variantOverride?: number | null;
  channel: string | null;
  branchId: number | null;
}

interface PriceLookupRow {
  variant_id: number | null;
  channel: string | null;
  branch_id: number | null;
  price: number;
}

/**
 * Resolve giá hiệu dụng dùng chung (D20, GOAL-005): đọc các dòng
 * product_prices của sản phẩm rồi chạy cùng fallback 8 bước như
 * effectivePrice(). Route GET /api/products/:id/price và luồng tạo đơn
 * (snapshot giá tại thời điểm đặt) cùng dùng hàm này, không viết lại
 * logic tìm giá 2 lần.
 */
export function resolveEffectivePrice(
  db: DatabaseSync,
  input: EffectivePriceLookup,
): { price: number; source: PriceSource } {
  const rows = db
    .prepare('SELECT variant_id, channel, branch_id, price FROM product_prices WHERE product_id = ?')
    .all(input.productId) as unknown as PriceLookupRow[];
  const findPrice = (
    wantVariant: number | null,
    wantChannel: string | null,
    wantBranch: number | null,
  ): number | null => {
    const row = rows.find(
      (r) =>
        (r.variant_id ?? null) === wantVariant &&
        (r.channel ?? null) === wantChannel &&
        (r.branch_id ?? null) === wantBranch,
    );
    return row ? row.price : null;
  };
  return effectivePrice({
    basePrice: input.basePrice,
    variantOverride: input.variantOverride ?? null,
    variantChannelBranch:
      input.variantId === null ? null : findPrice(input.variantId, input.channel, input.branchId),
    variantChannel:
      input.variantId === null ? null : findPrice(input.variantId, input.channel, null),
    variantBranch:
      input.variantId === null ? null : findPrice(input.variantId, null, input.branchId),
    productChannelBranch: findPrice(null, input.channel, input.branchId),
    productChannel: findPrice(null, input.channel, null),
    productBranch: findPrice(null, null, input.branchId),
  });
}
