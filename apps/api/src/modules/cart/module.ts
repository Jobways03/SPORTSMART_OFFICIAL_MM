import { Module, forwardRef } from '@nestjs/common';
import { CartController } from './presentation/controllers/cart.controller';
import { CustomerReservationsController } from './presentation/controllers/customer-reservations.controller';
import { CartService } from './application/services/cart.service';
import { CartPublicFacade } from './application/facades/cart-public.facade';
// Phase 61 (2026-05-22) — abandonment-sweep cron (audit Gap #12).
import { CartAbandonmentSweepCron } from './application/jobs/cart-abandonment-sweep.cron';
import { PrismaCartRepository } from './infrastructure/repositories/prisma-cart.repository';
import { CART_REPOSITORY } from './domain/repositories/cart.repository.interface';
import { UserAuthGuard } from '../../core/guards';
// Phase 64 (2026-05-22) — CatalogPublicFacade powers the cart-level
// serviceability preview. forwardRef breaks the pre-existing
// Catalog → Cart import cycle.
import { CatalogModule } from '../catalog/module';
// Phase 52 polish (2026-05-21) — InventoryModule exports
// InventoryPublicFacade, which the new customer reservation
// controller uses for getReservation / extendReservation.
import { InventoryModule } from '../inventory/module';

@Module({
  imports: [forwardRef(() => CatalogModule), forwardRef(() => InventoryModule)],
  controllers: [CartController, CustomerReservationsController],
  providers: [
    UserAuthGuard,
    CartService,
    CartPublicFacade,
    CartAbandonmentSweepCron,
    {
      provide: CART_REPOSITORY,
      useClass: PrismaCartRepository,
    },
  ],
  exports: [CartPublicFacade],
})
export class CartModule {}
