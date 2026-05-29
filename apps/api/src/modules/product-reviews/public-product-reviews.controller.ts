import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NotFoundAppException } from '../../core/exceptions';
import { ProductReviewsService } from './product-reviews.service';

// Public PDP read — returns approved reviews + the aggregate summary
// (average rating, count, star breakdown) in a single payload. Mobile
// consumes this via useProductReviews(slug). 404s when the product
// slug doesn't exist so the mobile hook can distinguish "no product"
// from "no reviews".
@ApiTags('Storefront Product Reviews')
@Controller('storefront/products/:slug/reviews')
export class PublicProductReviewsController {
  constructor(private readonly service: ProductReviewsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(@Param('slug') slug: string) {
    const data = await this.service.listPublicByProductSlug(slug);
    if (!data) throw new NotFoundAppException('Product not found');
    return { success: true, message: 'Product reviews', data };
  }
}
