/**
 * Sản phẩm / giá / CSV (GOAL-003) — stub cho Tester.
 * Worker sẽ điền logic thật: fallback giá 8 bước + parse CSV.
 * Mọi hàm hiện tại đều ném "not implemented" để test acceptance ĐỎ đúng lý do.
 */

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
export function effectivePrice(_input: EffectivePriceInput): { price: number; source: PriceSource } {
  throw new Error('not implemented');
}

export interface CsvRecord {
  [column: string]: string;
}

/**
 * Parse CSV sản phẩm: bỏ BOM UTF-8, xử lý dấu phẩy trong ô có ngoặc kép,
 * bỏ qua dòng trống. Trả header + từng dòng dữ liệu dạng record thô
 * (chưa validate nghiệp vụ — validate ở tầng service).
 */
export function parseProductCsv(_text: string): { header: string[]; records: CsvRecord[] } {
  throw new Error('not implemented');
}
