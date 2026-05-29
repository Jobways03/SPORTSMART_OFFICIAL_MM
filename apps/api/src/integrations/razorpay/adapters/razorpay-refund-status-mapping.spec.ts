// Phase 96 (2026-05-23) — Phase 98 audit Gap #1 closure coverage.
//
// Verifies the adapter no longer coerces non-processed Razorpay
// statuses to 'failed'. Pre-Phase-96 a `pending` (the normal initial
// state) was reported as `failed`, and the gateway service then
// treated `failed` as success.

import { RazorpayAdapter } from './razorpay.adapter';

function makeAdapter(returnedStatus: string) {
  const client = {
    createRefund: jest.fn().mockResolvedValue({
      id: 'rfnd_test',
      payment_id: 'pay_test',
      status: returnedStatus,
    }),
  } as any;
  return new RazorpayAdapter(client);
}

describe('RazorpayAdapter.initiateRefund status mapping (Phase 96)', () => {
  it('maps processed → processed', async () => {
    const adapter = makeAdapter('processed');
    const out = await adapter.initiateRefund('pay_test', 100n);
    expect(out.status).toBe('processed');
  });

  it('maps pending → pending (was incorrectly mapped to failed pre-Phase-96)', async () => {
    const adapter = makeAdapter('pending');
    const out = await adapter.initiateRefund('pay_test', 100n);
    expect(out.status).toBe('pending');
  });

  it('maps failed → failed', async () => {
    const adapter = makeAdapter('failed');
    const out = await adapter.initiateRefund('pay_test', 100n);
    expect(out.status).toBe('failed');
  });

  it('maps unknown/empty → pending (defensive default — never silently failed)', async () => {
    const adapter = makeAdapter('');
    const out = await adapter.initiateRefund('pay_test', 100n);
    expect(out.status).toBe('pending');
  });

  it('uppercase-tolerant', async () => {
    const adapter = makeAdapter('PROCESSED');
    const out = await adapter.initiateRefund('pay_test', 100n);
    expect(out.status).toBe('processed');
  });
});
