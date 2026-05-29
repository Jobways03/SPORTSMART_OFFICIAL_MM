// Phase 112 — dispute message hardening.
//
//   - body length capped (1..5000) server-side (backstop to the DTO).
//   - internal-note coercion: only an ADMIN sender can post an internal note.
//   - internal notes publish NO event but ARE audited (internal_note_added).
//   - public replies are audited (message_added) + the insert/updatedAt bump
//     run in one transaction.
//   - ownership: a non-owner, non-affected-seller is refused.

import { DisputeService } from './dispute.service';

function build(prismaOverrides: any = {}) {
  const prisma: any = {
    dispute: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    disputeMessage: { create: jest.fn().mockResolvedValue({ id: 'msg-1' }) },
    subOrder: { findUnique: jest.fn() },
    ...prismaOverrides,
  };
  prisma.$transaction = jest.fn(async (fn: any) =>
    typeof fn === 'function' ? fn(prisma) : Promise.all(fn),
  );
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
  const caseDuplicates = {
    assertNoActiveDisputeForReturn: jest.fn(),
    assertNoActiveDisputeForOrderAndKind: jest.fn(),
  };
  const service = new DisputeService(
    prisma as any,
    eventBus as any,
    audit as any,
    caseDuplicates as any,
    {} as any,
    {} as any,
  );
  return { service, prisma, audit, eventBus };
}

const admin = { type: 'ADMIN', id: 'admin-1', name: 'Admin' } as any;
const customer = { type: 'CUSTOMER', id: 'cust-1', name: 'Cust' } as any;
const openDispute = {
  id: 'd-1',
  status: 'UNDER_REVIEW',
  filedByType: 'CUSTOMER',
  filedById: 'cust-1',
  subOrderId: null,
  disputeNumber: 'DSP-2026-000001',
  assignedAdminId: null,
};

describe('DisputeService.reply — Phase 112 hardening', () => {
  it('rejects an empty / whitespace-only body before any DB read', async () => {
    const { service, prisma } = build();
    await expect(
      service.reply({ disputeId: 'd-1', sender: customer, body: '   ' }),
    ).rejects.toThrow(/required/i);
    expect(prisma.dispute.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a body over 5000 chars before any DB read', async () => {
    const { service, prisma } = build();
    await expect(
      service.reply({ disputeId: 'd-1', sender: customer, body: 'x'.repeat(5001) }),
    ).rejects.toThrow(/too long/i);
    expect(prisma.dispute.findUnique).not.toHaveBeenCalled();
  });

  it('refuses a reply on a closed / resolved dispute', async () => {
    const { service, prisma } = build();
    prisma.dispute.findUnique.mockResolvedValue({ ...openDispute, status: 'RESOLVED_BUYER' });
    await expect(
      service.reply({ disputeId: 'd-1', sender: customer, body: 'hi' }),
    ).rejects.toThrow(/closed\/resolved/i);
    expect(prisma.disputeMessage.create).not.toHaveBeenCalled();
  });

  it('coerces isInternalNote=true to false for a non-admin sender, and publishes the event', async () => {
    const { service, prisma, eventBus } = build();
    prisma.dispute.findUnique.mockResolvedValue(openDispute);
    await service.reply({ disputeId: 'd-1', sender: customer, body: 'hi', isInternalNote: true });
    expect(prisma.disputeMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isInternalNote: false }) }),
    );
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'disputes.message.added' }),
    );
  });

  it('admin internal note: stored internal, NO event published, audited as internal_note_added', async () => {
    const { service, prisma, eventBus, audit } = build();
    prisma.dispute.findUnique.mockResolvedValue(openDispute);
    await service.reply({ disputeId: 'd-1', sender: admin, body: 'private note', isInternalNote: true });
    expect(prisma.disputeMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isInternalNote: true }) }),
    );
    expect(eventBus.publish).not.toHaveBeenCalled();
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dispute.internal_note_added' }),
    );
  });

  it('public reply: audited as message_added and wrapped in a transaction (insert + updatedAt bump)', async () => {
    const { service, prisma, audit } = build();
    prisma.dispute.findUnique.mockResolvedValue(openDispute);
    await service.reply({ disputeId: 'd-1', sender: customer, body: 'hello' });
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.dispute.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ updatedAt: expect.any(Date) }) }),
    );
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dispute.message_added' }),
    );
  });

  it('forbids a non-owner, non-affected-seller sender', async () => {
    const { service, prisma } = build();
    prisma.dispute.findUnique.mockResolvedValue({ ...openDispute, filedById: 'other-cust' });
    await expect(
      service.reply({ disputeId: 'd-1', sender: customer, body: 'hi' }),
    ).rejects.toThrow(/not allowed/i);
    expect(prisma.disputeMessage.create).not.toHaveBeenCalled();
  });
});
