import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../bootstrap/database/prisma.service';
import {
  RiskScoreCalculator,
  type RiskSignals,
  type RiskScoreOutput,
} from './risk-score.calculator';

/**
 * Phase 6 (PR 6.3) — Risk score persistence layer.
 *
 * Wraps the pure calculator with a Prisma upsert keyed on
 * (resourceType, resourceId). Optimistic-lock style version bump on
 * every recompute so concurrent recomputes (e.g. webhook + cron firing
 * at the same instant) don't lose a write.
 *
 * `getOrZero` is a hot-path helper for the queue API: if no score row
 * exists yet (case never triggered a recompute), return a synthetic
 * LOW score with empty signals rather than 1000 NULLs at render time.
 */
@Injectable()
export class RiskScoreService {
  private readonly logger = new Logger(RiskScoreService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: RiskScoreCalculator,
  ) {}

  /**
   * Compute and persist. Returns the persisted shape so the caller
   * can immediately echo it back (e.g. "case opened with risk MEDIUM").
   */
  async recompute(
    resourceType: 'dispute' | 'return',
    resourceId: string,
    signals: RiskSignals,
  ): Promise<RiskScoreOutput & { resourceId: string }> {
    const out = this.calculator.compute(signals);
    try {
      await this.prisma.riskScore.upsert({
        where: {
          resourceType_resourceId: {
            resourceType,
            resourceId,
          },
        },
        create: {
          resourceType,
          resourceId,
          score: out.score,
          tier: out.tier,
          signals: out.signals as Prisma.InputJsonValue,
        },
        update: {
          score: out.score,
          tier: out.tier,
          signals: out.signals as Prisma.InputJsonValue,
          version: { increment: 1 },
          computedAt: new Date(),
        },
      });
    } catch (err) {
      // The score is informational; a write failure shouldn't fail the
      // higher-level operation (creating a return / dispute).
      this.logger.warn(
        `risk-score upsert failed for ${resourceType} ${resourceId}: ${(err as Error).message}`,
      );
    }
    return { ...out, resourceId };
  }

  async get(
    resourceType: string,
    resourceId: string,
  ): Promise<{ score: number; tier: string } | null> {
    const row = await this.prisma.riskScore.findUnique({
      where: {
        resourceType_resourceId: { resourceType, resourceId },
      },
      select: { score: true, tier: true },
    });
    return row ? { score: row.score, tier: row.tier as string } : null;
  }

  async getOrZero(
    resourceType: string,
    resourceId: string,
  ): Promise<{ score: number; tier: string }> {
    const row = await this.get(resourceType, resourceId);
    return row ?? { score: 0, tier: 'LOW' };
  }

  /**
   * Batch variant of `getOrZero` for the queue API. One `findMany` for the
   * whole page instead of one `findUnique` per row (the queue can carry up
   * to MAX_LIMIT*5 snapshots, so the per-row version was N sequential
   * round-trips). Missing rows default to the synthetic LOW score, same as
   * `getOrZero`. Returned as a Map keyed on resourceId for O(1) lookup.
   */
  async getManyOrZero(
    resourceType: string,
    resourceIds: string[],
  ): Promise<Map<string, { score: number; tier: string }>> {
    const out = new Map<string, { score: number; tier: string }>();
    if (resourceIds.length === 0) return out;
    const rows = await this.prisma.riskScore.findMany({
      where: { resourceType, resourceId: { in: resourceIds } },
      select: { resourceId: true, score: true, tier: true },
    });
    for (const row of rows) {
      out.set(row.resourceId, { score: row.score, tier: row.tier as string });
    }
    return out;
  }
}
