import 'reflect-metadata';
import { RefundInstructionService } from '../../src/modules/refund-instructions/application/services/refund-instruction.service';
import { ConflictAppException } from '../../src/core/exceptions';

// Phase 170 — Refund-Instruction Queue audit remediation.
//   #10 requestClarification flips PENDING_APPROVAL → NEEDS_CLARIFICATION
//   #2  approve emits refunds.instruction.approved
//   #15 revertRejection CANCELLED → PENDING_APPROVAL
//   #16 status-history rows written
//   #17 >= threshold (at-threshold queues)

function buildService(initial: Record<string, any> = {}) {
  let row: any = {
    id: 'ri-1',
    status: 'PENDING_APPROVAL',
    amountInPaise: 50_000n, // below dual threshold
    refundMethod: 'WALLET',
    idempotencyKey: 'dispute:d1',
    sourceType: 'DISPUTE',
    sourceId: 'd1',
    customerId: 'cust-1',
    firstApprovedBy: null,
    approvedBy: null,
    ...initial,
  };
  const history: any[] = [];
  const prisma: any = {
    refundInstruction: {
      findUnique: jest.fn(async () => (row ? { ...row } : null)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const statusMatches =
          where.status === undefined
            ? true
            : where.status?.in
              ? where.status.in.includes(row?.status)
              : row?.status === where.status;
        if (!row || row.id !== where.id || !statusMatches) return { count: 0 };
        if (where.firstApprovedBy !== undefined && row.firstApprovedBy !== where.firstApprovedBy) {
          return { count: 0 };
        }
        row = { ...row, ...data };
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }: any) => {
        row = { ...row, ...data };
        return { ...row };
      }),
    },
    return: { update: jest.fn(async () => ({})) },
    refundInstructionStatusHistory: {
      create: jest.fn(async ({ data }: any) => {
        history.push(data);
        return { id: `h-${history.length}`, ...data };
      }),
    },
  };
  const env: any = {
    getNumber: jest.fn((key: string, dflt: number) =>
      key === 'REFUND_DUAL_APPROVAL_THRESHOLD_PAISE' ? 10_000_000 : dflt,
    ),
    getBoolean: jest.fn(() => true),
    getOptional: jest.fn(() => undefined),
  };
  const saga: any = {
    run: jest.fn(async () => ({ status: 'COMPLETED', finalContext: { walletTransactionId: 'wtx-1' } })),
  };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const svc = new RefundInstructionService(prisma, env, {} as any, saga, {} as any, eventBus);
  return { svc, prisma, saga, eventBus, history, getRow: () => row };
}

describe('requestClarification (#10)', () => {
  it('flips PENDING_APPROVAL → NEEDS_CLARIFICATION + persists the question + records history', async () => {
    const { svc, getRow, history } = buildService();
    const res = await svc.requestClarification({ instructionId: 'ri-1', adminId: 'admin-1', question: 'was the box opened?' });
    expect(res.status).toBe('NEEDS_CLARIFICATION');
    expect(getRow().clarificationNote).toBe('was the box opened?');
    expect(getRow().clarificationBy).toBe('admin-1');
    expect(history.some((h) => h.toStatus === 'NEEDS_CLARIFICATION')).toBe(true);
  });

  it('is idempotent on re-ask (already NEEDS_CLARIFICATION) — updates the note, no new history', async () => {
    const { svc, history } = buildService({ status: 'NEEDS_CLARIFICATION' });
    await svc.requestClarification({ instructionId: 'ri-1', adminId: 'admin-1', question: 'follow-up?' });
    expect(history.length).toBe(0); // no from!=to transition
  });

  it('rejects clarification on a decided instruction', async () => {
    const { svc } = buildService({ status: 'SUCCESS' });
    await expect(
      svc.requestClarification({ instructionId: 'ri-1', adminId: 'admin-1', question: 'too late?' }),
    ).rejects.toThrow(/not awaiting approval/);
  });
});

describe('approveByFinance from NEEDS_CLARIFICATION (#10) + approved event (#2)', () => {
  it('approves a NEEDS_CLARIFICATION instruction + emits refunds.instruction.approved', async () => {
    const { svc, eventBus, getRow } = buildService({ status: 'NEEDS_CLARIFICATION' });
    const res = await svc.approveByFinance({ instructionId: 'ri-1', adminId: 'admin-2' });
    expect(res.status).toBe('SUCCESS');
    expect(getRow().approvedBy).toBe('admin-2');
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'refunds.instruction.approved' }),
    );
  });
});

describe('revertRejection (#15)', () => {
  it('flips CANCELLED → PENDING_APPROVAL + clears rejection stamps + records history', async () => {
    const { svc, getRow, history } = buildService({
      status: 'CANCELLED', rejectedBy: 'admin-1', rejectedAt: new Date(), rejectionReason: 'wrong call',
    });
    const res = await svc.revertRejection({ instructionId: 'ri-1', adminId: 'admin-9', reason: 'customer was right' });
    expect(res.status).toBe('PENDING_APPROVAL');
    expect(getRow().rejectedBy).toBeNull();
    expect(getRow().approvalDueBy).toBeInstanceOf(Date);
    expect(history.some((h) => h.fromStatus === 'CANCELLED' && h.toStatus === 'PENDING_APPROVAL')).toBe(true);
  });

  it('refuses to revert a non-CANCELLED instruction', async () => {
    const { svc } = buildService({ status: 'SUCCESS' });
    await expect(
      svc.revertRejection({ instructionId: 'ri-1', adminId: 'admin-9', reason: 'oops' }),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  // Phase 170 review (L1#2) — reverting a high-value refund must CLEAR the
  // dual-approval stamps so the re-opened instruction requires fresh approvals
  // (no single second-approver bypass via a stale firstApprovedBy).
  it('clears firstApprovedBy/approvedBy on revert (no SoD bypass)', async () => {
    const { svc, getRow } = buildService({
      status: 'CANCELLED',
      firstApprovedBy: 'admin-A',
      firstApprovedAt: new Date(),
      approvedBy: null,
      rejectedBy: 'admin-B',
      rejectedAt: new Date(),
      rejectionReason: 'mistake',
    });
    await svc.revertRejection({ instructionId: 'ri-1', adminId: 'admin-9', reason: 're-open' });
    expect(getRow().firstApprovedBy).toBeNull();
    expect(getRow().firstApprovedAt).toBeNull();
    expect(getRow().approvedBy).toBeNull();
  });
});

describe('rejectByFinance CAS + NEEDS_CLARIFICATION (#10) + history (#16)', () => {
  it('rejects from NEEDS_CLARIFICATION and records history', async () => {
    // Phase 171 — the default fixture is DISPUTE-sourced, so a finance reject now
    // routes back to the dispute (ROUTED_BACK_TO_DISPUTE) rather than CANCELLED.
    const { svc, getRow, history } = buildService({ status: 'NEEDS_CLARIFICATION' });
    const res = await svc.rejectByFinance({ instructionId: 'ri-1', adminId: 'admin-1', reason: 'not eligible' });
    expect(res.status).toBe('ROUTED_BACK_TO_DISPUTE');
    expect(getRow().rejectionReason).toBe('not eligible');
    expect(history.some((h) => h.toStatus === 'ROUTED_BACK_TO_DISPUTE')).toBe(true);
  });
});

describe('amountRequiresApproval >= threshold (#17)', () => {
  // Use the private method via the dispute gate (exactly-at-threshold must queue).
  it('queues a refund EXACTLY at the threshold (>= not >)', async () => {
    const { svc, getRow } = buildService();
    // createForDispute at exactly ₹10,000 = 1_000_000 paise (default threshold).
    const prismaAny = (svc as any).prisma;
    prismaAny.refundInstruction.findUnique = jest.fn(async () => null); // no existing
    let created: any = null;
    prismaAny.refundInstruction.create = jest.fn(async ({ data }: any) => {
      created = { id: 'ri-new', ...data };
      return created;
    });
    await svc.createForDispute({
      disputeId: 'd2', disputeNumber: 'D-2', customerId: 'c1', masterOrderId: 'mo1',
      amountInPaise: 1_000_000, // exactly the threshold
      customerRemedy: 'FULL_REFUND',
    });
    expect(created.status).toBe('PENDING_APPROVAL'); // queued, not auto-processed
    void getRow;
  });
});
