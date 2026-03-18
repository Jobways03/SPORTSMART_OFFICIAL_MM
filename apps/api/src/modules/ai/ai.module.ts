import { Module } from '@nestjs/common';
import { AiContentController } from './controllers/ai-content.controller';
import { SellerAuthGuard, AdminAuthGuard } from '../../core/guards';

@Module({
  controllers: [AiContentController],
  providers: [SellerAuthGuard, AdminAuthGuard],
})
export class AiModule {}
