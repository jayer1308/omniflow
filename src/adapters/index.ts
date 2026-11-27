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
}

export class FakeEmailAdapter implements EmailAdapter {
  send(to: string, subject: string, body: string): EmailResult {
    return {
      simulated: true,
      messageId: digest('FAKE-MAIL', `${to}:${subject}:${body}`),
      to,
    };
  }
}
