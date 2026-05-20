import { Module, forwardRef } from '@nestjs/common';
import { AdminDiscountsController } from './presentation/controllers/admin-discounts.controller';
import { CustomerDiscountsController } from './presentation/controllers/customer-discounts.controller';
import { DiscountsService } from './application/services/discounts.service';
import { DiscountReservationService } from './application/services/discount-reservation.service';
import { DiscountAllocationService } from './application/services/discount-allocation.service';
import { DiscountAnalyticsService } from './application/services/discount-analytics.service';
import { DiscountStackingService } from './application/services/discount-stacking.service';
import { DiscountFraudService } from './application/services/discount-fraud.service';
import { DiscountEventsService } from './application/services/discount-events.service';
import { DiscountEligibilityService } from './application/services/discount-eligibility.service';
import { DiscountAffiliateUnificationService } from './application/services/discount-affiliate-unification.service';
import { DiscountPublicFacade } from './application/facades/discount-public.facade';
import { ReleaseExpiredRedemptionsCron } from './application/crons/release-expired-redemptions.cron';
import { CouponAttemptsCleanupCron } from './application/crons/coupon-attempts-cleanup.cron';
import { PrismaDiscountRepository } from './infrastructure/repositories/prisma-discount.repository';
import { DISCOUNT_REPOSITORY } from './domain/repositories/discount.repository.interface';
import { AdminAuthGuard, UserAuthGuard } from '../../core/guards';
import { AffiliateModule } from '../affiliate/module';
import { AuditModule } from '../audit/module';
import { TaxModule } from '../tax/module';

@Module({
  // TaxModule pulls Checkout → Discounts via forwardRef chain; mirror it here.
  imports: [AffiliateModule, AuditModule, forwardRef(() => TaxModule)],
  controllers: [AdminDiscountsController, CustomerDiscountsController],
  providers: [
    AdminAuthGuard,
    UserAuthGuard,
    DiscountsService,
    DiscountReservationService,
    DiscountAllocationService,
    DiscountAnalyticsService,
    DiscountStackingService,
    DiscountFraudService,
    DiscountEventsService,
    DiscountEligibilityService,
    DiscountAffiliateUnificationService,
    DiscountPublicFacade,
    ReleaseExpiredRedemptionsCron,
    // Phase 4.8 (2026-05-16) — daily purge of coupon_attempts rows
    // older than the cleanup horizon (default 30 days) so the
    // windowed fraud-check query stays fast at scale.
    CouponAttemptsCleanupCron,
    {
      provide: DISCOUNT_REPOSITORY,
      useClass: PrismaDiscountRepository,
    },
  ],
  exports: [
    DiscountPublicFacade,
    DiscountReservationService,
    DiscountAllocationService,
    DiscountStackingService,
    DiscountFraudService,
    DiscountEligibilityService,
    DiscountAffiliateUnificationService,
  ],
})
export class DiscountsModule {}
