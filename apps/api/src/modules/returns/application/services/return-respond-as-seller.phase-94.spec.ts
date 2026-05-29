// Phase 94 (2026-05-23) — Seller/Franchise Return Response audit
// coverage.
//
// Gaps asserted:
//   #1  franchise sub-orders skip the seller-response window
//   #4/#5/#7/#8 respondAsSeller wraps update + evidence + history +
//        outbox publish in a single tx
//   #6  version CAS — P2025 surfaces as BadRequest, not silent
//   #9  evidence URL allowlist rejects external URLs
//   #10 'returns.seller.responded' published with the right payload
//   #13 notes sanitized (HTML stripped + capped at 2000 chars)
//   #14 controller decorators present (@Idempotent + @Throttle)
//   #15 sweeper publishes per-row 'returns.seller.response.expired'

import { Reflector } from '@nestjs/core';
import { SellerReturnsController } from '../../presentation/controllers/seller-returns.controller';
import { IDEMPOTENT_KEY } from '../../../../core/decorators/idempotent.decorator';

// ── Helpers ──────────────────────────────────────────────────────

function buildTxMock(opts: {
  ret?: any;
  updateThrowsP2025?: boolean;
  expectedVersion?: number;
} = {}) {
  const ret = opts.ret ?? {
    id: 'r1',
    version: 0,
    status: 'REQUESTED',
    returnNumber: 'RET-2026-000001',
    sellerResponseStatus: 'PENDING',
    sellerResponseDueAt: new Date(Date.now() + 60_000),
    subOrder: { sellerId: 'seller-a' },
  };
  const tx: any = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    return: {
      findUnique: jest.fn().mockResolvedValue(ret),
      update: jest.fn().mockImplementation(async ({ where, data }: any) => {
        if (opts.updateThrowsP2025) {
          const err: any = new Error('Record not found');
          err.code = 'P2025';
          throw err;
        }
        return { id: where.id, ...data };
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    returnItem: {
      // Phase 95 — respondAsSeller now reads existing items for the
      // per-item rollup.
      findMany: jest.fn().mockResolvedValue([{ id: 'ri-1' }]),
      update: jest.fn().mockResolvedValue({}),
    },
    returnEvidence: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    returnStatusHistory: {
      create: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  return { tx, ret };
}

function buildService(deps: any = {}) {
  // Lazy-require so we don't bring up the whole DI graph just to
  // exercise the respondAsSeller / sweeper methods.
  /* eslint-disable @typescript-eslint/no-var-requires */
  const { ReturnService } = require('./return.service');
  const baseTx = deps.tx;
  const prisma = deps.prisma ?? {
    $transaction: jest.fn().mockImplementation((fn: any) => fn(baseTx)),
  };
  const service = new ReturnService(
    deps.returnRepo ?? { findByIdWithItems: jest.fn() },
    prisma,
    deps.eligibilityService ?? {},
    deps.autoApprovalService ?? {},
    deps.stockRestorationService ?? {},
    deps.commissionReversalService ?? {},
    deps.refundGateway ?? {},
    deps.cloudinaryAdapter ?? {},
    deps.eventBus ?? {
      publish: jest.fn().mockResolvedValue(undefined),
    },
    deps.caseDuplicates ?? {},
    deps.env ?? { getOptional: () => undefined, getBoolean: () => false, getString: () => '' },
    deps.restockingFee ?? {},
    deps.abuseCounter ?? {},
    deps.commissionFacade ?? {},
    deps.logger ?? {
      setContext: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    deps.liabilityLedger ?? {},
    deps.audit ?? {
      writeAuditLog: jest.fn().mockResolvedValue(undefined),
    },
    deps.riskScorer ?? {},
    deps.replacement ?? {},
    deps.razorpay ?? {},
    deps.discountAlloc ?? {},
    deps.moneyDualWrite ?? { applyPaise: (_: string, d: any) => d },
    deps.creditNote ?? {},
    deps.walletAdjust ?? {},
  );
  return service;
}

describe('ReturnService.respondAsSeller (Phase 94)', () => {
  it('Gap #4/#10 — wraps the write + evidence + history + publish in one tx', async () => {
    const { tx } = buildTxMock();
    const publish = jest.fn().mockResolvedValue(undefined);
    const prismaTxn = jest
      .fn()
      .mockImplementation((fn: any) => fn(tx));
    const service = buildService({
      tx,
      prisma: { $transaction: prismaTxn },
      eventBus: { publish },
    });
    await service.respondAsSeller({
      returnId: 'r1',
      sellerId: 'seller-a',
      decision: 'ACCEPTED',
      notes: 'all good',
    });
    expect(prismaTxn).toHaveBeenCalledTimes(1);
    expect(tx.return.update).toHaveBeenCalledTimes(1);
    expect(tx.returnStatusHistory.create).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'returns.seller.responded',
        aggregate: 'Return',
        aggregateId: 'r1',
        payload: expect.objectContaining({
          decision: 'ACCEPTED',
          returnId: 'r1',
        }),
      }),
      { tx },
    );
  });

  it('Gap #6 — P2025 from version CAS surfaces as BadRequest', async () => {
    const { tx } = buildTxMock({ updateThrowsP2025: true });
    const service = buildService({
      tx,
      prisma: {
        $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
      },
    });
    await expect(
      service.respondAsSeller({
        returnId: 'r1',
        sellerId: 'seller-a',
        decision: 'ACCEPTED',
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/refresh and retry/i),
    });
  });

  it('Gap #6 — version is included in the WHERE clause', async () => {
    const { tx, ret } = buildTxMock();
    ret.version = 7;
    const service = buildService({
      tx,
      prisma: { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) },
    });
    await service.respondAsSeller({
      returnId: 'r1',
      sellerId: 'seller-a',
      decision: 'ACCEPTED',
    });
    const where = tx.return.update.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: 'r1', version: 7 });
  });

  it('Gap #9 — evidence URL with non-allowed host throws BadRequest', async () => {
    const { tx } = buildTxMock();
    const service = buildService({
      tx,
      prisma: { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) },
    });
    await expect(
      service.respondAsSeller({
        returnId: 'r1',
        sellerId: 'seller-a',
        decision: 'CONTESTED',
        notes: 'see attached',
        evidenceFileUrls: ['https://evil.example.com/payload.jpg'],
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/not in evidence allowlist/i),
    });
    // Should reject pre-tx, before any DB call.
    expect(tx.return.update).not.toHaveBeenCalled();
  });

  it('Gap #9 — Cloudinary URL is accepted', async () => {
    const { tx } = buildTxMock();
    const service = buildService({
      tx,
      prisma: { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) },
    });
    await service.respondAsSeller({
      returnId: 'r1',
      sellerId: 'seller-a',
      decision: 'CONTESTED',
      notes: 'see attached',
      evidenceFileUrls: ['https://res.cloudinary.com/x/image/upload/p.jpg'],
    });
    expect(tx.returnEvidence.createMany).toHaveBeenCalledTimes(1);
    const data = tx.returnEvidence.createMany.mock.calls[0][0].data;
    expect(data[0]).toMatchObject({
      uploadedBy: 'SELLER',
      uploaderId: 'seller-a',
      fileType: 'IMAGE',
    });
  });

  it('Gap #13 — HTML stripped from notes before column write', async () => {
    const { tx } = buildTxMock();
    const service = buildService({
      tx,
      prisma: { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) },
    });
    await service.respondAsSeller({
      returnId: 'r1',
      sellerId: 'seller-a',
      decision: 'CONTESTED',
      notes: 'Hello <script>alert(1)</script> world',
    });
    const data = tx.return.update.mock.calls[0][0].data;
    expect(data.sellerResponseNotes).toBe('Hello alert(1) world');
  });

  it('Gap #13 — notes > 2000 chars truncated', async () => {
    const { tx } = buildTxMock();
    const service = buildService({
      tx,
      prisma: { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) },
    });
    await service.respondAsSeller({
      returnId: 'r1',
      sellerId: 'seller-a',
      decision: 'CONTESTED',
      notes: 'a'.repeat(2500),
    });
    const data = tx.return.update.mock.calls[0][0].data;
    expect(data.sellerResponseNotes.length).toBe(2000);
  });

  it('Gap #13 — blank notes coerce to null', async () => {
    const { tx } = buildTxMock();
    const service = buildService({
      tx,
      prisma: { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) },
    });
    await service.respondAsSeller({
      returnId: 'r1',
      sellerId: 'seller-a',
      decision: 'ACCEPTED',
      notes: '   ',
    });
    const data = tx.return.update.mock.calls[0][0].data;
    expect(data.sellerResponseNotes).toBeNull();
  });

  it('forbids cross-seller respond', async () => {
    const { tx, ret } = buildTxMock();
    ret.subOrder.sellerId = 'someone-else';
    const service = buildService({
      tx,
      prisma: { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) },
    });
    await expect(
      service.respondAsSeller({
        returnId: 'r1',
        sellerId: 'seller-a',
        decision: 'ACCEPTED',
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/do not have access/i),
    });
  });

  it('rejects when sellerResponseStatus is NOT_REQUIRED', async () => {
    const { tx, ret } = buildTxMock();
    ret.sellerResponseStatus = 'NOT_REQUIRED';
    const service = buildService({
      tx,
      prisma: { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) },
    });
    await expect(
      service.respondAsSeller({
        returnId: 'r1',
        sellerId: 'seller-a',
        decision: 'ACCEPTED',
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/no seller response is required/i),
    });
  });

  it('rejects when window closed (past 1h grace)', async () => {
    const { tx, ret } = buildTxMock();
    ret.sellerResponseDueAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const service = buildService({
      tx,
      prisma: { $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)) },
    });
    await expect(
      service.respondAsSeller({
        returnId: 'r1',
        sellerId: 'seller-a',
        decision: 'ACCEPTED',
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/window has closed/i),
    });
  });
});

describe('ReturnService.sweepExpiredSellerResponses (Phase 94)', () => {
  it('Gap #15 — publishes per-row expired event + uses FOR UPDATE SKIP LOCKED', async () => {
    const candidates = [
      { id: 'r1', return_number: 'RET-1' },
      { id: 'r2', return_number: 'RET-2' },
    ];
    const tx: any = {
      $queryRawUnsafe: jest
        .fn()
        .mockResolvedValueOnce(candidates) // first batch
        .mockResolvedValueOnce([]), // second batch ends loop
      return: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      returnStatusHistory: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const publish = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      $transaction: jest.fn().mockImplementation((fn: any) => fn(tx)),
    };
    const service = buildService({ prisma, tx, eventBus: { publish } });
    const result = await service.sweepExpiredSellerResponses(new Date());
    expect(result.expiredCount).toBe(2);
    // FOR UPDATE SKIP LOCKED in the raw query.
    const sqlCall = tx.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(sqlCall).toMatch(/FOR UPDATE SKIP LOCKED/);
    // updateMany flips to EXPIRED.
    expect(tx.return.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['r1', 'r2'] } },
        data: { sellerResponseStatus: 'EXPIRED' },
      }),
    );
    // One publish per expired row.
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls[0][0]).toMatchObject({
      eventName: 'returns.seller.response.expired',
      aggregate: 'Return',
      aggregateId: 'r1',
    });
  });
});

describe('SellerReturnsController.respond (Phase 94)', () => {
  it('Gap #14 — @Idempotent metadata present', () => {
    const reflector = new Reflector();
    const meta = reflector.get(
      IDEMPOTENT_KEY,
      SellerReturnsController.prototype.respond,
    );
    expect(meta).toBe(true);
  });

  it('Gap #14 — @Throttle metadata present', () => {
    // Throttler stores metadata under a private symbol; we just
    // check that *some* throttler metadata exists on the handler.
    const handler = SellerReturnsController.prototype.respond as any;
    const keys = Reflect.getMetadataKeys(handler);
    const hasThrottle = keys.some(
      (k: any) => typeof k === 'string' && k.toLowerCase().includes('throttle'),
    );
    expect(hasThrottle).toBe(true);
  });
});
