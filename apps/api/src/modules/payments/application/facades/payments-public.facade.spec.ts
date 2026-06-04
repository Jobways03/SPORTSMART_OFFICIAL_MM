import { PaymentsPublicFacade } from './payments-public.facade';
import { BadRequestAppException } from '../../../../core/exceptions';

// We construct the facade directly with structurally-typed test doubles
// instead of using `Test.createTestingModule`. Importing the real
// `OrdersPublicFacade` class would transitively pull in `orders.service.ts`,
// which currently references Prisma client members not present in the
// generated client (a separate pre-existing issue tracked under Phase 2).
// The facade's constructor is a plain field-assignment so direct
// construction is faithful behaviour-wise.

const baseOrder = {
  id: 'order-1',
  orderNumber: 'SM-0001',
  customerId: 'cust-1',
  totalAmount: '1000.00',                  // ₹1000 — used by legacy event payload
  totalAmountInPaise: 100_000n,            // 1_00_000 paise = ₹1000
  razorpayOrderId: 'rzp_order_test1',
  paymentMethod: 'ONLINE',
  paymentStatus: 'PENDING',
  orderStatus: 'PENDING_PAYMENT',
  verified: false,
  itemCount: 1,
  createdAt: new Date(),
};

const goodSnapshot = {
  amount: 100_000,                          // matches
  status: 'captured',
  captured: true,
  order_id: 'rzp_order_test1',
};

describe('PaymentsPublicFacade.markOrderPaid — Phase 0 amount-check', () => {
  let facade: PaymentsPublicFacade;
  let ordersFacade: {
    getMasterOrderBasic: jest.Mock;
    updatePaymentStatus: jest.Mock;
    flipPaymentStatusIfFrom: jest.Mock;
  };
  let paymentOpsFacade: { flagMismatch: jest.Mock; recordAttempt: jest.Mock };
  let eventBus: { publish: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock; error: jest.Mock };

  beforeEach(() => {
    ordersFacade = {
      getMasterOrderBasic: jest.fn(),
      updatePaymentStatus: jest.fn(),
      flipPaymentStatusIfFrom: jest.fn().mockResolvedValue({
        flipped: true,
        order: { id: 'order-1', paymentStatus: 'PAID' },
      }),
    };
    paymentOpsFacade = {
      flagMismatch: jest.fn().mockResolvedValue(undefined),
      recordAttempt: jest.fn().mockResolvedValue(undefined),
    };
    eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
    logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    facade = new PaymentsPublicFacade(
      ordersFacade as any,
      eventBus as any,
      logger as any,
      paymentOpsFacade as any,
    );
  });

  it('flips the order to PAID when the gateway snapshot matches', async () => {
    ordersFacade.getMasterOrderBasic.mockResolvedValue(baseOrder as any);
    // Phase 0 (PR 0.12) — facade now drives the flip via the conditional
    // updateMany. Default mock already returns flipped=true above; tests
    // that need the loser path override it locally.

    await facade.markOrderPaid({
      masterOrderId: baseOrder.id,
      actorType: 'WEBHOOK',
      gatewaySnapshot: goodSnapshot,
    });

    expect(ordersFacade.flipPaymentStatusIfFrom).toHaveBeenCalledWith(
      baseOrder.id,
      ['PENDING', 'FAILED'],
      'PAID',
    );
    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    expect(paymentOpsFacade.flagMismatch).not.toHaveBeenCalled();
  });

  // ── The headline silent-loss case ──────────────────────────────────

  it('REJECTS when gateway amount is less than order total (the ₹1-for-₹1000 attack)', async () => {
    ordersFacade.getMasterOrderBasic.mockResolvedValue(baseOrder as any);

    await expect(
      facade.markOrderPaid({
        masterOrderId: baseOrder.id,
        actorType: 'WEBHOOK',
        paymentReference: 'pay_evil',
        gatewaySnapshot: { ...goodSnapshot, amount: 100 }, // 1 paise
      }),
    ).rejects.toMatchObject({ code: 'GATEWAY_AMOUNT_MISMATCH' });

    // Order MUST NOT be flipped to PAID
    expect(ordersFacade.flipPaymentStatusIfFrom).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();

    // A PaymentMismatchAlert MUST be written so finance ops see it
    expect(paymentOpsFacade.flagMismatch).toHaveBeenCalledTimes(1);
    expect(paymentOpsFacade.flagMismatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'AMOUNT_MISMATCH',
        masterOrderId: baseOrder.id,
        // Phase 143 — both amounts are BigInt paise now (ADR-007 migration); the
        // amount-check guard is unchanged and still rejects the ₹1-for-₹1000
        // attack — this assertion proves the rejection event fires.
        expectedInPaise: BigInt(100_000),
        actualInPaise: BigInt(100),
        severity: 95,
      }),
    );
  });

  it('rejects an over-payment', async () => {
    ordersFacade.getMasterOrderBasic.mockResolvedValue(baseOrder as any);

    await expect(
      facade.markOrderPaid({
        masterOrderId: baseOrder.id,
        actorType: 'WEBHOOK',
        gatewaySnapshot: { ...goodSnapshot, amount: 100_001 },
      }),
    ).rejects.toMatchObject({ code: 'GATEWAY_AMOUNT_MISMATCH' });

    expect(ordersFacade.flipPaymentStatusIfFrom).not.toHaveBeenCalled();
  });

  it('rejects when gateway order_id is for a different Razorpay order', async () => {
    ordersFacade.getMasterOrderBasic.mockResolvedValue(baseOrder as any);

    await expect(
      facade.markOrderPaid({
        masterOrderId: baseOrder.id,
        actorType: 'WEBHOOK',
        gatewaySnapshot: { ...goodSnapshot, order_id: 'rzp_order_other' },
      }),
    ).rejects.toMatchObject({ code: 'GATEWAY_ORDER_ID_MISMATCH' });

    expect(ordersFacade.flipPaymentStatusIfFrom).not.toHaveBeenCalled();
    expect(paymentOpsFacade.flagMismatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'SIGNATURE_INVALID' }),
    );
  });

  it('rejects an authorized-but-not-captured snapshot', async () => {
    ordersFacade.getMasterOrderBasic.mockResolvedValue(baseOrder as any);

    await expect(
      facade.markOrderPaid({
        masterOrderId: baseOrder.id,
        actorType: 'WEBHOOK',
        gatewaySnapshot: { ...goodSnapshot, status: 'authorized', captured: false },
      }),
    ).rejects.toMatchObject({ code: 'GATEWAY_PAYMENT_NOT_CAPTURED' });

    expect(ordersFacade.flipPaymentStatusIfFrom).not.toHaveBeenCalled();
  });

  it('rejects when the order has no razorpayOrderId (routing bug catch)', async () => {
    ordersFacade.getMasterOrderBasic.mockResolvedValue({
      ...baseOrder,
      razorpayOrderId: null,
    } as any);

    await expect(
      facade.markOrderPaid({
        masterOrderId: baseOrder.id,
        actorType: 'WEBHOOK',
        gatewaySnapshot: goodSnapshot,
      }),
    ).rejects.toBeInstanceOf(BadRequestAppException);

    expect(ordersFacade.flipPaymentStatusIfFrom).not.toHaveBeenCalled();
  });

  // ── Admin manual-mark-paid path (no snapshot) ──────────────────────

  it('skips the gateway check when no snapshot is supplied (admin manual COD override)', async () => {
    // Phase 168 (#1/#2) — the manual (no-snapshot) override is now COD-ONLY.
    // An ONLINE order can no longer be flipped PAID without a gateway snapshot
    // (that path is exercised in the dedicated Phase-168 guard describe below).
    ordersFacade.getMasterOrderBasic.mockResolvedValue({
      ...baseOrder,
      paymentMethod: 'COD',
    } as any);
    // Phase 0 (PR 0.12) — facade now drives the flip via the conditional
    // updateMany. Default mock already returns flipped=true above; tests
    // that need the loser path override it locally.

    await facade.markOrderPaid({
      masterOrderId: baseOrder.id,
      actorType: 'ADMIN',
      actorId: 'admin-1',
      paymentReference: 'manual-recon-ref-123',
    });

    expect(ordersFacade.flipPaymentStatusIfFrom).toHaveBeenCalledWith(
      baseOrder.id,
      ['PENDING', 'FAILED'],
      'PAID',
    );
    expect(paymentOpsFacade.flagMismatch).not.toHaveBeenCalled();
  });

  // ── Idempotency + already-terminal guards (unchanged behaviour) ────

  it('returns early when the order is already PAID', async () => {
    ordersFacade.getMasterOrderBasic.mockResolvedValue({
      ...baseOrder,
      paymentStatus: 'PAID',
    } as any);

    await facade.markOrderPaid({
      masterOrderId: baseOrder.id,
      actorType: 'WEBHOOK',
      gatewaySnapshot: goodSnapshot,
    });

    expect(ordersFacade.flipPaymentStatusIfFrom).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('rejects a CANCELLED order even with a matching snapshot', async () => {
    ordersFacade.getMasterOrderBasic.mockResolvedValue({
      ...baseOrder,
      paymentStatus: 'CANCELLED',
    } as any);

    await expect(
      facade.markOrderPaid({
        masterOrderId: baseOrder.id,
        actorType: 'WEBHOOK',
        gatewaySnapshot: goodSnapshot,
      }),
    ).rejects.toBeInstanceOf(BadRequestAppException);

    expect(ordersFacade.flipPaymentStatusIfFrom).not.toHaveBeenCalled();
  });

  it('emits payments.payment.captured exactly once on the happy path', async () => {
    ordersFacade.getMasterOrderBasic.mockResolvedValue(baseOrder as any);
    // Phase 0 (PR 0.12) — facade now drives the flip via the conditional
    // updateMany. Default mock already returns flipped=true above; tests
    // that need the loser path override it locally.

    await facade.markOrderPaid({
      masterOrderId: baseOrder.id,
      actorType: 'WEBHOOK',
      paymentReference: 'pay_good',
      gatewaySnapshot: goodSnapshot,
    });

    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'payments.payment.captured',
        aggregateId: baseOrder.id,
        payload: expect.objectContaining({
          masterOrderId: baseOrder.id,
          amountInPaise: '100000', // paise as string per the BigInt.toJSON pattern
        }),
      }),
    );
  });

  // ── PR 0.12: TOCTOU — concurrent webhook fan-out guard ────────────

  describe('Phase 0 (PR 0.12) — TOCTOU race close', () => {
    it('TOCTOU loser does NOT emit payments.payment.captured (the headline race fix)', async () => {
      ordersFacade.getMasterOrderBasic.mockResolvedValue(baseOrder as any);
      // Simulate: this caller observed PENDING via getMasterOrderBasic,
      // but a concurrent caller flipped the row to PAID before our
      // conditional updateMany landed. count=0 → flipped=false.
      ordersFacade.flipPaymentStatusIfFrom.mockResolvedValue({
        flipped: false,
        order: { id: baseOrder.id, paymentStatus: 'PAID' },
      });

      const result = await facade.markOrderPaid({
        masterOrderId: baseOrder.id,
        actorType: 'WEBHOOK',
        gatewaySnapshot: goodSnapshot,
      });

      // Critical: no event fires from the loser. Commission handler,
      // notification handler, and audit handler would have all double-
      // fired without this guard.
      expect(eventBus.publish).not.toHaveBeenCalled();
      // Returns the latest order state (paid) so caller still sees a
      // consistent view — just doesn't trigger downstream cascade.
      expect(result).toMatchObject({ id: baseOrder.id, paymentStatus: 'PAID' });
    });

    it('only ONE of N concurrent invocations emits the captured event', async () => {
      ordersFacade.getMasterOrderBasic.mockResolvedValue(baseOrder as any);

      // Simulate 5 concurrent webhook deliveries by interleaving the
      // mock: first call wins, the rest lose. (We can't truly run them
      // in parallel against the same mock from JS, but we can simulate
      // the contract: a single `flipped: true` and four `flipped: false`.)
      let callCount = 0;
      ordersFacade.flipPaymentStatusIfFrom.mockImplementation(async () => {
        callCount++;
        return {
          flipped: callCount === 1,
          order: { id: baseOrder.id, paymentStatus: 'PAID' },
        };
      });

      const calls = await Promise.all(
        Array.from({ length: 5 }, () =>
          facade.markOrderPaid({
            masterOrderId: baseOrder.id,
            actorType: 'WEBHOOK',
            gatewaySnapshot: goodSnapshot,
          }),
        ),
      );

      expect(calls).toHaveLength(5);
      // Exactly one event fired — the captured-event fan-out is
      // protected from duplicate commission / notification work.
      expect(eventBus.publish).toHaveBeenCalledTimes(1);
    });

    it('Webhook race where the loser sees PAID does NOT throw', async () => {
      // This is the "I read PENDING, you flipped to PAID, my flip
      // came back count=0" case. Loser must not throw — it's a
      // legitimate idempotent outcome.
      ordersFacade.getMasterOrderBasic.mockResolvedValue(baseOrder as any);
      ordersFacade.flipPaymentStatusIfFrom.mockResolvedValue({
        flipped: false,
        order: { id: baseOrder.id, paymentStatus: 'PAID' },
      });

      await expect(
        facade.markOrderPaid({
          masterOrderId: baseOrder.id,
          actorType: 'WEBHOOK',
          gatewaySnapshot: goodSnapshot,
        }),
      ).resolves.toBeDefined();
    });
  });
});

// Phase 168 (COD Mark-Paid audit #1/#2) — a MANUAL mark-paid (no
// gatewaySnapshot) must be COD. An ONLINE order flipped PAID with no snapshot
// would bypass the gateway entirely (no amount/signature verification) — the
// exact fraud vector the audit flagged on the second mark-paid endpoint.
describe('PaymentsPublicFacade.markOrderPaid — Phase 168 manual COD-only guard', () => {
  function build(order: any) {
    const ordersFacade = {
      getMasterOrderBasic: jest.fn().mockResolvedValue(order),
      flipPaymentStatusIfFrom: jest.fn().mockResolvedValue({
        flipped: true,
        order: { ...order, paymentStatus: 'PAID' },
      }),
    };
    const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const paymentOps = { flagMismatch: jest.fn(), recordAttempt: jest.fn() };
    const facade = new PaymentsPublicFacade(
      ordersFacade as any, eventBus as any, logger as any, paymentOps as any,
    );
    return { facade, ordersFacade, eventBus };
  }

  const onlineOrder = {
    id: 'order-x', orderNumber: 'SM-9', customerId: 'c1',
    totalAmount: '1000.00', totalAmountInPaise: 100_000n,
    razorpayOrderId: 'rzp_x', paymentMethod: 'ONLINE',
    paymentStatus: 'PENDING', orderStatus: 'PENDING_PAYMENT', verified: true, itemCount: 1, createdAt: new Date(),
  };

  it('REJECTS a manual (no-snapshot) mark-paid on an ONLINE order', async () => {
    const { facade, eventBus } = build(onlineOrder);
    await expect(
      facade.markOrderPaid({ masterOrderId: 'order-x', actorType: 'ADMIN', actorId: 'a1' }),
    ).rejects.toThrow(/COD/);
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('ALLOWS a manual mark-paid on a COD order', async () => {
    const { facade, ordersFacade } = build({ ...onlineOrder, paymentMethod: 'COD' });
    await facade.markOrderPaid({ masterOrderId: 'order-x', actorType: 'ADMIN', actorId: 'a1' });
    expect(ordersFacade.flipPaymentStatusIfFrom).toHaveBeenCalled();
  });

  it('STILL ALLOWS an ONLINE order via the gateway-snapshot (verified) path', async () => {
    const { facade, ordersFacade } = build(onlineOrder);
    await facade.markOrderPaid({
      masterOrderId: 'order-x',
      actorType: 'WEBHOOK',
      gatewaySnapshot: { amount: 100_000, status: 'captured', captured: true, order_id: 'rzp_x' },
    });
    expect(ordersFacade.flipPaymentStatusIfFrom).toHaveBeenCalled();
  });
});
