import 'reflect-metadata';
import { RefundGatewayService } from '../../src/modules/returns/application/services/refund-gateway.service';

/**
 * Regression test for the refund gateway payment-id lookup.
 *
 * Before: processRefund called the Razorpay adapter with our internal
 * MasterOrder id where Razorpay expects a pay_xxx payment id. Every
 * online refund was rejected by Razorpay and silently downgraded to
 * "requires manual processing" via the catch-all. Meanwhile
 * checkRefundStatus passed an empty-string paymentId, so the poll
 * loop never advanced any refund past REFUND_PROCESSING. Net effect:
 * the online refund pipeline was broken end-to-end.
 *
 * After: both paths look up MasterOrder.razorpayPaymentId (stored at
 * verify-payment time) and pass the correct id to the adapter. If the
 * payment id is missing (legacy orders, COD mis-flag), we fail closed
 * with requiresManualProcessing for initiate and PENDING for status
 * check — safe behaviour that doesn't silently eat the refund.
 */

describe('RefundGatewayService — payment id lookup', () => {
  const buildDeps = (order: any) => {
    const prisma: any = {
      masterOrder: { findFirst: jest.fn().mockResolvedValue(order) },
      return: { findFirst: jest.fn() },
    };
    const razorpayAdapter: any = {
      initiateRefund: jest.fn().mockResolvedValue({
        providerRefundId: 'rfnd_fake',
        paymentId: order?.razorpayPaymentId,
        amount: 100,
        status: 'processed',
        processedAt: new Date(),
      }),
      getRefundStatus: jest.fn().mockResolvedValue({ status: 'processed' }),
    };
    const logger: any = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const svc = new RefundGatewayService(logger, razorpayAdapter, prisma);
    return { svc, razorpayAdapter, prisma };
  };

  const baseInput = {
    orderId: 'order-1',
    orderNumber: 'ORD-1',
    paymentMethod: 'ONLINE',
    amount: 100,
    customerId: 'cust-1',
    returnId: 'ret-1',
    returnNumber: 'RET-1',
  };

  it('processRefund passes razorpayPaymentId, not internal orderId', async () => {
    const { svc, razorpayAdapter } = buildDeps({
      orderNumber: 'ORD-1',
      paymentStatus: 'PAID',
      razorpayPaymentId: 'pay_realID123',
    });

    const result = await svc.processRefund(baseInput);

    expect(result.success).toBe(true);
    expect(razorpayAdapter.initiateRefund).toHaveBeenCalledWith(
      'pay_realID123',
      100,
      expect.any(Object),
    );
  });

  it('processRefund falls back to manual when razorpayPaymentId is missing', async () => {
    const { svc, razorpayAdapter } = buildDeps({
      orderNumber: 'ORD-1',
      paymentStatus: 'PAID',
      razorpayPaymentId: null,
    });

    const result = await svc.processRefund(baseInput);

    expect(result.success).toBe(false);
    expect(result.requiresManualProcessing).toBe(true);
    expect(razorpayAdapter.initiateRefund).not.toHaveBeenCalled();
  });

  it('checkRefundStatus looks up paymentId via Return → MasterOrder', async () => {
    const { svc, prisma, razorpayAdapter } = buildDeps({
      paymentStatus: 'PAID',
      razorpayPaymentId: 'pay_realID123',
    });
    prisma.return.findFirst.mockResolvedValue({
      masterOrder: { razorpayPaymentId: 'pay_realID123' },
    });

    const result = await svc.checkRefundStatus('ret-1', 'rfnd_fake');

    expect(result.status).toBe('PROCESSED');
    expect(razorpayAdapter.getRefundStatus).toHaveBeenCalledWith(
      'pay_realID123',
      'rfnd_fake',
    );
  });

  it('checkRefundStatus returns PENDING when no payment id is linked', async () => {
    const { svc, prisma, razorpayAdapter } = buildDeps({});
    prisma.return.findFirst.mockResolvedValue({
      masterOrder: { razorpayPaymentId: null },
    });

    const result = await svc.checkRefundStatus('ret-1', 'rfnd_fake');

    expect(result.status).toBe('PENDING');
    // Must NOT hit the gateway with an empty paymentId.
    expect(razorpayAdapter.getRefundStatus).not.toHaveBeenCalled();
  });
});
