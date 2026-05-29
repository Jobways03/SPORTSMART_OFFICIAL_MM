// Phase 119 — ticket priority hardening: status guard, no-op skip, version-less
// CAS on the prior priority, audit_logs row, and who/when stamps. (Queue
// priority-sort + DTO @IsEnum are covered by the repo/DTO changes + tsc.)

import { SupportService } from './support.service';
import {
  BadRequestAppException,
  ConflictAppException,
} from '../../../../core/exceptions';

function build() {
  const repo: any = { findTicketById: jest.fn(), updateTicket: jest.fn() };
  const prisma: any = {
    ticket: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    // Phase 131 — escalation path looks up the assignee's email.
    admin: {
      findUnique: jest.fn().mockResolvedValue({ email: 'a@x.com', name: 'Agent' }),
    },
  };
  const env: any = {
    getBoolean: jest.fn().mockReturnValue(false),
    getNumber: jest.fn().mockReturnValue(0),
  };
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
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
  return { svc, repo, prisma, audit, eventBus };
}

const openNormal = { id: 't-1', status: 'OPEN', priority: 'NORMAL' };

describe('SupportService.setPriority — Phase 119', () => {
  it('refuses to change priority on a CLOSED ticket (no write)', async () => {
    const { svc, repo, prisma } = build();
    repo.findTicketById.mockResolvedValue({ ...openNormal, status: 'CLOSED' });
    await expect(svc.setPriority('t-1', 'URGENT' as any, 'admin-1')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
  });

  it('is a no-op when the priority is unchanged (no write, no audit)', async () => {
    const { svc, repo, prisma, audit } = build();
    repo.findTicketById.mockResolvedValue(openNormal);
    await svc.setPriority('t-1', 'NORMAL' as any, 'admin-1');
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
    expect(audit.writeAuditLog).not.toHaveBeenCalled();
  });

  it('changes priority via CAS, stamps who/when + SLA, and audits the change', async () => {
    const { svc, repo, prisma, audit } = build();
    repo.findTicketById.mockResolvedValue(openNormal);
    await svc.setPriority('t-1', 'URGENT' as any, 'admin-1');
    expect(prisma.ticket.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't-1', priority: 'NORMAL' },
        data: expect.objectContaining({
          priority: 'URGENT',
          priorityUpdatedBy: 'admin-1',
          priorityUpdatedAt: expect.any(Date),
          slaTargetAt: expect.any(Date),
        }),
      }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ticket.priority_changed',
        oldValue: { priority: 'NORMAL' },
        newValue: { priority: 'URGENT' },
      }),
    );
  });

  it('raises 409 when the CAS loses (priority changed concurrently)', async () => {
    const { svc, repo, prisma } = build();
    repo.findTicketById.mockResolvedValue(openNormal);
    prisma.ticket.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.setPriority('t-1', 'HIGH' as any, 'admin-1')).rejects.toBeInstanceOf(
      ConflictAppException,
    );
  });

  // ── Phase 131 — escalation notification ─────────────────────────────────
  it('emits tickets.priority.changed to the assignee on escalation', async () => {
    const { svc, repo, eventBus, prisma } = build();
    repo.findTicketById.mockResolvedValue({
      ...openNormal,
      assignedAdminId: 'admin-2',
      ticketNumber: 'TKT-2026-000001',
    });
    await svc.setPriority('t-1', 'URGENT' as any, 'admin-1');
    expect(prisma.admin.findUnique).toHaveBeenCalled();
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'tickets.priority.changed',
        payload: expect.objectContaining({
          assigneeId: 'admin-2',
          assigneeEmail: 'a@x.com',
          fromPriority: 'NORMAL',
          toPriority: 'URGENT',
        }),
      }),
    );
  });

  it('does NOT notify on a de-escalation', async () => {
    const { svc, repo, eventBus } = build();
    repo.findTicketById.mockResolvedValue({
      ...openNormal,
      priority: 'URGENT',
      assignedAdminId: 'admin-2',
      ticketNumber: 'TKT-1',
    });
    await svc.setPriority('t-1', 'NORMAL' as any, 'admin-1');
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('does NOT notify when the escalator is the assignee themselves', async () => {
    const { svc, repo, eventBus } = build();
    repo.findTicketById.mockResolvedValue({
      ...openNormal,
      assignedAdminId: 'admin-1',
      ticketNumber: 'TKT-1',
    });
    await svc.setPriority('t-1', 'URGENT' as any, 'admin-1');
    expect(eventBus.publish).not.toHaveBeenCalled();
  });

  it('does NOT notify when the ticket is unassigned', async () => {
    const { svc, repo, eventBus } = build();
    repo.findTicketById.mockResolvedValue(openNormal); // no assignedAdminId
    await svc.setPriority('t-1', 'URGENT' as any, 'admin-1');
    expect(eventBus.publish).not.toHaveBeenCalled();
  });
});
