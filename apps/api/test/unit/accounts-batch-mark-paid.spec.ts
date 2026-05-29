// Phase 146 — batch mark-paid. The seller path DELEGATES to the hardened
// single-settlement markSettlementPaid (so it inherits audit + TCS/TDS +
// version-CAS + UTR-unique + paise); the franchise path runs a CAS update +
// its own audit row. Plus payload dedup, size cap, and per-item partial failure.

import { AccountsSettlementService } from '../../src/modules/accounts/application/services/accounts-settlement.service';

function build(opts: { markPaidResult?: { success: boolean; message?: string }; franchise?: any } = {}) {
  const tx = {
    franchiseSettlement: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    franchiseFinanceLedger: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
  };
  const prisma = {
    sellerSettlement: {
      findUnique: jest.fn().mockResolvedValue({ cycleId: 'cyc-s' }),
      count: jest.fn().mockResolvedValue(0),
    },
    franchiseSettlement: {
      findUnique: jest.fn().mockResolvedValue(
        opts.franchise ?? {
          id: 'f1',
          status: 'APPROVED',
          cycleId: 'cyc-f',
          franchiseId: 'fr1',
          netPayableToFranchise: '500.00',
        },
      ),
      count: jest.fn().mockResolvedValue(0),
    },
    settlementCycle: { update: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const moneyDualWrite = { applyPaise: (_k: string, d: any) => d };
  const settlementService = {
    markSettlementPaid: jest
      .fn()
      .mockResolvedValue(opts.markPaidResult ?? { success: true, message: 'ok' }),
  };
  const svc = new AccountsSettlementService(
    {} as any, // accountsRepo
    prisma as any,
    eventBus as any,
    moneyDualWrite as any,
    settlementService as any,
    audit as any,
  );
  (svc as any).logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
  return { svc, prisma, tx, audit, settlementService };
}

describe('AccountsSettlementService.batchMarkPaid (Phase 146)', () => {
  it('delegates each seller item to the hardened markSettlementPaid', async () => {
    const { svc, settlementService } = build();
    const res = await svc.batchMarkPaid(
      [{ id: 's1', type: 'seller', reference: 'HDFCUTR0001' }],
      { adminId: 'admin1', ipAddress: '1.2.3.4', userAgent: 'jest' },
    );
    expect(settlementService.markSettlementPaid).toHaveBeenCalledWith(
      's1',
      'HDFCUTR0001',
      expect.objectContaining({ adminId: 'admin1', ipAddress: '1.2.3.4' }),
    );
    expect(res.results[0]!.success).toBe(true);
  });

  it('records a per-item failure when the delegated call fails (e.g. duplicate UTR)', async () => {
    const { svc } = build({ markPaidResult: { success: false, message: 'UTR already recorded' } });
    const res = await svc.batchMarkPaid(
      [{ id: 's1', type: 'seller', reference: 'DUP123456' }],
      { adminId: 'admin1' },
    );
    expect(res.results[0]!.success).toBe(false);
    expect(res.results[0]!.error).toMatch(/already recorded/i);
  });

  it('marks a franchise item paid (CAS) + writes its own audit row', async () => {
    const { svc, tx, audit } = build();
    const res = await svc.batchMarkPaid(
      [{ id: 'f1', type: 'franchise', reference: 'FRREF12345' }],
      { adminId: 'admin1' },
    );
    expect(res.results[0]!.success).toBe(true);
    expect(tx.franchiseSettlement.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'f1', status: 'APPROVED' },
        data: expect.objectContaining({ status: 'PAID', paidByAdminId: 'admin1' }),
      }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MARK_SETTLEMENT_PAID',
        resource: 'franchise_settlement',
      }),
    );
  });

  it('rejects a settlement listed twice in one payload', async () => {
    const { svc } = build();
    const res = await svc.batchMarkPaid(
      [
        { id: 's1', type: 'seller', reference: 'REF00000001' },
        { id: 's1', type: 'seller', reference: 'REF00000002' },
      ],
      { adminId: 'admin1' },
    );
    expect(res.results[0]!.success).toBe(true);
    expect(res.results[1]!.success).toBe(false);
    expect(res.results[1]!.error).toMatch(/duplicate/i);
  });

  it('enforces the 100-item cap', async () => {
    const { svc } = build();
    const items = Array.from({ length: 101 }, (_, i) => ({
      id: `s${i}`,
      type: 'seller' as const,
      reference: `REF${String(i).padStart(8, '0')}`,
    }));
    await expect(svc.batchMarkPaid(items, { adminId: 'a' })).rejects.toThrow(/capped at 100/i);
  });

  it('rolls a cycle to PAID only when both seller + franchise children are clean', async () => {
    const { svc, prisma } = build();
    await svc.batchMarkPaid([{ id: 'f1', type: 'franchise', reference: 'FRREF99999' }], {
      adminId: 'admin1',
    });
    // rollup counted BOTH seller and franchise outstanding (0 + 0) → cycle flips.
    expect(prisma.sellerSettlement.count).toHaveBeenCalled();
    expect(prisma.franchiseSettlement.count).toHaveBeenCalled();
    expect(prisma.settlementCycle.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'PAID' } }),
    );
  });
});
