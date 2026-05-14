import { Module } from '@nestjs/common';
import { UserAuthGuard } from '../../core/guards';
import { WishlistController } from './wishlist.controller';
import { WishlistService } from './wishlist.service';

@Module({
  controllers: [WishlistController],
  providers: [UserAuthGuard, WishlistService],
  exports: [WishlistService],
})
export class WishlistModule {}
