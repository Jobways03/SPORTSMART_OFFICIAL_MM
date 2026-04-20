import { Module } from '@nestjs/common';

// Guards
import { AdminAuthGuard } from '../../core/guards';

// Repository
import { ADMIN_REPOSITORY } from './domain/repositories/admin.repository.interface';
import { PrismaAdminRepository } from './infrastructure/repositories/prisma-admin.repository';

// Services
import { AdminAuditService } from './application/services/admin-audit.service';
import { AdminCustomerService } from './application/services/admin-customer.service';

// Use Cases
import { AdminLoginUseCase } from './application/use-cases/admin-login.use-case';
import { AdminLogoutUseCase } from './application/use-cases/admin-logout.use-case';
import { AdminGetMeUseCase } from './application/use-cases/admin-get-me.use-case';
import { AdminListSellersUseCase } from './application/use-cases/admin-list-sellers.use-case';
import { AdminGetSellerUseCase } from './application/use-cases/admin-get-seller.use-case';
import { AdminEditSellerUseCase } from './application/use-cases/admin-edit-seller.use-case';
import { AdminUpdateSellerStatusUseCase } from './application/use-cases/admin-update-seller-status.use-case';
import { AdminUpdateSellerVerificationUseCase } from './application/use-cases/admin-update-seller-verification.use-case';
import { AdminImpersonateSellerUseCase } from './application/use-cases/admin-impersonate-seller.use-case';
import { AdminSendSellerMessageUseCase } from './application/use-cases/admin-send-seller-message.use-case';
import { AdminChangeSellerPasswordUseCase } from './application/use-cases/admin-change-seller-password.use-case';
import { AdminDeleteSellerUseCase } from './application/use-cases/admin-delete-seller.use-case';
import { ForgotAdminPasswordUseCase } from './application/use-cases/forgot-admin-password.use-case';
import { VerifyAdminResetOtpUseCase } from './application/use-cases/verify-admin-reset-otp.use-case';
import { ResendAdminResetOtpUseCase } from './application/use-cases/resend-admin-reset-otp.use-case';
import { ResetAdminPasswordUseCase } from './application/use-cases/reset-admin-password.use-case';

// Email OTP adapter (used by password reset flow)
import { EmailOtpAdapter } from '../../integrations/email/adapters/email-otp.adapter';

// Controllers
import { AdminAuthController } from './presentation/controllers/admin-auth.controller';
import { AdminSellersController } from './presentation/controllers/admin-sellers.controller';
import { AdminCustomersController } from './presentation/controllers/admin-customers.controller';

@Module({
  controllers: [
    AdminAuthController,
    AdminSellersController,
    AdminCustomersController,
  ],
  providers: [
    AdminAuthGuard,
    {
      provide: ADMIN_REPOSITORY,
      useClass: PrismaAdminRepository,
    },
    AdminAuditService,
    AdminCustomerService,
    EmailOtpAdapter,
    AdminLoginUseCase,
    AdminLogoutUseCase,
    AdminGetMeUseCase,
    AdminListSellersUseCase,
    AdminGetSellerUseCase,
    AdminEditSellerUseCase,
    AdminUpdateSellerStatusUseCase,
    AdminUpdateSellerVerificationUseCase,
    AdminImpersonateSellerUseCase,
    AdminSendSellerMessageUseCase,
    AdminChangeSellerPasswordUseCase,
    AdminDeleteSellerUseCase,
    ForgotAdminPasswordUseCase,
    VerifyAdminResetOtpUseCase,
    ResendAdminResetOtpUseCase,
    ResetAdminPasswordUseCase,
  ],
  exports: [],
})
export class AdminModule {}
