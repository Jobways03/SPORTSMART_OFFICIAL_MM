import { Module } from '@nestjs/common';
import { AdminDiscountsController } from './controllers/admin-discounts.controller';
import { AdminAuthGuard } from '../../core/guards';

@Module({
  controllers: [AdminDiscountsController],
  providers: [AdminAuthGuard],
})
export class DiscountsModule {}
