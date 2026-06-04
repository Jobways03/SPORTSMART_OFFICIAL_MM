import { QueueService } from './queue.service';

/**
 * Pins the N+1 fix: list() must resolve risk scores with a single batched
 * lookup (risk.getManyOrZero) rather than one getOrZero await per row.
 */
function makeService(opts?: { riskMap?: Map<string, { score: number; tier: string }> }) {
  const rows = [
    {
      id: 'd1',
      status: 'OPEN',
      updatedAt: new Date('2026-01-01T00:00:00Z'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
      disputeNumber: 'DSP-1',
    },
    {
      id: 'd2',
      status: 'OPEN',
      updatedAt: new Date('2026-01-02T00:00:00Z'),
      createdAt: new Date('2026-01-02T00:00:00Z'),
      disputeNumber: 'DSP-2',
    },
  ];
  const prisma = {
    dispute: { findMany: jest.fn().mockResolvedValue(rows) },
    return: { findMany: jest.fn().mockResolvedValue([]) },
    ticket: { findMany: jest.fn().mockResolvedValue([]) },
  } as any;
  const tracker = { evaluate: jest.fn().mockResolvedValue([]) } as any;
  const getManyOrZero = jest.fn().mockResolvedValue(
    opts?.riskMap ?? new Map([['d1', { score: 80, tier: 'HIGH' }]]),
  );
  const getOrZero = jest.fn();
  const risk = { getManyOrZero, getOrZero } as any;
  return { svc: new QueueService(prisma, tracker, risk), getManyOrZero, getOrZero };
}

describe('QueueService — batched risk lookup (no N+1)', () => {
  it('calls getManyOrZero once with every resourceId and never getOrZero', async () => {
    const { svc, getManyOrZero, getOrZero } = makeService();
    await svc.list({ resource: 'dispute', page: 1, limit: 20 });
    expect(getManyOrZero).toHaveBeenCalledTimes(1);
    expect(getManyOrZero).toHaveBeenCalledWith('dispute', ['d1', 'd2']);
    expect(getOrZero).not.toHaveBeenCalled();
  });

  it('maps risk from the batch result and defaults missing rows to LOW/0', async () => {
    const { svc } = makeService(); // map only has d1
    const { items } = await svc.list({ resource: 'dispute', page: 1, limit: 20 });
    const d1 = items.find((i) => i.resourceId === 'd1');
    const d2 = items.find((i) => i.resourceId === 'd2');
    expect(d1).toMatchObject({ riskScore: 80, riskTier: 'HIGH' });
    expect(d2).toMatchObject({ riskScore: 0, riskTier: 'LOW' });
  });

  it('summary() batches each queue (one getManyOrZero per resource, not per row)', async () => {
    const { svc, getManyOrZero } = makeService();
    await svc.summary();
    // three resources → three batched calls, regardless of row count
    expect(getManyOrZero).toHaveBeenCalledTimes(3);
  });
});
