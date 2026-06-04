import 'reflect-metadata';
import { RefundProcessorService } from '../../src/modules/returns/application/services/refund-processor.service';

// Phase 170 (Refund Queue audit #3) — the legacy refund poller must NOT
// auto-confirm a Return whose linked RefundInstruction is still awaiting finance
// approval (PENDING_APPROVAL / NEEDS_CLARIFICATION) or was CANCELLED.

function build(instructionStatus: string | null) {
  const ret = { id: 'ret-1', returnNumber: 'RET-1', refundReference: 'rfnd_1' };
  const prisma: any = {
    return: { findMany: jest.fn().mockResolvedValue([ret]) },
    refundTransaction: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    refundInstruction: {
      findFirst: jest.fn().mockResolvedValue(
        instructionStatus ? { status: instructionStatus } : null,
      ),
    },
  };
  const refundGateway = {
    checkRefundStatus: jest.fn().mockResolvedValue({ status: 'PROCESSED' }),
  };
  const returnService = {
    confirmRefund: jest.fn().mockResolvedValue(undefined),
    markRefundFailed: jest.fn().mockResolvedValue(undefined),
  };
  // Construct with the fields pollPendingRefunds touches; other ctor deps unused
  // on this path so `any`-cast partial is fine.
  const svc = new RefundProcessorService(
    prisma,
    {} as any, // redis
    { getNumber: () => 5, getBoolean: () => true } as any, // env
    returnService as any,
    refundGateway as any,
    {} as any, // leader
    {} as any, // instrumentation
    { writeAuditLog: jest.fn().mockResolvedValue(undefined) } as any, // audit (Phase 214)
  );
  return { svc, prisma, returnService, refundGateway };
}

async function runPoll(svc: RefundProcessorService) {
  // pollPendingRefunds is private; invoke via the public tick() which calls it,
  // OR cast to any. The tick() also calls retryFailedRefunds; stub return.findMany
  // returns the same single row so it's harmless. We call the private directly.
  await (svc as any).pollPendingRefunds();
}

describe('RefundProcessorService.pollPendingRefunds gating (#3)', () => {
  it('SKIPS confirm when the linked instruction is PENDING_APPROVAL', async () => {
    const { svc, returnService, refundGateway } = build('PENDING_APPROVAL');
    await runPoll(svc);
    expect(refundGateway.checkRefundStatus).not.toHaveBeenCalled();
    expect(returnService.confirmRefund).not.toHaveBeenCalled();
  });

  it('SKIPS confirm when the linked instruction is NEEDS_CLARIFICATION', async () => {
    const { svc, returnService } = build('NEEDS_CLARIFICATION');
    await runPoll(svc);
    expect(returnService.confirmRefund).not.toHaveBeenCalled();
  });

  it('SKIPS confirm when the linked instruction is CANCELLED', async () => {
    const { svc, returnService } = build('CANCELLED');
    await runPoll(svc);
    expect(returnService.confirmRefund).not.toHaveBeenCalled();
  });

  it('CONFIRMS when the linked instruction is PROCESSING (approved + executing)', async () => {
    const { svc, returnService, refundGateway } = build('PROCESSING');
    await runPoll(svc);
    expect(refundGateway.checkRefundStatus).toHaveBeenCalled();
    expect(returnService.confirmRefund).toHaveBeenCalled();
  });

  it('CONFIRMS when there is no linked instruction (legacy gateway-only refund)', async () => {
    const { svc, returnService } = build(null);
    await runPoll(svc);
    expect(returnService.confirmRefund).toHaveBeenCalled();
  });
});
