/**
 * Khuyen mai (GOAL-009) — STUB cua Tester.
 * Worker implement that giu dung ten ham + chu ky nay.
 * - calculateDiscount: ham thuan tinh so tien giam tren tong don GOC
 *   (snapshot GOAL-005, CHUA tru diem), cat o cap (chi loai percent) va
 *   o phan con lai sau diem (total - pointsDiscount); khong bao gio am,
 *   promo_discount + points_discount <= total.
 *   percent -> floor(total * value / 100) roi min voi cap (khi cap co
 *   gia tri) va min voi phan con lai sau diem.
 *   fixed -> min(value, total - pointsDiscount).
 */
export interface DiscountInput {
  type: 'percent' | 'fixed';
  value: number;
  cap: number | null;
}

export function calculateDiscount(
  _total: number,
  _promo: DiscountInput,
  _pointsDiscount = 0,
): number {
  throw new Error('not implemented');
}
