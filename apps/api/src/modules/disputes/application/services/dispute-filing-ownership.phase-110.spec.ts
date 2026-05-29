// Phase 110 (2026-05-25) — IDOR guard for self-service dispute filing.
//
// fileDispute must reject a CUSTOMER/SELLER filer that links an order graph
// they don't own (otherwise any authenticated customer could file against any
// order via direct API), and attachEvidence must reject a file the uploader
// doesn't own.

import { DisputeService } from './dispute.service';

function build(prismaOverrides: any = {}) {
  const prisma: any = {
    masterOrder: { findUnique: jest.fn() },
    subOrder: { findUnique: jest.fn() },
    return: { findUnique: jest.fn() },
    fileMetadata: { findUnique: jest.fn() },
    dispute: { create: jest.fn() },
    disputeEvidence: { create: jest.fn().mockResolvedValue({ id: 'ev-1' }) },
    disputeSequence: { upsert: jest.fn().mockResolvedValue({ lastNumber: 1 }) },
    ...prismaOverrides,
  };
  prisma.$transaction = jest.fn(async (fn: any) =>
    typeof fn === 'function' ? fn(prisma) : Promise.all(fn),
  );
  const caseDuplicates = {
    assertNoActiveDisputeForReturn: jest.fn().mockResolvedValue(undefined),
    assertNoActiveDisputeForOrderAndKind: jest.fn().mockResolvedValue(undefined),
  };
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
  const service = new DisputeService(
    prisma as any,
    eventBus as any,
    audit as any,
    caseDuplicates as any,
    {} as any, // refundInstruction — unused on this path
    {} as any, // ledger — unused on this path
  );
  return { service, prisma, caseDuplicates, audit };
}

const filer = { type: 'CUSTOMER' as const, id: 'cust-1', name: 'Cust One' };

describe('DisputeService.fileDispute — ownership guard (Phase 110, IDOR fix)', () => {
  it('refuses a master order owned by another customer (no dispute created)', async () => {
    const { service, prisma } = build();
    prisma.masterOrder.findUnique.mockResolvedValue({ customerId: 'other-cust' });
    await expect(
      service.fileDispute({ filer, kind: 'OTHER' as any, summary: 'a valid summary', masterOrderId: 'mo-1' }),
    ).rejects.toThrow(/does not belong/i);
    expect(prisma.dispute.create).not.toHaveBeenCalled();
  });

  it('refuses a return owned by another customer', async () => {
    const { service, prisma } = build();
    prisma.return.findUnique.mockResolvedValue({ customerId: 'other-cust', masterOrderId: 'mo-1', subOrderId: 'so-1' });
    await expect(
      service.fileDispute({ filer, kind: 'RETURN_REJECTED' as any, summary: 'a valid summary', returnId: 'ret-1' }),
    ).rejects.toThrow(/does not belong/i);
    expect(prisma.dispute.create).not.toHaveBeenCalled();
  });

  it('rejects a subOrderId that does not match the linked return (cross-link consistency)', async () => {
    const { service, prisma } = build();
    prisma.return.findUnique.mockResolvedValue({ customerId: 'cust-1', masterOrderId: 'mo-1', subOrderId: 'so-real' });
    await expect(
      service.fileDispute({ filer, kind: 'OTHER' as any, summary: 'a valid summary', returnId: 'ret-1', subOrderId: 'so-mismatch' }),
    ).rejects.toThrow(/does not match/i);
  });

  it('files + audits when the customer owns the linked order', async () => {
    const { service, prisma, audit } = build();
    prisma.masterOrder.findUnique.mockResolvedValue({ customerId: 'cust-1' });
    prisma.dispute.create.mockResolvedValue({
      id: 'd-1',
      disputeNumber: 'DSP-2026-000001',
      kind: 'OTHER',
      masterOrderId: 'mo-1',
      subOrderId: null,
      returnId: null,
      summary: 'a valid summary',
    });
    const out = await service.fileDispute({ filer, kind: 'OTHER' as any, summary: 'a valid summary', masterOrderId: 'mo-1' });
    expect(out.disputeNumber).toBe('DSP-2026-000001');
    expect(prisma.dispute.create).toHaveBeenCalledTimes(1);
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'dispute.filed', resourceId: 'd-1' }),
    );
  });
});

describe('DisputeService.attachEvidence — file ownership (Phase 110)', () => {
  it('refuses a file owned by another customer', async () => {
    const { service, prisma } = build();
    prisma.fileMetadata.findUnique.mockResolvedValue({ uploadedBy: 'other-cust' });
    await expect(
      service.attachEvidence({ disputeId: 'd-1', fileId: 'f-1', uploader: { type: 'CUSTOMER', id: 'cust-1' } }),
    ).rejects.toThrow(/does not belong/i);
    expect(prisma.disputeEvidence.create).not.toHaveBeenCalled();
  });

  it('refuses a non-existent file', async () => {
    const { service, prisma } = build();
    prisma.fileMetadata.findUnique.mockResolvedValue(null);
    await expect(
      service.attachEvidence({ disputeId: 'd-1', fileId: 'missing', uploader: { type: 'CUSTOMER', id: 'cust-1' } }),
    ).rejects.toThrow(/not found/i);
  });

  it('attaches a file the customer owns', async () => {
    const { service, prisma } = build();
    prisma.fileMetadata.findUnique.mockResolvedValue({ uploadedBy: 'cust-1' });
    const out = await service.attachEvidence({ disputeId: 'd-1', fileId: 'f-1', uploader: { type: 'CUSTOMER', id: 'cust-1' } });
    expect(out).toEqual({ id: 'ev-1' });
    expect(prisma.disputeEvidence.create).toHaveBeenCalledTimes(1);
  });
});

describe('DisputeService.fileDispute — duplicate-prevention wiring (Phase 1.5)', () => {
  it('calls the dispute-per-return guard and aborts (no dispute created) when it rejects', async () => {
    const { service, prisma, caseDuplicates } = build();
    // Ownership passes (the return belongs to the filer) so we reach the dup guard.
    prisma.return.findUnique.mockResolvedValue({
      customerId: 'cust-1',
      masterOrderId: 'mo-1',
      subOrderId: 'so-1',
    });
    caseDuplicates.assertNoActiveDisputeForReturn.mockRejectedValue(
      new Error('A dispute is already open for this return (DSP-2026-000009).'),
    );
    await expect(
      service.fileDispute({ filer, kind: 'RETURN_REJECTED' as any, summary: 'a valid summary', returnId: 'ret-1' }),
    ).rejects.toThrow(/already open/i);
    expect(caseDuplicates.assertNoActiveDisputeForReturn).toHaveBeenCalledWith(
      expect.objectContaining({ returnId: 'ret-1' }),
    );
    expect(prisma.dispute.create).not.toHaveBeenCalled();
  });

  it('calls the dispute-per-order-and-kind guard and aborts when it rejects', async () => {
    const { service, prisma, caseDuplicates } = build();
    prisma.masterOrder.findUnique.mockResolvedValue({ customerId: 'cust-1' });
    caseDuplicates.assertNoActiveDisputeForOrderAndKind.mockRejectedValue(
      new Error('An active "OTHER" dispute (DSP-2026-000010) already exists for this order.'),
    );
    await expect(
      service.fileDispute({ filer, kind: 'OTHER' as any, summary: 'a valid summary', masterOrderId: 'mo-1' }),
    ).rejects.toThrow(/already exists/i);
    expect(caseDuplicates.assertNoActiveDisputeForOrderAndKind).toHaveBeenCalledWith(
      expect.objectContaining({ masterOrderId: 'mo-1', kind: 'OTHER' }),
    );
    expect(prisma.dispute.create).not.toHaveBeenCalled();
  });
});
