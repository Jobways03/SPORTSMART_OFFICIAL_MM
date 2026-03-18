import { Module } from '@nestjs/common';
import { IdentityPublicFacade } from './application/facades/identity-public.facade';
import { RegisterUserUseCase } from './application/use-cases/register-user.use-case';
import { LoginUserUseCase } from './application/use-cases/login-user.use-case';
import { ForgotPasswordUseCase } from './application/use-cases/forgot-password.use-case';
import { VerifyResetOtpUseCase } from './application/use-cases/verify-reset-otp.use-case';
import { ResendResetOtpUseCase } from './application/use-cases/resend-reset-otp.use-case';
import { ResetPasswordUseCase } from './application/use-cases/reset-password.use-case';
import { PermissionCheckService } from './application/services/permission-check.service';
import { EmailOtpAdapter } from './infrastructure/adapters/email-otp.adapter';
import { PrismaUserRepository } from './infrastructure/repositories/prisma-user.prisma-repository';
import { PrismaSessionRepository } from './infrastructure/repositories/prisma-session.prisma-repository';
import { RegisterController } from './presentation/controllers/register.controller';
import { LoginController } from './presentation/controllers/login.controller';
import { ForgotPasswordController } from './presentation/controllers/forgot-password.controller';
import { ResetPasswordController } from './presentation/controllers/reset-password.controller';

@Module({
  controllers: [
    RegisterController,
    LoginController,
    ForgotPasswordController,
    ResetPasswordController,
  ],
  providers: [
    IdentityPublicFacade,
    RegisterUserUseCase,
    LoginUserUseCase,
    ForgotPasswordUseCase,
    VerifyResetOtpUseCase,
    ResendResetOtpUseCase,
    ResetPasswordUseCase,
    PermissionCheckService,
    EmailOtpAdapter,
    PrismaUserRepository,
    PrismaSessionRepository,
  ],
  exports: [IdentityPublicFacade],
})
export class IdentityModule {}
