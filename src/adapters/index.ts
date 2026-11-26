import { createHash } from 'node:crypto';

export interface PaymentResult {
  simulated: true;
  status: 'success';
  reference: string;
  amount: number;
  currency: string;
}

export interface PaymentAdapter {
  charge(amount: number, currency: string): PaymentResult;
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
  charge(amount: number, currency: string): PaymentResult {
    return {
      simulated: true,
      status: 'success',
      reference: digest('FAKE-PAY', `${amount}:${currency}`),
      amount,
      currency,
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
