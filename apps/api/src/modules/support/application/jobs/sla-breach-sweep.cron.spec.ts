// Phase 120 — support SLA-breach sweep. Escalates a still-open ticket past its
// slaTargetAt exactly once (escalationLevel 0→1), audits + emits, and is
// dedup-safe via the CAS on escalationLevel.

import { SlaBreachSweepCron } from './sla-breach-sweep.cron';

function build(candidates: any[] = []) {
  const prisma: any = {
    ticket: {
      findMany: jest.fn().mockResolvedValue(candidates),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const env: any = { getBoolean: jest.fn().mockReturnValue(true) };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const leader: any = { run: jest.fn() };
  const instr: any = { wrap: jest.fn() };
  const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const cron = new SlaBreachSweepCron(prisma, env, eventBus, leader, instr, audit);
  return { cron, prisma, eventBus, audit };
}

const sweepOnce = (cron: SlaBreachSweepCron) =>
  (cron as unknown as { sweepOnce: () => Promise<{ scanned: number; escalated: number }> }).sweepOnce();

describe('SlaBreachSweepCron', () => {
  it('escalates each breached ticket once (escalationLevel 0→1) + audits + emits', async () => {
    const { cron, prisma, eventBus, audit } = build([
      {
        id: 't-1', ticketNumber: 'TKT-1', priority: 'URGENT',
        assignedAdminId: 'a-1', slaTargetAt: new Date(0),
      },
    ]);
    const res = await sweepOnce(cron);
    expect(res).toEqual({ scanned: 1, escalated: 1 });
    expect(prisma.ticket.updateMany).toHaveBeenCalledWith({
      where: { id: 't-1', escalationLevel: 0 },
      data: { escalationLevel: 1, escalatedAt: expect.any(Date) },
    });
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ticket.sla_breached', resourceId: 't-1' }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'tickets.sla_breached' }),
    );
  });

  it('no-ops when nothing is breached', async () => {
    const { cron, prisma, audit } = build([]);
    const res = await sweepOnce(cron);
    expect(res).toEqual({ scanned: 0, escalated: 0 });
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
    expect(audit.writeAuditLog).not.toHaveBeenCalled();
  });

  it('skips side-effects when the CAS loses (already escalated)', async () => {
    const { cron, prisma, eventBus } = build([
      {
        id: 't-2', ticketNumber: 'TKT-2', priority: 'HIGH',
        assignedAdminId: null, slaTargetAt: new Date(0),
      },
    ]);
    prisma.ticket.updateMany.mockResolvedValue({ count: 0 });
    const res = await sweepOnce(cron);
    expect(res).toEqual({ scanned: 1, escalated: 0 });
    expect(eventBus.publish).not.toHaveBeenCalled();
  });
});
