import { Injectable } from '@nestjs/common';
import { AccountsDashboardService } from '../services/accounts-dashboard.service';

@Injectable()
export class AccountsPublicFacade {
  constructor(
    private readonly dashboardService: AccountsDashboardService,
  ) {}

  async getPlatformOverview(fromDate?: Date, toDate?: Date) {
    return this.dashboardService.getPlatformOverview(fromDate, toDate);
  }

  async getOutstandingPayables() {
    return this.dashboardService.getOutstandingPayables();
  }
}
