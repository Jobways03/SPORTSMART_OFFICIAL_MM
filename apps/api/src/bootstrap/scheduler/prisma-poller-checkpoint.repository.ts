import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PollerCheckpointRepository } from './poller-checkpoint.repository';

/**
 * Phase 1 (PR 1.11) — Prisma-backed poller checkpoint store.
 *
 * Thin wrapper over `prisma.integrationPollerCheckpoint`. Two design
 * choices to call out:
 *
 *   1. `get` returns `null` (not `undefined`) when missing, so callers
 *      can do `const at = await repo.get(key); if (at == null) ...`
 *      without juggling two falsey shapes.
 *
 *   2. `set` upserts unconditionally — the poller calls it on every
 *      successful run and doesn't care whether a row was previously
 *      seeded. This eliminates a class of "first run after deploy"
 *      branching in the caller.
 */
@Injectable()
export class PrismaPollerCheckpointRepository implements PollerCheckpointRepository {
  constructor(private readonly prisma: PrismaService) {}

  async get(pollerKey: string): Promise<Date | null> {
    const row = await this.prisma.integrationPollerCheckpoint.findUnique({
      where: { pollerKey },
      select: { lastPolledAt: true },
    });
    return row?.lastPolledAt ?? null;
  }

  async set(pollerKey: string, lastPolledAt: Date): Promise<void> {
    await this.prisma.integrationPollerCheckpoint.upsert({
      where: { pollerKey },
      create: { pollerKey, lastPolledAt },
      update: { lastPolledAt },
    });
  }
}
