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
import { EmailOtpAdapter } from '../identity/infrastructure/adapters/email-otp.adapter';
import { CloudinaryAdapter } from '../../integrations/cloudinary/cloudinary.adapter';
import { SellerAuthGuard } from './infrastructure/guards/seller-auth.guard';
import { SellerRegisterController } from './presentation/controllers/seller-register.controller';
import { SellerLoginController } from './presentation/controllers/seller-login.controller';
import { SellerForgotPasswordController } from './presentation/controllers/seller-forgot-password.controller';
import { SellerResetPasswordController } from './presentation/controllers/seller-reset-password.controller';
import { SellerProfileController } from './presentation/controllers/seller-profile.controller';
import { SellerProfileMediaController } from './presentation/controllers/seller-profile-media.controller';
import { SellerEmailVerificationController } from './presentation/controllers/seller-email-verification.controller';

@Module({
  controllers: [
    SellerRegisterController,
    SellerLoginController,
    SellerForgotPasswordController,
    SellerResetPasswordController,
    SellerProfileController,
    SellerProfileMediaController,
    SellerEmailVerificationController,
  ],
  providers: [
    SellerPublicFacade,
    RegisterSellerUseCase,
    LoginSellerUseCase,
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
    EmailOtpAdapter,
    CloudinaryAdapter,
    SellerAuthGuard,
  ],
  exports: [SellerPublicFacade],
})
export class SellerModule {}
