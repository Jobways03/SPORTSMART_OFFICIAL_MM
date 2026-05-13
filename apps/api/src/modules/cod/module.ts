import { Global, Module } from '@nestjs/common';
import {
  AdminAuthGuard,
  AffiliateAuthGuard,
  AnyAuthGuard,
  FranchiseAuthGuard,
  SellerAuthGuard,
  UserAuthGuard,
} from '../../core/guards';
import { CodPublicFacade } from './application/facades/cod-public.facade';
import { CodRuleEngine } from './application/services/cod-rule-engine.service';
import {
  AdminCodRulesController,
  CodEvaluateController,
} from './presentation/controllers/cod.controller';
import { MoneyModule } from '../../core/money/money.module';

@Global()
@Module({
  imports: [MoneyModule],
  controllers: [AdminCodRulesController, CodEvaluateController],
  providers: [
    AdminAuthGuard,
    UserAuthGuard,
    SellerAuthGuard,
    FranchiseAuthGuard,
    AffiliateAuthGuard,
    AnyAuthGuard,
    CodPublicFacade,
    CodRuleEngine,
  ],
  exports: [CodPublicFacade, CodRuleEngine],
})
export class CodModule {}
