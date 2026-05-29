// Phase 128 — support auto-assignment: permission-based pool + race-safe claim.
//
//   - The pool is active admins who effectively hold `support.reply`
//     (registry role-defaults ∪ custom-role grants) — not a hardcoded role
//     list, and including custom-role holders.
//   - The claim is a CAS on `assignedAdminId IS NULL`, so a fire-and-forget
//     auto-assign racing a manual assign never clobbers the human decision.

import { SupportService } from './support.service';

function build() {
  const repo: any = {};
  const prisma: any = {
    adminRoleAssignment: { findMany: jest.fn().mockResolvedValue([]) },
    admin: { findMany: jest.fn().mockResolvedValue([]) },
    ticket: {
      groupBy: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
  const env = { getBoolean: jest.fn().mockReturnValue(true) };
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const svc = new SupportService(
    repo,
    prisma,
    eventBus as any,
    {} as any, // caseDuplicates
    {} as any, // disputes
    env as any,
    audit as any,
  );
  return { svc, prisma };
}

describe('SupportService.autoAssignTicket — Phase 128', () => {
  it('assigns to the least-loaded eligible admin via CAS on unassigned', async () => {
    const { svc, prisma } = build();
    prisma.admin.findMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]);
    prisma.ticket.groupBy.mockResolvedValue([
      { assignedAdminId: 'a1', _count: { _all: 2 } }, // a2 has 0 → least loaded
    ]);
    const result = await svc.autoAssignTicket('t-1');
    expect(result).toBe('a2');
    expect(prisma.ticket.updateMany).toHaveBeenCalledWith({
      where: { id: 't-1', assignedAdminId: null },
      data: { assignedAdminId: 'a2', assignedAt: expect.any(Date) },
    });
  });

  it('skips (returns null) when the ticket was already assigned — CAS count 0', async () => {
    const { svc, prisma } = build();
    prisma.admin.findMany.mockResolvedValue([{ id: 'a1' }]);
    prisma.ticket.updateMany.mockResolvedValue({ count: 0 });
    expect(await svc.autoAssignTicket('t-1')).toBeNull();
  });

  it('returns null (no work) when no eligible admin is in the pool', async () => {
    const { svc, prisma } = build();
    prisma.admin.findMany.mockResolvedValue([]);
    expect(await svc.autoAssignTicket('t-1')).toBeNull();
    expect(prisma.ticket.groupBy).not.toHaveBeenCalled();
    expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
  });

  it('includes custom-role holders (not just system roles) in the pool', async () => {
    const { svc, prisma } = build();
    prisma.adminRoleAssignment.findMany.mockResolvedValue([{ adminId: 'cust-1' }]);
    prisma.admin.findMany.mockResolvedValue([{ id: 'cust-1' }]);
    await svc.autoAssignTicket('t-1');
    const whereArg = prisma.admin.findMany.mock.calls[0][0].where;
    expect(whereArg.status).toBe('ACTIVE');
    expect(whereArg.OR).toEqual(
      expect.arrayContaining([{ id: { in: ['cust-1'] } }]),
    );
  });
});
