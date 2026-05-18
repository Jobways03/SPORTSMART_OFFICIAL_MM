import { Module } from '@nestjs/common';

import { IThinkModule } from '../../integrations/ithink/ithink.module';

// Guards
import { AdminAuthGuard } from '../../core/guards';

// Repository
import { ADMIN_REPOSITORY } from './domain/repositories/admin.repository.interface';
import { PrismaAdminRepository } from './infrastructure/repositories/prisma-admin.repository';

// Services
import { AdminAuditService } from './application/services/admin-audit.service';
import { AdminCustomerService } from './application/services/admin-customer.service';
import { AdminUserService } from './application/services/admin-user.service';
import { AdminDeliveryMethodsService } from './application/services/admin-delivery-methods.service';

// Use Cases
import { AdminLoginUseCase } from './application/use-cases/admin-login.use-case';
import { AdminLogoutUseCase } from './application/use-cases/admin-logout.use-case';
import { AdminGetMeUseCase } from './application/use-cases/admin-get-me.use-case';
import { RefreshAdminSessionUseCase } from './application/use-cases/refresh-admin-session.use-case';
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
import { AdminRolesController } from './presentation/controllers/admin-roles.controller';
import { AdminAuthzReadinessController } from './presentation/controllers/admin-authz-readiness.controller';
import { AdminUsersController } from './presentation/controllers/admin-users.controller';
import {
  AdminFranchiseDeliveryMethodsController,
  AdminSellerDeliveryMethodsController,
} from './presentation/controllers/admin-delivery-methods.controller';
import { RoleService } from './application/services/role.service';

// Policies
import { SellerStatusTransitionPolicy } from '../seller/application/policies/seller-status-transition.policy';

@Module({
  imports: [IThinkModule],
  controllers: [
    AdminAuthController,
    AdminSellersController,
    AdminCustomersController,
    AdminRolesController,
    AdminAuthzReadinessController,
    AdminUsersController,
    AdminSellerDeliveryMethodsController,
    AdminFranchiseDeliveryMethodsController,
  ],
  providers: [
    AdminAuthGuard,
    RoleService,
    AdminUserService,
    AdminDeliveryMethodsService,
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
    RefreshAdminSessionUseCase,
    AdminListSellersUseCase,
    AdminGetSellerUseCase,
    AdminEditSellerUseCase,
    AdminUpdateSellerStatusUseCase,
    AdminUpdateSellerVerificationUseCase,
    SellerStatusTransitionPolicy,
    AdminImpersonateSellerUseCase,
    AdminSendSellerMessageUseCase,
    AdminChangeSellerPasswordUseCase,
    AdminDeleteSellerUseCase,
    ForgotAdminPasswordUseCase,
    VerifyAdminResetOtpUseCase,
    ResendAdminResetOtpUseCase,
    ResetAdminPasswordUseCase,
  ],
  // Phase 10 (PR 10.5) — Export the repository binding so the
  // admin-mfa module (which composes the existing AdminRepository
  // for MFA writes) can inject it without redeclaring the provider.
  exports: [ADMIN_REPOSITORY],
})
export class AdminModule {}
