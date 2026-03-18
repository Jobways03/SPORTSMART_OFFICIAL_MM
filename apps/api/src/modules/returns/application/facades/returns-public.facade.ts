import { Injectable } from '@nestjs/common';

@Injectable()
export class ReturnsPublicFacade {
  async createReturnRequest(returnData: unknown): Promise<unknown> {
    throw new Error('Not implemented');
  }

  async evaluateReturnEligibility(orderLineId: string): Promise<{ eligible: boolean; reasons: string[] }> {
    throw new Error('Not implemented');
  }

  async updateQcResult(returnId: string, qcData: unknown): Promise<void> {
    throw new Error('Not implemented');
  }

  async approveReturn(returnId: string): Promise<void> {
    throw new Error('Not implemented');
  }

  async rejectReturn(returnId: string, reason: string): Promise<void> {
    throw new Error('Not implemented');
  }

  async getReturnState(returnId: string): Promise<unknown> {
    throw new Error('Not implemented');
  }

  async requestRefundOrAdjustment(returnId: string): Promise<void> {
    throw new Error('Not implemented');
  }
}
