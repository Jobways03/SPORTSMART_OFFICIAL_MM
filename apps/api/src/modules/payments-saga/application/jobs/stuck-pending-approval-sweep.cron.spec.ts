// Phase 116 — stuck PENDING_APPROVAL sweep.
//
// A refund instruction that finance never actions sits in PENDING_APPROVAL
// indefinitely. This cron escalates one to an AdminTask after the stuck window
// WITHOUT changing its status (it must stay approvable). enqueueAdminTask
// dedups on UNIQUE(kind, sourceType, sourceId), so re-runs are idempotent.

import { StuckPendingApprovalSweepCron } from './stuck-pending-approval-sweep.cron';

function build(candidates: any[] = []) {
  const prisma: any = {
    refundInstruction: { findMany: jest.fn().mockResolvedValue(candidates) },
  };
  const env: any = {
    getNumber: jest.fn().mockReturnValue(48),
    getBoolean: jest.fn().mockReturnValue(true),
  };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const leader: any = { run: jest.fn() };
  const ledger: any = { enqueueAdminTask: jest.fn().mockResolvedValue({ id: 'task-1' }) };
  const instr: any = { wrap: jest.fn() };
  const cron = new StuckPendingApprovalSweepCron(
    prisma, env, eventBus, leader, ledger, instr,
  );
  return { cron, prisma, ledger, eventBus };
}

const sweepOnce = (cron: StuckPendingApprovalSweepCron) =>
  (cron as unknown as { sweepOnce: () => Promise<{ scanned: number; escalated: number }> }).sweepOnce();

describe('StuckPendingApprovalSweepCron', () => {
  it('escalates each stuck instruction via AdminTask and never mutates its status', async () => {
    const { cron, prisma, ledger, eventBus } = build([
      {
        id: 'ri-1', sourceType: 'DISPUTE', sourceId: 'd-1',
        customerId: 'c-1', amountInPaise: BigInt(1_500_000), createdAt: new Date(0),
      },
    ]);
    const res = await sweepOnce(cron);
    expect(res).toEqual({ scanned: 1, escalated: 1 });
    expect(ledger.enqueueAdminTask).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'REFUND_INSTRUCTION_FAILED',
        sourceType: 'DISPUTE',
        sourceId: 'd-1',
        slaHours: 24,
      }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'refunds.instruction.pending_approval_stuck' }),
    );
    // No status mutation: the cron must not flip PENDING_APPROVAL away.
    expect(prisma.refundInstruction.update).toBeUndefined();
    expect(prisma.refundInstruction.updateMany).toBeUndefined();
  });

  it('no-ops when nothing is stuck', async () => {
    const { cron, ledger } = build([]);
    const res = await sweepOnce(cron);
    expect(res).toEqual({ scanned: 0, escalated: 0 });
    expect(ledger.enqueueAdminTask).not.toHaveBeenCalled();
  });

  it('maps REPLACEMENT source to MANUAL for the admin task', async () => {
    const { cron, ledger } = build([
      {
        id: 'ri-2', sourceType: 'REPLACEMENT', sourceId: 's-2',
        customerId: 'c-2', amountInPaise: BigInt(500), createdAt: new Date(0),
      },
    ]);
    await sweepOnce(cron);
    expect(ledger.enqueueAdminTask).toHaveBeenCalledWith(
      expect.objectContaining({ sourceType: 'MANUAL' }),
    );
  });
});
