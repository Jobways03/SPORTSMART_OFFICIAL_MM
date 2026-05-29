import { CommissionReversalHandler } from './commission-reversal.handler';

/**
 * Phase 0 (PR 0.11) + Phase 150 — commission reversal handler.
 *
 *   - Subscribes to `returns.refund.completed` ONLY.
 *   - Writes a `SellerDebit` for SETTLED commissions (post-settlement claw-back).
 *   - Emits `commission.post_settlement_reversal_recorded` per SellerDebit.
 *
 *   Phase 150 changes asserted here:
 *   - Reversal is scoped to the RETURNED items (return.items), not the whole
 *     sub-order, and the claw-back is PROPORTIONAL to the returned quantity.
 *   - The status flip + all debit creates run in one `$transaction`.
 *   - Aggregated debits null out orderId/subOrderId.
 *   - A seller that already has a (RETURN, returnId) debit is skipped
 *     (pre-check), so the in-transaction create never hits P2002.
 */

type AnyRecord = Record<string, unknown>;

function buildHandler(opts: {
  retRow?: AnyRecord | null;
  returnItems?: Array<{
    orderItemId: string;
    quantity: number;
    qcQuantityApproved?: number | null;
  }>;
  records?: Array<AnyRecord>;
  existingDebits?: Array<{ sellerId: string }>;
  dedupAllowsProceed?: boolean;
}) {
  const txUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
  const sellerDebitCreate = jest.fn(async (args: any) => {
    return { id: 'debit-' + args.data.sellerId, ...args.data };
  });

  const records = opts.records ?? [];
  // Default: every returned item fully returned (qcQuantityApproved == qty),
  // derived from the commission rows so simple tests don't have to spell it out.
  const returnItems =
    opts.returnItems ??
    records.map((r: any) => ({
      orderItemId: r.orderItemId ?? r.id,
      quantity: r.quantity ?? 1,
      qcQuantityApproved: r.quantity ?? 1,
    }));

  const txClient = {
    commissionRecord: { updateMany: txUpdateMany },
    sellerDebit: { create: sellerDebitCreate },
  };

  const prisma = {
    return: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.retRow === undefined
            ? {
                id: 'ret-1',
                returnNumber: 'RTN-001',
                subOrderId: 'sub-1',
                items: returnItems,
              }
            : opts.retRow,
        ),
    },
    commissionRecord: {
      findMany: jest.fn().mockResolvedValue(records),
    },
    sellerDebit: {
      create: sellerDebitCreate,
      findMany: jest.fn().mockResolvedValue(opts.existingDebits ?? []),
    },
    $transaction: jest.fn(async (fn: any) => fn(txClient)),
  } as any;

  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  const eventDedup = {
    tryConsume: jest.fn().mockResolvedValue(opts.dedupAllowsProceed ?? true),
  } as any;

  const handler = new CommissionReversalHandler(prisma, eventBus, eventDedup);
  return {
    handler,
    prisma,
    eventBus,
    eventDedup,
    updateMany: txUpdateMany,
    sellerDebitCreate,
  };
}

describe('CommissionReversalHandler — PR 0.11 + Phase 150', () => {
  it('flips fully-returned PENDING and ON_HOLD commissions to REFUNDED', async () => {
    const { handler, updateMany, sellerDebitCreate } = buildHandler({
      records: [
        { id: 'cr-1', orderItemId: 'oi-1', quantity: 1, sellerId: 's-1', status: 'PENDING', adminEarningInPaise: 0n, adminEarning: '50.00' },
        { id: 'cr-2', orderItemId: 'oi-2', quantity: 1, sellerId: 's-1', status: 'ON_HOLD', adminEarningInPaise: 0n, adminEarning: '50.00' },
      ],
    });

    await handler.onRefundCompleted({
      eventName: 'returns.refund.completed',
      payload: { returnId: 'ret-1', returnNumber: 'RTN-001', refundAmount: 100 },
    } as any);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['cr-1', 'cr-2'] },
        status: { in: ['PENDING', 'ON_HOLD'] },
      },
      data: { status: 'REFUNDED' },
    });
    expect(sellerDebitCreate).not.toHaveBeenCalled();
  });

  it('does NOT flip a partially-returned PENDING commission (seller still earns on the rest)', async () => {
    const { handler, updateMany } = buildHandler({
      records: [
        { id: 'cr-1', orderItemId: 'oi-1', quantity: 5, sellerId: 's-1', status: 'PENDING', adminEarningInPaise: 0n, adminEarning: '50.00' },
      ],
      returnItems: [{ orderItemId: 'oi-1', quantity: 5, qcQuantityApproved: 2 }],
    });

    await handler.onRefundCompleted({
      payload: { returnId: 'ret-1', returnNumber: 'RTN-001', refundAmount: 20 },
    } as any);

    // 2 of 5 returned → not fully returned → no status flip here.
    expect(updateMany).not.toHaveBeenCalled();
  });

  // ── Headline: post-settlement claw-back ────────────────────────────

  it('writes a SellerDebit for fully-returned SETTLED commissions (aggregated per seller)', async () => {
    const { handler, sellerDebitCreate, eventBus } = buildHandler({
      records: [
        { id: 'cr-3', orderItemId: 'oi-3', quantity: 1, sellerId: 's-1', status: 'SETTLED', adminEarningInPaise: 7500n, adminEarning: '75.00' },
        { id: 'cr-4', orderItemId: 'oi-4', quantity: 1, sellerId: 's-1', status: 'SETTLED', adminEarningInPaise: 2500n, adminEarning: '25.00' },
      ],
    });

    await handler.onRefundCompleted({
      payload: { returnId: 'ret-1', returnNumber: 'RTN-001', refundAmount: 100 },
    } as any);

    expect(sellerDebitCreate).toHaveBeenCalledTimes(1);
    expect(sellerDebitCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sellerId: 's-1',
          sourceType: 'RETURN',
          sourceId: 'ret-1',
          amountInPaise: 10000n, // 7500 + 2500, both fully returned
          orderId: null, // Phase 150 — aggregated, granular ids nulled
          subOrderId: null,
          reason: expect.stringContaining('POST_SETTLEMENT_RETURN'),
        }),
      }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'commission.post_settlement_reversal_recorded',
        payload: expect.objectContaining({
          returnId: 'ret-1',
          sellerId: 's-1',
          amountInPaise: '10000',
        }),
      }),
    );
  });

  it('claws back PROPORTIONALLY for a partial SETTLED return (audit #8)', async () => {
    const { handler, sellerDebitCreate } = buildHandler({
      records: [
        { id: 'cr-5', orderItemId: 'oi-5', quantity: 4, sellerId: 's-1', status: 'SETTLED', adminEarningInPaise: 10000n, adminEarning: '100.00' },
      ],
      returnItems: [{ orderItemId: 'oi-5', quantity: 4, qcQuantityApproved: 1 }],
    });

    await handler.onRefundCompleted({
      payload: { returnId: 'ret-1', returnNumber: 'RTN-001', refundAmount: 25 },
    } as any);

    // 1 of 4 returned → 10000 × 1/4 = 2500 paise (not the full 10000).
    expect(sellerDebitCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amountInPaise: 2500n }),
      }),
    );
  });

  it('scopes to RETURNED items only — a sibling SETTLED item not in the return is untouched', async () => {
    const { handler, sellerDebitCreate } = buildHandler({
      // Only oi-6 is returned; oi-7 belongs to the same sub-order but isn't.
      records: [
        { id: 'cr-6', orderItemId: 'oi-6', quantity: 1, sellerId: 's-1', status: 'SETTLED', adminEarningInPaise: 4000n, adminEarning: '40.00' },
      ],
      returnItems: [{ orderItemId: 'oi-6', quantity: 1, qcQuantityApproved: 1 }],
    });

    await handler.onRefundCompleted({
      payload: { returnId: 'ret-1', returnNumber: 'RTN-001', refundAmount: 40 },
    } as any);

    // Only oi-6's commission (4000) is clawed back — oi-7 never queried.
    expect(sellerDebitCreate).toHaveBeenCalledTimes(1);
    expect(sellerDebitCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amountInPaise: 4000n }),
      }),
    );
  });

  it('one debit per seller when multiple sellers have settled commissions for one return', async () => {
    const { handler, sellerDebitCreate } = buildHandler({
      records: [
        { id: 'cr-A', orderItemId: 'oi-A', quantity: 1, sellerId: 's-A', status: 'SETTLED', adminEarningInPaise: 4000n, adminEarning: '40.00' },
        { id: 'cr-B', orderItemId: 'oi-B', quantity: 1, sellerId: 's-B', status: 'SETTLED', adminEarningInPaise: 6000n, adminEarning: '60.00' },
      ],
    });

    await handler.onRefundCompleted({
      payload: { returnId: 'ret-1', returnNumber: 'RTN-001', refundAmount: 100 },
    } as any);

    expect(sellerDebitCreate).toHaveBeenCalledTimes(2);
    const sellerIds = sellerDebitCreate.mock.calls.map((c: any) => c[0].data.sellerId);
    expect(sellerIds.sort()).toEqual(['s-A', 's-B']);
  });

  it('mixed PENDING + SETTLED: status flip AND seller debit both fire', async () => {
    const { handler, updateMany, sellerDebitCreate } = buildHandler({
      records: [
        { id: 'cr-p', orderItemId: 'oi-p', quantity: 1, sellerId: 's-1', status: 'PENDING', adminEarningInPaise: 0n, adminEarning: '10.00' },
        { id: 'cr-s', orderItemId: 'oi-s', quantity: 1, sellerId: 's-1', status: 'SETTLED', adminEarningInPaise: 5000n, adminEarning: '50.00' },
      ],
    });

    await handler.onRefundCompleted({
      payload: { returnId: 'ret-1', returnNumber: 'RTN-001', refundAmount: 60 },
    } as any);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'REFUNDED' } }),
    );
    expect(sellerDebitCreate).toHaveBeenCalledTimes(1);
    expect(sellerDebitCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sellerId: 's-1', amountInPaise: 5000n }),
      }),
    );
  });

  it('is idempotent: a seller already debited for this return is skipped (pre-check, no P2002)', async () => {
    const { handler, sellerDebitCreate, eventBus } = buildHandler({
      records: [
        { id: 'cr-3', orderItemId: 'oi-3', quantity: 1, sellerId: 's-1', status: 'SETTLED', adminEarningInPaise: 7500n, adminEarning: '75.00' },
      ],
      existingDebits: [{ sellerId: 's-1' }],
    });

    await handler.onRefundCompleted({
      payload: { returnId: 'ret-1', returnNumber: 'RTN-001', refundAmount: 75 },
    } as any);

    expect(sellerDebitCreate).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('falls back to the Decimal admin earning when the paise sibling is zero', async () => {
    const { handler, sellerDebitCreate } = buildHandler({
      records: [
        { id: 'cr-x', orderItemId: 'oi-x', quantity: 1, sellerId: 's-1', status: 'SETTLED', adminEarningInPaise: 0n, adminEarning: '12.34' },
      ],
    });

    await handler.onRefundCompleted({
      payload: { returnId: 'ret-1', returnNumber: 'RTN-001', refundAmount: 12 },
    } as any);

    expect(sellerDebitCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amountInPaise: 1234n }),
      }),
    );
  });

  it('skips when no commissions match the returned items', async () => {
    const { handler, sellerDebitCreate, updateMany } = buildHandler({
      records: [],
      returnItems: [{ orderItemId: 'oi-z', quantity: 1, qcQuantityApproved: 1 }],
    });

    await handler.onRefundCompleted({
      payload: { returnId: 'ret-1', returnNumber: 'RTN-001', refundAmount: 0 },
    } as any);

    expect(sellerDebitCreate).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('subscribes to returns.refund.completed only — `onApproved` no longer exists', () => {
    const proto = CommissionReversalHandler.prototype as any;
    expect(typeof proto.onRefundCompleted).toBe('function');
    expect(proto.onApproved).toBeUndefined();
  });
});
