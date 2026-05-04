import { Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/guards';
import { AdminNovaWarehousesController } from './presentation/controllers/admin-warehouses.controller';
import { AdminNovaProductsController } from './presentation/controllers/admin-products.controller';
import { AdminNovaProcurementController } from './presentation/controllers/admin-procurement.controller';
import { OwnBrandService } from './application/services/own-brand.service';
import { OwnBrandPublicFacade } from './application/facades/own-brand-public.facade';
import { PrismaOwnBrandRepository } from './infrastructure/repositories/prisma-own-brand.repository';
import { OWN_BRAND_REPOSITORY } from './domain/repositories/own-brand.repository.interface';

@Module({
  controllers: [
    AdminNovaWarehousesController,
    AdminNovaProductsController,
    AdminNovaProcurementController,
  ],
  providers: [
    AdminAuthGuard,
    OwnBrandService,
    OwnBrandPublicFacade,
    {
      provide: OWN_BRAND_REPOSITORY,
      useClass: PrismaOwnBrandRepository,
    },
  ],
  exports: [OwnBrandPublicFacade],
})
export class OwnBrandModule {}
