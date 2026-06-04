import { Prisma } from '@prisma/client';
import { PrismaAccountsRepository } from '../../infrastructure/repositories/prisma-accounts.repository';
import { addBusinessDays, parseHolidaySet } from '../../../../core/util/business-days';
import { ConflictAppException, NotFoundAppException } from '../../../../core/exceptions';
import { TdsPayoutHoldbackService, TDS_HOLD_REASON } from './tds-payout-holdback.service';

// Phase 178 — Outstanding Payables (SLA / aging) audit remediation.

describe('#10 business-day SLA helper', () => {
  it('never lands a due-date on a weekend', () => {
    for (let n = 1; n <= 12; n++) {
      const r = addBusinessDays(new Date('2026-06-01T00:00:00Z'), n);
      expect(r.getUTCDay()).not.toBe(0); // Sun
      expect(r.getUTCDay()).not.toBe(6); // Sat
    }
  });
  it('a holiday on the would-be due day pushes it further out', () => {
    const base = addBusinessDays(new Date('2026-06-01T00:00:00Z'), 1);
    const withHol = addBusinessDays(
      new Date('2026-06-01T00:00:00Z'), 1, parseHolidaySet(base.toISOString().slice(0, 10)),
    );
    expect(withHol.getTime()).toBeGreaterThan(base.getTime());
  });
});

describe('#3 net-payable math (gross − TCS − TDS − commission-GST)', () => {
  it('getPayablesSummary returns NET pending, no N+1 (constant queries)', async () => {
    const prisma: any = {
      sellerSettlement: {
        groupBy: jest.fn()
          .mockResolvedValueOnce([
            {
              sellerId: 's1', sellerName: 'Acme', status: 'PENDING', _count: { id: 2 },
              _sum: {
                totalSettlementAmountInPaise: 10000000n, // ₹1,00,000 gross
                tcsDeductedInPaise: 200000n,             // ₹2,000
                tdsDeductedInPaise: 100000n,             // ₹1,000
                totalCommissionGstInPaise: 1800000n,     // ₹18,000
                paidAmountInPaise: 0n,
                totalPlatformMargin: new Prisma.Decimal('5000'),
              },
            },
          ])
          .mockResolvedValueOnce([]), // lastPaid groupBy
      },
      franchiseSettlement: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    const repo = new PrismaAccountsRepository(prisma);
    const r = await repo.getPayablesSummary({ page: 1, limit: 50, nodeType: 'SELLER' });
    // ₹1,00,000 − 2,000 − 1,000 − 18,000 = ₹79,000 (the audit's ~21%-off case).
    expect(r.payables[0]!.pendingAmount).toBe('79000.00');
    // No per-row aggregate (N+1 closed): only the 2 groupBy calls.
    expect(prisma.sellerSettlement.groupBy).toHaveBeenCalledTimes(2);
  });
});

describe('#2/#9/#16 aging buckets', () => {
  function makePrisma() {
    return {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([ // seller buckets
          { bucket: '30+', cnt: 2n, net_paise: 5000000n },
          { bucket: '0-7', cnt: 1n, net_paise: 1000000n },
        ])
        .mockResolvedValueOnce([ // franchise buckets
          { bucket: '30+', cnt: 1n, net_paise: 2500000n },
        ])
        .mockResolvedValueOnce([{ oldest: new Date('2026-04-01T00:00:00Z') }]),
      sellerSettlement: { count: jest.fn().mockResolvedValue(1) },
      franchiseSettlement: { count: jest.fn().mockResolvedValue(0) },
    } as any;
  }

  it('merges seller+franchise buckets with severity + overdue total', async () => {
    const repo = new PrismaAccountsRepository(makePrisma());
    const r = await repo.getOutstandingPayables();
    const b30 = r.aging.buckets.find((x) => x.bucket === '30+')!;
    expect(b30.count).toBe(3); // 2 seller + 1 franchise
    expect(b30.amount).toBe('75000.00'); // (5000000 + 2500000) paise
    expect(b30.severity).toBe('CRITICAL');
    expect(r.aging.buckets.find((x) => x.bucket === '0-7')!.severity).toBe('LOW');
    expect(r.aging.overdue.count).toBe(4); // 3 + 1, excludes not_due
    expect(r.totalOutstanding).toBe('85000.00'); // seller 60000 + franchise 25000
    expect(r.frozen.count).toBe(1); // sellerFrozen(1) + franchiseFrozen(0)
    expect(r.oldestUnpaidDate).toEqual(new Date('2026-04-01T00:00:00Z'));
  });
});

describe('#4/#11 settlement hold', () => {
  it('freeze sets ON_HOLD + frozenAt; reject freezing a PAID settlement', async () => {
    const prisma: any = {
      sellerSettlement: {
        findUnique: jest.fn().mockResolvedValue({ status: 'PENDING' }),
        update: jest.fn().mockResolvedValue({ id: 's1', status: 'ON_HOLD', frozenAt: new Date() }),
      },
    };
    const repo = new PrismaAccountsRepository(prisma);
    await repo.setSettlementHold({ nodeType: 'SELLER', settlementId: 's1', hold: true, adminId: 'a1' });
    const upd = prisma.sellerSettlement.update.mock.calls[0][0];
    expect(upd.data.status).toBe('ON_HOLD');
    expect(upd.data.frozenAt).toBeInstanceOf(Date);
    expect(upd.data.frozenByAdminId).toBe('a1');
  });

  it('cannot freeze a PAID settlement', async () => {
    const prisma: any = {
      sellerSettlement: { findUnique: jest.fn().mockResolvedValue({ status: 'PAID' }), update: jest.fn() },
    };
    const repo = new PrismaAccountsRepository(prisma);
    await expect(
      repo.setSettlementHold({ nodeType: 'SELLER', settlementId: 's1', hold: true }),
    ).rejects.toBeInstanceOf(ConflictAppException);
    expect(prisma.sellerSettlement.update).not.toHaveBeenCalled();
  });

  it('release clears the hold (→ PENDING)', async () => {
    const prisma: any = {
      sellerSettlement: {
        findUnique: jest.fn().mockResolvedValue({ status: 'ON_HOLD' }),
        update: jest.fn().mockResolvedValue({ id: 's1', status: 'PENDING', frozenAt: null }),
      },
    };
    const repo = new PrismaAccountsRepository(prisma);
    await repo.setSettlementHold({ nodeType: 'SELLER', settlementId: 's1', hold: false, adminId: 'a1' });
    const upd = prisma.sellerSettlement.update.mock.calls[0][0];
    expect(upd.data.status).toBe('PENDING');
    expect(upd.data.frozenAt).toBeNull();
  });

  it('404s a missing settlement', async () => {
    const prisma: any = { franchiseSettlement: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn() } };
    const repo = new PrismaAccountsRepository(prisma);
    await expect(
      repo.setSettlementHold({ nodeType: 'FRANCHISE', settlementId: 'nope', hold: true }),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });
});

describe('#12 partial / full settlement payment', () => {
  // Net = 10,000,000 − 200,000 − 100,000 − 1,800,000 = 7,900,000 paise (₹79,000).
  function sellerTx(status = 'APPROVED', paid = 0n) {
    return {
      sellerSettlement: {
        findUnique: jest.fn().mockResolvedValue({
          status,
          paidAmountInPaise: paid,
          totalSettlementAmountInPaise: 10000000n,
          tcsDeductedInPaise: 200000n,
          tdsDeductedInPaise: 100000n,
          totalCommissionGstInPaise: 1800000n,
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
  }
  function prismaFor(tx: any) {
    return { $transaction: jest.fn(async (fn: any) => fn(tx)) } as any;
  }

  it('a part payment flips PENDING-ish → PARTIALLY_PAID', async () => {
    const tx = sellerTx();
    const repo = new PrismaAccountsRepository(prismaFor(tx));
    const r = await repo.recordSettlementPayment({ nodeType: 'SELLER', settlementId: 's1', amountInPaise: 5000000n });
    expect(r.status).toBe('PARTIALLY_PAID');
    expect(r.paidAmountInPaise).toBe('5000000');
    const data = tx.sellerSettlement.updateMany.mock.calls[0][0].data;
    expect(data.status).toBe('PARTIALLY_PAID');
    expect(data.paidAt).toBeUndefined(); // not fully paid yet
  });

  it('the remaining balance flips → PAID with paidAt set', async () => {
    const tx = sellerTx('PARTIALLY_PAID', 5000000n);
    const repo = new PrismaAccountsRepository(prismaFor(tx));
    const r = await repo.recordSettlementPayment({ nodeType: 'SELLER', settlementId: 's1', amountInPaise: 2900000n });
    expect(r.status).toBe('PAID');
    expect(r.paidAmountInPaise).toBe('7900000');
    expect(tx.sellerSettlement.updateMany.mock.calls[0][0].data.paidAt).toBeInstanceOf(Date);
  });

  it('rejects over-payment beyond the net payable', async () => {
    const tx = sellerTx();
    const repo = new PrismaAccountsRepository(prismaFor(tx));
    await expect(
      repo.recordSettlementPayment({ nodeType: 'SELLER', settlementId: 's1', amountInPaise: 8000000n }),
    ).rejects.toBeInstanceOf(ConflictAppException);
    expect(tx.sellerSettlement.updateMany).not.toHaveBeenCalled();
  });

  it('rejects paying a frozen (ON_HOLD) settlement', async () => {
    const tx = sellerTx('ON_HOLD');
    const repo = new PrismaAccountsRepository(prismaFor(tx));
    await expect(
      repo.recordSettlementPayment({ nodeType: 'SELLER', settlementId: 's1', amountInPaise: 100n }),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('rejects a non-positive amount', async () => {
    const repo = new PrismaAccountsRepository({} as any);
    await expect(
      repo.recordSettlementPayment({ nodeType: 'SELLER', settlementId: 's1', amountInPaise: 0n }),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });
});

describe('#11 §194-O TDS payout holdback cron', () => {
  function makeSvc(opts: { enabled?: boolean } = {}) {
    const prisma: any = {
      sellerSettlement: {
        findMany: jest.fn()
          .mockResolvedValueOnce([{ id: 'freeze-me' }]) // freeze candidates (TDS unhandled)
          .mockResolvedValueOnce([{ id: 'release-me' }]), // release candidates (TDS now handled)
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const env: any = { getBoolean: jest.fn().mockReturnValue(opts.enabled ?? true) };
    const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
    const leader: any = { run: jest.fn(async (_n: string, _t: number, fn: any) => fn()) };
    const svc = new TdsPayoutHoldbackService(prisma, env, eventBus, leader);
    return { svc, prisma, eventBus, leader, env };
  }

  it('freezes a TDS-unhandled due settlement and releases a now-handled one', async () => {
    const { svc, prisma, eventBus } = makeSvc();
    const r = await svc.runOnce(new Date('2026-06-01T00:00:00Z'));
    expect(r).toEqual({ frozen: 1, released: 1 });

    const freezeData = prisma.sellerSettlement.updateMany.mock.calls[0][0].data;
    expect(freezeData.status).toBe('ON_HOLD');
    expect(freezeData.holdReason).toBe(TDS_HOLD_REASON);
    expect(freezeData.frozenByAdminId).toBeNull(); // system actor

    const releaseData = prisma.sellerSettlement.updateMany.mock.calls[1][0].data;
    expect(releaseData.status).toBe('APPROVED');
    expect(releaseData.holdReason).toBeNull();

    expect(eventBus.publish).toHaveBeenCalledTimes(1);
    expect(eventBus.publish.mock.calls[0][0].payload).toMatchObject({ frozen: 1, released: 1 });
  });

  it('is a no-op when the kill switch is off', async () => {
    const { svc, prisma, leader } = makeSvc({ enabled: false });
    await svc.run();
    expect(leader.run).not.toHaveBeenCalled();
    expect(prisma.sellerSettlement.findMany).not.toHaveBeenCalled();
  });
});
