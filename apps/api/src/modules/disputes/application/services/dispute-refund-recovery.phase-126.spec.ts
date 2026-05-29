// Phase 126 — crash-recovery for the post-decision refund step.
//
// decide() commits the dispute status + outbox event in one txn, then mints
// the RefundInstruction outside it. A crash in that window strands the
// customer's refund. ensureRefundInstructionForDecidedDispute re-mints it,
// idempotently, and — critically — resolves the ORDER customer rather than
// the dispute filer (the Phase-113 money-routing invariant must hold on the
// recovery path too).

import 'reflect-metadata';
import { DisputeService } from './dispute.service';

function build(opts: { dispute?: any; existingInstruction?: any } = {}) {
  const refundInstruction = {
    createForDispute: jest.fn().mockResolvedValue({ id: 'ri-1' }),
  };
  const ledger = { enqueueAdminTask: jest.fn().mockResolvedValue(undefined) };
  const prisma: any = {
    dispute: {
      findUnique: jest.fn().mockResolvedValue(opts.dispute ?? null),
    },
    refundInstruction: {
      findUnique: jest.fn().mockResolvedValue(opts.existingInstruction ?? null),
    },
    return: { findUnique: jest.fn().mockResolvedValue(null) },
    subOrder: { findUnique: jest.fn().mockResolvedValue(null) },
    masterOrder: { findUnique: jest.fn().mockResolvedValue(null) },
  };
  const svc = new DisputeService(
    prisma as never, // prisma
    null as never, // eventBus
    null as never, // audit
    null as never, // caseDuplicates
    refundInstruction as never,
    ledger as never,
  );
  return { svc, prisma, refundInstruction, ledger };
}

const ensure = (svc: DisputeService, id: string) =>
  svc.ensureRefundInstructionForDecidedDispute(id);

const decidedDispute = (extra: any = {}) => ({
  id: 'd-1',
  disputeNumber: 'DSP-2026-000001',
  decisionAmountInPaise: 50000,
  customerRemedy: 'FULL_REFUND',
  returnId: null,
  subOrderId: null,
  masterOrderId: 'mo-1',
  filedByType: 'SELLER',
  filedById: 'seller-1',
  ...extra,
});

describe('DisputeService.ensureRefundInstructionForDecidedDispute (Phase 126)', () => {
  it('mints a missing RefundInstruction to the resolved ORDER customer (not the filer)', async () => {
    const { svc, prisma, refundInstruction } = build({
      dispute: decidedDispute(),
    });
    prisma.masterOrder.findUnique.mockResolvedValue({ customerId: 'cust-9' });
    const out = await ensure(svc, 'd-1');
    expect(out).toBe('created');
    expect(refundInstruction.createForDispute).toHaveBeenCalledWith(
      expect.objectContaining({
        disputeId: 'd-1',
        customerId: 'cust-9', // ← the order customer, NOT seller-1
        amountInPaise: 50000,
        customerRemedy: 'FULL_REFUND',
      }),
    );
  });

  it('returns "exists" and does not re-mint when an instruction is already present', async () => {
    const { svc, refundInstruction } = build({
      dispute: decidedDispute(),
      existingInstruction: { id: 'ri-existing' },
    });
    const out = await ensure(svc, 'd-1');
    expect(out).toBe('exists');
    expect(refundInstruction.createForDispute).not.toHaveBeenCalled();
  });

  it('skips a dispute with no customer-owed remedy', async () => {
    const { svc, refundInstruction } = build({
      dispute: decidedDispute({ customerRemedy: 'NO_REFUND' }),
    });
    expect(await ensure(svc, 'd-1')).toBe('skipped');
    expect(refundInstruction.createForDispute).not.toHaveBeenCalled();
  });

  it('skips a dispute with no positive decision amount', async () => {
    const { svc, refundInstruction } = build({
      dispute: decidedDispute({ decisionAmountInPaise: 0 }),
    });
    expect(await ensure(svc, 'd-1')).toBe('skipped');
    expect(refundInstruction.createForDispute).not.toHaveBeenCalled();
  });

  it('refuses to refund (enqueues an admin task) when the customer is unresolvable — never routes to the filer', async () => {
    const { svc, refundInstruction, ledger } = build({
      dispute: decidedDispute({ masterOrderId: null, filedByType: 'SELLER' }),
    });
    const out = await ensure(svc, 'd-1');
    expect(out).toBe('skipped');
    expect(refundInstruction.createForDispute).not.toHaveBeenCalled();
    expect(ledger.enqueueAdminTask).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'REFUND_INSTRUCTION_FAILED',
        sourceType: 'DISPUTE',
        sourceId: 'd-1',
      }),
    );
  });

  it('returns "skipped" for an unknown dispute id', async () => {
    const { svc } = build({ dispute: null });
    expect(await ensure(svc, 'missing')).toBe('skipped');
  });
});
