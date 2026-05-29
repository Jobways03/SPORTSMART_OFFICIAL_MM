// Phase 124 — back-mirror reliability sweep (dispute → ticket). Re-mirrors
// admin dispute replies that never landed on the customer's ticket; skips
// already-mirrored ones; only ADMIN non-internal messages are eligible.

import { DisputeMirrorBackSweepCron } from './dispute-mirror-back-sweep.cron';

function build(candidates: any[] = [], mirrored: Record<string, boolean> = {}) {
  const prisma: any = {
    disputeMessage: { findMany: jest.fn().mockResolvedValue(candidates) },
    ticketMessage: {
      findUnique: jest.fn().mockImplementation(({ where }: any) =>
        mirrored[where.mirroredFromDisputeMessageId] ? { id: 'tm' } : null,
      ),
    },
  };
  const env: any = {
    getBoolean: jest.fn().mockReturnValue(true),
    getNumber: jest.fn().mockReturnValue(120),
  };
  const leader: any = { run: jest.fn() };
  const instr: any = { wrap: jest.fn() };
  const support: any = {
    mirrorDisputeMessageToTicket: jest.fn().mockResolvedValue(undefined),
  };
  const cron = new DisputeMirrorBackSweepCron(prisma, env, leader, instr, support);
  return { cron, prisma, support };
}

const sweepOnce = (cron: DisputeMirrorBackSweepCron) =>
  (cron as unknown as { sweepOnce: () => Promise<{ scanned: number; mirrored: number }> }).sweepOnce();

const dm = (id: string, extra: any = {}) => ({
  id,
  senderId: 'admin-1',
  body: "here's the resolution",
  dispute: { sourceTicketId: 'tkt-1' },
  ...extra,
});

describe('DisputeMirrorBackSweepCron', () => {
  it('re-mirrors an admin reply that never reached the ticket', async () => {
    const { cron, support } = build([dm('dmsg-1')]);
    const res = await sweepOnce(cron);
    expect(res).toEqual({ scanned: 1, mirrored: 1 });
    expect(support.mirrorDisputeMessageToTicket).toHaveBeenCalledWith({
      ticketId: 'tkt-1',
      body: "here's the resolution",
      adminId: 'admin-1',
      sourceDisputeMessageId: 'dmsg-1',
    });
  });

  it('skips a message already mirrored to the ticket', async () => {
    const { cron, support } = build([dm('dmsg-2')], { 'dmsg-2': true });
    const res = await sweepOnce(cron);
    expect(res).toEqual({ scanned: 1, mirrored: 0 });
    expect(support.mirrorDisputeMessageToTicket).not.toHaveBeenCalled();
  });

  it('no-ops when nothing is pending', async () => {
    const { cron, support } = build([]);
    const res = await sweepOnce(cron);
    expect(res).toEqual({ scanned: 0, mirrored: 0 });
    expect(support.mirrorDisputeMessageToTicket).not.toHaveBeenCalled();
  });
});
