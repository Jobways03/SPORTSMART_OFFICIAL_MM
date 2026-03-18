import { Injectable } from '@nestjs/common';

@Injectable()
export class SettlementsPublicFacade {
  async recordLedgerImpact(ledgerEntry: unknown): Promise<void> {
    throw new Error('Not implemented');
  }

  async previewSettlement(sellerId: string, periodStart: Date, periodEnd: Date): Promise<unknown> {
    throw new Error('Not implemented');
  }

  async approveSettlementRun(runId: string): Promise<void> {
    throw new Error('Not implemented');
  }

  async getPayoutStatement(statementId: string): Promise<unknown> {
    throw new Error('Not implemented');
  }

  async getSellerLedger(sellerId: string): Promise<unknown[]> {
    throw new Error('Not implemented');
  }

  async getFranchiseLedger(franchiseId: string): Promise<unknown[]> {
    throw new Error('Not implemented');
  }

  async getAffiliateLedger(affiliateId: string): Promise<unknown[]> {
    throw new Error('Not implemented');
  }
}
