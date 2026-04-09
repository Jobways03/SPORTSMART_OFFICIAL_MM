import { Module } from '@nestjs/common';
import { IdentityPublicFacade } from './application/facades/identity-public.facade';
import { RegisterUserUseCase } from './application/use-cases/register-user.use-case';
import { LoginUserUseCase } from './application/use-cases/login-user.use-case';
import { ForgotPasswordUseCase } from './application/use-cases/forgot-password.use-case';
import { VerifyResetOtpUseCase } from './application/use-cases/verify-reset-otp.use-case';
import { ResendResetOtpUseCase } from './application/use-cases/resend-reset-otp.use-case';
import { ResetPasswordUseCase } from './application/use-cases/reset-password.use-case';
import { PermissionCheckService } from './application/services/permission-check.service';
import { EmailOtpAdapter } from '../../integrations/email/adapters/email-otp.adapter';
import { USER_REPOSITORY } from './domain/repositories/user.repository';
import { SESSION_REPOSITORY } from './domain/repositories/session.repository';
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
    {
      provide: USER_REPOSITORY,
      useClass: PrismaUserRepository,
    },
    {
      provide: SESSION_REPOSITORY,
      useClass: PrismaSessionRepository,
    },
  ],
  exports: [IdentityPublicFacade],
})
export class IdentityModule {}
