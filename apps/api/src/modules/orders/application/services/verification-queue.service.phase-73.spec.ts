// Phase 73 (2026-05-22) — claim-flow audit fixes.
//
// Covers:
//   Gap #4  — auto-release cron emits TTL_EXPIRY history rows + event
//   Gap #7  — max-claims-per-verifier cap rejects above limit
//   Gap #9  — claim acquisition + release write audit log
//   Gap #11 — orders.claim.acquired/released events emitted
//   Gap #14 — OrderClaimHistory row written on every release path
//   Gap #17 — release is idempotent for expired claims by the
//             original holder

import { VerificationQueueService } from './verification-queue.service';

function makeSvc(opts: {
  liveClaimsCount?: number;
  claimResultRow?: { id: string; order_number: string } | null;
  claimedByCallerExpired?: boolean;
  envMinutes?: number;
  envMaxClaims?: number;
} = {}) {
  const masterOrderCount = jest
    .fn()
    .mockResolvedValue(opts.liveClaimsCount ?? 0);
  const queryRawResult = opts.claimResultRow !== undefined
    ? (opts.claimResultRow === null ? [] : [opts.claimResultRow])
    : [{ id: 'mo-X', order_number: 'SM-X' }];
  const claimedAt = new Date(Date.now() - 120_000);
  const expiresAt = opts.claimedByCallerExpired
    ? new Date(Date.now() - 5_000)
    : new Date(Date.now() + 5 * 60 * 1000);
  const masterOrderFindUnique = jest.fn().mockResolvedValue({
    orderNumber: 'SM-X',
    claimedByAdminId: 'admin-A',
    claimedAt,
    claimExpiresAt: expiresAt,
  });
  const masterOrderUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const claimHistoryCreate = jest.fn().mockResolvedValue({});
  const prisma: any = {
    masterOrder: {
      count: masterOrderCount,
      findUnique: masterOrderFindUnique,
      updateMany: masterOrderUpdateMany,
    },
    orderClaimHistory: { create: claimHistoryCreate },
    $queryRaw: jest.fn().mockResolvedValue(queryRawResult),
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(async (cb: any) =>
      cb({
        $queryRaw: jest.fn().mockResolvedValue(queryRawResult),
        // Phase 174 — claimNext's candidate SELECT now uses $queryRawUnsafe
        // (optional band filter interpolated as a whitelisted enum literal).
        $queryRawUnsafe: jest.fn().mockResolvedValue(queryRawResult),
        $executeRawUnsafe: jest.fn().mockResolvedValue(1),
        masterOrder: {
          updateMany: masterOrderUpdateMany,
        },
        orderClaimHistory: { create: claimHistoryCreate },
      }),
    ),
  };

  const env: any = {
    getNumber: (k: string, fallback: number) => {
      if (k === 'VERIFICATION_CLAIM_TTL_MINUTES') return opts.envMinutes ?? fallback;
      if (k === 'VERIFICATION_MAX_CLAIMS_PER_VERIFIER') return opts.envMaxClaims ?? fallback;
      return fallback;
    },
  };
  const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const ordersService: any = { verifyOrder: jest.fn(), rejectOrder: jest.fn() };
  const riskScoring: any = { scoreOrder: jest.fn() };

  const svc = new VerificationQueueService(
    prisma,
    ordersService,
    audit,
    riskScoring,
    env,
    eventBus,
  );
  return {
    svc,
    prisma,
    audit,
    eventBus,
    masterOrderCount,
    masterOrderUpdateMany,
    claimHistoryCreate,
    masterOrderFindUnique,
  };
}

describe('VerificationQueueService.claimNext (Phase 73 — Gaps #7, #9, #11)', () => {
  it('Gap #7 — rejects when verifier is at max claims', async () => {
    const { svc } = makeSvc({ liveClaimsCount: 10 });
    await expect(svc.claimNext('admin-A')).rejects.toMatchObject({
      message: expect.stringContaining('per-verifier claim limit'),
    });
  });

  it('Gap #7 — allows claim just under the cap', async () => {
    const { svc, masterOrderUpdateMany: _u, prisma } = makeSvc({
      liveClaimsCount: 9,
    });
    const result = await svc.claimNext('admin-A');
    expect(result).not.toBeNull();
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('Gap #9 — writes ORDER_CLAIM_ACQUIRED audit row', async () => {
    const { svc, audit } = makeSvc({ liveClaimsCount: 0 });
    await svc.claimNext('admin-A');
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ORDER_CLAIM_ACQUIRED',
        actorId: 'admin-A',
      }),
    );
  });

  it('Gap #11 — emits orders.claim.acquired event', async () => {
    const { svc, eventBus } = makeSvc({ liveClaimsCount: 0 });
    await svc.claimNext('admin-A');
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'orders.claim.acquired',
        payload: expect.objectContaining({
          claimedByAdminId: 'admin-A',
        }),
      }),
    );
  });

  it('returns null when queue is empty', async () => {
    const { svc, audit, eventBus } = makeSvc({
      liveClaimsCount: 0,
      claimResultRow: null,
    });
    const result = await svc.claimNext('admin-A');
    expect(result).toBeNull();
    expect(audit.writeAuditLog).not.toHaveBeenCalled();
    expect(eventBus.publish).not.toHaveBeenCalled();
  });
});

describe('VerificationQueueService.release (Phase 73 — Gaps #14, #17)', () => {
  it('Gap #17 — releases expired claim if still held by caller', async () => {
    const { svc, masterOrderUpdateMany, claimHistoryCreate } = makeSvc({
      claimedByCallerExpired: true,
    });
    await svc.release('mo-X', 'admin-A');
    expect(masterOrderUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'mo-X', claimedByAdminId: 'admin-A' },
        data: expect.objectContaining({
          claimedByAdminId: null,
          claimedAt: null,
          claimExpiresAt: null,
        }),
      }),
    );
    expect(claimHistoryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          releaseReason: 'TTL_EXPIRY',
          releasedByAdminId: 'admin-A',
        }),
      }),
    );
  });

  it('Gap #14 — explicit release of live claim writes EXPLICIT_RELEASE history row', async () => {
    const { svc, claimHistoryCreate } = makeSvc({});
    await svc.release('mo-X', 'admin-A');
    expect(claimHistoryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          releaseReason: 'EXPLICIT_RELEASE',
          releasedByAdminId: 'admin-A',
        }),
      }),
    );
  });

  it('Gap #11 — emits orders.claim.released event with reason', async () => {
    const { svc, eventBus } = makeSvc({});
    await svc.release('mo-X', 'admin-A');
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'orders.claim.released',
        payload: expect.objectContaining({
          releasedByAdminId: 'admin-A',
          releaseReason: 'EXPLICIT_RELEASE',
        }),
      }),
    );
  });

  it('rejects when claim is held by another admin', async () => {
    const { svc, masterOrderFindUnique } = makeSvc({});
    masterOrderFindUnique.mockResolvedValueOnce({
      orderNumber: 'SM-Y',
      claimedByAdminId: 'admin-B',
      claimedAt: new Date(),
      claimExpiresAt: new Date(Date.now() + 60_000),
    });
    await expect(svc.release('mo-Y', 'admin-A')).rejects.toMatchObject({
      message: expect.stringContaining('not held by you'),
    });
  });

  it('rejects with NotFound when order missing', async () => {
    const { svc, masterOrderFindUnique } = makeSvc({});
    masterOrderFindUnique.mockResolvedValueOnce(null);
    await expect(svc.release('mo-missing', 'admin-A')).rejects.toMatchObject({
      message: expect.stringContaining('not found'),
    });
  });
});
