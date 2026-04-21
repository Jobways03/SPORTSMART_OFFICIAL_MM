/**
 * FranchiseModule — isolation invariants
 * --------------------------------------
 * Franchises can ONLY consume the catalog, never mutate it.
 *
 * The following operations are intentionally NOT available to this module,
 * and must not be added without product-owner sign-off:
 *   - prisma.product.{create,update,delete,upsert}
 *   - prisma.productVariant.{create,update,delete,upsert}
 *   - any SellerProductsService / SellerVariantsService / Seller-* writers
 *
 * All product/variant writes belong to the seller stack (CatalogModule /
 * SellerProductsController). A franchise interacts with the catalog only via:
 *   - FranchiseCatalogService (read products, create FranchiseCatalogMapping)
 *   - FranchiseInventoryService (FranchiseStock, FranchiseInventoryLedger)
 *   - ProcurementService (ProcurementRequest)
 *   - FranchisePosService (FranchisePosSale)
 *
 * Separation is also enforced at the HTTP layer by FranchiseAuthGuard +
 * JWT_FRANCHISE_SECRET, so a franchise token cannot reach seller endpoints
 * even if a route were misconfigured.
 */
import { Module } from '@nestjs/common';
import { FranchiseAuthGuard, AdminAuthGuard } from '../../core/guards';
import { EmailOtpAdapter } from '../../integrations/email/adapters/email-otp.adapter';
import { CloudinaryAdapter } from '../../integrations/cloudinary/cloudinary.adapter';
import { PrismaFranchiseRepository } from './infrastructure/repositories/prisma-franchise.repository';
import { FRANCHISE_PARTNER_REPOSITORY } from './domain/repositories/franchise.repository.interface';
import { FranchisePublicFacade } from './application/facades/franchise-public.facade';

// Phase 5 imports — Franchise Order Fulfillment
import { CatalogModule } from '../catalog/module';
import { FranchiseOrdersService } from './application/services/franchise-orders.service';
import { FranchiseOrdersController } from './presentation/controllers/franchise-orders.controller';
import { AdminFranchiseOrdersController } from './presentation/controllers/admin-franchise-orders.controller';

// Phase 2 imports — Catalog
import { PrismaFranchiseCatalogRepository } from './infrastructure/repositories/prisma-franchise-catalog.repository';
import { FRANCHISE_CATALOG_REPOSITORY } from './domain/repositories/franchise-catalog.repository.interface';
import { FranchiseCatalogService } from './application/services/franchise-catalog.service';

// Phase 3 imports — Inventory
import { PrismaFranchiseInventoryRepository } from './infrastructure/repositories/prisma-franchise-inventory.repository';
import { FRANCHISE_INVENTORY_REPOSITORY } from './domain/repositories/franchise-inventory.repository.interface';
import { FranchiseInventoryService } from './application/services/franchise-inventory.service';

// Phase 6 imports — Procurement
import { PrismaProcurementRepository } from './infrastructure/repositories/prisma-procurement.repository';
import { PROCUREMENT_REPOSITORY } from './domain/repositories/procurement.repository.interface';
import { ProcurementService } from './application/services/procurement.service';

// Phase 7 imports — POS
import { PrismaFranchisePosRepository } from './infrastructure/repositories/prisma-franchise-pos.repository';
import { FRANCHISE_POS_REPOSITORY } from './domain/repositories/franchise-pos.repository.interface';
import { FranchisePosService } from './application/services/franchise-pos.service';

// Phase 8 imports — Commission & Settlement
import { PrismaFranchiseFinanceRepository } from './infrastructure/repositories/prisma-franchise-finance.repository';
import { FRANCHISE_FINANCE_REPOSITORY } from './domain/repositories/franchise-finance.repository.interface';
import { FranchiseCommissionService } from './application/services/franchise-commission.service';
import { FranchiseSettlementService } from './application/services/franchise-settlement.service';

// Background services
import { FranchiseReservationCleanupService } from './application/services/franchise-reservation-cleanup.service';
import { FranchiseCommissionProcessorService } from './application/services/franchise-commission-processor.service';

// Event handlers
import { VariantSoftDeleteCleanupHandler } from './application/event-handlers/variant-soft-delete-cleanup.handler';

// Controllers
import { FranchiseAuthController } from './presentation/controllers/franchise-auth.controller';
import { FranchiseProfileController } from './presentation/controllers/franchise-profile.controller';
import { AdminFranchiseController } from './presentation/controllers/admin-franchise.controller';
import { FranchiseCatalogController } from './presentation/controllers/franchise-catalog.controller';
import { AdminFranchiseCatalogController } from './presentation/controllers/admin-franchise-catalog.controller';
import { FranchiseInventoryController } from './presentation/controllers/franchise-inventory.controller';
import { AdminFranchiseInventoryController } from './presentation/controllers/admin-franchise-inventory.controller';
import { FranchiseProcurementController } from './presentation/controllers/franchise-procurement.controller';
import { AdminProcurementController } from './presentation/controllers/admin-procurement.controller';
import { AdminFranchiseProcurementPricingController } from './presentation/controllers/admin-franchise-procurement-pricing.controller';
import { FranchisePosController } from './presentation/controllers/franchise-pos.controller';
import { AdminFranchisePosController } from './presentation/controllers/admin-franchise-pos.controller';
import { FranchiseEarningsController } from './presentation/controllers/franchise-earnings.controller';
import { AdminFranchiseSettlementsController } from './presentation/controllers/admin-franchise-settlements.controller';
import { AdminFranchiseFinanceController } from './presentation/controllers/admin-franchise-finance.controller';
import { FranchiseEmailVerificationController } from './presentation/controllers/franchise-email-verification.controller';
import { FranchiseMediaController } from './presentation/controllers/franchise-media.controller';
import { FranchiseStaffController } from './presentation/controllers/franchise-staff.controller';

// Auth use-cases
import { RegisterFranchiseUseCase } from './application/use-cases/register-franchise.use-case';
import { LoginFranchiseUseCase } from './application/use-cases/login-franchise.use-case';
import { ForgotPasswordFranchiseUseCase } from './application/use-cases/forgot-password-franchise.use-case';
import { VerifyResetOtpFranchiseUseCase } from './application/use-cases/verify-reset-otp-franchise.use-case';
import { ResendResetOtpFranchiseUseCase } from './application/use-cases/resend-reset-otp-franchise.use-case';
import { ResetPasswordFranchiseUseCase } from './application/use-cases/reset-password-franchise.use-case';
import { ChangePasswordFranchiseUseCase } from './application/use-cases/change-password-franchise.use-case';

// Profile use-cases
import { GetFranchiseProfileUseCase } from './application/use-cases/get-franchise-profile.use-case';
import { UpdateFranchiseProfileUseCase } from './application/use-cases/update-franchise-profile.use-case';

// Email verification use-cases
import { SendFranchiseEmailVerificationUseCase } from './application/use-cases/send-franchise-email-verification.use-case';
import { VerifyFranchiseEmailUseCase } from './application/use-cases/verify-franchise-email.use-case';

// Media use-cases
import { UploadFranchiseMediaUseCase } from './application/use-cases/upload-franchise-media.use-case';
import { DeleteFranchiseMediaUseCase } from './application/use-cases/delete-franchise-media.use-case';

// Staff service
import { FranchiseStaffService } from './application/services/franchise-staff.service';

// Admin use-cases
import { AdminListFranchisesUseCase } from './application/use-cases/admin-list-franchises.use-case';
import { AdminGetFranchiseUseCase } from './application/use-cases/admin-get-franchise.use-case';
import { AdminUpdateFranchiseStatusUseCase } from './application/use-cases/admin-update-franchise-status.use-case';
import { AdminUpdateFranchiseVerificationUseCase } from './application/use-cases/admin-update-franchise-verification.use-case';
import { AdminUpdateFranchiseCommissionUseCase } from './application/use-cases/admin-update-franchise-commission.use-case';
import { AdminEditFranchiseProfileUseCase } from './application/use-cases/admin-edit-franchise-profile.use-case';
import { AdminSendFranchiseMessageUseCase } from './application/use-cases/admin-send-franchise-message.use-case';
import { AdminChangeFranchisePasswordUseCase } from './application/use-cases/admin-change-franchise-password.use-case';
import { AdminImpersonateFranchiseUseCase } from './application/use-cases/admin-impersonate-franchise.use-case';
import { AdminDeleteFranchiseUseCase } from './application/use-cases/admin-delete-franchise.use-case';

@Module({
  imports: [CatalogModule],
  controllers: [
    FranchiseAuthController,
    FranchiseProfileController,
    AdminFranchiseController,
    FranchiseCatalogController,
    AdminFranchiseCatalogController,
    FranchiseInventoryController,
    AdminFranchiseInventoryController,
    FranchiseOrdersController,
    AdminFranchiseOrdersController,
    FranchiseProcurementController,
    AdminProcurementController,
    AdminFranchiseProcurementPricingController,
    FranchisePosController,
    AdminFranchisePosController,
    FranchiseEarningsController,
    AdminFranchiseSettlementsController,
    AdminFranchiseFinanceController,
    FranchiseEmailVerificationController,
    FranchiseMediaController,
    FranchiseStaffController,
  ],
  providers: [
    {
      provide: FRANCHISE_PARTNER_REPOSITORY,
      useClass: PrismaFranchiseRepository,
    },
    {
      provide: FRANCHISE_CATALOG_REPOSITORY,
      useClass: PrismaFranchiseCatalogRepository,
    },
    {
      provide: FRANCHISE_INVENTORY_REPOSITORY,
      useClass: PrismaFranchiseInventoryRepository,
    },
    {
      provide: PROCUREMENT_REPOSITORY,
      useClass: PrismaProcurementRepository,
    },
    {
      provide: FRANCHISE_POS_REPOSITORY,
      useClass: PrismaFranchisePosRepository,
    },
    {
      provide: FRANCHISE_FINANCE_REPOSITORY,
      useClass: PrismaFranchiseFinanceRepository,
    },
    FranchisePublicFacade,
    FranchiseCatalogService,
    FranchiseInventoryService,
    FranchiseOrdersService,
    ProcurementService,
    FranchisePosService,
    FranchiseCommissionService,
    FranchiseSettlementService,
    FranchiseReservationCleanupService,
    FranchiseCommissionProcessorService,
    VariantSoftDeleteCleanupHandler,
    RegisterFranchiseUseCase,
    LoginFranchiseUseCase,
    ForgotPasswordFranchiseUseCase,
    VerifyResetOtpFranchiseUseCase,
    ResendResetOtpFranchiseUseCase,
    ResetPasswordFranchiseUseCase,
    ChangePasswordFranchiseUseCase,
    GetFranchiseProfileUseCase,
    UpdateFranchiseProfileUseCase,
    AdminListFranchisesUseCase,
    AdminGetFranchiseUseCase,
    AdminUpdateFranchiseStatusUseCase,
    AdminUpdateFranchiseVerificationUseCase,
    AdminUpdateFranchiseCommissionUseCase,
    AdminEditFranchiseProfileUseCase,
    AdminSendFranchiseMessageUseCase,
    AdminChangeFranchisePasswordUseCase,
    AdminImpersonateFranchiseUseCase,
    AdminDeleteFranchiseUseCase,
    SendFranchiseEmailVerificationUseCase,
    VerifyFranchiseEmailUseCase,
    UploadFranchiseMediaUseCase,
    DeleteFranchiseMediaUseCase,
    FranchiseStaffService,
    FranchiseAuthGuard,
    AdminAuthGuard,
    EmailOtpAdapter,
    CloudinaryAdapter,
  ],
  exports: [FranchisePublicFacade],
})
export class FranchiseModule {}
