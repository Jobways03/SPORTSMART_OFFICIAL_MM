import { Module } from '@nestjs/common';
import { AdminAuthGuard, SellerAuthGuard, FranchiseAuthGuard, FranchiseActiveGuard } from '../../core/guards';
import { MoneyModule } from '../../core/money/money.module';
// Phase 146 — batch mark-paid delegates to the hardened single-settlement path.
import { SettlementsModule } from '../settlements/module';
// Phase 175 (Accounts Overview audit #13) — audit-log every dashboard read.
import { AuditModule } from '../audit/module';

// Repository
import { ACCOUNTS_REPOSITORY } from './domain/repositories/accounts.repository.interface';
import { PrismaAccountsRepository } from './infrastructure/repositories/prisma-accounts.repository';

// Services
import { AccountsDashboardService } from './application/services/accounts-dashboard.service';
import { AccountsSettlementService } from './application/services/accounts-settlement.service';
import { AccountsReportsService } from './application/services/accounts-reports.service';
import { SettlementCycleProcessorService } from './application/services/settlement-cycle-processor.service';
import { DoubleEntryValidatorService } from './application/services/double-entry-validator.service';
// Phase 178 (Outstanding Payables audit #11) — §194-O TDS payout holdback cron.
import { TdsPayoutHoldbackService } from './application/services/tds-payout-holdback.service';

// Facade
import { AccountsPublicFacade } from './application/facades/accounts-public.facade';

// Controllers
import { AccountsDashboardController } from './presentation/controllers/accounts-dashboard.controller';
import { AccountsSettlementsController } from './presentation/controllers/accounts-settlements.controller';
import { AccountsReportsController } from './presentation/controllers/accounts-reports.controller';
// Phase 176 (Per-Seller Accounts audit #4) — seller self-view of own finances.
import { SellerAccountsController } from './presentation/controllers/seller-accounts.controller';
// Phase 177 (Per-Franchise Accounts audit #4) — franchise self-view of own finances.
import { FranchiseAccountsController } from './presentation/controllers/franchise-accounts.controller';

@Module({
  imports: [MoneyModule, SettlementsModule, AuditModule],
  controllers: [
    AccountsDashboardController,
    AccountsSettlementsController,
    AccountsReportsController,
    SellerAccountsController,
    FranchiseAccountsController,
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
    DoubleEntryValidatorService,
    TdsPayoutHoldbackService,
    AccountsPublicFacade,
    AdminAuthGuard,
    SellerAuthGuard,
    FranchiseAuthGuard,
    FranchiseActiveGuard,
  ],
  exports: [AccountsPublicFacade],
})
export class AccountsModule {}
