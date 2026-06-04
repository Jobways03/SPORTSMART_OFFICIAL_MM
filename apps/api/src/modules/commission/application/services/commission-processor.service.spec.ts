// Cluster-B — commission processor cron-wiring + COD cash-in-hand gate.
//
// Verified here:
//   • run() drives processCommissions() through CronInstrumentationService.wrap
//     (the setInterval driver produced no cron_runs row; the @Cron one does).
//   • run() respects the COMMISSION_PROCESSOR_ENABLED feature flag.
//   • #2b — when COMMISSION_REQUIRE_COD_PAID is ON, a DELIVERED-but-unpaid COD
//     sub-order is DEFERRED (not commission-locked) until its cash is collected
//     (paymentStatus=PAID); ONLINE/prepaid + paid-COD sub-orders still process.
//   • #2b — the gate is OFF by default (no behaviour change vs. pre-Cluster-B).

import { CommissionProcessorService } from './commission-processor.service';

type EnvOverrides = Record<string, boolean | number>;

function makeService(opts?: {
  subOrders?: any[];
  codMasterIds?: string[];
  env?: EnvOverrides;
}) {
  const env: any = {
    getBoolean: (k: string, d: boolean) =>
      opts?.env?.[k] !== undefined ? (opts!.env![k] as boolean) : d,
    getNumber: (k: string, d: number) =>
      opts?.env?.[k] !== undefined ? (opts!.env![k] as number) : d,
  };

  const commissionRepo: any = {
    findDeliveredSubOrders: jest
      .fn()
      .mockResolvedValue(opts?.subOrders ?? []),
    getCommissionSettings: jest
      .fn()
      .mockResolvedValue({ commissionValue: 20 }),
    getSellerProductMappingsBatch: jest.fn().mockResolvedValue(new Map()),
    processSubOrderCommission: jest.fn().mockResolvedValue(true),
    recordCommissionFailure: jest.fn().mockResolvedValue(undefined),
  };

  const redis: any = {
    acquireLockWithToken: jest
      .fn()
      .mockResolvedValue({ acquired: true, token: 'tok' }),
    releaseLockWithToken: jest.fn().mockResolvedValue(undefined),
  };

  const prisma: any = {
    masterOrder: {
      findMany: jest
        .fn()
        .mockResolvedValue((opts?.codMasterIds ?? []).map((id) => ({ id }))),
    },
  };

  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const ordersFacade: any = {};
  const moneyDualWrite: any = { applyPaise: (_m: string, d: any) => d };
  const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const instr: any = {
    wrap: jest
      .fn()
      .mockImplementation((_n: string, fn: () => Promise<unknown>) => fn()),
  };

  const service = new CommissionProcessorService(
    commissionRepo,
    redis,
    prisma,
    eventBus,
    ordersFacade,
    moneyDualWrite,
    env,
    audit,
    instr,
  );
  return { service, commissionRepo, redis, prisma, instr, env };
}

function sellerSubOrder(id: string, masterOrderId: string, paymentStatus: string) {
  return {
    id,
    masterOrderId,
    sellerId: `seller-${id}`,
    paymentStatus, // SubOrder column (per-sub-order COD cash state)
    masterOrder: { orderNumber: `ORD-${id}` },
    items: [
      {
        id: `item-${id}`,
        productId: `p-${id}`,
        variantId: null,
        productTitle: 'Thing',
        variantTitle: null,
        unitPrice: '100.00',
        totalPrice: '100.00',
        quantity: 1,
      },
    ],
  };
}

describe('CommissionProcessorService.run (Cluster-B cron wiring)', () => {
  it('drives the tick through CronInstrumentationService.wrap', async () => {
    const { service, instr, commissionRepo } = makeService({ subOrders: [] });
    await service.run();
    expect(instr.wrap).toHaveBeenCalledWith(
      'commission-processor',
      expect.any(Function),
    );
    expect(commissionRepo.findDeliveredSubOrders).toHaveBeenCalled();
  });

  it('skips the tick when COMMISSION_PROCESSOR_ENABLED=false', async () => {
    const { service, instr, commissionRepo } = makeService({
      env: { COMMISSION_PROCESSOR_ENABLED: false },
    });
    await service.run();
    expect(instr.wrap).not.toHaveBeenCalled();
    expect(commissionRepo.findDeliveredSubOrders).not.toHaveBeenCalled();
  });
});

describe('CommissionProcessorService COD cash-in-hand gate (#2b)', () => {
  it('OFF by default — a delivered unpaid COD sub-order is still processed', async () => {
    const { service, commissionRepo, prisma } = makeService({
      subOrders: [sellerSubOrder('a', 'm1', 'PENDING')],
      codMasterIds: ['m1'],
      // no COMMISSION_REQUIRE_COD_PAID override → default false
    });
    const res = await service.processCommissions();
    // Gate disabled → no master lookup, the sub-order is processed.
    expect(prisma.masterOrder.findMany).not.toHaveBeenCalled();
    expect(commissionRepo.processSubOrderCommission).toHaveBeenCalledTimes(1);
    expect(res.processed).toBe(1);
  });

  it('ON — defers an unpaid COD sub-order (no commission lock)', async () => {
    const { service, commissionRepo } = makeService({
      subOrders: [sellerSubOrder('a', 'm1', 'PENDING')],
      codMasterIds: ['m1'],
      env: { COMMISSION_REQUIRE_COD_PAID: true },
    });
    const res = await service.processCommissions();
    expect(commissionRepo.processSubOrderCommission).not.toHaveBeenCalled();
    expect(res.processed).toBe(0);
    expect(res.skippedUnpaidCod).toBe(1);
  });

  it('ON — processes a COD sub-order once its cash is collected (PAID)', async () => {
    const { service, commissionRepo } = makeService({
      subOrders: [sellerSubOrder('a', 'm1', 'PAID')],
      codMasterIds: ['m1'],
      env: { COMMISSION_REQUIRE_COD_PAID: true },
    });
    const res = await service.processCommissions();
    expect(commissionRepo.processSubOrderCommission).toHaveBeenCalledTimes(1);
    expect(res.processed).toBe(1);
    expect(res.skippedUnpaidCod).toBe(0);
  });

  it('ON — a non-COD (prepaid/online) sub-order is unaffected regardless of paymentStatus', async () => {
    const { service, commissionRepo } = makeService({
      // m2 is NOT in the COD master set → ONLINE order. PENDING paymentStatus
      // must NOT block it (online capture is verified elsewhere).
      subOrders: [sellerSubOrder('b', 'm2', 'PENDING')],
      codMasterIds: [], // no COD masters among the candidates
      env: { COMMISSION_REQUIRE_COD_PAID: true },
    });
    const res = await service.processCommissions();
    expect(commissionRepo.processSubOrderCommission).toHaveBeenCalledTimes(1);
    expect(res.processed).toBe(1);
    expect(res.skippedUnpaidCod).toBe(0);
  });

  it('ON — mixed batch: paid-COD + online process, unpaid-COD deferred', async () => {
    const { service, commissionRepo } = makeService({
      subOrders: [
        sellerSubOrder('paidcod', 'm1', 'PAID'), // COD, collected → process
        sellerSubOrder('unpaidcod', 'm1', 'PENDING'), // COD, not collected → defer
        sellerSubOrder('online', 'm3', 'PENDING'), // online → process
      ],
      codMasterIds: ['m1'],
      env: { COMMISSION_REQUIRE_COD_PAID: true },
    });
    const res = await service.processCommissions();
    expect(commissionRepo.processSubOrderCommission).toHaveBeenCalledTimes(2);
    expect(res.processed).toBe(2);
    expect(res.skippedUnpaidCod).toBe(1);
  });
});
