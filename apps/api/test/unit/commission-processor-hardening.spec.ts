// Phase 135 — commission-processor cron hardening (audit remediation):
//   - exact Prisma.Decimal money arithmetic (no JS-float paise drift)
//   - FENCED Redis lock (token acquire + token release)
//   - env-tunable batch cap on the per-tick scan
//   - per-sub-order failure isolation (one bad row can't wedge the tick)
//   - fallback-rate path

import { Prisma } from '@prisma/client';
import { CommissionProcessorService } from '../../src/modules/commission/application/services/commission-processor.service';

function build(opts: {
  subOrders?: any[];
  settlement?: any;
  mapping?: any;
} = {}) {
  const processSubOrderCommission = jest.fn().mockResolvedValue(true);
  const recordCommissionFailure = jest.fn().mockResolvedValue(undefined);
  const commissionRepo = {
    findDeliveredSubOrders: jest.fn().mockResolvedValue(opts.subOrders ?? []),
    getCommissionSettings: jest
      .fn()
      .mockResolvedValue(opts.settlement ?? { commissionValue: new Prisma.Decimal(20) }),
    // Phase 135 — prefetched mapping cache. Fake Map-like that returns the
    // configured mapping for any key (undefined → triggers config fallback).
    getSellerProductMappingsBatch: jest
      .fn()
      .mockResolvedValue({ get: () => opts.mapping ?? undefined }),
    processSubOrderCommission,
    recordCommissionFailure,
  };
  const redis = {
    acquireLockWithToken: jest
      .fn()
      .mockResolvedValue({ acquired: true, token: 'tok-1' }),
    releaseLockWithToken: jest.fn().mockResolvedValue(true),
    // The unfenced pair must NOT be used post-fix — leave them throwing
    // so a regression to them fails loudly.
    acquireLock: jest.fn(() => {
      throw new Error('unfenced acquireLock must not be used');
    }),
    releaseLock: jest.fn(() => {
      throw new Error('unfenced releaseLock must not be used');
    }),
  };
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
  const env = {
    // Phase 174 — the COD cash-in-hand gate (COMMISSION_REQUIRE_COD_PAID)
    // defaults OFF in prod; keep it OFF here (these hardening tests don't
    // exercise it) while leaving COMMISSION_PROCESSOR_ENABLED true. The COD
    // gate itself is covered by commission-processor.service.spec.ts.
    getBoolean: jest.fn((key: string) =>
      key === 'COMMISSION_REQUIRE_COD_PAID' ? false : true,
    ),
    getNumber: jest.fn((_k: string, d: number) => d),
  };
  const moneyDualWrite = {
    applyPaise: (_m: string, d: any) => d,
    applyPaiseMany: (_m: string, r: any[]) => r,
  };
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const svc = new CommissionProcessorService(
    commissionRepo as any,
    redis as any,
    {} as any, // prisma (unused on this path)
    eventBus as any,
    {} as any, // ordersFacade (repo wraps it)
    moneyDualWrite as any,
    env as any,
    audit as any,
    { wrap: jest.fn((_n: string, fn: () => unknown) => fn()) } as any, // instr (Phase 174 @Cron migration)
  );
  return {
    svc,
    commissionRepo,
    redis,
    eventBus,
    env,
    audit,
    processSubOrderCommission,
    recordCommissionFailure,
  };
}

const so = (items: any[], extra: any = {}) => ({
  id: 'so1',
  sellerId: 'seller1',
  masterOrderId: 'mo1',
  masterOrder: { orderNumber: 'ORD-1' },
  seller: { sellerShopName: 'Shop' },
  items,
  ...extra,
});
const item = (unitPrice: string, qty: number, extra: any = {}) => ({
  id: 'oi1',
  productId: 'p1',
  variantId: null,
  productTitle: 'P',
  variantTitle: null,
  unitPrice: new Prisma.Decimal(unitPrice),
  totalPrice: new Prisma.Decimal(unitPrice).mul(qty),
  quantity: qty,
  ...extra,
});

describe('CommissionProcessorService — Phase 135 hardening', () => {
  it('computes commission with EXACT Decimal arithmetic (the float-drift case)', async () => {
    // 0.10 platform, 0.07 settlement, qty 1000 — the classic case where
    // Number arithmetic drifts. Decimal must yield exact 2dp strings.
    const { svc, processSubOrderCommission } = build({
      subOrders: [so([item('0.10', 1000)])],
      mapping: { settlementPrice: new Prisma.Decimal('0.07') },
    });
    await svc.processCommissions();
    expect(processSubOrderCommission).toHaveBeenCalledTimes(1);
    const records = processSubOrderCommission.mock.calls[0][1];
    expect(records[0]).toMatchObject({
      platformPrice: '0.10',
      settlementPrice: '0.07',
      totalPlatformAmount: '100.00',
      totalSettlementAmount: '70.00',
      platformMargin: '30.00',
      adminEarning: '30.00',
      productEarning: '70.00',
    });
  });

  it('uses the FENCED lock — token acquire + token release', async () => {
    const { svc, redis } = build({ subOrders: [] });
    await svc.processCommissions();
    expect(redis.acquireLockWithToken).toHaveBeenCalledWith(
      'lock:commission-processor',
      30,
    );
    expect(redis.releaseLockWithToken).toHaveBeenCalledWith(
      'lock:commission-processor',
      'tok-1',
    );
    expect(redis.acquireLock).not.toHaveBeenCalled();
    expect(redis.releaseLock).not.toHaveBeenCalled();
  });

  it('skips work + does NOT release when the lock is not acquired', async () => {
    const { svc, redis, commissionRepo } = build();
    redis.acquireLockWithToken.mockResolvedValue({ acquired: false, token: null });
    await svc.processCommissions();
    expect(commissionRepo.findDeliveredSubOrders).not.toHaveBeenCalled();
    expect(redis.releaseLockWithToken).not.toHaveBeenCalled();
  });

  it('passes the configured batch size to the scan', async () => {
    const { svc, commissionRepo, env } = build({ subOrders: [] });
    env.getNumber.mockImplementation((k: string, d: number) =>
      k === 'COMMISSION_PROCESSOR_BATCH_SIZE' ? 50 : d,
    );
    await svc.processCommissions();
    expect(commissionRepo.findDeliveredSubOrders).toHaveBeenCalledWith(50);
  });

  it('isolates a failing sub-order — DLQs it, processes the rest, releases the lock', async () => {
    const { svc, redis, processSubOrderCommission, recordCommissionFailure } = build({
      subOrders: [
        so([item('100.00', 1)], { id: 'so1' }),
        so([item('200.00', 1)], { id: 'so2' }),
      ],
      mapping: { settlementPrice: new Prisma.Decimal('80.00') },
    });
    processSubOrderCommission
      .mockRejectedValueOnce(new Error('bad row'))
      .mockResolvedValueOnce(true);
    await svc.processCommissions();
    expect(processSubOrderCommission).toHaveBeenCalledTimes(2); // 2nd not skipped
    expect(recordCommissionFailure).toHaveBeenCalledTimes(1); // bad row → DLQ
    expect(redis.releaseLockWithToken).toHaveBeenCalled(); // lock released despite throw
  });

  it('uses the prefetched mapping cache (one batch query, no per-item lookup)', async () => {
    const { svc, commissionRepo } = build({
      subOrders: [so([item('100.00', 1)])],
      mapping: { settlementPrice: new Prisma.Decimal('80.00') },
    });
    await svc.processCommissions();
    expect(commissionRepo.getSellerProductMappingsBatch).toHaveBeenCalledTimes(1);
    // The per-item N+1 method must not be used on the cron path.
    expect((commissionRepo as any).getSellerProductMapping).toBeUndefined();
  });

  it('applies the fallback rate when the mapping leaves no margin', async () => {
    const { svc, processSubOrderCommission } = build({
      subOrders: [so([item('100.00', 1)])],
      mapping: { settlementPrice: new Prisma.Decimal('100.00') }, // margin 0 → fallback
      settlement: { commissionValue: new Prisma.Decimal(20) },
    });
    await svc.processCommissions();
    const r = processSubOrderCommission.mock.calls[0][1][0];
    expect(r.commissionRate).toContain('fallback');
    expect(r.platformMargin).toBe('20.00'); // 20% of 100
    expect(r.settlementPrice).toBe('80.00'); // 100 - 20
    expect(r.commissionRateBps).toBe(2000); // 20.00% → 2000 bps
  });

  it('stamps settlableAt = returnWindowEndsAt when the window has already passed', async () => {
    const past = new Date(Date.now() - 86_400_000); // yesterday
    const { svc, processSubOrderCommission } = build({
      subOrders: [so([item('100.00', 1)], { returnWindowEndsAt: past })],
      mapping: { settlementPrice: new Prisma.Decimal('80.00') },
    });
    await svc.processCommissions();
    const r = processSubOrderCommission.mock.calls[0][1][0];
    // The stable settlement date is the (historical) window end, NOT now() —
    // this is what stops a backfill dumping old deliveries into the new cycle.
    expect(r.settlableAt.getTime()).toBe(past.getTime());
  });

  it('stamps settlableAt = now when the window is still open (early/immediate lock)', async () => {
    const future = new Date(Date.now() + 86_400_000); // tomorrow
    const before = Date.now();
    const { svc, processSubOrderCommission } = build({
      subOrders: [so([item('100.00', 1)], { returnWindowEndsAt: future })],
      mapping: { settlementPrice: new Prisma.Decimal('80.00') },
    });
    await svc.processCommissions();
    const r = processSubOrderCommission.mock.calls[0][1][0];
    expect(r.settlableAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(r.settlableAt.getTime()).toBeLessThan(future.getTime());
  });

  it('falls back to the CONFIGURED rate (not a hardcoded 0.8) when there is NO mapping', async () => {
    const { svc, processSubOrderCommission } = build({
      subOrders: [so([item('100.00', 1)])],
      // no mapping → opts.mapping undefined → cache miss
      settlement: { commissionValue: new Prisma.Decimal(30) }, // 30% platform
    });
    await svc.processCommissions();
    const r = processSubOrderCommission.mock.calls[0][1][0];
    expect(r.settlementPrice).toBe('70.00'); // 100 - 30% (NOT the old 80.00)
    expect(r.platformMargin).toBe('30.00');
    expect(r.processedBy).toBe('cron'); // provenance stamped
    expect(r.processedAt).toBeInstanceOf(Date);
  });
});
