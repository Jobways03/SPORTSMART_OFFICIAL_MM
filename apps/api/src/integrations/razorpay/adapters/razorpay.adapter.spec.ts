import { RazorpayAdapter } from './razorpay.adapter';

/**
 * Phase 0 (PR 0.5) — adapter accepts BigInt paise.
 *
 * Pins the new contract: every money input is `bigint` paise, and the
 * adapter never multiplies by 100 or divides by 100 anywhere in the
 * outbound path. The intermediate `RazorpayClient` accepts paise as
 * JS Number (Razorpay's API spec); the adapter coerces `BigInt → Number`
 * only after asserting the value is within safe range.
 */

function buildAdapter(opts?: { isConfigured?: boolean }) {
  const createOrder = jest.fn().mockResolvedValue({
    id: 'order_test1',
    amount: 1_000_000,
    currency: 'INR',
    receipt: 'rcpt-1',
    status: 'created',
  });
  const fetchPayment = jest.fn().mockResolvedValue({
    id: 'pay_test1',
    amount: 1_000_000,
    currency: 'INR',
    status: 'captured',
    order_id: 'order_test1',
    method: 'upi',
    captured: true,
  });
  const capturePayment = jest.fn().mockResolvedValue({
    id: 'pay_test1',
    status: 'captured',
    captured: true,
  });
  const createRefund = jest.fn().mockResolvedValue({
    id: 'rfnd_test1',
    payment_id: 'pay_test1',
    amount: 500_000,
    status: 'processed',
    speed_processed: 'normal',
  });
  const fetchRefund = jest.fn().mockResolvedValue({
    id: 'rfnd_test1',
    amount: 500_000,
    status: 'processed',
  });

  const client = {
    isConfigured: opts?.isConfigured ?? true,
    createOrder,
    fetchPayment,
    capturePayment,
    createRefund,
    fetchRefund,
  } as any;

  const adapter = new RazorpayAdapter(client);
  return { adapter, client, createOrder, fetchPayment, capturePayment, createRefund, fetchRefund };
}

describe('RazorpayAdapter — Phase 0 PR 0.5 (BigInt paise)', () => {
  // ── createOrder ────────────────────────────────────────────────────

  it('sends paise directly to the client without any rupee conversion', async () => {
    const { adapter, createOrder } = buildAdapter();
    await adapter.createOrder({
      amountInPaise: 1_000_000n, // ₹10,000
      receipt: 'rcpt-1',
    });
    expect(createOrder).toHaveBeenCalledWith({
      amount: 1_000_000,
      receipt: 'rcpt-1',
      notes: undefined,
    });
  });

  it('returns paise as BigInt (no Number rupees field on the return shape)', async () => {
    const { adapter } = buildAdapter();
    const result = await adapter.createOrder({
      amountInPaise: 1_000_000n,
      receipt: 'rcpt-1',
    });
    expect(result).toEqual({
      providerOrderId: 'order_test1',
      amountInPaise: 1_000_000n,
      currency: 'INR',
    });
    // Compile-time check: result has no `amount` rupee field.
    expect((result as any).amount).toBeUndefined();
  });

  it('rejects a negative amount before calling the client', async () => {
    const { adapter, createOrder } = buildAdapter();
    await expect(
      adapter.createOrder({ amountInPaise: -1n, receipt: 'rcpt-1' }),
    ).rejects.toThrow(/non-negative/);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('rejects an amount above Number.MAX_SAFE_INTEGER paise', async () => {
    const { adapter, createOrder } = buildAdapter();
    const aboveSafe = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
    await expect(
      adapter.createOrder({ amountInPaise: aboveSafe, receipt: 'rcpt-1' }),
    ).rejects.toThrow(/safe range/);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('throws when client is not configured', async () => {
    const { adapter, createOrder } = buildAdapter({ isConfigured: false });
    await expect(
      adapter.createOrder({ amountInPaise: 100n, receipt: 'rcpt-1' }),
    ).rejects.toThrow(/Razorpay is not configured/);
    expect(createOrder).not.toHaveBeenCalled();
  });

  // ── capturePayment ─────────────────────────────────────────────────

  it('capturePayment sends paise straight to the client', async () => {
    const { adapter, capturePayment } = buildAdapter();
    const result = await adapter.capturePayment('pay_test1', 1_000_000n);
    expect(capturePayment).toHaveBeenCalledWith('pay_test1', 1_000_000);
    expect(result.amountInPaise).toBe(1_000_000n);
    expect(result.status).toBe('captured');
    expect((result as any).amount).toBeUndefined();
  });

  // ── getPaymentStatus ───────────────────────────────────────────────

  it('getPaymentStatus returns paise as BigInt', async () => {
    const { adapter } = buildAdapter();
    const result = await adapter.getPaymentStatus('pay_test1');
    expect(result.amountInPaise).toBe(1_000_000n);
    expect(result.captured).toBe(true);
    expect((result as any).amount).toBeUndefined();
  });

  // ── getRawPayment (unchanged from PR 0.1 — Razorpay-shape passthrough) ──

  it('getRawPayment passes the gateway shape through unchanged', async () => {
    const { adapter } = buildAdapter();
    const result = await adapter.getRawPayment('pay_test1');
    // amount is intentionally Number here — this is the raw Razorpay
    // payload used by the gateway-amount-verifier helper.
    expect(result.amount).toBe(1_000_000);
    expect(result.captured).toBe(true);
    expect(result.order_id).toBe('order_test1');
  });

  // ── initiateRefund ─────────────────────────────────────────────────

  it('initiateRefund sends paise directly to the client', async () => {
    const { adapter, createRefund } = buildAdapter();
    const result = await adapter.initiateRefund('pay_test1', 500_000n, {
      return_id: 'ret-1',
    });
    expect(createRefund).toHaveBeenCalledWith('pay_test1', {
      amount: 500_000,
      speed: 'normal',
      notes: { return_id: 'ret-1' },
    });
    expect(result.amountInPaise).toBe(500_000n);
    expect(result.status).toBe('processed');
    expect((result as any).amount).toBeUndefined();
  });

  it('initiateRefund rejects a negative amount', async () => {
    const { adapter, createRefund } = buildAdapter();
    await expect(adapter.initiateRefund('pay_test1', -1n)).rejects.toThrow(
      /non-negative/,
    );
    expect(createRefund).not.toHaveBeenCalled();
  });

  // ── getRefundStatus ────────────────────────────────────────────────

  it('getRefundStatus returns paise as BigInt', async () => {
    const { adapter } = buildAdapter();
    const result = await adapter.getRefundStatus('pay_test1', 'rfnd_test1');
    expect(result.amountInPaise).toBe(500_000n);
    expect(result.status).toBe('processed');
    expect((result as any).amount).toBeUndefined();
  });

  // ── precision integrity ────────────────────────────────────────────

  it('passes huge-but-safe values exactly (no off-by-one truncation)', async () => {
    const { adapter, createOrder } = buildAdapter();
    // 10^15 paise = ₹10,000 crore — within Number.MAX_SAFE_INTEGER
    // (≈ 9 × 10^15) so still safe; smaller than the throw boundary.
    const huge = 1_000_000_000_000_000n;
    createOrder.mockResolvedValueOnce({
      id: 'order_huge',
      amount: Number(huge),
      currency: 'INR',
      receipt: 'rcpt-huge',
      status: 'created',
    });
    const result = await adapter.createOrder({
      amountInPaise: huge,
      receipt: 'rcpt-huge',
    });
    expect(result.amountInPaise).toBe(huge);
    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ amount: Number(huge) }),
    );
  });
});
