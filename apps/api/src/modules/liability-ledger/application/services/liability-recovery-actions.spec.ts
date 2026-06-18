// Recovery-action wiring (2026-06-16) — logistics-claim lifecycle transitions
// + platform-expense reverse-by-id. Closes the "ledger is display-only" gap.

import { LogisticsClaimService } from './logistics-claim.service';
import { PlatformExpenseService } from './platform-expense.service';

describe('LogisticsClaimService.transition — recovery state machine', () => {
  const build = (current: any) => {
    const prisma: any = {
      logisticsClaim: {
        findUnique: jest.fn().mockResolvedValue(current),
        update: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ ...current, ...data }),
          ),
      },
    };
    return { svc: new LogisticsClaimService(prisma), prisma };
  };

  it('PENDING → SUBMITTED stamps submittedAt', async () => {
    const { svc, prisma } = build({ id: 'c1', status: 'PENDING' });
    const r = await svc.transition('c1', 'SUBMITTED');
    expect(r.status).toBe('SUBMITTED');
    expect(prisma.logisticsClaim.update.mock.calls[0][0].data.submittedAt).toBeInstanceOf(Date);
  });

  it('ACCEPTED → RECOVERED stamps recoveredAt', async () => {
    const { svc, prisma } = build({ id: 'c1', status: 'ACCEPTED' });
    await svc.transition('c1', 'RECOVERED');
    expect(prisma.logisticsClaim.update.mock.calls[0][0].data.recoveredAt).toBeInstanceOf(Date);
  });

  it('rejects an illegal jump PENDING → RECOVERED (no write)', async () => {
    const { svc, prisma } = build({ id: 'c1', status: 'PENDING' });
    await expect(svc.transition('c1', 'RECOVERED')).rejects.toThrow(/Illegal/);
    expect(prisma.logisticsClaim.update).not.toHaveBeenCalled();
  });

  it('rejects moving out of a terminal state (RECOVERED → SUBMITTED)', async () => {
    const { svc } = build({ id: 'c1', status: 'RECOVERED' });
    await expect(svc.transition('c1', 'SUBMITTED')).rejects.toThrow(/terminal|Illegal/);
  });

  it('is an idempotent no-op when already in the target status', async () => {
    const { svc, prisma } = build({ id: 'c1', status: 'SUBMITTED' });
    const r = await svc.transition('c1', 'SUBMITTED');
    expect(r.status).toBe('SUBMITTED');
    expect(prisma.logisticsClaim.update).not.toHaveBeenCalled();
  });

  it('allows REJECT from any in-flight state', async () => {
    for (const from of ['PENDING', 'SUBMITTED', 'ACCEPTED']) {
      const { svc, prisma } = build({ id: 'c1', status: from });
      await svc.transition('c1', 'REJECTED');
      expect(prisma.logisticsClaim.update).toHaveBeenCalled();
    }
  });

  it('throws when the claim does not exist', async () => {
    const { svc } = build(null);
    await expect(svc.transition('missing', 'SUBMITTED')).rejects.toThrow(/not found/);
  });
});

describe('PlatformExpenseService.reverseById', () => {
  const build = (row: any) => {
    const prisma: any = {
      platformExpense: {
        findUnique: jest.fn().mockResolvedValue(row),
        update: jest
          .fn()
          .mockImplementation(({ data }: any) => Promise.resolve({ ...row, ...data })),
      },
    };
    return { svc: new PlatformExpenseService(prisma), prisma };
  };

  it('reverses an un-reversed expense (soft mark)', async () => {
    const { svc, prisma } = build({ id: 'px1', reversedAt: null });
    const r = await svc.reverseById('px1', 'mis-attributed');
    expect(r.reversedAt).toBeInstanceOf(Date);
    expect(prisma.platformExpense.update).toHaveBeenCalled();
  });

  it('throws on an already-reversed expense (no double-stamp)', async () => {
    const { svc, prisma } = build({ id: 'px1', reversedAt: new Date() });
    await expect(svc.reverseById('px1', 'x')).rejects.toThrow(/already reversed/);
    expect(prisma.platformExpense.update).not.toHaveBeenCalled();
  });

  it('throws when the expense does not exist', async () => {
    const { svc } = build(null);
    await expect(svc.reverseById('missing', 'x')).rejects.toThrow(/not found/);
  });
});
