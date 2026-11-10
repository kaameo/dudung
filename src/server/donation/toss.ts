import { TossError, type PaymentGateway, type TossPayment } from '@/server/ports';

const API = 'https://api.tosspayments.com/v1';

/** 토스페이먼츠 결제 API 클라이언트(테스트 모드 키로도 같은 엔드포인트를 쓴다). */
export class TossPaymentsClient implements PaymentGateway {
  private readonly auth: string;

  constructor(secretKey: string, private readonly timeoutMs = 10_000) {
    this.auth = `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;
  }

  private async call(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<TossPayment> {
    const headers: Record<string, string> = { Authorization: this.auth };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new TossError(res.status, String(json.code ?? 'UNKNOWN'), String(json.message ?? `toss ${res.status}`));
    }
    return {
      paymentKey: String(json.paymentKey),
      orderId: String(json.orderId),
      totalAmount: Number(json.totalAmount),
      status: String(json.status),
      approvedAt: (json.approvedAt as string | null | undefined) ?? null,
    };
  }

  confirm(input: { paymentKey: string; orderId: string; amount: number }) {
    return this.call('POST', '/payments/confirm', input, input.orderId);
  }

  getPayment(paymentKey: string) {
    return this.call('GET', `/payments/${encodeURIComponent(paymentKey)}`);
  }

  async getPaymentByOrderId(orderId: string) {
    try {
      return await this.call('GET', `/payments/orders/${encodeURIComponent(orderId)}`);
    } catch (err) {
      if (err instanceof TossError && err.httpStatus === 404) return null;
      throw err;
    }
  }
}
