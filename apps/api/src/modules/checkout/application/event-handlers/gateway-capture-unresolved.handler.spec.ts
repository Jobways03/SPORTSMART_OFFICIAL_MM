// Option B (Phase 4) — GatewayCaptureUnresolvedHandler unit specs.
//
// The handler is the cycle-safe bridge: it consumes the payments webhook's
// `payments.gateway_capture_unresolved` event and dispatches to
// CheckoutService.materializeFromGateway. The regression-worthy behavior is:
// forward the gateway ids, reject malformed payloads, and never let a
// materialize exception escape into the event bus.

import { GatewayCaptureUnresolvedHandler } from './gateway-capture-unresolved.handler';

function makeHandler(materialize?: jest.Mock) {
  const materializeFromGateway =
    materialize ??
    jest.fn().mockResolvedValue({ masterOrderId: 'mo-1', orderNumber: 'SM-1' });
  const checkoutService: any = { materializeFromGateway };
  const handler = new GatewayCaptureUnresolvedHandler(checkoutService);
  return { handler, materializeFromGateway };
}

describe('GatewayCaptureUnresolvedHandler', () => {
  it('forwards the gateway order + payment ids to materializeFromGateway', async () => {
    const { handler, materializeFromGateway } = makeHandler();
    await handler.handle({
      eventName: 'payments.gateway_capture_unresolved',
      payload: {
        razorpayOrderId: 'order_rp1',
        razorpayPaymentId: 'pay_1',
        capturedAmountInPaise: '12345',
      },
    } as any);
    expect(materializeFromGateway).toHaveBeenCalledWith('order_rp1', 'pay_1');
  });

  it('no-ops on a malformed payload (missing ids)', async () => {
    const { handler, materializeFromGateway } = makeHandler();
    await handler.handle({ payload: { razorpayOrderId: 'order_rp1' } } as any);
    expect(materializeFromGateway).not.toHaveBeenCalled();
  });

  it('swallows a materialize exception (never escapes into the event bus)', async () => {
    const throwing = jest.fn().mockRejectedValue(new Error('boom'));
    const { handler } = makeHandler(throwing);
    await expect(
      handler.handle({
        payload: { razorpayOrderId: 'order_rp1', razorpayPaymentId: 'pay_1' },
      } as any),
    ).resolves.toBeUndefined();
    expect(throwing).toHaveBeenCalled();
  });

  it('tolerates a null result (no owning session / concurrent / terminal)', async () => {
    const nullRes = jest.fn().mockResolvedValue(null);
    const { handler } = makeHandler(nullRes);
    await expect(
      handler.handle({
        payload: { razorpayOrderId: 'order_rp1', razorpayPaymentId: 'pay_1' },
      } as any),
    ).resolves.toBeUndefined();
  });
});
