// Phase 1.5 — duplicate-prevention guard, gated by
// CASE_DUPLICATE_PREVENTION_ENABLED (now defaulting ON). Pins the two
// behaviours that matter for the dispute flow: OFF = no-op (no query, no
// throw); ON = reject an active duplicate dispute and record it.

import { CaseDuplicateService } from './case-duplicate.service';
import { DuplicateCaseException } from '../exceptions/duplicate-case.exception';

function build(enabled: boolean, prismaOverrides: any = {}) {
  const env = { getBoolean: jest.fn().mockReturnValue(enabled) };
  const logger = { setContext: jest.fn(), error: jest.fn() };
  const prisma: any = {
    dispute: { findFirst: jest.fn() },
    caseDuplicate: { create: jest.fn().mockResolvedValue({ id: 'cd-1' }) },
    ...prismaOverrides,
  };
  const service = new CaseDuplicateService(
    prisma as any,
    env as any,
    logger as any,
  );
  return { service, prisma, env };
}

const actor = { type: 'SELLER', id: 'seller-1' };

describe('CaseDuplicateService.assertNoActiveDisputeForReturn', () => {
  it('is a no-op when the flag is OFF (no query, no throw)', async () => {
    const { service, prisma, env } = build(false);
    await expect(
      service.assertNoActiveDisputeForReturn({ returnId: 'ret-1', actor }),
    ).resolves.toBeUndefined();
    expect(env.getBoolean).toHaveBeenCalledWith(
      'CASE_DUPLICATE_PREVENTION_ENABLED',
      false,
    );
    expect(prisma.dispute.findFirst).not.toHaveBeenCalled();
  });

  it('throws + records a case_duplicates row when ON and an active dispute exists', async () => {
    const { service, prisma } = build(true);
    prisma.dispute.findFirst.mockResolvedValue({
      id: 'd-9',
      disputeNumber: 'DSP-2026-000009',
    });
    await expect(
      service.assertNoActiveDisputeForReturn({ returnId: 'ret-1', actor }),
    ).rejects.toBeInstanceOf(DuplicateCaseException);
    expect(prisma.caseDuplicate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attemptedSourceType: 'DISPUTE',
          duplicateOfSourceType: 'DISPUTE',
          duplicateOfSourceId: 'd-9',
          reason: 'ACTIVE_DISPUTE_EXISTS_FOR_RETURN',
          actorId: 'seller-1',
        }),
      }),
    );
  });

  it('passes silently when ON but no active dispute exists', async () => {
    const { service, prisma } = build(true);
    prisma.dispute.findFirst.mockResolvedValue(null);
    await expect(
      service.assertNoActiveDisputeForReturn({ returnId: 'ret-1', actor }),
    ).resolves.toBeUndefined();
    expect(prisma.caseDuplicate.create).not.toHaveBeenCalled();
  });
});

describe('CaseDuplicateService.assertNoActiveDisputeForOrderAndKind', () => {
  it('throws when ON and an active dispute of the same kind exists on the order', async () => {
    const { service, prisma } = build(true);
    prisma.dispute.findFirst.mockResolvedValue({
      id: 'd-10',
      disputeNumber: 'DSP-2026-000010',
    });
    await expect(
      service.assertNoActiveDisputeForOrderAndKind({
        masterOrderId: 'mo-1',
        kind: 'OTHER',
        actor,
      }),
    ).rejects.toBeInstanceOf(DuplicateCaseException);
    expect(prisma.caseDuplicate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reason: 'ACTIVE_DISPUTE_EXISTS_FOR_ORDER_AND_KIND',
        }),
      }),
    );
  });

  it('is a no-op when the flag is OFF', async () => {
    const { service, prisma } = build(false);
    await service.assertNoActiveDisputeForOrderAndKind({
      masterOrderId: 'mo-1',
      kind: 'OTHER',
      actor,
    });
    expect(prisma.dispute.findFirst).not.toHaveBeenCalled();
  });
});
