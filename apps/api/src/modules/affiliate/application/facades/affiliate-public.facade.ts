import { Injectable } from '@nestjs/common';

@Injectable()
export class AffiliatePublicFacade {
  async resolveAttribution(sessionContext: unknown): Promise<unknown> {
    throw new Error('Not implemented');
  }

  async recordReferralEvent(referralData: unknown): Promise<void> {
    throw new Error('Not implemented');
  }

  async computeCommissionBasis(orderId: string): Promise<unknown> {
    throw new Error('Not implemented');
  }

  async reverseCommissionEligibility(orderId: string, reason: string): Promise<void> {
    throw new Error('Not implemented');
  }
}
