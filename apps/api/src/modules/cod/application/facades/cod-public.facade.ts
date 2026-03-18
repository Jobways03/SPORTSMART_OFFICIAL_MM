import { Injectable } from '@nestjs/common';

@Injectable()
export class CodPublicFacade {
  async evaluateCodEligibility(params: {
    customerId: string;
    sellerId: string;
    orderValue: number;
    pincode: string;
  }): Promise<{ allowed: boolean; reasons: string[] }> {
    throw new Error('Not implemented');
  }

  async logCodDecision(decisionData: unknown): Promise<void> {
    throw new Error('Not implemented');
  }

  async getReasonCodes(): Promise<unknown[]> {
    throw new Error('Not implemented');
  }
}
