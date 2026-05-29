import 'reflect-metadata';
import { FranchiseStaffService } from '../../src/modules/franchise/application/services/franchise-staff.service';
import { ConflictAppException, NotFoundAppException } from '../../src/core/exceptions';

/**
 * Phase 159t — Franchise Staff Management audit (data-model + security).
 *   #5/#6 per-franchise email (no cross-franchise leak; terminated frees it)
 *   #8/#12 terminate with actor/reason + status; suspend via update
 *   #9 audit logging; #13 getStaff single scoped query
 */
function build(over: { existing?: any; staff?: any } = {}) {
  const prisma: any = {
    franchiseStaff: {
      findFirst: jest.fn().mockResolvedValue(over.existing ?? null),
      findUnique: jest.fn().mockResolvedValue(over.staff ?? null),
      create: jest.fn(async ({ data }: any) => ({ id: 'staff-1', ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'staff-1', ...data })),
    },
    // Phase 159u — suspend/terminate revoke staff sessions.
    franchiseStaffSession: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const logger: any = { setContext: jest.fn(), log: jest.fn() };
  const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const service = new FranchiseStaffService(prisma, logger, audit);
  return { service, prisma, audit };
}

const addInput = { name: 'Asha', email: 'asha@shop.in', role: 'POS_OPERATOR' };

describe('FranchiseStaffService.addStaff — #5 per-franchise email + B4 invite', () => {
  it('scopes the duplicate check to the franchise (not global)', async () => {
    const { service, prisma } = build();
    await service.addStaff('fr-1', addInput, 'fr-1');
    const where = prisma.franchiseStaff.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ franchiseId: 'fr-1', email: 'asha@shop.in' });
    expect(where.status).toEqual({ not: 'TERMINATED' });
  });

  it('rejects a same-franchise duplicate with a franchise-scoped (non-enumerating) message', async () => {
    const { service } = build({ existing: { id: 'dup' } });
    await expect(service.addStaff('fr-1', addInput, 'fr-1')).rejects.toThrow(/at your franchise/);
  });

  it('B4 — creates an INVITED staff (no password) + invite token + audit', async () => {
    const { service, prisma, audit } = build();
    const res: any = await service.addStaff('fr-1', addInput, 'owner-actor');
    const data = prisma.franchiseStaff.create.mock.calls[0][0].data;
    expect(data.createdBy).toBe('owner-actor');
    expect(data.status).toBe('INVITED');
    expect(data.passwordHash).toBeUndefined(); // owner never sets the password
    expect(data.inviteTokenHash).toEqual(expect.any(String));
    expect(res.inviteToken).toEqual(expect.any(String)); // returned for delivery to staff
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FRANCHISE_STAFF_INVITED', resourceId: 'staff-1' }),
    );
  });
});

describe('FranchiseStaffService.removeStaff — #8 terminate with actor/reason', () => {
  it('terminates (status TERMINATED + suspendedBy/reason) and audits', async () => {
    const { service, prisma, audit } = build({ staff: { id: 'staff-1', franchiseId: 'fr-1', status: 'ACTIVE' } });
    await service.removeStaff('fr-1', 'staff-1', 'owner-actor', 'theft');
    const data = prisma.franchiseStaff.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ isActive: false, status: 'TERMINATED', suspendedBy: 'owner-actor', suspensionReason: 'theft' });
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FRANCHISE_STAFF_TERMINATED' }),
    );
  });
});

describe('FranchiseStaffService.updateStaff — #12 status sync + #9 audit', () => {
  it('isActive=false suspends (status SUSPENDED + actor) and audits', async () => {
    const { service, prisma, audit } = build({ staff: { id: 'staff-1', franchiseId: 'fr-1', status: 'ACTIVE', isActive: true, role: 'POS_OPERATOR' } });
    await service.updateStaff('fr-1', 'staff-1', { isActive: false }, 'owner-actor');
    const data = prisma.franchiseStaff.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ isActive: false, status: 'SUSPENDED', suspendedBy: 'owner-actor' });
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FRANCHISE_STAFF_SUSPENDED' }),
    );
  });

  it('audits a role change', async () => {
    const { service, audit } = build({ staff: { id: 'staff-1', franchiseId: 'fr-1', status: 'ACTIVE', isActive: true, role: 'POS_OPERATOR' } });
    await service.updateStaff('fr-1', 'staff-1', { role: 'MANAGER' }, 'owner-actor');
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FRANCHISE_STAFF_ROLE_CHANGED', metadata: expect.objectContaining({ from: 'POS_OPERATOR', to: 'MANAGER' }) }),
    );
  });

  it('refuses to reactivate a TERMINATED staff', async () => {
    const { service } = build({ staff: { id: 'staff-1', franchiseId: 'fr-1', status: 'TERMINATED', isActive: false, role: 'POS_OPERATOR' } });
    await expect(
      service.updateStaff('fr-1', 'staff-1', { isActive: true }, 'owner-actor'),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });
});

describe('FranchiseStaffService.getStaff — #13 single scoped query', () => {
  it('queries by (id, franchiseId) once and 404s when not found in this franchise', async () => {
    const { service, prisma } = build();
    await expect(service.getStaff('fr-1', 'ghost')).rejects.toBeInstanceOf(NotFoundAppException);
    expect(prisma.franchiseStaff.findUnique).not.toHaveBeenCalled();
    expect(prisma.franchiseStaff.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ghost', franchiseId: 'fr-1' } }),
    );
  });
});
