import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { UserAuthGuard } from '../../core/guards';
import {
  CreateReviewInput,
  ProductReviewsService,
} from './product-reviews.service';

// Customer write path. New reviews are created in PENDING state so
// the admin moderation queue catches everything before it goes live.
// One review per (product, user) — repeated POSTs to the same product
// return a 409 with a helpful message.
@ApiTags('Customer Product Reviews')
@Controller('customer/products/:slug/reviews')
@UseGuards(UserAuthGuard)
export class CustomerProductReviewsController {
  constructor(private readonly service: ProductReviewsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('slug') slug: string,
    @Body() body: CreateReviewInput,
    @Req() req: Request & { userId?: string },
  ) {
    const review = await this.service.createReview(
      req.userId as string,
      slug,
      body,
    );
    return {
      success: true,
      message: 'Review submitted — pending moderation',
      data: review,
    };
  }
}
