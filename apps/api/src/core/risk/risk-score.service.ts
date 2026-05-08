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
}
