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

export class FakePaymentAdapter implements PaymentAdapter {
  charge(_amount: number, _currency: string): PaymentResult {
    throw new Error('not implemented');
  }
}

export class FakeShippingAdapter implements ShippingAdapter {
  quote(_weightGrams: number, _destination: string): ShippingQuote {
    throw new Error('not implemented');
  }
}

export class FakeEmailAdapter implements EmailAdapter {
  send(_to: string, _subject: string, _body: string): EmailResult {
    throw new Error('not implemented');
  }
}
