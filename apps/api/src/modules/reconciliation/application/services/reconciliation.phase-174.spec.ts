import { ReconciliationService } from './reconciliation.service';
import { ConflictAppException, NotFoundAppException } from '../../../../core/exceptions';

// Phase 174 — Discrepancy Resolution Flow audit remediation.

function makeService() {
  const history: any[] = [];
  const prisma: any = {
    reconciliationDiscrepancy: {
      findUnique: jest.fn(),
      update: jest.fn().mockImplementation(({ data }: any) => ({ id: 'd1', ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    discrepancyStatusHistory: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        history.push(data);
        return { id: `h${history.length}`, ...data };
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    // Run the transaction callback against the same mocked client.
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(prisma)),
  };
  const eventBus = { publish: jest.fn().mockResolvedValue(undefined) };
  const audit = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const svc = new ReconciliationService(prisma as any, eventBus as any, audit as any);
  return { svc, prisma, eventBus, audit, history };
}

describe('#1/#2/#16 transition writes history + stamps investigation + emits event', () => {
  it('OPEN→IN_REVIEW stamps investigatingBy/At, writes history, publishes event', async () => {
    const { svc, prisma, eventBus, history } = makeService();
    prisma.reconciliationDiscrepancy.findUnique
      .mockResolvedValueOnce({ id: 'd1', status: 'OPEN' })
      .mockResolvedValueOnce({ id: 'd1', status: 'IN_REVIEW' });

    await svc.transitionDiscrepancy({ id: 'd1', status: 'IN_REVIEW', adminId: 'a1' });

    const upd = prisma.reconciliationDiscrepancy.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'd1', status: 'OPEN' });
    expect(upd.data.investigatingByAdminId).toBe('a1');
    expect(upd.data.investigatingAt).toBeInstanceOf(Date);
    // not terminal → no resolver stamp
    expect(upd.data.resolvedByAdminId).toBeNull();

    expect(history[0]).toMatchObject({
      discrepancyId: 'd1', fromStatus: 'OPEN', toStatus: 'IN_REVIEW', actorAdminId: 'a1', actorRole: 'ADMIN',
    });
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: 'recon.discrepancy.transitioned' }),
    );
  });

  it('CAS + history are atomic — both run inside $transaction', async () => {
    const { svc, prisma } = makeService();
    prisma.reconciliationDiscrepancy.findUnique
      .mockResolvedValueOnce({ id: 'd1', status: 'OPEN' })
      .mockResolvedValueOnce({ id: 'd1', status: 'RESOLVED' });
    await svc.transitionDiscrepancy({ id: 'd1', status: 'RESOLVED', adminId: 'a1' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.discrepancyStatusHistory.create).toHaveBeenCalledTimes(1);
  });

  it('does not write history when the CAS loses the race', async () => {
    const { svc, prisma, history } = makeService();
    prisma.reconciliationDiscrepancy.findUnique.mockResolvedValueOnce({ id: 'd1', status: 'OPEN' });
    prisma.reconciliationDiscrepancy.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      svc.transitionDiscrepancy({ id: 'd1', status: 'RESOLVED', adminId: 'a1' }),
    ).rejects.toBeInstanceOf(ConflictAppException);
    expect(history).toHaveLength(0);
  });
});

describe('#8 reopen', () => {
  it('RESOLVED→OPEN clears resolution + investigation stamps and records reason', async () => {
    const { svc, prisma, history } = makeService();
    prisma.reconciliationDiscrepancy.findUnique
      .mockResolvedValueOnce({ id: 'd1', status: 'RESOLVED' })
      .mockResolvedValueOnce({ id: 'd1', status: 'OPEN' });

    await svc.reopenDiscrepancy({ id: 'd1', reason: 'bank later flagged the credit', adminId: 'a1' });

    const upd = prisma.reconciliationDiscrepancy.updateMany.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'd1', status: 'RESOLVED' });
    expect(upd.data.status).toBe('OPEN');
    expect(upd.data.resolvedByAdminId).toBeNull();
    expect(upd.data.resolvedAt).toBeNull();
    expect(upd.data.investigatingByAdminId).toBeNull();
    expect(upd.data.resolutionNotes).toContain('bank later');
    expect(history[0].toStatus).toBe('OPEN');
    expect(history[0].notes).toContain('REOPENED');
  });

  it('rejects reopening a non-terminal (OPEN/IN_REVIEW) discrepancy', async () => {
    const { svc, prisma } = makeService();
    prisma.reconciliationDiscrepancy.findUnique.mockResolvedValue({ id: 'd1', status: 'IN_REVIEW' });
    await expect(
      svc.reopenDiscrepancy({ id: 'd1', reason: 'x', adminId: 'a1' }),
    ).rejects.toBeInstanceOf(ConflictAppException);
    expect(prisma.reconciliationDiscrepancy.updateMany).not.toHaveBeenCalled();
  });

  it('404s a missing discrepancy', async () => {
    const { svc, prisma } = makeService();
    prisma.reconciliationDiscrepancy.findUnique.mockResolvedValue(null);
    await expect(
      svc.reopenDiscrepancy({ id: 'nope', reason: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundAppException);
  });
});

describe('#6 assign / unassign', () => {
  it('assigns an owner + stamps assignedAt + audits', async () => {
    const { svc, prisma, audit } = makeService();
    prisma.reconciliationDiscrepancy.findUnique.mockResolvedValue({ id: 'd1', assignedToAdminId: null });
    await svc.assignDiscrepancy({ id: 'd1', assignedToAdminId: 'a2', adminId: 'a1' });
    const upd = prisma.reconciliationDiscrepancy.update.mock.calls[0][0];
    expect(upd.data.assignedToAdminId).toBe('a2');
    expect(upd.data.assignedAt).toBeInstanceOf(Date);
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'recon.discrepancy.assigned' }),
    );
  });

  it('unassign (null) clears assignedAt', async () => {
    const { svc, prisma } = makeService();
    prisma.reconciliationDiscrepancy.findUnique.mockResolvedValue({ id: 'd1', assignedToAdminId: 'a2' });
    await svc.assignDiscrepancy({ id: 'd1', assignedToAdminId: null, adminId: 'a1' });
    const upd = prisma.reconciliationDiscrepancy.update.mock.calls[0][0];
    expect(upd.data.assignedToAdminId).toBeNull();
    expect(upd.data.assignedAt).toBeNull();
  });
});

describe('#11 bulkTransition', () => {
  it('reports per-id partial success and routes each through transitionDiscrepancy', async () => {
    const { svc } = makeService();
    const spy = jest
      .spyOn(svc, 'transitionDiscrepancy')
      .mockResolvedValueOnce({} as any)
      .mockRejectedValueOnce(new ConflictAppException('stale'));
    const res = await svc.bulkTransition({ ids: ['d1', 'd2'], status: 'IGNORED', notes: 'known seed drift', adminId: 'a1' });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(res.total).toBe(2);
    expect(res.succeeded).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.results[0]).toMatchObject({ id: 'd1', ok: true });
    expect(res.results[1]).toMatchObject({ id: 'd2', ok: false });
  });
});

describe('#2 getDiscrepancyHistory', () => {
  it('returns the trail for an existing discrepancy', async () => {
    const { svc, prisma } = makeService();
    prisma.reconciliationDiscrepancy.findUnique.mockResolvedValue({ id: 'd1' });
    prisma.discrepancyStatusHistory.findMany.mockResolvedValue([
      { id: 'h1', toStatus: 'RESOLVED' },
    ]);
    const rows = await svc.getDiscrepancyHistory('d1');
    expect(rows).toHaveLength(1);
    expect(prisma.discrepancyStatusHistory.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { discrepancyId: 'd1' }, orderBy: { occurredAt: 'desc' } }),
    );
  });

  it('404s a missing discrepancy', async () => {
    const { svc, prisma } = makeService();
    prisma.reconciliationDiscrepancy.findUnique.mockResolvedValue(null);
    await expect(svc.getDiscrepancyHistory('nope')).rejects.toBeInstanceOf(NotFoundAppException);
  });
});
