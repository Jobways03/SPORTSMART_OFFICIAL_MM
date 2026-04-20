import { Injectable, Inject } from '@nestjs/common';
import {
  AccountsRepository,
  ACCOUNTS_REPOSITORY,
} from '../../domain/repositories/accounts.repository.interface';

@Injectable()
export class AccountsDashboardService {
  constructor(
    @Inject(ACCOUNTS_REPOSITORY)
    private readonly accountsRepo: AccountsRepository,
  ) {}

  async getPlatformOverview(fromDate?: Date, toDate?: Date) {
    return this.accountsRepo.getPlatformFinanceSummary({
      fromDate,
      toDate,
    });
  }

  async getSellerOverview(fromDate?: Date, toDate?: Date) {
    return this.accountsRepo.getSellerFinanceSummary({
      fromDate,
      toDate,
    });
  }

  async getFranchiseOverview(fromDate?: Date, toDate?: Date) {
    return this.accountsRepo.getFranchiseFinanceSummary({
      fromDate,
      toDate,
    });
  }

  async getOutstandingPayables() {
    return this.accountsRepo.getOutstandingPayables();
  }

  async getTopPerformers(
    limit: number,
    fromDate?: Date,
    toDate?: Date,
  ) {
    const [topSellers, topFranchises] = await Promise.all([
      this.accountsRepo.getTopSellers(limit, fromDate, toDate),
      this.accountsRepo.getTopFranchises(limit, fromDate, toDate),
    ]);

    return { topSellers, topFranchises };
  }
}
