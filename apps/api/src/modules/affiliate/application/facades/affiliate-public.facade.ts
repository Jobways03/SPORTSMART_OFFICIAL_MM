import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';

@Injectable()
export class AffiliatePublicFacade {
  private readonly logger = new Logger(AffiliatePublicFacade.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve affiliate attribution from a session context (e.g. referral code in URL).
   * Returns the affiliate record if attribution is found, null otherwise.
   *
   * Note: Referral/AffiliateCommission tables not yet in schema — this is a
   * placeholder that will be wired up once the Prisma models are added.
   */
  async resolveAttribution(sessionContext: {
    referralCode?: string;
    utmSource?: string;
    utmMedium?: string;
  }): Promise<{
    affiliateId: string;
    referralId: string;
    code: string;
  } | null> {
    if (!sessionContext.referralCode) return null;

    // Placeholder — Referral model not yet in schema
    this.logger.warn('Affiliate attribution lookup not yet available (no Referral model)');
    return null;
  }

  /**
   * Record a referral event (e.g. a click, signup, or order placed via affiliate link).
   */
  async recordReferralEvent(referralData: {
    affiliateId: string;
    referralId: string;
    eventType: string;
    orderId?: string;
    customerId?: string;
  }): Promise<void> {
    this.logger.log(
      `Referral event: ${referralData.eventType} for affiliate ${referralData.affiliateId}`,
    );
  }

  /**
   * Compute the commission basis for an affiliate on a given order.
   */
  async computeCommissionBasis(orderId: string): Promise<{
    orderId: string;
    orderTotal: number;
    commissionRate: number;
    commissionAmount: number;
  } | null> {
    const order = await this.prisma.masterOrder.findUnique({
      where: { id: orderId },
      select: { id: true, totalAmount: true },
    });

    if (!order) return null;

    // Default affiliate commission rate (configurable in future)
    const commissionRate = 0.05; // 5%
    const commissionAmount = Number(order.totalAmount) * commissionRate;

    return {
      orderId: order.id,
      orderTotal: Number(order.totalAmount),
      commissionRate,
      commissionAmount,
    };
  }

  /**
   * Reverse affiliate commission eligibility (e.g. on order cancellation or return).
   * Placeholder — will be implemented when AffiliateCommission model is added.
   */
  async reverseCommissionEligibility(
    orderId: string,
    reason: string,
  ): Promise<void> {
    this.logger.log(
      `Affiliate commission reversal requested for order ${orderId}. Reason: ${reason}`,
    );
  }
}
