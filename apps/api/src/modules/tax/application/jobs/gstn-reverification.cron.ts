// Phase 200 (Customer Tax Profile audit #14) — periodic GSTN re-verification.
//
// A GSTIN verified once is NOT verified forever: a taxpayer can be suspended or
// have their registration cancelled by the department weeks later. A B2B
// invoice issued against a now-CANCELLED GSTIN breaks the buyer's ITC claim and
// can implicate the platform. CBIC has no push feed for this, so the only
// option is to re-poll the portal on a cadence.
//
// This weekly, leader-elected sweep re-checks customer tax profiles whose last
// successful verification is older than GSTN_REVERIFY_STALE_DAYS (default 90),
// plus any profile currently flagged SUSPENDED/CANCELLED (so a reinstated GSTIN
// flips back to ACTIVE). It routes through GstnVerificationService, which writes
// the verification event + audit + flips isVerified/gstnPortalStatus and emits
// the mismatch/failed events the notification + KYC dashboards already consume.
//
// HONEST-CALL (bounded skeleton): in dev/staging the GstnProvider is the stub
// (derives the result from the local Mod-36 checksum), so this re-check is real
// machinery but a no-op signal until the live GSTN sandbox adapter is wired —
// at which point the SAME cron starts doing a true portal re-poll with zero
// code change. The production boot guard (tax/module.ts) already refuses to
// start with GSTN_PROVIDER=stub, so this can never silently "re-verify" against
// a checksum in prod. The cron is gated OFF by default
// (GSTN_REVERIFY_CRON_ENABLED) so it does not consume a provider quota until an
// operator opts in.

import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { LeaderElectedCron } from '../../../../bootstrap/scheduler/leader-elected-cron';
import { GstnVerificationService } from '../services/gstn-verification.service';

@Injectable()
export class GstnReVerificationCron {
  private readonly logger = new Logger(GstnReVerificationCron.name);
  private static readonly BATCH = 50;
  private static readonly DEFAULT_STALE_DAYS = 90;

  constructor(
    private readonly prisma: PrismaService,
    private readonly leader: LeaderElectedCron,
    private readonly verification: GstnVerificationService,
  ) {}

  @Cron(CronExpression.EVERY_WEEK)
  async sweep(): Promise<void> {
    // Default-OFF: opt in once the live provider is wired (avoids burning the
    // GSTN quota on the stub, and avoids re-poll load nobody asked for).
    // Read from process.env directly (these two keys are also documented for
    // addition to env.schema.ts — see this phase's notes).
    if ((process.env.GSTN_REVERIFY_CRON_ENABLED ?? 'false') !== 'true') {
      return;
    }
    await this.leader.run('gstn-customer-reverification', 3600, async () => {
      const parsedStale = Number(process.env.GSTN_REVERIFY_STALE_DAYS);
      const staleDays =
        Number.isFinite(parsedStale) && parsedStale > 0
          ? parsedStale
          : GstnReVerificationCron.DEFAULT_STALE_DAYS;
      const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);

      // Profiles overdue for a re-check: never-verified-but-once-checked is left
      // alone (create already kicked off verification); we target rows that WERE
      // verified but whose check is stale, OR rows whose portal status is a
      // non-terminal problem state that could have recovered.
      const due = await this.prisma.customerTaxProfile.findMany({
        where: {
          OR: [
            { isVerified: true, verifiedAt: { lt: cutoff } },
            { gstnPortalStatus: { in: ['SUSPENDED', 'CANCELLED', 'INACTIVE'] } },
          ],
        },
        select: { id: true },
        orderBy: { lastCheckedAt: 'asc' },
        take: GstnReVerificationCron.BATCH,
      });

      let rechecked = 0;
      let flipped = 0;
      for (const p of due) {
        try {
          const res = await this.verification.verifyCustomerTaxProfile({
            profileId: p.id,
            actorId: 'system-gstn-reverification',
            force: true,
          });
          rechecked++;
          if (!res.verified) flipped++;
        } catch (err) {
          this.logger.error(
            `GSTN re-verification failed for profile ${p.id}: ${(err as Error).message}`,
          );
        }
      }

      if (rechecked > 0) {
        this.logger.log(
          `GSTN re-verification sweep: re-checked ${rechecked} customer profile(s) ` +
            `(stale > ${staleDays}d or non-ACTIVE); ${flipped} now NOT verified.`,
        );
      }
    });
  }
}
