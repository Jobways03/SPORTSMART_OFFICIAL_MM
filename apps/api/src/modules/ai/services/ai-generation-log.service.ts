import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../bootstrap/database/prisma.service';

/**
 * Phase 249 (#3) — per-generation log lifecycle. All writes are best-effort:
 * an AI generation must never fail because the log write failed. The product
 * save path (catalog module) flips a log GENERATED → ACCEPTED and stamps the
 * product's AI provenance; an explicit FE ping can flip it → DISCARDED.
 */
@Injectable()
export class AiGenerationLogService {
  private readonly logger = new Logger(AiGenerationLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordGenerated(args: {
    subject: string;
    subjectType?: string | null;
    titleHint?: string | null;
    categoryHint?: string | null;
    brandHint?: string | null;
    promptVersion: string;
    provider?: string | null;
    model?: string | null;
    generatedJson?: unknown;
    durationMs?: number | null;
  }): Promise<string | null> {
    try {
      const row = await this.prisma.aiGenerationLog.create({
        data: {
          subject: args.subject,
          subjectType: args.subjectType ?? null,
          titleHint: args.titleHint ?? null,
          categoryHint: args.categoryHint ?? null,
          brandHint: args.brandHint ?? null,
          promptVersion: args.promptVersion,
          provider: args.provider ?? null,
          model: args.model ?? null,
          generatedJson: (args.generatedJson ?? null) as any,
          status: 'GENERATED',
          durationMs: args.durationMs ?? null,
        },
      });
      return row.id;
    } catch (e) {
      this.logger.warn(`AiGenerationLog write failed: ${(e as Error).message}`);
      return null;
    }
  }

  async recordFailed(args: {
    subject: string;
    subjectType?: string | null;
    titleHint?: string | null;
    promptVersion: string;
    provider?: string | null;
    errorMessage: string;
    durationMs?: number | null;
  }): Promise<void> {
    try {
      await this.prisma.aiGenerationLog.create({
        data: {
          subject: args.subject,
          subjectType: args.subjectType ?? null,
          titleHint: args.titleHint ?? null,
          promptVersion: args.promptVersion,
          provider: args.provider ?? null,
          status: 'FAILED',
          errorMessage: args.errorMessage.slice(0, 1000),
          durationMs: args.durationMs ?? null,
        },
      });
    } catch (e) {
      this.logger.warn(`AiGenerationLog FAILED write failed: ${(e as Error).message}`);
    }
  }

  /**
   * FE outcome ping after the seller decides. CAS on (id, subject, status=
   * GENERATED): only the actor who generated it can resolve it, and only
   * from the open state (so a later product-save ACCEPTED isn't clobbered).
   */
  async markOutcome(
    logId: string,
    subject: string,
    status: 'ACCEPTED' | 'DISCARDED',
    productId?: string | null,
  ): Promise<boolean> {
    const res = await this.prisma.aiGenerationLog.updateMany({
      where: { id: logId, subject, status: 'GENERATED' },
      data: {
        status,
        productId: productId ?? null,
        acceptedAt: status === 'ACCEPTED' ? new Date() : null,
      },
    });
    return res.count > 0;
  }
}
