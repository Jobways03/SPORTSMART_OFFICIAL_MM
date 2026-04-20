import { Module } from '@nestjs/common';
import { AiContentController } from './controllers/ai-content.controller';
import { AnyAuthGuard, SellerAuthGuard, AdminAuthGuard } from '../../core/guards';

@Module({
  controllers: [AiContentController],
  providers: [AnyAuthGuard, SellerAuthGuard, AdminAuthGuard],
})
export class AiModule {}
