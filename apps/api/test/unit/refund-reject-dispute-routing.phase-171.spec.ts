import 'reflect-metadata';
import { RefundInstructionService } from '../../src/modules/refund-instructions/application/services/refund-instruction.service';
import { ConflictAppException } from '../../src/core/exceptions';

// Phase 171 — Refund Approve/Reject (reject → dispute routing) remediation.
//   #2/#3 dispute-sourced reject → ROUTED_BACK_TO_DISPUTE; other → REJECTED
//   #4   linkedDisputeId populated
//   #6   customerVisibleReason stored separate from internal reason
//   #16  status-history row written

function buildService(initial: Record<string, any> = {}) {
  let row: any = {
    id: 'ri-1',
    status: 'PENDING_APPROVAL',
    amountInPaise: 50_000n,
    refundMethod: 'WALLET',
    idempotencyKey: 'dispute:d1',
    sourceType: 'DISPUTE',
    sourceId: 'd1',
    customerId: 'cust-1',
    linkedDisputeId: 'd1',
    firstApprovedBy: null,
    ...initial,
  };
  const history: any[] = [];
  const prisma: any = {
    refundInstruction: {
      findUnique: jest.fn(async () => (row ? { ...row } : null)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const statusMatches = where.status?.in
          ? where.status.in.includes(row?.status)
          : where.status === undefined || row?.status === where.status;
        if (!row || row.id !== where.id || !statusMatches) return { count: 0 };
        row = { ...row, ...data };
        return { count: 1 };
      }),
      update: jest.fn(async ({ data }: any) => {
        row = { ...row, ...data };
        return { ...row };
      }),
    },
    refundInstructionStatusHistory: {
      create: jest.fn(async ({ data }: any) => {
        history.push(data);
        return { id: `h-${history.length}`, ...data };
      }),
    },
  };
  const env: any = { getNumber: (_: string, d: number) => d, getBoolean: () => true, getOptional: () => undefined };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const svc = new RefundInstructionService(prisma, env, {} as any, {} as any, {} as any, eventBus);
  return { svc, history, getRow: () => row };
}

describe('rejectByFinance — dispute source (#1/#2/#3)', () => {
  it('flips a DISPUTE refund to ROUTED_BACK_TO_DISPUTE + stamps routedBack* + returns routedBackToDispute=true', async () => {
    const { svc, getRow, history } = buildService();
    const res = await svc.rejectByFinance({ instructionId: 'ri-1', adminId: 'fin-1', reason: 'amount looks wrong' });
    expect(res.status).toBe('ROUTED_BACK_TO_DISPUTE');
    expect((res as any).routedBackToDispute).toBe(true);
    expect(getRow().routedBackBy).toBe('fin-1');
    expect(getRow().routedBackAt).toBeInstanceOf(Date);
    expect(getRow().linkedDisputeId).toBe('d1');
    expect(history.some((h) => h.toStatus === 'ROUTED_BACK_TO_DISPUTE')).toBe(true);
  });

  it('stores customerVisibleReason separate from the internal rejectionReason (#6)', async () => {
    const { svc, getRow } = buildService();
    await svc.rejectByFinance({
      instructionId: 'ri-1', adminId: 'fin-1',
      reason: 'fraud signals detected', customerVisibleReason: 'Additional review required',
    });
    expect(getRow().rejectionReason).toBe('fraud signals detected');
    expect(getRow().customerVisibleReason).toBe('Additional review required');
  });
});

describe('rejectByFinance — non-dispute source (#2)', () => {
  it('flips a RETURN refund to REJECTED (not routed back)', async () => {
    const { svc, getRow } = buildService({ sourceType: 'RETURN', sourceId: 'r1', linkedDisputeId: null });
    const res = await svc.rejectByFinance({ instructionId: 'ri-1', adminId: 'fin-1', reason: 'over the cap' });
    expect(res.status).toBe('REJECTED');
    expect((res as any).routedBackToDispute).toBe(false);
    expect(getRow().routedBackAt).toBeNull();
  });
});

describe('createForDispute re-decision after finance rejection (review CRITICAL)', () => {
  it('mints a FRESH instruction (versioned key) when the prior one was ROUTED_BACK_TO_DISPUTE', async () => {
    // Existing rejected instruction under the base key.
    const rejected = {
      id: 'ri-old',
      status: 'ROUTED_BACK_TO_DISPUTE',
      idempotencyKey: 'dispute:d1',
      sourceType: 'DISPUTE',
      sourceId: 'd1',
    };
    let created: any = null;
    const prisma: any = {
      refundInstruction: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.idempotencyKey === 'dispute:d1') return { ...rejected };
          return null; // versioned key free
        }),
        count: jest.fn(async () => 1), // one prior attempt
        create: jest.fn(async ({ data }: any) => {
          created = { id: 'ri-new', ...data };
          return created;
        }),
      },
    };
    const env: any = { getNumber: (_: string, d: number) => d, getBoolean: () => true, getOptional: () => undefined };
    const saga: any = { run: jest.fn(async () => ({ status: 'COMPLETED', finalContext: {} })) };
    const svc = new RefundInstructionService(prisma, env, {} as any, saga, {} as any, { publish: jest.fn() } as any);
    const res = await svc.createForDispute({
      disputeId: 'd1', disputeNumber: 'DSP-1', customerId: 'c1', masterOrderId: 'mo1',
      amountInPaise: 5_000_000, customerRemedy: 'FULL_REFUND', // above threshold → PENDING_APPROVAL
    });
    // A NEW row was created under a versioned key (not the old rejected one).
    expect(prisma.refundInstruction.create).toHaveBeenCalled();
    expect(created.idempotencyKey).toBe('dispute:d1:redecide-2');
    expect(res?.id).toBe('ri-new');
  });

  it('still dedups to a LIVE instruction (PENDING_APPROVAL) on a genuine replay', async () => {
    const live = {
      id: 'ri-live', status: 'PENDING_APPROVAL', idempotencyKey: 'dispute:d1',
      sourceType: 'DISPUTE', sourceId: 'd1',
    };
    const prisma: any = {
      refundInstruction: {
        findUnique: jest.fn(async () => ({ ...live })),
        count: jest.fn(),
        create: jest.fn(),
      },
    };
    const env: any = { getNumber: (_: string, d: number) => d, getBoolean: () => true, getOptional: () => undefined };
    const svc = new RefundInstructionService(prisma, env, {} as any, { run: jest.fn() } as any, {} as any, { publish: jest.fn() } as any);
    const res = await svc.createForDispute({
      disputeId: 'd1', disputeNumber: 'DSP-1', customerId: 'c1', masterOrderId: 'mo1',
      amountInPaise: 5_000_000, customerRemedy: 'FULL_REFUND',
    });
    expect(prisma.refundInstruction.create).not.toHaveBeenCalled();
    expect(res?.id).toBe('ri-live');
  });
});

describe('rejectByFinance — idempotency + guards', () => {
  it('is idempotent on an already-ROUTED_BACK row', async () => {
    const { svc } = buildService({ status: 'ROUTED_BACK_TO_DISPUTE' });
    const res = await svc.rejectByFinance({ instructionId: 'ri-1', adminId: 'fin-2', reason: 'retry' });
    expect(res.status).toBe('ROUTED_BACK_TO_DISPUTE');
  });

  it('refuses to reject a PROCESSING (money-in-flight) row (#13)', async () => {
    const { svc } = buildService({ status: 'PROCESSING' });
    await expect(
      svc.rejectByFinance({ instructionId: 'ri-1', adminId: 'fin-1', reason: 'too late' }),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });
});
