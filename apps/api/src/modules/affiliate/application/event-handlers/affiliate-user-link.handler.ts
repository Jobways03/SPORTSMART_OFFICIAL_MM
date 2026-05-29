import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';

/**
 * Phase 22 (2026-05-20) — Affiliate ↔ User auto-link.
 *
 * The Affiliate schema's `userId` is optional and intended to bind a
 * registered customer to an existing affiliate application with the
 * same email. Pre-Phase-22 NO code path performed that bind, so the
 * link sat dormant — a person who applied as an affiliate and later
 * signed up as a customer ended up with two disconnected accounts.
 *
 * This handler listens for `identity.user.email_verified` (the moment
 * the User row flips to ACTIVE) and, if there is an existing Affiliate
 * with the same email and no userId yet, stamps the link. We
 * deliberately wait until email verification so a typo-applicant
 * can't have their affiliate row hijacked by someone else who
 * registered the same email without proving it. Both columns are
 * @unique, so a race produces a P2002 — caught and logged.
 */
@Injectable()
export class AffiliateUserLinkHandler {
  private readonly logger = new Logger(AffiliateUserLinkHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent('identity.user.email_verified')
  async onUserEmailVerified(
    event: DomainEvent<{ userId: string; email?: string }>,
  ) {
    const userId = event.payload.userId;
    if (!userId) return;

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true },
      });
      if (!user) return;

      const affiliate = await this.prisma.affiliate.findUnique({
        where: { email: user.email.toLowerCase() },
        select: { id: true, userId: true },
      });
      if (!affiliate || affiliate.userId) return;

      await this.prisma.affiliate.update({
        where: { id: affiliate.id },
        data: { userId: user.id },
      });
      this.logger.log(
        `Linked affiliate ${affiliate.id} ↔ user ${user.id} (email match on verification).`,
      );
    } catch (err: any) {
      if (err?.code === 'P2002') {
        // Race: another affiliate row had this userId stamped between
        // our findUnique and update. Safe to ignore — the link
        // already exists somewhere.
        this.logger.warn(
          `Affiliate ↔ user link skipped due to P2002 race for user ${userId}.`,
        );
        return;
      }
      this.logger.error(
        `Affiliate ↔ user link failed for user ${userId}: ${(err as Error)?.message ?? err}`,
      );
    }
  }
}
