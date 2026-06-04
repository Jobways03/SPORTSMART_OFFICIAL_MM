import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '../../../../bootstrap/events/domain-event.interface';
import { IdempotentHandler } from '../../../../bootstrap/events/outbox/idempotent-handler.decorator';
import { EventDeduplicationService } from '../../../../bootstrap/events/outbox/event-deduplication.service';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { NotificationsPublicFacade } from '../facades/notifications-public.facade';
import { safeHtml, rawHtml } from '../../../../core/util/escape-html';

/**
 * Payload published by AffiliateRegistrationService on
 * `affiliate.coupon_created`. The `code` is the most important field —
 * the affiliate needs it to start sharing. `couponSource` distinguishes
 * the approval-time primary code from an admin-added campaign code.
 */
interface CouponCreatedPayload {
  affiliateId: string;
  couponId: string;
  code: string;
  isPrimary: boolean;
  couponSource: string;
}

/**
 * Finding #15 — the affiliate was never told their coupon code existed.
 * `affiliate.coupon_created` carried the generated code but had ZERO
 * @OnEvent consumers, so a freshly-minted code sat in the DB with the
 * affiliate none the wiser.
 *
 * This handler emails the affiliate their code. Best-effort: any failure
 * (unknown affiliate, no email on file, queue hiccup) is logged and
 * swallowed so it never breaks the publisher's transaction — exactly how
 * the dispute/wallet handlers guard.
 *
 * Send path: the raw `notify()` surface (not `notifyFromTemplate`) because
 * there is no `affiliate.coupon_created` template key in the registry and
 * this fix is not allowed to invent template infrastructure. The recipient
 * is resolved by id — RecipientResolverService already maps an Affiliate id
 * to its email — so we pass `affiliateId` as `recipientId`. Marked
 * `transactional: true`: this is an account-setup message about the
 * affiliate's own code (comparable to refund-credited), so it should not be
 * silently dropped by a marketing opt-out (the suppression list + WhatsApp
 * STOP still hard-block).
 */
@Injectable()
export class AffiliateCouponNotificationHandler {
  private readonly logger = new Logger(AffiliateCouponNotificationHandler.name);

  constructor(
    private readonly notifications: NotificationsPublicFacade,
    private readonly prisma: PrismaService,
    // Phase 2 / M21-M32 — outbox-replay dedup. Exposed (not private) so the
    // @IdempotentHandler decorator can read it off `this`.
    protected readonly eventDedup: EventDeduplicationService,
  ) {}

  @OnEvent('affiliate.coupon_created')
  @IdempotentHandler()
  async onCouponCreated(event: DomainEvent<CouponCreatedPayload>) {
    const { affiliateId, code } = event.payload;
    try {
      // Confirm the affiliate exists + has a destination before we enqueue.
      // The worker re-resolves the address at send time; this is a cheap
      // early-out + a clearer log line when there's nothing to send to.
      const affiliate = await this.prisma.affiliate.findUnique({
        where: { id: affiliateId },
        select: { email: true, firstName: true, lastName: true },
      });
      if (!affiliate) {
        this.logger.warn(
          `affiliate.coupon_created for unknown affiliate ${affiliateId} — skipping notification`,
        );
        return;
      }
      if (!affiliate.email) {
        this.logger.warn(
          `affiliate.coupon_created: affiliate ${affiliateId} has no email on file — skipping notification`,
        );
        return;
      }

      const greetingName =
        `${affiliate.firstName} ${affiliate.lastName}`.trim() || 'there';

      // Optional CTA fragment. Built with its own safeHtml call (escapes the
      // URL), then spliced into the outer template via rawHtml so the outer
      // call does NOT double-escape this already-trusted fragment.
      const storefrontUrl = process.env.STOREFRONT_URL;
      const ctaFragment = storefrontUrl
        ? safeHtml`<p>Start sharing from your <a href="${storefrontUrl}">Sportsmart</a> link.</p>`
        : '';

      // The code is platform/admin-controlled (validated, uppercased), but
      // routing it through safeHtml keeps the auto-escape habit uniform and
      // costs nothing.
      await this.notifications.notify({
        channel: 'EMAIL',
        recipientId: affiliateId,
        subject: 'Your Sportsmart affiliate coupon code is ready',
        body: safeHtml`<p>Hi ${greetingName},</p><p>Your affiliate coupon code is now active:</p><p style="font-size:18px;font-weight:700;letter-spacing:1px">${code}</p><p>Share this code with your audience — every qualifying order that uses it earns you commission.</p>${rawHtml(
          ctaFragment,
        )}`,
        eventType: 'affiliate.coupon_created',
        eventId: event.payload.couponId,
        // Account-setup message about the affiliate's own code; bypass
        // marketing opt-out (suppression list + STOP still hard-block).
        transactional: true,
      });
    } catch (err) {
      this.logger.error(
        `Failed to send affiliate.coupon_created notification for affiliate ${affiliateId}: ${(err as Error).message}`,
      );
    }
  }
}
