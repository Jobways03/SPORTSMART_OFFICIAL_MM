import { Module } from '@nestjs/common';
import {
  AdminAuthGuard,
  PermissionsGuard,
  UserAuthGuard,
} from '../../core/guards';
import { ProductReviewsService } from './product-reviews.service';
import { PublicProductReviewsController } from './public-product-reviews.controller';
import { CustomerProductReviewsController } from './customer-product-reviews.controller';
import { AdminProductReviewsController } from './admin-product-reviews.controller';

@Module({
  controllers: [
    PublicProductReviewsController,
    CustomerProductReviewsController,
    AdminProductReviewsController,
  ],
  providers: [
    ProductReviewsService,
    AdminAuthGuard,
    PermissionsGuard,
    UserAuthGuard,
  ],
  exports: [ProductReviewsService],
})
export class ProductReviewsModule {}
