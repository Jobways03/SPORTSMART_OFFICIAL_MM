import { Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/guards';

// Repository
import { ACCOUNTS_REPOSITORY } from './domain/repositories/accounts.repository.interface';
import { PrismaAccountsRepository } from './infrastructure/repositories/prisma-accounts.repository';

// Services
import { AccountsDashboardService } from './application/services/accounts-dashboard.service';
import { AccountsSettlementService } from './application/services/accounts-settlement.service';
import { AccountsReportsService } from './application/services/accounts-reports.service';
import { SettlementCycleProcessorService } from './application/services/settlement-cycle-processor.service';

// Facade
import { AccountsPublicFacade } from './application/facades/accounts-public.facade';

// Controllers
import { AccountsDashboardController } from './presentation/controllers/accounts-dashboard.controller';
import { AccountsSettlementsController } from './presentation/controllers/accounts-settlements.controller';
import { AccountsReportsController } from './presentation/controllers/accounts-reports.controller';

@Module({
  controllers: [
    AccountsDashboardController,
    AccountsSettlementsController,
    AccountsReportsController,
  ],
  providers: [
    {
      provide: ACCOUNTS_REPOSITORY,
      useClass: PrismaAccountsRepository,
    },
    AccountsDashboardService,
    AccountsSettlementService,
    AccountsReportsService,
    SettlementCycleProcessorService,
    AccountsPublicFacade,
    AdminAuthGuard,
  ],
  exports: [AccountsPublicFacade],
})
export class AccountsModule {}
