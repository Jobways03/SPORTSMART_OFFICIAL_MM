// Phase 161 (TDS §194-O exempt seller flow audit B1) — exemption revalidation.
//
// CBIC's §194-O sub-threshold exemption is conditional on the seller's
// projected annual gross staying below ₹5L AND PAN/Aadhaar furnished — it is
// NOT permanent and must be revalidated. Pre-Phase-161 an exemption was a
// forever-true flag. This daily sweep enforces the lifecycle:
//
//   • EXPIRED windows (effectiveTo in the past): auto-revoke via the
//     exemption service (writes history + audit + event) and raise an
//     AdminTask so finance knows TDS deduction has re-armed.
//   • STALE open-ended exemptions (no effectiveTo, attested > 365 days ago):
//     do NOT auto-revoke (avoid a surprise deduction); raise an AdminTask
//     EXEMPTION_REVALIDATION_REQUIRED so an admin re-attests or sets a window.

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { Tds194OExemptionService } from '../services/tds-194o-exemption.service';

@Injectable()
export class Tds194ORevalidationCron {
  private readonly logger = new Logger(Tds194ORevalidationCron.name);
  private static readonly BATCH = 100;
  private static readonly STALE_DAYS = 365;

  constructor(
    private readonly prisma: PrismaService,
    private readonly leader: LeaderElectedCron,
    private readonly exemption: Tds194OExemptionService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async sweep(): Promise<void> {
    await this.leader.run('tds-194o-revalidation', 3600, async () => {
      const now = new Date();

      // 1. Expired windows → auto-revoke.
      const expired = await this.prisma.seller.findMany({
        where: {
          is194OExempt: true,
          exempt194OEffectiveTo: { not: null, lt: now },
        },
        select: { id: true },
        take: Tds194ORevalidationCron.BATCH,
      });
      let revoked = 0;
      for (const s of expired) {
        try {
          await this.exemption.revoke({
            sellerId: s.id,
            reason: 'Exemption window expired — auto-revoked; annual revalidation required.',
            actorId: 'system-194o-revalidation',
          });
          await this.raiseTask(s.id, 'expired');
          revoked++;
        } catch (err) {
          this.logger.error(
            `194-O auto-revoke failed for seller ${s.id}: ${(err as Error).message}`,
          );
        }
      }

      // 2. Stale open-ended exemptions → flag for revalidation (no auto-revoke).
      const staleCutoff = new Date(
        now.getTime() - Tds194ORevalidationCron.STALE_DAYS * 24 * 60 * 60 * 1000,
      );
      const stale = await this.prisma.seller.findMany({
        where: {
          is194OExempt: true,
          exempt194OEffectiveTo: null,
          exempt194OAttestedAt: { lt: staleCutoff },
        },
        select: { id: true },
        take: Tds194ORevalidationCron.BATCH,
      });
      for (const s of stale) {
        await this.raiseTask(s.id, 'stale');
      }

      if (revoked > 0 || stale.length > 0) {
        this.logger.log(
          `194-O revalidation sweep: ${revoked} expired exemption(s) auto-revoked, ` +
            `${stale.length} stale open-ended exemption(s) flagged for review.`,
        );
      }
    });
  }

  private async raiseTask(sellerId: string, kind: 'expired' | 'stale'): Promise<void> {
    try {
      await (this.prisma as any).adminTask.upsert({
        where: { uniqueKey: `tds194o-revalidation:${sellerId}` },
        update: {},
        create: {
          kind: 'EXEMPTION_REVALIDATION_REQUIRED',
          uniqueKey: `tds194o-revalidation:${sellerId}`,
          severity: 'MEDIUM',
          status: 'OPEN',
          title:
            kind === 'expired'
              ? `§194-O exemption expired + auto-revoked (seller ${sellerId})`
              : `§194-O exemption needs annual revalidation (seller ${sellerId})`,
          details:
            kind === 'expired'
              ? 'The effective window passed; TDS deduction has re-armed. Re-attest if still eligible.'
              : 'Open-ended exemption attested > 365 days ago. Confirm the seller still qualifies (projected gross < ₹5L) or revoke.',
          relatedResource: 'seller',
          relatedResourceId: sellerId,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to raise revalidation AdminTask for seller ${sellerId}: ${(err as Error).message}`,
      );
    }
  }
}
