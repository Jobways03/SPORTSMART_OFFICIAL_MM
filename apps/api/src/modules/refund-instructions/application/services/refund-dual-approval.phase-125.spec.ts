// Phase 125 — dual-approval (two-person rule) for high-value refunds.
//
// Refunds at/above REFUND_DUAL_APPROVAL_THRESHOLD_PAISE require TWO distinct
// finance approvers (separation of duties). The first approval is recorded
// and held in PENDING_APPROVAL; only a second, DIFFERENT admin releases the
// saga. Below the threshold a single approval executes immediately.
//
// Verifies against the real RefundInstructionService.approveByFinance with a
// stateful in-memory prisma mock (updateMany emulates the CAS guards).

import { RefundInstructionService } from './refund-instruction.service';
import { ConflictAppException } from '../../../../core/exceptions';

const DUAL_THRESHOLD = 10_000_000; // ₹1,00,000

function build(initial: Record<string, any> = {}) {
  let row: any = {
    id: 'ri-1',
    status: 'PENDING_APPROVAL',
    amountInPaise: 20_000_000n, // ₹2,00,000 → above the dual threshold
    refundMethod: 'WALLET',
    idempotencyKey: 'dispute:d1',
    sourceType: 'DISPUTE',
    sourceId: 'd1',
    customerId: 'cust-1',
    firstApprovedBy: null,
    firstApprovedAt: null,
    approvedBy: null,
    approvedAt: null,
    walletTransactionId: null,
    gatewayRefundId: null,
    ...initial,
  };

  const prisma: any = {
    refundInstruction: {
      findUnique: jest.fn(async () => (row ? { ...row } : null)),
      // Emulates a compare-and-swap: every WHERE field (besides id) must
      // match the current row, else count:0 and no mutation.
      updateMany: jest.fn(async ({ where, data }: any) => {
        // Phase 170 — the CAS WHERE clauses now use `status: { in: [...] }`
        // (PENDING_APPROVAL | NEEDS_CLARIFICATION). Emulate both scalar and
        // `{ in }` forms.
        const statusMatches =
          where.status === undefined
            ? true
            : where.status?.in
              ? where.status.in.includes(row?.status)
              : row?.status === where.status;
        const matches =
          row &&
          row.id === where.id &&
          statusMatches &&
          (where.firstApprovedBy === undefined ||
            row.firstApprovedBy === where.firstApprovedBy);
        if (!matches) return { count: 0 };
        row = { ...row, ...data };
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }: any) => {
        row = { ...row, ...data };
        return { ...row };
      }),
    },
    return: { update: jest.fn(async () => ({})) },
    refundInstructionStatusHistory: { create: jest.fn(async () => ({})) },
  };
  const env: any = {
    getNumber: jest.fn((key: string, dflt: number) =>
      key === 'REFUND_DUAL_APPROVAL_THRESHOLD_PAISE' ? DUAL_THRESHOLD : dflt,
    ),
    getBoolean: jest.fn(() => true),
    getOptional: jest.fn(() => undefined),
  };
  const wallet: any = {};
  const saga: any = {
    run: jest.fn(async () => ({
      status: 'COMPLETED',
      finalContext: { walletTransactionId: 'wtx-1' },
    })),
  };
  const splitCalculator: any = {};

  const svc = new RefundInstructionService(
    prisma,
    env,
    wallet,
    saga,
    splitCalculator,
  );
  return { svc, prisma, saga, getRow: () => row };
}

describe('RefundInstructionService.approveByFinance — dual approval', () => {
  it('records the first approval and HOLDS a high-value refund (no saga)', async () => {
    const { svc, saga, getRow } = build();
    const res = await svc.approveByFinance({
      instructionId: 'ri-1',
      adminId: 'admin-A',
    });
    expect((res as any).pendingSecondApproval).toBe(true);
    expect(res.status).toBe('PENDING_APPROVAL');
    expect(res.firstApprovedBy).toBe('admin-A');
    expect(getRow().approvedBy).toBeNull();
    expect(saga.run).not.toHaveBeenCalled();
  });

  it('rejects the SAME admin trying to approve twice (separation of duties)', async () => {
    const { svc, saga } = build({
      firstApprovedBy: 'admin-A',
      firstApprovedAt: new Date(),
    });
    await expect(
      svc.approveByFinance({ instructionId: 'ri-1', adminId: 'admin-A' }),
    ).rejects.toBeInstanceOf(ConflictAppException);
    expect(saga.run).not.toHaveBeenCalled();
  });

  it('releases the saga when a DISTINCT second admin approves', async () => {
    const { svc, saga, getRow } = build({
      firstApprovedBy: 'admin-A',
      firstApprovedAt: new Date(),
    });
    const res = await svc.approveByFinance({
      instructionId: 'ri-1',
      adminId: 'admin-B',
    });
    expect(saga.run).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('SUCCESS');
    expect((res as any).pendingSecondApproval).toBeUndefined();
    expect(getRow().approvedBy).toBe('admin-B');
    expect(getRow().firstApprovedBy).toBe('admin-A');
  });

  it('executes immediately on a single approval below the dual threshold', async () => {
    const { svc, saga, getRow } = build({ amountInPaise: 500_000n }); // ₹5,000
    const res = await svc.approveByFinance({
      instructionId: 'ri-1',
      adminId: 'admin-A',
    });
    expect(saga.run).toHaveBeenCalledTimes(1);
    expect(res.status).toBe('SUCCESS');
    expect(getRow().firstApprovedBy).toBeNull(); // dual path never engaged
    expect(getRow().approvedBy).toBe('admin-A');
  });

  it('is idempotent on an already-SUCCESS instruction', async () => {
    const { svc, saga } = build({ status: 'SUCCESS' });
    const res = await svc.approveByFinance({
      instructionId: 'ri-1',
      adminId: 'admin-A',
    });
    expect(res.status).toBe('SUCCESS');
    expect(saga.run).not.toHaveBeenCalled();
  });

  it('refuses to approve a non-pending (e.g. CANCELLED) instruction', async () => {
    const { svc } = build({ status: 'CANCELLED' });
    await expect(
      svc.approveByFinance({ instructionId: 'ri-1', adminId: 'admin-A' }),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });
});
