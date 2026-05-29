// Phase 129 — linked-return status update uses the FSM + optimistic-lock CAS.
//
// decide() step 4 maps the dispute outcome onto the linked return's status.
// It used to blind-write (no FSM check, no version CAS) — an illegal target
// state could be written and a concurrent return-side write silently lost.
// Now: allowed-transition pre-check (benign skip), then applyOptimisticTransition
// (version CAS), escalating a race / failure to an admin task.

import 'reflect-metadata';
import { DisputeService } from './dispute.service';

function build(ret: any, opts: { updateThrows?: any } = {}) {
  const prisma: any = {
    return: {
      findUnique: jest.fn().mockResolvedValue(ret),
      update: jest.fn(),
    },
  };
  if (opts.updateThrows) {
    prisma.return.update.mockRejectedValue(opts.updateThrows);
  } else {
    prisma.return.update.mockImplementation(async ({ data }: any) => ({
      ...ret,
      ...data,
    }));
  }
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const ledger = { enqueueAdminTask: jest.fn().mockResolvedValue(undefined) };
  const svc = new DisputeService(
    prisma as never, // prisma
    null as never, // eventBus
    audit as never, // audit
    null as never, // caseDuplicates
    null as never, // refundInstruction
    ledger as never, // ledger
  );
  return { svc, prisma, audit, ledger };
}

const call = (svc: DisputeService, args: any): Promise<void> =>
  (
    svc as unknown as {
      updateLinkedReturnStatus: (a: any) => Promise<void>;
    }
  ).updateLinkedReturnStatus(args);

const baseArgs = {
  disputeId: 'd-1',
  returnId: 'r-1',
  outcome: 'RESOLVED_BUYER',
  customerRemedy: 'FULL_REFUND',
  liabilityParty: 'SELLER',
};

describe('DisputeService.updateLinkedReturnStatus (Phase 129)', () => {
  it('applies an allowed transition via optimistic CAS + audits', async () => {
    // COMPLETED → DISPUTE_OVERTURNED is a declared transition.
    const { svc, prisma, audit } = build({
      id: 'r-1',
      status: 'COMPLETED',
      version: 3,
    });
    await call(svc, baseArgs);
    expect(prisma.return.update).toHaveBeenCalledWith({
      where: { id: 'r-1', version: 3 }, // version CAS
      data: { status: 'DISPUTE_OVERTURNED', version: { increment: 1 } },
    });
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'return.status_changed_by_dispute' }),
    );
  });

  it('skips silently when the FSM forbids the move (no write, no admin task)', async () => {
    // DISPUTE_OVERTURNED is terminal — no transition to DISPUTE_CONFIRMED.
    const { svc, prisma, ledger } = build({
      id: 'r-1',
      status: 'DISPUTE_OVERTURNED',
      version: 1,
    });
    await call(svc, { ...baseArgs, outcome: 'RESOLVED_SELLER', customerRemedy: 'NONE' });
    expect(prisma.return.update).not.toHaveBeenCalled();
    expect(ledger.enqueueAdminTask).not.toHaveBeenCalled();
  });

  it('skips when the return is already in the target state', async () => {
    const { svc, prisma } = build({
      id: 'r-1',
      status: 'DISPUTE_CONFIRMED',
      version: 2,
    });
    await call(svc, { ...baseArgs, outcome: 'RESOLVED_SELLER' });
    expect(prisma.return.update).not.toHaveBeenCalled();
  });

  it('escalates to an admin task when the CAS loses (version race → P2025)', async () => {
    const { svc, ledger } = build(
      { id: 'r-1', status: 'COMPLETED', version: 3 },
      { updateThrows: Object.assign(new Error('not found'), { code: 'P2025' }) },
    );
    await call(svc, baseArgs);
    expect(ledger.enqueueAdminTask).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'DISPUTE', sourceId: 'd-1' }),
    );
  });

  it('returns silently when the linked return does not exist', async () => {
    const { svc, prisma } = build(null);
    await call(svc, baseArgs);
    expect(prisma.return.update).not.toHaveBeenCalled();
  });
});
