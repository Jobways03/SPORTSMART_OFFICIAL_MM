import { Module } from '@nestjs/common';
import { AdminAuthGuard } from '../../core/guards';
import { ContentService } from './content.service';
import {
  AdminContentController,
  StorefrontContentController,
} from './content.controllers';

@Module({
  controllers: [StorefrontContentController, AdminContentController],
  providers: [AdminAuthGuard, ContentService],
  exports: [ContentService],
})
export class ContentModule {}
