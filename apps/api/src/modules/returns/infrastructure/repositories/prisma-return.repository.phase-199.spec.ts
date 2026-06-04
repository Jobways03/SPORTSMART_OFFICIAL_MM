// Phase 199 (2026-06-02) — Returns Flow PII audit coverage.
//
// Asserts the customer-safe repository reads use a strict `select`
// whitelist (NOT `include`, which returns every Return scalar) and that
// the whitelist excludes the leaked admin/QC/risk/internal columns the
// audit flagged (#1/#2/#3/#4/#20/#23).

import { PrismaReturnRepository } from './prisma-return.repository';

const LEAKED_COLUMNS = [
  'qcInternalNotes',
  'qcRationale',
  'riskScore',
  'riskFlags',
  'riskScoredAt',
  'liabilityParty',
  'qcCourierName',
  'qcAwbNumber',
  'sellerResponseNotes',
  'creditNoteEligibilityStatus',
  'financeReviewedBy',
  'approvedBy',
  'rejectedBy',
  'version',
  'receivedBy',
  'refundFailureReason',
  'refundFailureHistory',
  'sellerIdSnapshot',
  'franchiseIdSnapshot',
  'closedBy',
  'cancelledBy',
];

function buildPrisma() {
  const findUnique = jest.fn().mockResolvedValue(null);
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  return {
    prisma: {
      return: { findUnique, findMany, count },
      $transaction: jest
        .fn()
        .mockImplementation(async (ops: any[]) => Promise.all(ops)),
    } as any,
    findUnique,
    findMany,
  };
}

function moneyDualWrite() {
  return { applyPaise: (_: string, d: any) => d } as any;
}

describe('PrismaReturnRepository customer-safe reads (Phase 199)', () => {
  it('findByIdForCustomer uses select (not include) and omits every leaked column', async () => {
    const { prisma, findUnique } = buildPrisma();
    const repo = new PrismaReturnRepository(prisma, moneyDualWrite());

    await repo.findByIdForCustomer('ret-1');

    const arg = findUnique.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'ret-1' });
    // Whitelist, not blacklist.
    expect(arg.select).toBeDefined();
    expect(arg.include).toBeUndefined();
    for (const col of LEAKED_COLUMNS) {
      expect(arg.select[col]).toBeUndefined();
    }
    // Customer-safe fields ARE present.
    expect(arg.select.returnNumber).toBe(true);
    expect(arg.select.refundFailureMessageCustomer).toBe(true);
    expect(arg.select.customerId).toBe(true); // needed for ownership check
  });

  it('findByIdForCustomer filters evidence to CUSTOMER + ADMIN and drops uploaderId (#4)', async () => {
    const { prisma, findUnique } = buildPrisma();
    const repo = new PrismaReturnRepository(prisma, moneyDualWrite());

    await repo.findByIdForCustomer('ret-1');
    const sel = findUnique.mock.calls[0][0].select;

    expect(sel.evidence.where).toEqual({
      uploadedBy: { in: ['CUSTOMER', 'ADMIN'] },
    });
    // uploaderId (internal actor) must not be selected.
    expect(sel.evidence.select.uploaderId).toBeUndefined();
    expect(sel.evidence.select.fileUrl).toBe(true);
  });

  it('findByIdForCustomer side-loads refundTransactions WITHOUT gatewayRefundId (#23)', async () => {
    const { prisma, findUnique } = buildPrisma();
    const repo = new PrismaReturnRepository(prisma, moneyDualWrite());

    await repo.findByIdForCustomer('ret-1');
    const sel = findUnique.mock.calls[0][0].select;

    expect(sel.refundTransactions.select.gatewayRefundId).toBeUndefined();
    // Raw per-attempt failureReason can carry gateway internals — omitted.
    expect(sel.refundTransactions.select.failureReason).toBeUndefined();
    expect(sel.refundTransactions.select.status).toBe(true);
    expect(sel.refundTransactions.select.attemptNumber).toBe(true);
  });

  it('findByIdForCustomer status-history select drops the internal actor id (changedById) (#3)', async () => {
    const { prisma, findUnique } = buildPrisma();
    const repo = new PrismaReturnRepository(prisma, moneyDualWrite());

    await repo.findByIdForCustomer('ret-1');
    const sel = findUnique.mock.calls[0][0].select;

    expect(sel.statusHistory.select.changedById).toBeUndefined();
    expect(sel.statusHistory.select.toStatus).toBe(true);
  });

  it('findByCustomerIdSafe uses select (not include), omits leaked columns, keeps refund summary (#2/#21)', async () => {
    const { prisma, findMany } = buildPrisma();
    const repo = new PrismaReturnRepository(prisma, moneyDualWrite());

    await repo.findByCustomerIdSafe('cust-1', { page: 1, limit: 20 });

    const arg = findMany.mock.calls[0][0];
    expect(arg.select).toBeDefined();
    expect(arg.include).toBeUndefined();
    for (const col of LEAKED_COLUMNS) {
      expect(arg.select[col]).toBeUndefined();
    }
    // #21 — refund summary on the list row.
    expect(arg.select.refundAmount).toBe(true);
    expect(arg.select.refundMethod).toBe(true);
    expect(arg.select.refundProcessedAt).toBe(true);
  });
});
