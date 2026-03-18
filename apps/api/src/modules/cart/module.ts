import { Module } from '@nestjs/common';
import { CartController } from './controllers/cart.controller';
import { UserAuthGuard } from '../../core/guards';

@Module({
  controllers: [CartController],
  providers: [UserAuthGuard],
})
export class CartModule {}
