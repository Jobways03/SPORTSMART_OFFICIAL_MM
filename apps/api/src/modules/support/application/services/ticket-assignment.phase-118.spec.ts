// Phase 118 — manual ticket-assignment hardening (parity with auto-assign +
// the dispute-assign flow):
//   - target admin must exist + be ACTIVE
//   - CLOSED tickets can't be reassigned
//   - version-less CAS on the prior assignee (concurrent reassign → 409)
//   - stamp assignedAt / assignedByAdminId + write an audit_logs row
//     (the who→whom→when history)

import { SupportService } from './support.service';
import {
  BadRequestAppException,
  ConflictAppException,
} from '../../../../core/exceptions';

function build() {
  const repo: any = {
    findTicketById: jest.fn(),
    updateTicket: jest.fn(),
  };
  const prisma: any = {
    admin: { findUnique: jest.fn() },
    ticket: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    // Phase 128 — pool check falls back to a custom-role count when the
    // role-default doesn't grant support.reply. Default to 0 (none).
    adminRoleAssignment: { count: jest.fn().mockResolvedValue(0) },
  };
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
  const svc = new SupportService(
    repo,
    prisma,
    eventBus as any,
    {} as any, // caseDuplicates
    {} as any, // disputes
    {} as any, // env
    audit as any,
  );
  return { svc, repo, prisma, audit, eventBus };
}

const openUnassigned = { id: 't-1', status: 'OPEN', assignedAdminId: null };

describe('SupportService.assign — Phase 118', () => {
  it('rejects assignment to an inactive/suspended admin (no write)', async () => {
    const { svc, repo, prisma } = build();
    repo.findTicketById.mockResolvedValue(openUnassigned);
    prisma.admin.findUnique.mockResolvedValue({ status: 'SUSPENDED' });
    await expect(svc.assign('t-1', 'admin-2', 'admin-1')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
  });

  it('rejects assignment to a non-existent admin', async () => {
    const { svc, repo, prisma } = build();
    repo.findTicketById.mockResolvedValue(openUnassigned);
    prisma.admin.findUnique.mockResolvedValue(null);
    await expect(svc.assign('t-1', 'ghost', 'admin-1')).rejects.toThrow(/not found/i);
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to reassign a CLOSED ticket (before any admin lookup)', async () => {
    const { svc, repo, prisma } = build();
    repo.findTicketById.mockResolvedValue({ ...openUnassigned, status: 'CLOSED' });
    await expect(svc.assign('t-1', 'admin-2', 'admin-1')).rejects.toThrow(/closed/i);
    expect(prisma.admin.findUnique).not.toHaveBeenCalled();
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
  });

  it('assigns to an ACTIVE admin: CAS on prior assignee, stamps who/when, audits', async () => {
    const { svc, repo, prisma, audit } = build();
    repo.findTicketById.mockResolvedValue(openUnassigned);
    prisma.admin.findUnique.mockResolvedValue({
      status: 'ACTIVE', email: 'a2@example.com', name: 'Agent Two',
      role: 'SELLER_SUPPORT', // holds support.reply by role default
    });
    await svc.assign('t-1', 'admin-2', 'admin-1');
    expect(prisma.ticket.updateMany).toHaveBeenCalledWith({
      where: { id: 't-1', assignedAdminId: null },
      data: {
        assignedAdminId: 'admin-2',
        assignedAt: expect.any(Date),
        assignedByAdminId: 'admin-1',
      },
    });
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ticket.assigned',
        actorId: 'admin-1',
        oldValue: { assignedAdminId: null },
        newValue: { assignedAdminId: 'admin-2' },
      }),
    );
  });

  it('raises 409 when the CAS loses (someone else reassigned)', async () => {
    const { svc, repo, prisma } = build();
    repo.findTicketById.mockResolvedValue(openUnassigned);
    prisma.admin.findUnique.mockResolvedValue({
      status: 'ACTIVE', role: 'SELLER_SUPPORT',
    });
    prisma.ticket.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.assign('t-1', 'admin-2', 'admin-1')).rejects.toBeInstanceOf(
      ConflictAppException,
    );
  });

  it('rejects assignment to an ACTIVE admin who lacks support.reply (not in the pool)', async () => {
    const { svc, repo, prisma } = build();
    repo.findTicketById.mockResolvedValue(openUnassigned);
    // FINANCE_OPERATIONS (or any role without support.reply) + no custom-role
    // grant → not in the support pool.
    prisma.admin.findUnique.mockResolvedValue({
      status: 'ACTIVE', email: 'f@example.com', name: 'Finance', role: 'FINANCE_OPERATIONS',
    });
    prisma.adminRoleAssignment.count.mockResolvedValue(0);
    await expect(svc.assign('t-1', 'admin-2', 'admin-1')).rejects.toBeInstanceOf(
      BadRequestAppException,
    );
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
  });

  it('un-assign (null) skips the admin lookup and clears the stamps', async () => {
    const { svc, repo, prisma } = build();
    repo.findTicketById.mockResolvedValue({ ...openUnassigned, assignedAdminId: 'admin-2' });
    await svc.assign('t-1', null, 'admin-1');
    expect(prisma.admin.findUnique).not.toHaveBeenCalled();
    expect(prisma.ticket.updateMany).toHaveBeenCalledWith({
      where: { id: 't-1', assignedAdminId: 'admin-2' },
      data: { assignedAdminId: null, assignedAt: null, assignedByAdminId: null },
    });
  });
});
