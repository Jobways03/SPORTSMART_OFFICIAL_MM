// Phase 122 — explicit admin ticket status transitions now enforce an FSM
// allow-list, CAS on the prior status, no-op skip, and an audit_logs trail.

import { SupportService } from './support.service';
import {
  BadRequestAppException,
  ConflictAppException,
} from '../../../../core/exceptions';

function build(ticket: any) {
  const repo: any = { findTicketById: jest.fn().mockResolvedValue(ticket) };
  const prisma: any = {
    ticket: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const env: any = {
    getBoolean: jest.fn().mockReturnValue(false),
    getNumber: jest.fn().mockReturnValue(0),
  };
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
  const svc = new SupportService(
    repo,
    prisma,
    eventBus as any,
    {} as any, // caseDuplicates
    {} as any, // disputes
    env,
    audit as any,
  );
  return { svc, prisma, audit, eventBus };
}

const t = (status: string, extra: any = {}) => ({
  id: 't-1', status, priority: 'NORMAL', resolvedAt: null, ...extra,
});

describe('SupportService.setStatus — FSM (Phase 122)', () => {
  it.each([
    ['OPEN', 'WAITING_ON_CUSTOMER'],
    ['CLOSED', 'RESOLVED'],
    ['RESOLVED', 'OPEN'],
    ['WAITING_ON_CUSTOMER', 'OPEN'],
  ])('rejects the invalid transition %s → %s', async (from, to) => {
    const { svc, prisma } = build(t(from));
    await expect(svc.setStatus('t-1', to as any, 'admin-1')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
  });

  it('is a no-op when the status is unchanged (no write, no audit)', async () => {
    const { svc, prisma, audit } = build(t('OPEN'));
    await svc.setStatus('t-1', 'OPEN' as any, 'admin-1');
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
    expect(audit.writeAuditLog).not.toHaveBeenCalled();
  });

  it('allows IN_PROGRESS → RESOLVED via CAS on the prior status, and audits + emits', async () => {
    const { svc, prisma, audit, eventBus } = build(t('IN_PROGRESS'));
    await svc.setStatus('t-1', 'RESOLVED' as any, 'admin-1', 'fixed it');
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'tickets.status.changed' }),
    );
    expect(prisma.ticket.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't-1', status: 'IN_PROGRESS' },
        data: expect.objectContaining({ status: 'RESOLVED' }),
      }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'support.ticket.status_changed',
        oldValue: { status: 'IN_PROGRESS' },
        newValue: { status: 'RESOLVED' },
      }),
    );
  });

  it('allows CLOSED → IN_PROGRESS (admin reopen) and clears closed metadata', async () => {
    const { svc, prisma } = build(t('CLOSED', { closedAt: new Date() }));
    await svc.setStatus('t-1', 'IN_PROGRESS' as any, 'admin-1');
    expect(prisma.ticket.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't-1', status: 'CLOSED' },
        data: expect.objectContaining({
          status: 'IN_PROGRESS',
          closedAt: null,
          closedByAdminId: null,
          slaTargetAt: expect.any(Date),
        }),
      }),
    );
  });

  it('raises 409 when the CAS loses (status changed concurrently)', async () => {
    const { svc, prisma } = build(t('IN_PROGRESS'));
    prisma.ticket.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.setStatus('t-1', 'RESOLVED' as any, 'admin-1')).rejects.toBeInstanceOf(
      ConflictAppException,
    );
  });
});
