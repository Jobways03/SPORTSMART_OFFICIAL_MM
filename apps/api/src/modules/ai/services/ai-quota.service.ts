import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../bootstrap/database/prisma.service';
import { EnvService } from '../../../bootstrap/env/env.service';
import { ConflictAppException } from '../../../core/exceptions';

/**
 * Phase 7 (2026-05-16) — Per-tenant AI quota enforcement.
 *
 * The existing @Throttle decorator is per-IP and global; that's enough
 * to keep one client from hammering the endpoint, but not enough to
 * stop a single seller from quietly burning the whole org's AI budget
 * over the course of a day. This service adds a per-(subject, day,
 * provider) counter in `ai_usage_quotas` so we can refuse a seller
 * once they hit the configured daily cap regardless of how many IPs
 * they spread the load across.
 *
 * Counters are best-effort: the increment happens AFTER a successful
 * provider call (we don't want failed calls to count against the
 * cap, since the customer didn't get value). The reserve-then-confirm
 * pattern used elsewhere in the codebase is overkill here — a single
 * exceedance per day per tenant is acceptable, and the over-count
 * caps itself at +1.
 */
@Injectable()
export class AiQuotaService {
  private readonly logger = new Logger(AiQuotaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly env: EnvService,
  ) {}

  /**
   * UTC midnight for the supplied date. The (subject, day, provider)
   * unique key requires consistent bucketing — every call site MUST
   * use this helper rather than rounding inline.
   */
  static dayBucket(d: Date = new Date()): Date {
    const utc = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0),
    );
    return utc;
  }

  /**
   * Verify the subject hasn't exceeded today's quota across ALL
   * providers combined. Throws 409 with a clear message when the cap
   * is hit; safe to call before any provider work begins.
   *
   * Returns the current count so the caller can log / surface "X of
   * Y used today" headers if desired.
   */
  async assertWithinQuota(subject: string): Promise<{ used: number; cap: number }> {
    const cap = this.env.getNumber('AI_DAILY_QUOTA_PER_TENANT', 100);
    if (cap <= 0) return { used: 0, cap }; // 0/negative disables enforcement.

    const day = AiQuotaService.dayBucket();
    const rows = await this.prisma.aiUsageQuota.findMany({
      where: { subject, day },
      select: { callCount: true },
    });
    const used = rows.reduce((acc, r) => acc + r.callCount, 0);

    if (used >= cap) {
      throw new ConflictAppException(
        `AI daily quota of ${cap} requests reached for this account. Try again after UTC midnight.`,
      );
    }
    return { used, cap };
  }

  /**
   * Record one successful AI call against (subject, day, provider).
   * Best-effort — DB outages are logged and swallowed so an audit
   * failure can't break a customer-facing AI response that already
   * completed successfully.
   */
  async recordCall(
    subject: string,
    subjectType: string | null,
    provider: string,
  ): Promise<void> {
    const day = AiQuotaService.dayBucket();
    try {
      await this.prisma.aiUsageQuota.upsert({
        where: {
          ai_usage_quota_unique: { subject, day, provider },
        },
        create: {
          subject,
          subjectType,
          provider,
          day,
          callCount: 1,
        },
        update: {
          callCount: { increment: 1 },
          subjectType: subjectType ?? undefined,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record AI quota for subject=${subject} provider=${provider}: ${(err as Error).message}`,
      );
    }
  }
}
