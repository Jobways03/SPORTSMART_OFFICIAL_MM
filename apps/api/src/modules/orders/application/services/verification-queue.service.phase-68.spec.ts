// Phase 68 (2026-05-22) — VerificationQueueService regression.
//
// Covers:
//   Gap #11 — approve / reject both write audit log rows
//   Gap #16 — claim TTL is env-driven (VERIFICATION_CLAIM_TTL_MINUTES)
//   Gap #18 — service rejects approve when caller doesn't hold the
//             claim (asserClaimHeldBy)

import { VerificationQueueService } from './verification-queue.service';

function makeService(over: {
  envMinutes?: number;
  claimHeld?: 'me' | 'other' | 'expired';
} = {}) {
  const audit = {
    writeAuditLog: jest.fn().mockResolvedValue(undefined),
  };
  const ordersService = {
    verifyOrder: jest.fn().mockResolvedValue({ id: 'mo-1' }),
    rejectOrder: jest.fn().mockResolvedValue(undefined),
  };
  const riskScoring = {
    scoreOrder: jest.fn().mockResolvedValue({
      score: 10, band: 'GREEN', reasons: [],
    }),
  };
  const env = {
    getNumber: (_k: string, fallback: number) =>
      over.envMinutes ?? fallback,
  };

  const claimRows = (() => {
    if (over.claimHeld === 'me') {
      return [{ exists: true, claim_held: true, claim_live: true }];
    }
    if (over.claimHeld === 'other') {
      return [{ exists: true, claim_held: false, claim_live: true }];
    }
    if (over.claimHeld === 'expired') {
      return [{ exists: true, claim_held: true, claim_live: false }];
    }
    return [{ exists: true, claim_held: true, claim_live: true }];
  })();

  // Phase 73 — approve/reject now write OrderClaimHistory rows
  // inside a tx. Mock both the inner tx-scoped operations and
  // the outer prisma surface.
  const masterOrderUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const claimHistoryCreate = jest.fn().mockResolvedValue({});
  const prisma: any = {
    $queryRaw: jest.fn().mockResolvedValue(claimRows),
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(async (cb: any) =>
      cb({
        masterOrder: { updateMany: masterOrderUpdateMany },
        orderClaimHistory: { create: claimHistoryCreate },
      }),
    ),
    masterOrder: {
      updateMany: masterOrderUpdateMany,
      findUnique: jest.fn().mockResolvedValue({
        orderNumber: 'SM-42',
        orderStatus: 'PLACED',
        verificationRiskBand: 'RED',
        verificationRiskScore: 95,
        claimedAt: new Date(Date.now() - 60_000),
      }),
    },
  };

  // Phase 73 — service now also accepts EventBusService. Stub it
  // so existing Phase 68 assertions don't break.
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };

  const svc = new VerificationQueueService(
    prisma,
    ordersService as any,
    audit as any,
    riskScoring as any,
    env as any,
    eventBus,
  );

  return { svc, prisma, audit, ordersService, eventBus };
}

describe('VerificationQueueService constructor (Phase 68 — Gap #16)', () => {
  it('reads VERIFICATION_CLAIM_TTL_MINUTES via env', () => {
    const { svc } = makeService({ envMinutes: 45 });
    expect((svc as any).claimTtlInterval).toBe('45 minutes');
  });

  it('falls back to 15 minutes when env is unset', () => {
    const { svc } = makeService({});
    expect((svc as any).claimTtlInterval).toBe('15 minutes');
  });

  it('clamps zero/negative to at least 1 minute', () => {
    const { svc } = makeService({ envMinutes: 0 });
    expect((svc as any).claimTtlInterval).toBe('1 minutes');
  });
});

describe('VerificationQueueService.approve (Phase 68 — Gap #11)', () => {
  it('rejects when claim is held by another admin', async () => {
    const { svc } = makeService({ claimHeld: 'other' });
    await expect(svc.approve('mo-1', 'admin-A')).rejects.toMatchObject({
      message: expect.stringContaining('do not hold the claim'),
    });
  });

  it('rejects when claim has expired', async () => {
    const { svc } = makeService({ claimHeld: 'expired' });
    await expect(svc.approve('mo-1', 'admin-A')).rejects.toMatchObject({
      message: expect.stringContaining('expired'),
    });
  });

  it('delegates verifyOrder with actorContext', async () => {
    const { svc, ordersService } = makeService({ claimHeld: 'me' });
    await svc.approve('mo-1', 'admin-A', 'OK', { ipAddress: '2.2.2.2', userAgent: 'jest' });
    expect(ordersService.verifyOrder).toHaveBeenCalledWith(
      'mo-1',
      'admin-A',
      'OK',
      { ipAddress: '2.2.2.2', userAgent: 'jest' },
    );
  });
});

describe('VerificationQueueService.reject (Phase 68 — Gap #11)', () => {
  it('writes ORDER_REJECTED audit row with risk snapshot', async () => {
    const { svc, audit } = makeService({ claimHeld: 'me' });
    await svc.reject('mo-1', 'admin-A', 'risk too high', { ipAddress: '3.3.3.3', userAgent: 'jest' });
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ORDER_REJECTED',
        actorId: 'admin-A',
        resourceId: 'mo-1',
        ipAddress: '3.3.3.3',
        userAgent: 'jest',
        metadata: expect.objectContaining({
          orderNumber: 'SM-42',
          riskBand: 'RED',
          riskScore: 95,
          remarks: 'risk too high',
        }),
      }),
    );
  });

  it('audit write failure does not break the response', async () => {
    const { svc, audit } = makeService({ claimHeld: 'me' });
    audit.writeAuditLog.mockRejectedValueOnce(new Error('audit down'));
    await expect(svc.reject('mo-1', 'admin-A')).resolves.toBeUndefined();
  });

  it('rejects when claim is held by another admin', async () => {
    const { svc, audit } = makeService({ claimHeld: 'other' });
    await expect(svc.reject('mo-1', 'admin-A')).rejects.toMatchObject({
      message: expect.stringContaining('do not hold the claim'),
    });
    expect(audit.writeAuditLog).not.toHaveBeenCalled();
  });
});
