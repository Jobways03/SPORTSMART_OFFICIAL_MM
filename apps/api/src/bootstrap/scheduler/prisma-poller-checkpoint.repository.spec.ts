import 'reflect-metadata';
import { PrismaPollerCheckpointRepository } from './prisma-poller-checkpoint.repository';

/**
 * Phase 1 (PR 1.11) — poller checkpoint persistence.
 *
 * The repository is a thin port over the
 * `integration_poller_checkpoints` table. Three guarantees under test:
 *
 *   - `get(key)` returns the persisted Date or null (not undefined,
 *     not a row object).
 *   - `set(key, at)` upserts so a poller can call it on every
 *     successful run without caring whether a prior row exists.
 *   - the repo uses the table's primary-key on `pollerKey` so
 *     multiple pollers (Shiprocket, Razorpay status, etc.) live as
 *     parallel rows.
 */

function buildPrisma(opts: {
  findUniqueReturn?: { lastPolledAt: Date } | null;
} = {}) {
  return {
    integrationPollerCheckpoint: {
      findUnique: jest.fn().mockResolvedValue(opts.findUniqueReturn ?? null),
      upsert: jest.fn().mockResolvedValue(undefined),
    },
  } as any;
}

describe('PrismaPollerCheckpointRepository (PR 1.11)', () => {
  it('get(): returns the persisted Date when a checkpoint exists', async () => {
    const stored = new Date('2026-05-12T09:00:00Z');
    const prisma = buildPrisma({ findUniqueReturn: { lastPolledAt: stored } });
    const repo = new PrismaPollerCheckpointRepository(prisma);

    const result = await repo.get('shiprocket-tracking');
    expect(result).toEqual(stored);
    expect(prisma.integrationPollerCheckpoint.findUnique).toHaveBeenCalledWith({
      where: { pollerKey: 'shiprocket-tracking' },
      select: { lastPolledAt: true },
    });
  });

  it('get(): returns null (not undefined) when no checkpoint exists', async () => {
    const prisma = buildPrisma({ findUniqueReturn: null });
    const repo = new PrismaPollerCheckpointRepository(prisma);

    const result = await repo.get('shiprocket-tracking');
    expect(result).toBeNull();
  });

  it('set(): upserts so a poller can call it on every run regardless of prior state', async () => {
    const prisma = buildPrisma();
    const repo = new PrismaPollerCheckpointRepository(prisma);

    const at = new Date('2026-05-12T10:00:00Z');
    await repo.set('shiprocket-tracking', at);

    expect(prisma.integrationPollerCheckpoint.upsert).toHaveBeenCalledWith({
      where: { pollerKey: 'shiprocket-tracking' },
      create: { pollerKey: 'shiprocket-tracking', lastPolledAt: at },
      update: { lastPolledAt: at },
    });
  });
});
