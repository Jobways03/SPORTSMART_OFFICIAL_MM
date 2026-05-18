import { Module } from '@nestjs/common';
import { SellerPublicFacade } from './application/facades/seller-public.facade';
import { RegisterSellerUseCase } from './application/use-cases/register-seller.use-case';
import { LoginSellerUseCase } from './application/use-cases/login-seller.use-case';
import { ForgotPasswordSellerUseCase } from './application/use-cases/forgot-password-seller.use-case';
import { VerifyResetOtpSellerUseCase } from './application/use-cases/verify-reset-otp-seller.use-case';
import { ResendResetOtpSellerUseCase } from './application/use-cases/resend-reset-otp-seller.use-case';
import { ResetPasswordSellerUseCase } from './application/use-cases/reset-password-seller.use-case';
import { ChangeSellerPasswordUseCase } from './application/use-cases/change-seller-password.use-case';
import { GetSellerProfileUseCase } from './application/use-cases/get-seller-profile.use-case';
import { UpdateSellerProfileUseCase } from './application/use-cases/update-seller-profile.use-case';
import { UploadSellerMediaUseCase } from './application/use-cases/upload-seller-media.use-case';
import { DeleteSellerMediaUseCase } from './application/use-cases/delete-seller-media.use-case';
import { SendEmailVerificationOtpUseCase } from './application/use-cases/send-email-verification-otp.use-case';
import { VerifySellerEmailUseCase } from './application/use-cases/verify-seller-email.use-case';
import { SubmitSellerOnboardingUseCase } from './application/use-cases/submit-seller-onboarding.use-case';
import { ApproveSellerUseCase } from './application/use-cases/approve-seller.use-case';
import { RejectSellerUseCase } from './application/use-cases/reject-seller.use-case';
import { LogoutSellerUseCase } from './application/use-cases/logout-seller.use-case';
import { EmailOtpAdapter } from '../../integrations/email/adapters/email-otp.adapter';
import { CloudinaryAdapter } from '../../integrations/cloudinary/cloudinary.adapter';
import { SellerAuthGuard, AdminAuthGuard, PermissionsGuard } from '../../core/guards';
import { SellerRegisterController } from './presentation/controllers/seller-register.controller';
import { SellerLoginController } from './presentation/controllers/seller-login.controller';
import { SellerLogoutController } from './presentation/controllers/seller-logout.controller';
import { SellerForgotPasswordController } from './presentation/controllers/seller-forgot-password.controller';
import { SellerResetPasswordController } from './presentation/controllers/seller-reset-password.controller';
import { SellerProfileController } from './presentation/controllers/seller-profile.controller';
import { SellerProfileMediaController } from './presentation/controllers/seller-profile-media.controller';
import { SellerEmailVerificationController } from './presentation/controllers/seller-email-verification.controller';
import { SellerDeliveryMethodsController } from './presentation/controllers/seller-delivery-methods.controller';
import { SubmitSellerOnboardingController } from './presentation/controllers/submit-seller-onboarding.controller';
import { ApproveSellerController } from './presentation/controllers/approve-seller.controller';
import { RejectSellerController } from './presentation/controllers/reject-seller.controller';
import { SellerDeliveryMethodsService } from './application/services/seller-delivery-methods.service';
import { SELLER_REPOSITORY } from './domain/repositories/seller.repository.interface';
import { PrismaSellerRepository } from './infrastructure/repositories/prisma-seller.repository';
import { SellerAuditHandler } from './application/event-handlers/seller-audit.handler';

@Module({
  controllers: [
    SellerRegisterController,
    SellerLoginController,
    SellerLogoutController,
    SellerForgotPasswordController,
    SellerResetPasswordController,
    SellerProfileController,
    SellerProfileMediaController,
    SellerEmailVerificationController,
    SellerDeliveryMethodsController,
    SubmitSellerOnboardingController,
    ApproveSellerController,
    RejectSellerController,
  ],
  providers: [
    SellerDeliveryMethodsService,
    {
      provide: SELLER_REPOSITORY,
      useClass: PrismaSellerRepository,
    },
    SellerPublicFacade,
    RegisterSellerUseCase,
    LoginSellerUseCase,
    LogoutSellerUseCase,
    ForgotPasswordSellerUseCase,
    VerifyResetOtpSellerUseCase,
    ResendResetOtpSellerUseCase,
    ResetPasswordSellerUseCase,
    ChangeSellerPasswordUseCase,
    GetSellerProfileUseCase,
    UpdateSellerProfileUseCase,
    UploadSellerMediaUseCase,
    DeleteSellerMediaUseCase,
    SendEmailVerificationOtpUseCase,
    VerifySellerEmailUseCase,
    SubmitSellerOnboardingUseCase,
    ApproveSellerUseCase,
    RejectSellerUseCase,
    EmailOtpAdapter,
    CloudinaryAdapter,
    SellerAuthGuard,
    AdminAuthGuard,
    PermissionsGuard,
    // Listens to every seller.* event and writes a structured row to
    // audit_logs via AuditPublicFacade (which is exported from the
    // @Global AuditModule). Without this provider entry, the @OnEvent
    // decorators on the handler are never bound.
    SellerAuditHandler,
  ],
  exports: [SellerPublicFacade],
})
export class SellerModule {}
