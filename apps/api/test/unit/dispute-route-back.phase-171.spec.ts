import 'reflect-metadata';
import { DisputeService } from '../../src/modules/disputes/application/services/dispute.service';

// Phase 171 (#1/#10/#14) — finance-rejection route-back reopens a decided
// dispute, snapshots + clears the prior decision, appends a thread message,
// emits an event, and is idempotent/no-op on a non-resolved or missing dispute.

function make(status: string | null) {
  let dispute: any =
    status === null
      ? null
      : {
          id: 'd1',
          disputeNumber: 'DSP-1',
          status,
          decisionAt: new Date('2026-05-01'),
          decisionRationale: 'buyer favoured',
          decisionAmountInPaise: 100000,
        };
  const messages: any[] = [];
  const prisma: any = {
    dispute: {
      findUnique: jest.fn(async () => (dispute ? { ...dispute } : null)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (!dispute || dispute.id !== where.id || dispute.status !== where.status) {
          return { count: 0 };
        }
        dispute = { ...dispute, ...data };
        return { count: 1 };
      }),
    },
    disputeMessage: {
      create: jest.fn(async ({ data }: any) => {
        messages.push(data);
        return { id: `m-${messages.length}`, ...data };
      }),
    },
  };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  // DisputeService ctor: prisma, eventBus, audit, caseDuplicates,
  // refundInstruction, ledger (6 params).
  const svc = new DisputeService(
    prisma,
    eventBus,
    audit,
    {} as any,
    {} as any,
    {} as any,
  );
  return { svc, eventBus, messages, getDispute: () => dispute };
}

describe('DisputeService.routeBackFromFinanceRejection (#1)', () => {
  it('reopens RESOLVED_BUYER → UNDER_REVIEW, snapshots + clears decision, appends message, emits event', async () => {
    const { svc, getDispute, messages, eventBus } = make('RESOLVED_BUYER');
    const res = await svc.routeBackFromFinanceRejection({
      disputeId: 'd1',
      adminId: 'fin-1',
      reason: 'amount wrong',
    });
    expect(res.reopened).toBe(true);
    const d = getDispute();
    expect(d.status).toBe('UNDER_REVIEW');
    expect(d.previousDecisionRationale).toBe('buyer favoured');
    expect(d.financeRejectionReason).toBe('amount wrong');
    expect(d.rerouteDueBy).toBeInstanceOf(Date);
    // live decision columns cleared (review L1#2)
    expect(d.decisionAmountInPaise).toBeNull();
    expect(d.decisionRationale).toBeNull();
    expect(
      messages.some(
        (m) => /Finance rejected the refund/.test(m.body) && m.isInternalNote === false,
      ),
    ).toBe(true);
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'disputes.refund_rejected' }),
    );
  });

  it('is a no-op when the dispute is not in a resolved state (idempotent)', async () => {
    const { svc, eventBus } = make('UNDER_REVIEW');
    const res = await svc.routeBackFromFinanceRejection({
      disputeId: 'd1',
      adminId: 'fin-1',
      reason: 'x',
    });
    expect(res.reopened).toBe(false);
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('is a no-op when the dispute does not exist', async () => {
    const { svc } = make(null);
    const res = await svc.routeBackFromFinanceRejection({
      disputeId: 'gone',
      adminId: 'fin-1',
      reason: 'x',
    });
    expect(res.reopened).toBe(false);
  });
});
