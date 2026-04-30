import { Module } from '@nestjs/common';
import { AffiliateAuthGuard } from '../../core/guards';
import { CloudinaryAdapter } from '../../integrations/cloudinary/cloudinary.adapter';
import { EmailOtpAdapter } from '../../integrations/email/adapters/email-otp.adapter';
import { WhatsAppAdapter } from '../../integrations/whatsapp/adapters/whatsapp.adapter';
import { WhatsAppClient } from '../../integrations/whatsapp/clients/whatsapp.client';
import { AffiliatePublicFacade } from './application/facades/affiliate-public.facade';
import { AffiliateRegistrationService } from './application/services/affiliate-registration.service';
import { AffiliateAuthService } from './application/services/affiliate-auth.service';
import { AffiliatePasswordResetService } from './application/services/affiliate-password-reset.service';
import { AffiliateSettingsService } from './application/services/affiliate-settings.service';
import { AffiliatePhoneVerificationService } from './application/services/affiliate-phone-verification.service';
import { AffiliateCommissionService } from './application/services/affiliate-commission.service';
import { AffiliateEncryptionService } from './application/services/affiliate-encryption.service';
import { AffiliateKycService } from './application/services/affiliate-kyc.service';
import { AffiliatePayoutService } from './application/services/affiliate-payout.service';
import { AffiliateReturnWindowService } from './application/services/affiliate-return-window.service';
import { AffiliateOrderEventHandler } from './application/event-handlers/affiliate-order.handler';
import { AffiliateRegistrationController } from './presentation/controllers/affiliate-registration.controller';
import { AdminAffiliateController } from './presentation/controllers/admin-affiliate.controller';
import { AdminAffiliatePayoutController } from './presentation/controllers/admin-affiliate-payout.controller';
import { AdminAffiliateCommissionController } from './presentation/controllers/admin-affiliate-commission.controller';
import { AdminAffiliateReportsController } from './presentation/controllers/admin-affiliate-reports.controller';
import { AffiliateAuthController } from './presentation/controllers/affiliate-auth.controller';
import { AffiliateSelfController } from './presentation/controllers/affiliate-self.controller';

@Module({
  controllers: [
    AffiliateRegistrationController,
    AffiliateAuthController,
    AffiliateSelfController,
    // More-specific admin sub-paths MUST be registered before
    // AdminAffiliateController — its `:affiliateId` route otherwise
    // swallows /admin/affiliates/payouts and /commissions and the
    // service throws "Affiliate not found".
    AdminAffiliatePayoutController,
    AdminAffiliateCommissionController,
    AdminAffiliateReportsController,
    AdminAffiliateController,
  ],
  providers: [
    AffiliatePublicFacade,
    AffiliateRegistrationService,
    AffiliateAuthService,
    AffiliatePasswordResetService,
    AffiliateSettingsService,
    AffiliatePhoneVerificationService,
    AffiliateCommissionService,
    AffiliateEncryptionService,
    AffiliateKycService,
    AffiliatePayoutService,
    AffiliateReturnWindowService,
    AffiliateAuthGuard,
    CloudinaryAdapter,
    EmailOtpAdapter,
    WhatsAppAdapter,
    WhatsAppClient,
    // Event handlers — subscribed via @OnEvent decorators. Just
    // including them in providers is enough for Nest to register
    // the listeners with the event emitter.
    AffiliateOrderEventHandler,
  ],
  exports: [
    AffiliatePublicFacade,
    AffiliateRegistrationService,
    AffiliateCommissionService,
  ],
})
export class AffiliateModule {}
