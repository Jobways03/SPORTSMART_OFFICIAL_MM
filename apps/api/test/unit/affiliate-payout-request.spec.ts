// Phase 154 — affiliate payout request hardening: KYC gate (flag), verified
// primary method, commission-claim race-CAS, method snapshot, status-history,
// audit + event.

import { Prisma } from '@prisma/client';
import { AffiliatePayoutService } from '../../src/modules/affiliate/application/services/affiliate-payout.service';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
} from '../../src/core/exceptions';

const D = (v: string | number) => new Prisma.Decimal(v);

function build(opts: {
  status?: string;
  kycStatus?: string;
  kycFlag?: boolean; // undefined → falls back to the service's default (true)
  primary?: any;
  eligible?: any[];
  reversed?: any[];
  claimCount?: number;
  // Phase 159e — TDS config + PAN presence.
  tdsSection?: string; // default '194O'
  tdsRate?: number; // §194H rate (% from settings); default 10
  panOnFile?: boolean; // default true
} = {}) {
  const eligible = opts.eligible ?? [{ id: 'c1', adjustedAmount: D(1000) }];
  const reversed = opts.reversed ?? [];

  const create = jest.fn(async (args: any) => ({
    id: 'req1',
    grossAmount: D(args.data.grossAmount ?? 0),
    reversalDebit: D(args.data.reversalDebit ?? 0),
    tdsAmount: D(args.data.tdsAmount ?? 0),
    netAmount: D(args.data.netAmount ?? 0),
    financialYear: args.data.financialYear,
    payoutMethodType: args.data.payoutMethodType,
    payoutMethodSnapshot: args.data.payoutMethodSnapshot,
    status: args.data.status,
  }));
  const commissionUpdateMany = jest.fn(async (args: any) =>
    args.data.payoutRequestId !== undefined
      ? { count: opts.claimCount ?? eligible.length }
      : { count: reversed.length },
  );
  const commissionFindMany = jest.fn(async (args: any) =>
    args.where.status === 'CONFIRMED' ? eligible : reversed,
  );
  const historyCreate = jest.fn().mockResolvedValue({});
  const adjCreateMany = jest.fn().mockResolvedValue({});

  const ledgerCreate = jest.fn().mockResolvedValue({});
  const tx = {
    affiliateCommission: { findMany: commissionFindMany, updateMany: commissionUpdateMany },
    affiliateTdsRecord: { findUnique: jest.fn().mockResolvedValue(null) },
    // Phase 159e — §194-O config + PAN + per-payout ledger.
    affiliateSettings: {
      findUnique: jest.fn().mockResolvedValue({
        tdsSection: opts.tdsSection ?? '194O',
        tdsRate: D(opts.tdsRate ?? 10),
        tdsThresholdPerFY: D(15000),
        tdsRateWithPanBps: 100,
        tdsRateWithoutPanBps: 500,
      }),
    },
    affiliateKyc: {
      findUnique: jest.fn().mockResolvedValue(
        opts.panOnFile === false ? null : { panNumberEnc: 'enc', panLast4: '1234' },
      ),
    },
    affiliateTds194OLedger: { create: ledgerCreate },
    affiliatePayoutRequest: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { grossAmount: null, tdsAmount: null } }),
      create,
    },
    affiliateCommissionAdjustment: { createMany: adjCreateMany },
    affiliatePayoutRequestStatusHistory: { create: historyCreate },
  };

  const prisma = {
    affiliate: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'aff1',
        status: opts.status ?? 'ACTIVE',
        kycStatus: opts.kycStatus ?? 'VERIFIED',
      }),
    },
    affiliatePayoutMethodRecord: {
      findFirst: jest.fn().mockResolvedValue(
        opts.primary === undefined
          ? { id: 'pm1', type: 'UPI', accountLast4: null, ifscCode: null, accountHolderName: null, bankName: null, upiId: 'a@upi' }
          : opts.primary,
      ),
    },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  } as any;

  const env = {
    getBoolean: jest.fn((_k: string, fb?: boolean) => (opts.kycFlag === undefined ? !!fb : opts.kycFlag)),
  } as any;
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;

  const svc = new AffiliatePayoutService(prisma, {} as any, env, audit, eventBus);
  return { svc, prisma, tx, create, commissionUpdateMany, historyCreate, audit, eventBus, ledgerCreate };
}

describe('AffiliatePayoutService.requestPayout (Phase 154)', () => {
  it('enforces the KYC gate by default (unverified → 403)', async () => {
    const { svc } = build({ kycStatus: 'PENDING' });
    await expect(svc.requestPayout({ affiliateId: 'aff1' })).rejects.toBeInstanceOf(
      ForbiddenAppException,
    );
  });

  it('allows an unverified affiliate when the gate is explicitly disabled', async () => {
    const { svc, create } = build({ kycStatus: 'PENDING', kycFlag: false });
    await svc.requestPayout({ affiliateId: 'aff1' });
    expect(create).toHaveBeenCalled(); // proceeded past the KYC check
  });

  it('rejects when there is no VERIFIED primary method', async () => {
    const { svc, prisma } = build({ primary: null });
    await expect(svc.requestPayout({ affiliateId: 'aff1' })).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
    // The query must require isVerified:true.
    expect(prisma.affiliatePayoutMethodRecord.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isPrimary: true, isVerified: true }),
      }),
    );
  });

  it('throws Conflict when the commission claim count drops (concurrent race)', async () => {
    const { svc } = build({
      eligible: [
        { id: 'c1', adjustedAmount: D(400) },
        { id: 'c2', adjustedAmount: D(400) },
      ],
      claimCount: 1, // only 1 of 2 still unclaimed → race
    });
    await expect(svc.requestPayout({ affiliateId: 'aff1' })).rejects.toBeInstanceOf(
      ConflictAppException,
    );
  });

  it('claims commissions with a status-CAS (payoutRequestId:null + CONFIRMED)', async () => {
    const { svc, commissionUpdateMany } = build();
    await svc.requestPayout({ affiliateId: 'aff1' });
    expect(commissionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ payoutRequestId: null, status: 'CONFIRMED' }),
        data: { payoutRequestId: 'req1' },
      }),
    );
  });

  it('stores the payout-method snapshot + opens the status history + audits + emits', async () => {
    const { svc, create, historyCreate, audit, eventBus } = build();
    await svc.requestPayout({ affiliateId: 'aff1', ipAddress: '1.2.3.4', userAgent: 'jest' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REQUESTED',
          payoutMethodType: 'UPI',
          payoutMethodSnapshot: expect.objectContaining({ type: 'UPI', upiId: 'a@upi' }),
        }),
      }),
    );
    expect(historyCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ toStatus: 'REQUESTED' }) }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'affiliate.payout.requested' }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'affiliate.payout.requested' }),
    );
  });

  it('rejects below the ₹500 minimum', async () => {
    const { svc } = build({ eligible: [{ id: 'c1', adjustedAmount: D(100) }] });
    await expect(svc.requestPayout({ affiliateId: 'aff1' })).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
  });

  it('rejects an inactive affiliate', async () => {
    const { svc } = build({ status: 'SUSPENDED' });
    await expect(svc.requestPayout({ affiliateId: 'aff1' })).rejects.toBeInstanceOf(
      ForbiddenAppException,
    );
  });
});

describe('AffiliatePayoutService.requestPayout — §194-O TDS (Phase 159e)', () => {
  it('PAN on file → 1% TDS, §194-O snapshot, COMPUTED ledger row', async () => {
    const { svc, create, ledgerCreate } = build({
      eligible: [{ id: 'c1', adjustedAmount: D(1000) }],
      panOnFile: true,
    });
    await svc.requestPayout({ affiliateId: 'aff1' });
    const data = create.mock.calls[0]![0].data;
    expect(Number(data.tdsAmount)).toBe(10); // 1% of 1000
    expect(data.tdsSection).toBe('194O');
    expect(data.tdsRateBps).toBe(100);
    expect(data.panOnFileAtDeduction).toBe(true);
    expect(data.filingQuarter).toMatch(/^\d{4}-Q[1-4]$/);
    expect(Number(data.netAmount)).toBe(990);
    expect(ledgerCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'COMPUTED', tdsRateBps: 100 }) }),
    );
  });

  it('no PAN → 5% TDS', async () => {
    const { svc, create } = build({
      eligible: [{ id: 'c1', adjustedAmount: D(1000) }],
      panOnFile: false,
    });
    await svc.requestPayout({ affiliateId: 'aff1' });
    const data = create.mock.calls[0]![0].data;
    expect(Number(data.tdsAmount)).toBe(50); // 5% of 1000
    expect(data.tdsRateBps).toBe(500);
    expect(data.panOnFileAtDeduction).toBe(false);
  });

  it('§194-O has NO threshold — a small payout is still deducted', async () => {
    const { svc, create } = build({
      eligible: [{ id: 'c1', adjustedAmount: D(600) }], // well below the old ₹15k threshold
      panOnFile: true,
    });
    await svc.requestPayout({ affiliateId: 'aff1' });
    expect(Number(create.mock.calls[0]![0].data.tdsAmount)).toBe(6); // 1% of 600, not 0
  });

  it('§194H mode reads the rate from settings (not a hardcoded 10%) + no ledger row', async () => {
    const { svc, create, ledgerCreate } = build({
      tdsSection: '194H',
      tdsRate: 5, // settings rate
      eligible: [{ id: 'c1', adjustedAmount: D(20000) }], // above ₹15k threshold
    });
    await svc.requestPayout({ affiliateId: 'aff1' });
    const data = create.mock.calls[0]![0].data;
    // taxable = 20000 - 15000 = 5000; 5% = 250 (proves the settings rate, not 10%)
    expect(Number(data.tdsAmount)).toBe(250);
    expect(data.tdsSection).toBe('194H');
    expect(ledgerCreate).not.toHaveBeenCalled(); // §194H doesn't use the §194-O ledger
  });
});
