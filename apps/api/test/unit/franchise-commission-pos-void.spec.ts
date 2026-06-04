import 'reflect-metadata';
import { FranchiseCommissionService } from '../../src/modules/franchise/application/services/franchise-commission.service';

/**
 * Phase 159r (POS void/return audit #14) — voiding a sale whose commission was
 * already ACCRUED/SETTLED must post a compensating ADJUSTMENT (clawback) instead
 * of silently bailing, so the franchise can't keep commission on a voided sale.
 */
function build(originalStatus: string) {
  const original = {
    id: 'led-1',
    status: originalStatus,
    baseAmount: 1000,
    computedAmount: 80,
    platformEarning: 80,
    franchiseEarning: 0,
  };
  const financeRepo: any = {
    findLedgerEntryBySource: jest.fn().mockResolvedValue(original),
    updateLedgerEntryStatus: jest.fn().mockResolvedValue({ id: 'led-1', status: 'REVERSED' }),
    createLedgerEntry: jest.fn().mockResolvedValue({ id: 'led-adj' }),
  };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const logger: any = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  // Phase 181 — the PENDING void now posts the compensating reversal AND flips
  // the original inside one prisma.$transaction. The transaction body calls back
  // through financeRepo (already mocked above), so `tx` just needs to be a
  // passable handle the callback receives.
  const tx: any = {};
  const prisma: any = {
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const service = new FranchiseCommissionService(financeRepo, eventBus, logger, prisma);
  return { service, financeRepo };
}

describe('FranchiseCommissionService.recordPosVoid — #14 clawback', () => {
  it('PENDING commission is reversed AND posts a compensating POS_SALE_REVERSAL entry', async () => {
    // Phase 181 — the PENDING void now posts a compensating POS_SALE_REVERSAL
    // ledger entry (cancelling the original's balance effect) AND flips the
    // original to REVERSED inside one transaction. updateLedgerEntryStatus
    // gained two args: (id, 'REVERSED', undefined, { tx, reason }).
    const { service, financeRepo } = build('PENDING');
    await service.recordPosVoid({ franchiseId: 'fr-1', saleId: 'sale-1' });
    expect(financeRepo.createLedgerEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'POS_SALE_REVERSAL',
        sourceId: 'sale-1',
        idempotencyKey: 'POS_VOID:sale-1',
      }),
    );
    expect(financeRepo.updateLedgerEntryStatus).toHaveBeenCalledWith(
      'led-1',
      'REVERSED',
      undefined,
      expect.objectContaining({ reason: expect.stringContaining('sale-1') }),
    );
  });

  it('SETTLED commission posts a compensating negative ADJUSTMENT', async () => {
    const { service, financeRepo } = build('SETTLED');
    await service.recordPosVoid({ franchiseId: 'fr-1', saleId: 'sale-1' });
    expect(financeRepo.updateLedgerEntryStatus).not.toHaveBeenCalled();
    expect(financeRepo.createLedgerEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceType: 'ADJUSTMENT',
        sourceId: 'sale-1',
        platformEarning: -80,
        computedAmount: -80,
      }),
    );
  });

  it('ACCRUED commission also posts the clawback', async () => {
    const { service, financeRepo } = build('ACCRUED');
    await service.recordPosVoid({ franchiseId: 'fr-1', saleId: 'sale-1' });
    expect(financeRepo.createLedgerEntry).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'ADJUSTMENT', platformEarning: -80 }),
    );
  });
});

/**
 * Phase 159v (audit #9) — Decimal money math: exact paise, base = computed +
 * franchise at 2dp, reversals negative + exact.
 */
describe('FranchiseCommissionService — #9 Decimal money math', () => {
  function buildCapture() {
    let captured: any = null;
    const financeRepo: any = {
      createLedgerEntry: jest.fn(async (data: any) => {
        captured = data;
        return { id: 'led-x' };
      }),
    };
    const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
    const logger: any = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
    const service = new FranchiseCommissionService(financeRepo, eventBus, logger, {} as any);
    return { service, get captured() { return captured; } };
  }

  it('online commission splits exactly at 2dp (base = computed + franchise)', async () => {
    const h = buildCapture();
    await h.service.recordOnlineOrderCommission({
      franchiseId: 'fr-1',
      subOrderId: 'so-1',
      orderNumber: 'ORD-1',
      items: [{ unitPrice: 99.99, quantity: 3 }],
      commissionRate: 8,
    });
    const d = h.captured;
    expect(d.baseAmount).toBe(299.97); // 99.99 × 3, exact (float reduce drifts)
    expect(d.computedAmount).toBe(24); // 299.97 × 0.08 = 23.9976 → 24.00
    expect(d.franchiseEarning).toBe(275.97); // 299.97 − 24.00
    expect(d.baseAmount).toBe(d.computedAmount + d.franchiseEarning);
  });

  it('POS return reversal is negative and exact', async () => {
    const h = buildCapture();
    await h.service.recordPosReturn({
      franchiseId: 'fr-1',
      saleId: 'sale-1',
      saleNumber: 'POS-1',
      refundAmount: 150.5,
      commissionRate: 10,
    });
    const d = h.captured;
    expect(d.baseAmount).toBe(-150.5);
    expect(d.computedAmount).toBe(-15.05); // 150.50 × 0.10
    expect(d.franchiseEarning).toBe(-135.45); // −(150.50 − 15.05)
  });
});
