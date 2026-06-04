import {
  DynamicModule,
  Module,
  type Provider,
} from '@nestjs/common';
import { AdminLogisticsPartnerController } from './presentation/controllers/admin-logistics-partner.controller';
import { SellerLogisticsPartnerController } from './presentation/controllers/seller-logistics-partner.controller';
import { ListSellerRegistrationsService } from './application/services/list-seller-registrations.service';
import { RegisterSellerWithPartnerService } from './application/services/register-seller-with-partner.service';
import {
  PrismaSellerPartnerRegistrationRepository,
  SELLER_PARTNER_REGISTRATION_REPOSITORY,
} from './infrastructure/repositories/prisma-seller-partner-registration.repository';
import { RegisterFranchiseWithPartnerService } from './application/services/register-franchise-with-partner.service';
import {
  PrismaFranchisePartnerRegistrationRepository,
  FRANCHISE_PARTNER_REGISTRATION_REPOSITORY,
} from './infrastructure/repositories/prisma-franchise-partner-registration.repository';
import { LogisticsFacadeModule } from '../../integrations/logistics-facade/logistics-facade.module';
import { SellerModule } from '../seller/module';
import {
  SELLER_REPOSITORY,
  type SellerRepository,
} from '../seller/domain/repositories/seller.repository.interface';
import { PrismaSellerRepository } from '../seller/infrastructure/repositories/prisma-seller.repository';
import { AdminAuthGuard, PermissionsGuard, SellerAuthGuard } from '../../core/guards';

const REPO_PROVIDER: Provider = {
  provide: SELLER_PARTNER_REGISTRATION_REPOSITORY,
  useClass: PrismaSellerPartnerRegistrationRepository,
};

const FRANCHISE_REPO_PROVIDER: Provider = {
  provide: FRANCHISE_PARTNER_REGISTRATION_REPOSITORY,
  useClass: PrismaFranchisePartnerRegistrationRepository,
};

/**
 * Logistics-partner module — owns the SellerPartnerRegistration
 * aggregate + admin-facing endpoints that proxy the facade.
 *
 * Feature-flagged via `LOGISTICS_PARTNER_REGISTRATION_ENABLED`:
 *   • `forRoot({ enabled: true })`   → wires controllers + providers.
 *   • `forRoot({ enabled: false })`  → returns an empty module so the
 *     `/admin/logistics-partner/*` routes are not mounted. Existing
 *     calls return 404 (clean rollback path for MVP 1).
 *
 * The default `imports: [LogisticsPartnerModule]` import (without
 * forRoot) still works — it falls through to the enabled path so
 * environments that don't yet set the flag behave like prod.
 */
@Module({
  imports: [LogisticsFacadeModule, SellerModule],
  controllers: [
    AdminLogisticsPartnerController,
    SellerLogisticsPartnerController,
  ],
  providers: [
    ListSellerRegistrationsService,
    RegisterSellerWithPartnerService,
    RegisterFranchiseWithPartnerService,
    REPO_PROVIDER,
    FRANCHISE_REPO_PROVIDER,
    // Seller repository — re-bind locally so we don't depend on
    // SellerModule's provider-export which is currently scoped to its
    // own use-cases.
    {
      provide: SELLER_REPOSITORY,
      useClass: PrismaSellerRepository,
    },
    AdminAuthGuard,
    PermissionsGuard,
    SellerAuthGuard,
  ],
  exports: [
    ListSellerRegistrationsService,
    RegisterSellerWithPartnerService,
  ],
})
export class LogisticsPartnerModule {
  /**
   * Conditional registration honouring the
   * `LOGISTICS_PARTNER_REGISTRATION_ENABLED` flag. Called from
   * `app.module.ts`:
   *
   *   LogisticsPartnerModule.forRoot({
   *     enabled: process.env.LOGISTICS_PARTNER_REGISTRATION_ENABLED !== 'false',
   *   })
   *
   * The default (flag missing / true) wires the full module. Setting
   * the env var to literally `false` returns a no-op module whose
   * controllers + providers are not registered with Nest.
   */
  static forRoot(opts: { enabled: boolean }): DynamicModule {
    if (!opts.enabled) {
      return {
        module: LogisticsPartnerModule,
        controllers: [],
        providers: [],
        exports: [],
      };
    }
    return {
      module: LogisticsPartnerModule,
      imports: [LogisticsFacadeModule, SellerModule],
      controllers: [
        AdminLogisticsPartnerController,
        SellerLogisticsPartnerController,
      ],
      providers: [
        ListSellerRegistrationsService,
        RegisterSellerWithPartnerService,
        REPO_PROVIDER,
        {
          provide: SELLER_REPOSITORY,
          useClass: PrismaSellerRepository,
        },
        AdminAuthGuard,
        PermissionsGuard,
        SellerAuthGuard,
      ],
      exports: [
        ListSellerRegistrationsService,
        RegisterSellerWithPartnerService,
      ],
    };
  }
}

// Re-export so the test harness can stub the repository token.
export { SELLER_PARTNER_REGISTRATION_REPOSITORY };
export type { SellerRepository };
