import { createHash } from 'node:crypto';

export interface PaymentResult {
  simulated: true;
  status: 'success' | 'failed';
  reference: string;
  amount: number;
  currency: string;
}

export interface PaymentAdapter {
  charge(amount: number, currency: string, transactionId?: string): PaymentResult;
  refund(paymentReference: string, amount: number): PaymentResult;
}

export interface ShippingQuote {
  simulated: true;
  fee: number;
  currency: string;
  etaDays: number;
  reference: string;
}

export interface ShippingAdapter {
  quote(weightGrams: number, destination: string): ShippingQuote;
}

export interface EmailResult {
  simulated: true;
  messageId: string;
  to: string;
}

export interface EmailAdapter {
  send(to: string, subject: string, body: string): EmailResult;
}

/**
 * Adapter GIẢ LẬP (fake) chạy local, xác định (deterministic): cùng input cho
 * cùng output. Không kết nối cổng thanh toán/vận chuyển/email thật, không
 * tiền thật. Mọi kết quả đều ghi rõ simulated: true.
 */
function digest(prefix: string, input: string): string {
  return `${prefix}-${createHash('sha256').update(input).digest('hex').slice(0, 12).toUpperCase()}`;
}

export class FakePaymentAdapter implements PaymentAdapter {
  /**
   * Cờ giả lập lỗi có chủ đích, CHỈ dùng trong test (D23): lần charge() kế
   * tiếp trả status 'failed', sau đó tự tắt và charge lại 'success'.
   * Không lọt ra production path (route không bao giờ gọi failNext()).
   */
  private static failNextFlag = false;

  static failNext(): void {
    FakePaymentAdapter.failNextFlag = true;
  }

  charge(amount: number, currency: string, transactionId?: string): PaymentResult {
    const status: 'success' | 'failed' = FakePaymentAdapter.failNextFlag
      ? 'failed'
      : 'success';
    FakePaymentAdapter.failNextFlag = false;
    // Reference duy nhất theo giao dịch (D23): có transactionId thì digest
    // theo `${amount}:${currency}:${transactionId}`; không có thì giữ
    // digest cũ `${amount}:${currency}` để test khóa GOAL-001
    // (charge(50000,'VND') 2 lần vẫn bằng nhau) không vỡ.
    const input =
      transactionId !== undefined && transactionId !== ''
        ? `${amount}:${currency}:${transactionId}`
        : `${amount}:${currency}`;
    return {
      simulated: true,
      status,
      reference: digest('FAKE-PAY', input),
      amount,
      currency,
    };
  }

  refund(paymentReference: string, amount: number): PaymentResult {
    return {
      simulated: true,
      status: 'success',
      reference: digest('FAKE-REF', `${paymentReference}:${amount}`),
      amount,
      currency: 'VND',
    };
  }
}

export class FakeShippingAdapter implements ShippingAdapter {
  quote(weightGrams: number, destination: string): ShippingQuote {
    const fee = 15000 + Math.ceil(Math.max(weightGrams, 0) / 500) * 5000;
    const etaDays = /hà nội|ha noi/i.test(destination) ? 1 : 2;
    return {
      simulated: true,
      fee,
      currency: 'VND',
      etaDays,
      reference: digest('FAKE-SHIP', `${weightGrams}:${destination}`),
    };
  }

  /**
   * Ma van don deterministic (GOAL-007, D24): `FAKE-TRK-<sha256
   * (orderCode:carrier:shipmentId) 12 ky tu dau>`. Cung input -> cung ma;
   * khac shipmentId -> khac ma (digest PHAI co shipment id, neu khong 2
   * lan giao cung don cung carrier se trung tracking_code va UNIQUE chan
   * nham lan giao hop le sau khi shipment cu failed/delivered).
   */
  trackingRef(orderCode: string, carrier: string, shipmentId: number): string {
    return digest('FAKE-TRK', `${orderCode}:${carrier}:${shipmentId}`);
  }
}

export class FakeEmailAdapter implements EmailAdapter {
  /**
   * Co gia lap loi gui mot lan, CHI dung trong test (GOAL-011, D29 — nhu
   * D23 cua FakePaymentAdapter): lan send() ke tiep nem loi, sau do tu
   * tat. Route production khong bao gio goi failNext(). EmailResult khong
   * co truong status nen loi gui chi bieu hien duoc bang throw; runner
   * bat loi nay de retry/backoff (R-5).
   */
  private static failNextFlag = false;

  static failNext(): void {
    FakeEmailAdapter.failNextFlag = true;
  }

  send(to: string, subject: string, body: string): EmailResult {
    if (FakeEmailAdapter.failNextFlag) {
      FakeEmailAdapter.failNextFlag = false;
      throw new Error('not implemented: FakeEmailAdapter send failed (simulated)');
    }
    return {
      simulated: true,
      messageId: digest('FAKE-MAIL', `${to}:${subject}:${body}`),
      to,
    };
  }
}
