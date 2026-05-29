import { Module } from '@nestjs/common';
import { IdentityPublicFacade } from './application/facades/identity-public.facade';
import { RegisterUserUseCase } from './application/use-cases/register-user.use-case';
import { VerifyEmailOtpUseCase } from './application/use-cases/verify-email-otp.use-case';
import { ResendVerificationOtpUseCase } from './application/use-cases/resend-verification-otp.use-case';
import { LoginUserUseCase } from './application/use-cases/login-user.use-case';
import { ForgotPasswordUseCase } from './application/use-cases/forgot-password.use-case';
import { VerifyResetOtpUseCase } from './application/use-cases/verify-reset-otp.use-case';
import { ResendResetOtpUseCase } from './application/use-cases/resend-reset-otp.use-case';
import { ResetPasswordUseCase } from './application/use-cases/reset-password.use-case';
import { RefreshSessionUseCase } from './application/use-cases/refresh-session.use-case';
import { GetCustomerProfileUseCase } from './application/use-cases/get-customer-profile.use-case';
import { UpdateCustomerProfileUseCase } from './application/use-cases/update-customer-profile.use-case';
import { ChangeCustomerPasswordUseCase } from './application/use-cases/change-customer-password.use-case';
import { LogoutUserUseCase } from './application/use-cases/logout-user.use-case';
import { PermissionCheckService } from './application/services/permission-check.service';
import { ConsentService } from './application/services/consent.service';
import { CustomerDataExportService } from './application/services/customer-data-export.service';
import { EmailBruteForceService } from './application/services/email-brute-force.service';
import { EmailOtpAdapter } from '../../integrations/email/adapters/email-otp.adapter';
import { USER_REPOSITORY } from './domain/repositories/user.repository';
import { SESSION_REPOSITORY } from './domain/repositories/session.repository';
import { PrismaUserRepository } from './infrastructure/repositories/prisma-user.prisma-repository';
import { PrismaSessionRepository } from './infrastructure/repositories/prisma-session.prisma-repository';
import { RegisterController } from './presentation/controllers/register.controller';
import { LoginController } from './presentation/controllers/login.controller';
import { LogoutController } from './presentation/controllers/logout.controller';
import { ConsentController } from './presentation/controllers/consent.controller';
import { CustomerDataExportController } from './presentation/controllers/customer-data-export.controller';
import { ForgotPasswordController } from './presentation/controllers/forgot-password.controller';
import { ResetPasswordController } from './presentation/controllers/reset-password.controller';
import { RefreshSessionController } from './presentation/controllers/refresh-session.controller';
import { CustomerProfileController } from './presentation/controllers/customer-profile.controller';
import { AuthMeController } from './presentation/controllers/auth-me.controller';
import { SessionsController } from './presentation/controllers/sessions.controller';
import { UserAuthGuard } from '../../core/guards';

@Module({
  controllers: [
    RegisterController,
    LoginController,
    LogoutController,
    AuthMeController,
    SessionsController,
    ForgotPasswordController,
    ResetPasswordController,
    RefreshSessionController,
    CustomerProfileController,
    ConsentController,
    CustomerDataExportController,
  ],
  providers: [
    UserAuthGuard,
    IdentityPublicFacade,
    RegisterUserUseCase,
    VerifyEmailOtpUseCase,
    ResendVerificationOtpUseCase,
    LoginUserUseCase,
    LogoutUserUseCase,
    ForgotPasswordUseCase,
    VerifyResetOtpUseCase,
    ResendResetOtpUseCase,
    ResetPasswordUseCase,
    RefreshSessionUseCase,
    GetCustomerProfileUseCase,
    UpdateCustomerProfileUseCase,
    ChangeCustomerPasswordUseCase,
    PermissionCheckService,
    ConsentService,
    CustomerDataExportService,
    EmailBruteForceService,
    EmailOtpAdapter,
    {
      provide: USER_REPOSITORY,
      useClass: PrismaUserRepository,
    },
    {
      provide: SESSION_REPOSITORY,
      useClass: PrismaSessionRepository,
    },
  ],
  // Phase 28 (2026-05-21) — ConsentService is exported so the
  // NotificationsModule's gate can check ConsentRecord before
  // dispatching a marketing send. IdentityPublicFacade stays the
  // primary cross-module surface; ConsentService is exposed alongside
  // because the consent check is a hot-path query that doesn't fit
  // the facade's "actor lifecycle" shape.
  exports: [IdentityPublicFacade, ConsentService],
})
export class IdentityModule {}
