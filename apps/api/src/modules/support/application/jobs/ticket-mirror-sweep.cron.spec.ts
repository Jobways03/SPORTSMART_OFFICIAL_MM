// Phase 124 — forward-mirror reliability sweep. Re-mirrors customer/seller
// ticket replies on promoted tickets that never landed in the dispute thread;
// skips already-mirrored ones (idempotent + cheap).

import { TicketMirrorSweepCron } from './ticket-mirror-sweep.cron';

function build(candidates: any[] = [], mirrored: Record<string, boolean> = {}) {
  const prisma: any = {
    ticketMessage: { findMany: jest.fn().mockResolvedValue(candidates) },
    disputeMessage: {
      findUnique: jest.fn().mockImplementation(({ where }: any) =>
        mirrored[where.mirroredFromTicketMessageId] ? { id: 'dm' } : null,
      ),
    },
  };
  const env: any = {
    getBoolean: jest.fn().mockReturnValue(true),
    getNumber: jest.fn().mockReturnValue(120),
  };
  const leader: any = { run: jest.fn() };
  const instr: any = { wrap: jest.fn() };
  const disputes: any = {
    mirrorTicketMessageToDispute: jest.fn().mockResolvedValue(undefined),
  };
  const cron = new TicketMirrorSweepCron(prisma, env, leader, instr, disputes);
  return { cron, disputes };
}

const sweepOnce = (cron: TicketMirrorSweepCron) =>
  (cron as unknown as { sweepOnce: () => Promise<{ scanned: number; mirrored: number }> }).sweepOnce();

const msg = (id: string, extra: any = {}) => ({
  id,
  senderType: 'CUSTOMER',
  senderId: 'c-1',
  senderName: 'C',
  body: 'still broken',
  ticket: { promotedToDisputeId: 'd-1' },
  ...extra,
});

describe('TicketMirrorSweepCron', () => {
  it('re-mirrors an unmirrored ticket message', async () => {
    const { cron, disputes } = build([msg('tm-1')]);
    const res = await sweepOnce(cron);
    expect(res).toEqual({ scanned: 1, mirrored: 1 });
    expect(disputes.mirrorTicketMessageToDispute).toHaveBeenCalledWith(
      expect.objectContaining({
        disputeId: 'd-1',
        sourceTicketMessageId: 'tm-1',
        sender: expect.objectContaining({ type: 'CUSTOMER', id: 'c-1' }),
      }),
    );
  });

  it('skips a message that is already mirrored', async () => {
    const { cron, disputes } = build([msg('tm-2')], { 'tm-2': true });
    const res = await sweepOnce(cron);
    expect(res).toEqual({ scanned: 1, mirrored: 0 });
    expect(disputes.mirrorTicketMessageToDispute).not.toHaveBeenCalled();
  });

  it('maps a SELLER sender to a SELLER dispute actor', async () => {
    const { cron, disputes } = build([
      msg('tm-3', { senderType: 'SELLER', senderId: 's-1' }),
    ]);
    await sweepOnce(cron);
    expect(disputes.mirrorTicketMessageToDispute).toHaveBeenCalledWith(
      expect.objectContaining({ sender: expect.objectContaining({ type: 'SELLER' }) }),
    );
  });

  it('no-ops when nothing is pending', async () => {
    const { cron, disputes } = build([]);
    const res = await sweepOnce(cron);
    expect(res).toEqual({ scanned: 0, mirrored: 0 });
    expect(disputes.mirrorTicketMessageToDispute).not.toHaveBeenCalled();
  });
});
