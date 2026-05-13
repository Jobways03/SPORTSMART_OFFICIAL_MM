import { CommissionReversalHandler } from './commission-reversal.handler';

/**
 * Phase 0 (PR 0.11) — commission reversal corrections.
 *
 *   - Subscribes to `returns.refund.completed` ONLY (was: both that AND
 *     `returns.return.approved`, double-firing).
 *   - Wraps with `@IdempotentHandler` so a publisher replay can't double-
 *     reverse.
 *   - Writes a `SellerDebit` for SETTLED commissions (the platform-
 *     absorbs-the-loss bug from the audit).
 *   - Emits `commission.post_settlement_reversal_recorded` per SellerDebit
 *     for audit trail.
 */

type AnyRecord = Record<string, unknown>;

function buildHandler(opts: {
  retRow?: AnyRecord | null;
  items?: Array<{ id: string }>;
  records?: Array<AnyRecord>;
  sellerDebitThrows?: 'P2002' | 'other' | null;
  /** Toggle the EventDeduplicationService.tryConsume result. */
  dedupAllowsProceed?: boolean;
}) {
  const updateMany = jest.fn().mockResolvedValue({ count: 0 });
  const sellerDebitCreate = jest.fn(async (args: any) => {
    if (opts.sellerDebitThrows === 'P2002') {
      const err: any = new Error('unique violation');
      err.code = 'P2002';
      throw err;
    }
    if (opts.sellerDebitThrows === 'other') {
      throw new Error('unexpected DB error');
    }
    return { id: 'debit-' + args.data.sellerId, ...args.data };
  });

  const prisma = {
    return: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.retRow === undefined
            ? { id: 'ret-1', returnNumber: 'RTN-001', subOrderId: 'sub-1' }
            : opts.retRow,
        ),
    },
    orderItem: {
      findMany: jest.fn().mockResolvedValue(opts.items ?? []),
    },
    commissionRecord: {
      findMany: jest.fn().mockResolvedValue(opts.records ?? []),
      updateMany,
    },
    sellerDebit: { create: sellerDebitCreate },
  } as any;

  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  const eventDedup = {
    tryConsume: jest.fn().mockResolvedValue(opts.dedupAllowsProceed ?? true),
  } as any;

  const handler = new CommissionReversalHandler(prisma, eventBus, eventDedup);
  return { handler, prisma, eventBus, eventDedup, updateMany, sellerDebitCreate };
}

describe('CommissionReversalHandler — PR 0.11', () => {
  it('flips PENDING and ON_HOLD commissions to REFUNDED on refund.completed', async () => {
    const { handler, updateMany, sellerDebitCreate } = buildHandler({
      items: [{ id: 'oi-1' }, { id: 'oi-2' }],
      records: [
        { id: 'cr-1', sellerId: 's-1', status: 'PENDING', adminEarningInPaise: 0n, adminEarning: '50.00', subOrderId: 'sub-1', masterOrderId: 'm-1' },
        { id: 'cr-2', sellerId: 's-1', status: 'ON_HOLD', adminEarningInPaise: 0n, adminEarning: '50.00', subOrderId: 'sub-1', masterOrderId: 'm-1' },
      ],
    });

    await handler.onRefundCompleted({
      eventName: 'returns.refund.completed',
      aggregate: 'Return',
      aggregateId: 'ret-1',
      occurredAt: new Date(),
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

  // ── Headline: post-settlement claw-back ────────────────────────────

  it('writes a SellerDebit for SETTLED commissions (the platform-absorbs-loss fix)', async () => {
    const { handler, sellerDebitCreate, eventBus } = buildHandler({
      items: [{ id: 'oi-3' }, { id: 'oi-4' }],
      records: [
        // Two SETTLED commissions for the SAME seller → aggregated
        { id: 'cr-3', sellerId: 's-1', status: 'SETTLED', adminEarningInPaise: 7500n, adminEarning: '75.00', subOrderId: 'sub-1', masterOrderId: 'm-1' },
        { id: 'cr-4', sellerId: 's-1', status: 'SETTLED', adminEarningInPaise: 2500n, adminEarning: '25.00', subOrderId: 'sub-1', masterOrderId: 'm-1' },
      ],
    });

    await handler.onRefundCompleted({
      eventName: 'returns.refund.completed',
      aggregate: 'Return',
      aggregateId: 'ret-1',
      occurredAt: new Date(),
      payload: { returnId: 'ret-1', returnNumber: 'RTN-001', refundAmount: 100 },
    } as any);

    expect(sellerDebitCreate).toHaveBeenCalledTimes(1);
    expect(sellerDebitCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sellerId: 's-1',
          sourceType: 'RETURN',
          sourceId: 'ret-1',
          amountInPaise: 10000n, // 7500 + 2500
          reason: expect.stringContaining('POST_SETTLEMENT_RETURN'),
        }),
      }),
    );

    // commission.post_settlement_reversal_recorded fires
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

  it('one debit per seller when multiple sellers have settled commissions for one return', async () => {
    const { handler, sellerDebitCreate } = buildHandler({
      items: [{ id: 'oi-5' }, { id: 'oi-6' }],
      records: [
        { id: 'cr-A', sellerId: 's-A', status: 'SETTLED', adminEarningInPaise: 4000n, adminEarning: '40.00', subOrderId: 'sub-A', masterOrderId: 'm-1' },
        { id: 'cr-B', sellerId: 's-B', status: 'SETTLED', adminEarningInPaise: 6000n, adminEarning: '60.00', subOrderId: 'sub-B', masterOrderId: 'm-1' },
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
      items: [{ id: 'oi-X' }, { id: 'oi-Y' }],
      records: [
        { id: 'cr-pending', sellerId: 's-1', status: 'PENDING', adminEarningInPaise: 0n, adminEarning: '10.00', subOrderId: 'sub-1', masterOrderId: 'm-1' },
        { id: 'cr-settled', sellerId: 's-1', status: 'SETTLED', adminEarningInPaise: 5000n, adminEarning: '50.00', subOrderId: 'sub-1', masterOrderId: 'm-1' },
      ],
    });

    await handler.onRefundCompleted({
      payload: { returnId: 'ret-1', returnNumber: 'RTN-001', refundAmount: 100 },
    } as any);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ['cr-pending'] } }),
      }),
    );
    expect(sellerDebitCreate).toHaveBeenCalledTimes(1);
    expect(sellerDebitCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sellerId: 's-1', amountInPaise: 5000n }),
      }),
    );
  });

  it('treats a duplicate SellerDebit (P2002) as an idempotent no-op', async () => {
    const { handler, sellerDebitCreate, eventBus } = buildHandler({
      items: [{ id: 'oi-7' }],
      records: [
        { id: 'cr-dup', sellerId: 's-1', status: 'SETTLED', adminEarningInPaise: 1000n, adminEarning: '10.00', subOrderId: 'sub-1', masterOrderId: 'm-1' },
      ],
      sellerDebitThrows: 'P2002',
    });

    // Should not throw.
    await handler.onRefundCompleted({
      payload: { returnId: 'ret-1', returnNumber: 'RTN-001', refundAmount: 10 },
    } as any);

    expect(sellerDebitCreate).toHaveBeenCalledTimes(1);
    // P2002 happens BEFORE the publish, so no event for the duplicate.
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('falls back to Decimal-string admin earning when paise sibling is zero', async () => {
    const { handler, sellerDebitCreate } = buildHandler({
      items: [{ id: 'oi-8' }],
      records: [
        // legacy row: paise sibling not yet backfilled (0), Decimal is canonical
        { id: 'cr-legacy', sellerId: 's-2', status: 'SETTLED', adminEarningInPaise: 0n, adminEarning: '123.45', subOrderId: 'sub-1', masterOrderId: 'm-1' },
      ],
    });

    await handler.onRefundCompleted({
      payload: { returnId: 'ret-1', returnNumber: 'RTN-001', refundAmount: 123.45 },
    } as any);

    expect(sellerDebitCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ amountInPaise: 12345n }),
      }),
    );
  });

  it('skips when no commissions match the returned items', async () => {
    const { handler, sellerDebitCreate, updateMany } = buildHandler({
      items: [{ id: 'oi-9' }],
      records: [],
    });

    await handler.onRefundCompleted({
      payload: { returnId: 'ret-1', returnNumber: 'RTN-001', refundAmount: 0 },
    } as any);

    expect(updateMany).not.toHaveBeenCalled();
    expect(sellerDebitCreate).not.toHaveBeenCalled();
  });

  it('subscribes to returns.refund.completed only — `onApproved` no longer exists', () => {
    // The previous handler had `onApproved` subscribed to
    // `returns.return.approved`. This is a structural assertion that
    // the second subscription is gone.
    expect(typeof (CommissionReversalHandler.prototype as any).onApproved).toBe('undefined');
    expect(typeof (CommissionReversalHandler.prototype as any).onRefundCompleted).toBe('function');
  });
});
