import { Module } from '@nestjs/common';
import { CartController } from './presentation/controllers/cart.controller';
import { CartService } from './application/services/cart.service';
import { CartPublicFacade } from './application/facades/cart-public.facade';
import { PrismaCartRepository } from './infrastructure/repositories/prisma-cart.repository';
import { CART_REPOSITORY } from './domain/repositories/cart.repository.interface';
import { UserAuthGuard } from '../../core/guards';

@Module({
  controllers: [CartController],
  providers: [
    UserAuthGuard,
    CartService,
    CartPublicFacade,
    {
      provide: CART_REPOSITORY,
      useClass: PrismaCartRepository,
    },
  ],
  exports: [CartPublicFacade],
})
export class CartModule {}
