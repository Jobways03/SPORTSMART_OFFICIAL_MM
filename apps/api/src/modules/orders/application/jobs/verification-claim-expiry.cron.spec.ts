// Phase 73 (2026-05-22) — claim-flow audit Gap #4.
//
// Auto-release cron sweeps stale claim rows, writes TTL_EXPIRY
// history, and emits orders.claim.expired events.

import { VerificationClaimExpiryCron } from './verification-claim-expiry.cron';

function makeCron(opts: {
  candidates?: Array<{
    id: string;
    orderNumber: string;
    claimedByAdminId: string;
    claimedAt: Date;
    claimExpiresAt: Date;
  }>;
  envEnabled?: boolean;
  updateCount?: number;
} = {}) {
  const findMany = jest.fn().mockResolvedValue(opts.candidates ?? []);
  const updateMany = jest.fn().mockResolvedValue({
    count: opts.updateCount ?? 1,
  });
  const claimHistoryCreate = jest.fn().mockResolvedValue({});
  const prisma: any = {
    masterOrder: { findMany, updateMany },
    orderClaimHistory: { create: claimHistoryCreate },
    $transaction: jest.fn(async (cb: any) =>
      cb({
        masterOrder: { updateMany },
        orderClaimHistory: { create: claimHistoryCreate },
      }),
    ),
  };
  const env: any = {
    getBoolean: (_k: string, fb: boolean) =>
      opts.envEnabled !== undefined ? opts.envEnabled : fb,
    getNumber: (_k: string, fb: number) => fb,
  };
  const eventBus: any = { publish: jest.fn().mockResolvedValue(undefined) };
  const leader: any = {
    run: jest.fn(async (_l: string, _t: number, fn: () => Promise<void>) => fn()),
  };
  const audit: any = { writeAuditLog: jest.fn().mockResolvedValue(undefined) };
  const cron = new VerificationClaimExpiryCron(prisma, env, eventBus, leader, audit);
  return { cron, prisma, eventBus, audit, claimHistoryCreate, updateMany };
}

describe('VerificationClaimExpiryCron', () => {
  it('no-ops when env flag disabled', async () => {
    const { cron, prisma } = makeCron({ envEnabled: false });
    await cron.sweep();
    expect(prisma.masterOrder.findMany).not.toHaveBeenCalled();
  });

  it('returns released=0 when no expired claims found', async () => {
    const { cron } = makeCron({ candidates: [] });
    const result = await cron.runOnce();
    expect(result).toEqual({ released: 0 });
  });

  it('releases each expired claim + writes TTL_EXPIRY history row', async () => {
    const claimedAt = new Date(Date.now() - 20 * 60_000);
    const claimExpiresAt = new Date(Date.now() - 5 * 60_000);
    const { cron, claimHistoryCreate, updateMany } = makeCron({
      candidates: [
        { id: 'mo-1', orderNumber: 'SM-1', claimedByAdminId: 'admin-A', claimedAt, claimExpiresAt },
        { id: 'mo-2', orderNumber: 'SM-2', claimedByAdminId: 'admin-B', claimedAt, claimExpiresAt },
      ],
    });
    const result = await cron.runOnce();
    expect(result.released).toBe(2);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(claimHistoryCreate).toHaveBeenCalledTimes(2);
    expect(claimHistoryCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          releaseReason: 'TTL_EXPIRY',
          releasedByAdminId: null,
          claimedByAdminId: 'admin-A',
        }),
      }),
    );
  });

  it('emits orders.claim.expired event per released claim', async () => {
    const claimedAt = new Date(Date.now() - 20 * 60_000);
    const claimExpiresAt = new Date(Date.now() - 5 * 60_000);
    const { cron, eventBus } = makeCron({
      candidates: [
        { id: 'mo-1', orderNumber: 'SM-1', claimedByAdminId: 'admin-A', claimedAt, claimExpiresAt },
      ],
    });
    await cron.runOnce();
    expect(eventBus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'orders.claim.expired',
        aggregateId: 'mo-1',
        payload: expect.objectContaining({
          masterOrderId: 'mo-1',
          orderNumber: 'SM-1',
          claimedByAdminId: 'admin-A',
        }),
      }),
    );
  });

  it('writes audit log row per released claim', async () => {
    const claimedAt = new Date(Date.now() - 20 * 60_000);
    const claimExpiresAt = new Date(Date.now() - 5 * 60_000);
    const { cron, audit } = makeCron({
      candidates: [
        { id: 'mo-1', orderNumber: 'SM-1', claimedByAdminId: 'admin-A', claimedAt, claimExpiresAt },
      ],
    });
    await cron.runOnce();
    expect(audit.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ORDER_CLAIM_EXPIRED',
        actorRole: 'SYSTEM',
        resourceId: 'mo-1',
        metadata: expect.objectContaining({
          previousAdminId: 'admin-A',
        }),
      }),
    );
  });

  it('skips row when status-conditional update returns count=0 (race lost)', async () => {
    const claimedAt = new Date(Date.now() - 20 * 60_000);
    const claimExpiresAt = new Date(Date.now() - 5 * 60_000);
    const { cron, eventBus } = makeCron({
      candidates: [
        { id: 'mo-1', orderNumber: 'SM-1', claimedByAdminId: 'admin-A', claimedAt, claimExpiresAt },
      ],
      updateCount: 0,
    });
    const result = await cron.runOnce();
    expect(result.released).toBe(0);
    expect(eventBus.publish).not.toHaveBeenCalled();
  });
});
