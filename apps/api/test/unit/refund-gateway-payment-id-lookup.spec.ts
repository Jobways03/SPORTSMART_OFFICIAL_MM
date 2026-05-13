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
    // PR 12.1 — RefundGatewayService now takes 6 deps; the 6th is
    // RefundInstructionService for the wallet-refund routing via the
    // ADR-017 finance approval gate. The payment-id-lookup tests
    // exercise the ONLINE gateway path only, so stub.
    const walletFacade: any = {
      creditFromRefund: jest.fn(),
    };
    const paymentOps: any = {
      recordAttempt: jest.fn().mockResolvedValue(undefined),
    };
    const refundInstructions: any = {
      createForReturn: jest.fn(),
      createForDispute: jest.fn(),
    };
    const svc = new RefundGatewayService(
      logger,
      razorpayAdapter,
      prisma,
      walletFacade,
      paymentOps,
      refundInstructions,
    );
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
    // PR 12.5 — Phase 7 (ADR-007) paise migration: amount crosses the
    // Razorpay adapter boundary as a BigInt of paise, not a Number of
    // rupees. baseInput.amount is 100 (rupees) → service multiplies by
    // 100 and passes 10000n. Phase 13 also split the gateway-options
    // (idempotencyKey) into a 4th positional argument distinct from
    // the metadata bag.
    expect(razorpayAdapter.initiateRefund).toHaveBeenCalledWith(
      'pay_realID123',
      10000n,
      expect.any(Object),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
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
