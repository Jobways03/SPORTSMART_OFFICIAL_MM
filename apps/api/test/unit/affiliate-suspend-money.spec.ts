// Phase 159h — Affiliate suspend/reactivate money-handling.
//   - markPaid refuses a non-ACTIVE affiliate (the money-leak Critical);
//   - suspend cancels in-flight payouts + HOLDs commissions + strips reason;
//   - reactivate records the reason + releases suspension-HELD commissions.

import { AffiliateRegistrationService } from '../../src/modules/affiliate/application/services/affiliate-registration.service';
import { AffiliatePayoutService } from '../../src/modules/affiliate/application/services/affiliate-payout.service';
import {
  BadRequestAppException,
  ForbiddenAppException,
} from '../../src/core/exceptions';

// ── markPaid affiliate-status guard ─────────────────────────────
function buildPayout(affiliateStatus: string) {
  const tx = {
    affiliatePayoutRequest: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'p1',
        status: 'APPROVED',
        affiliateId: 'a1',
        affiliate: { status: affiliateStatus },
        processedAt: null,
      }),
    },
  } as any;
  const prisma = { $transaction: jest.fn(async (cb: any) => cb(tx)) } as any;
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  const svc = new AffiliatePayoutService(prisma, {} as any, {} as any, audit, eventBus);
  (svc as any).logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  return svc;
}

describe('AffiliatePayoutService.markPaid — affiliate-status guard (Phase 159h)', () => {
  it('refuses to pay a SUSPENDED affiliate (money-leak Critical)', async () => {
    const svc = buildPayout('SUSPENDED');
    await expect(
      svc.markPaid({ payoutRequestId: 'p1', adminId: 'admin1', transactionRef: 'UTR12345678' }),
    ).rejects.toBeInstanceOf(ForbiddenAppException);
  });
});

// ── suspend / reactivate money handling ─────────────────────────
function buildReg(status: string, inflightPayouts: any[] = []) {
  const affiliate = { id: 'a1', status, email: 'aff@x.com' };
  const affiliateUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const commissionUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
  const payoutUpdateMany = jest.fn().mockResolvedValue({ count: inflightPayouts.length });
  const ledgerDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const prisma: any = {
    affiliate: {
      findUnique: jest.fn().mockResolvedValue(affiliate),
      update: jest.fn(async (a: any) => ({ ...affiliate, ...a.data })),
      updateMany: affiliateUpdateMany,
    },
    affiliateStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    affiliateSession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    affiliatePayoutRequest: {
      findMany: jest.fn().mockResolvedValue(inflightPayouts),
      updateMany: payoutUpdateMany,
    },
    affiliateCommission: { updateMany: commissionUpdateMany },
    affiliateTds194OLedger: { deleteMany: ledgerDeleteMany },
  };
  prisma.$transaction = jest.fn(async (cb: any) => cb(prisma));
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) } as any;
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any;
  const svc = new AffiliateRegistrationService(prisma, eventBus, audit);
  (svc as any).logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  return { svc, affiliateUpdateMany, commissionUpdateMany, payoutUpdateMany };
}

describe('AffiliateRegistrationService.suspend — money handling (Phase 159h)', () => {
  it('cancels in-flight payouts, releases their commissions, and HOLDs the rest', async () => {
    const { svc, payoutUpdateMany, commissionUpdateMany } = buildReg('ACTIVE', [{ id: 'pr1' }]);
    await svc.suspend('a1', 'fraud', 'admin1');
    // Payout requests cancelled.
    expect(payoutUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
    );
    // Two commission updateMany: release (payoutRequestId null) + HOLD.
    const calls = commissionUpdateMany.mock.calls.map((c) => c[0]);
    expect(calls.some((a) => a.data?.payoutRequestId === null)).toBe(true);
    expect(calls.some((a) => a.data?.status === 'HOLD')).toBe(true);
  });

  it('strips HTML tags from the suspension reason', async () => {
    const { svc, affiliateUpdateMany } = buildReg('ACTIVE');
    await svc.suspend('a1', '<img src=x onerror=alert(1)>fraud', 'admin1');
    const stored = affiliateUpdateMany.mock.calls[0]![0].data.suspensionReason;
    expect(stored).toBe('fraud'); // the <img onerror> tag is gone
    expect(stored).not.toContain('<'); // no markup survives
  });

  it('rejects suspending a non-ACTIVE affiliate', async () => {
    const { svc } = buildReg('SUSPENDED');
    await expect(svc.suspend('a1', 'x', 'admin1')).rejects.toBeInstanceOf(BadRequestAppException);
  });
});

describe('AffiliateRegistrationService.reactivate — reason + release (Phase 159h)', () => {
  it('records the reactivation reason + releases suspension-HELD commissions', async () => {
    const { svc, affiliateUpdateMany, commissionUpdateMany } = buildReg('SUSPENDED');
    await svc.reactivate('a1', 'admin1', 'KYC cleared');
    const cas = affiliateUpdateMany.mock.calls[0]![0];
    expect(cas.data.status).toBe('ACTIVE');
    expect(cas.data.reactivationReason).toBe('KYC cleared');
    expect(commissionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'HOLD', holdReason: { startsWith: 'Affiliate suspended' } }),
        data: expect.objectContaining({ status: 'PENDING', holdReason: null }),
      }),
    );
  });

  it('rejects reactivating an already-ACTIVE affiliate', async () => {
    const { svc } = buildReg('ACTIVE');
    await expect(svc.reactivate('a1', 'admin1')).rejects.toBeInstanceOf(BadRequestAppException);
  });
});
