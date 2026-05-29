// Phase 126 — dispute-decision settlement recovery sweep. Re-mints customer
// refunds stranded when a crash hits between decide()'s status commit and the
// (post-txn) refund-instruction create. Recovery itself is delegated to
// DisputeService.ensureRefundInstructionForDecidedDispute (tested separately);
// these tests cover the sweep's batching + accounting.

import { DisputeRefundRecoverySweepCron } from './dispute-refund-recovery-sweep.cron';

function build(
  candidates: any[] = [],
  outcomes: Record<string, 'created' | 'exists' | 'skipped'> = {},
) {
  const prisma: any = {
    dispute: { findMany: jest.fn().mockResolvedValue(candidates) },
  };
  const env: any = {
    getBoolean: jest.fn().mockReturnValue(true),
    getNumber: jest.fn().mockReturnValue(1440),
  };
  const leader: any = { run: jest.fn() };
  const instr: any = { wrap: jest.fn() };
  const disputes: any = {
    ensureRefundInstructionForDecidedDispute: jest.fn(
      async (id: string) => outcomes[id] ?? 'created',
    ),
  };
  const cron = new DisputeRefundRecoverySweepCron(
    prisma,
    env,
    leader,
    instr,
    disputes,
  );
  return { cron, disputes };
}

const sweepOnce = (cron: DisputeRefundRecoverySweepCron) =>
  (cron as unknown as {
    sweepOnce: () => Promise<{ scanned: number; recovered: number }>;
  }).sweepOnce();

const cand = (id: string) => ({ id, disputeNumber: `DSP-${id}` });

describe('DisputeRefundRecoverySweepCron', () => {
  it('counts only the disputes for which it actually minted an instruction', async () => {
    const { cron, disputes } = build([cand('d1'), cand('d2'), cand('d3')], {
      d1: 'created',
      d2: 'exists',
      d3: 'created',
    });
    const res = await sweepOnce(cron);
    expect(res).toEqual({ scanned: 3, recovered: 2 });
    expect(disputes.ensureRefundInstructionForDecidedDispute).toHaveBeenCalledTimes(3);
  });

  it('continues past a failing dispute (one bad row does not abort the batch)', async () => {
    const { cron, disputes } = build([cand('d1'), cand('d2')]);
    disputes.ensureRefundInstructionForDecidedDispute
      .mockImplementationOnce(async () => {
        throw new Error('boom');
      })
      .mockImplementationOnce(async () => 'created');
    const res = await sweepOnce(cron);
    expect(res).toEqual({ scanned: 2, recovered: 1 });
  });

  it('no-ops when nothing is stranded', async () => {
    const { cron, disputes } = build([]);
    const res = await sweepOnce(cron);
    expect(res).toEqual({ scanned: 0, recovered: 0 });
    expect(disputes.ensureRefundInstructionForDecidedDispute).not.toHaveBeenCalled();
  });
});
