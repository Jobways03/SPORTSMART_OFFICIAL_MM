// Phase 111 — admin dispute assignment / severity / status hardening.
//
//   - setStatus must REFUSE RESOLVED_* (those go through `decide`; otherwise a
//     disputes.statusUpdate operator shortcuts the decision pipeline).
//   - setSeverity must be version-CAS protected (was a bare update).
//   - assign must reject a non-existent / inactive target admin.
//   - assign / setStatus / setSeverity must each write an audit_logs row.

import { DisputeService } from './dispute.service';

function build(prismaOverrides: any = {}) {
  const prisma: any = {
    dispute: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({
        id: 'd-1',
        status: 'UNDER_REVIEW',
        version: 2,
        severity: 80,
        assignedAdminId: 'admin-2',
      }),
    },
    admin: { findUnique: jest.fn() },
    ...prismaOverrides,
  };
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
  const caseDuplicates = {
    assertNoActiveDisputeForReturn: jest.fn().mockResolvedValue(undefined),
    assertNoActiveDisputeForOrderAndKind: jest.fn().mockResolvedValue(undefined),
  };
  const service = new DisputeService(
    prisma as any,
    eventBus as any,
    audit as any,
    caseDuplicates as any,
    {} as any, // refundInstruction — unused here
    {} as any, // ledger — unused here
  );
  return { service, prisma, audit };
}

describe('DisputeService.setStatus — RESOLVED_* must route through decide', () => {
  it.each(['RESOLVED_BUYER', 'RESOLVED_SELLER', 'RESOLVED_SPLIT'])(
    'refuses %s via setStatus (no DB read, no update)',
    async (status) => {
      const { service, prisma } = build();
      await expect(
        service.setStatus('d-1', status as any, 'admin-1'),
      ).rejects.toThrow(/decide/i);
      expect(prisma.dispute.findUnique).not.toHaveBeenCalled();
      expect(prisma.dispute.update).not.toHaveBeenCalled();
    },
  );

  it('allows a procedural transition (UNDER_REVIEW → AWAITING_INFO) and audits it', async () => {
    const { service, prisma, audit } = build();
    prisma.dispute.findUnique.mockResolvedValue({
      id: 'd-1',
      status: 'UNDER_REVIEW',
      version: 1,
    });
    await service.setStatus('d-1', 'AWAITING_INFO' as any, 'admin-1');
    expect(prisma.dispute.update).toHaveBeenCalledTimes(1);
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'dispute.status_changed',
        actorId: 'admin-1',
      }),
    );
  });
});

describe('DisputeService.setSeverity — version-CAS + audit', () => {
  it('writes with an optimistic version guard and records an audit row', async () => {
    const { service, prisma, audit } = build();
    prisma.dispute.findUnique.mockResolvedValue({
      id: 'd-1',
      status: 'UNDER_REVIEW',
      version: 7,
      severity: 50,
    });
    await service.setSeverity('d-1', 80, 'admin-1');
    // CAS: the update WHERE clause must pin the version we read.
    expect(prisma.dispute.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ version: 7 }),
        data: expect.objectContaining({ severity: 80 }),
      }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dispute.severity_changed' }),
    );
  });

  it.each([0, 101, -5])('rejects out-of-range severity %s before any DB call', async (sev) => {
    const { service, prisma } = build();
    await expect(service.setSeverity('d-1', sev, 'admin-1')).rejects.toThrow(/1-100/);
    expect(prisma.dispute.findUnique).not.toHaveBeenCalled();
  });
});

describe('DisputeService.assign — target-admin validation + audit', () => {
  it('rejects assignment to a suspended/inactive admin (no update)', async () => {
    const { service, prisma } = build();
    prisma.dispute.findUnique.mockResolvedValue({ id: 'd-1', status: 'OPEN', version: 1 });
    prisma.admin.findUnique.mockResolvedValue({ status: 'SUSPENDED' });
    await expect(service.assign('d-1', 'admin-2', 'admin-1')).rejects.toThrow(
      /inactive or suspended/i,
    );
    expect(prisma.dispute.update).not.toHaveBeenCalled();
  });

  it('rejects assignment to a non-existent admin', async () => {
    const { service, prisma } = build();
    prisma.dispute.findUnique.mockResolvedValue({ id: 'd-1', status: 'OPEN', version: 1 });
    prisma.admin.findUnique.mockResolvedValue(null);
    await expect(service.assign('d-1', 'ghost', 'admin-1')).rejects.toThrow(/not found/i);
    expect(prisma.dispute.update).not.toHaveBeenCalled();
  });

  it('assigns to an ACTIVE admin, auto-promotes OPEN → UNDER_REVIEW, and audits', async () => {
    const { service, prisma, audit } = build();
    prisma.dispute.findUnique.mockResolvedValue({
      id: 'd-1',
      status: 'OPEN',
      version: 1,
      assignedAdminId: null,
    });
    prisma.admin.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    await service.assign('d-1', 'admin-2', 'admin-1');
    expect(prisma.dispute.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ version: 1 }),
        data: expect.objectContaining({
          status: 'UNDER_REVIEW',
          assignedAdminId: 'admin-2',
        }),
      }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'dispute.assigned',
        actorId: 'admin-1',
        newValue: { assignedAdminId: 'admin-2' },
      }),
    );
  });

  it('un-assign (adminId=null) skips the admin lookup', async () => {
    const { service, prisma } = build();
    prisma.dispute.findUnique.mockResolvedValue({
      id: 'd-1',
      status: 'UNDER_REVIEW',
      version: 1,
      assignedAdminId: 'admin-2',
    });
    await service.assign('d-1', null, 'admin-1');
    expect(prisma.admin.findUnique).not.toHaveBeenCalled();
    expect(prisma.dispute.update).toHaveBeenCalledTimes(1);
  });
});
