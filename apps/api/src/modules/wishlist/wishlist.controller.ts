import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { UserAuthGuard } from '../../core/guards';
import { Idempotent } from '../../core/decorators/idempotent.decorator';
import { WishlistService } from './wishlist.service';
import { AddToWishlistDto, WishlistListQueryDto } from './wishlist.dto';

/**
 * Phase 202 — wishlist controller hardening.
 *
 *   - #4: the POST body is now a class-validator DTO (was a bare TS
 *     interface the ValidationPipe skipped).
 *   - #5: @Throttle on every endpoint — 30/min on the mutating POST/
 *     DELETE/move-to-cart, 60/min on the reads.
 *   - #8: GET /ids feeds client-side heart seeding.
 *   - #7: POST /:itemId/move-to-cart re-validates then removes.
 *   - @Idempotent on POST + move-to-cart so a retried request doesn't
 *     double-add / double-move.
 */
@ApiTags('Wishlist')
@Controller('customer/wishlist')
@UseGuards(UserAuthGuard)
export class WishlistController {
  constructor(private readonly service: WishlistService) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async list(
    @Req() req: Request & { userId?: string },
    @Query() query: WishlistListQueryDto,
  ) {
    const data = await this.service.list(
      req.userId as string,
      query.page ?? 1,
      query.limit ?? 50,
    );
    return { success: true, message: 'Wishlist retrieved', data };
  }

  /**
   * Phase 202 (#8) — id-only projection for client-side seeding. The
   * catalog / PDP calls this once on mount so every heart can render in
   * its correct filled/empty state without a per-card request.
   */
  @Get('ids')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async ids(@Req() req: Request & { userId?: string }) {
    const data = await this.service.getWishlistedIds(req.userId as string);
    return { success: true, message: 'Wishlist ids retrieved', data };
  }

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  @HttpCode(HttpStatus.CREATED)
  async add(
    @Req() req: Request & { userId?: string },
    @Body() body: AddToWishlistDto,
  ) {
    const data = await this.service.add(req.userId as string, body);
    return { success: true, message: 'Added to wishlist', data };
  }

  /**
   * Phase 202 (#7) — move a saved item into the cart. Re-validates the
   * product/variant (active + approved + in stock) and removes the
   * wishlist row. The storefront performs the actual cart insert via the
   * existing POST /customer/cart/items; this endpoint is the validated
   * backend entry point + event emitter for a server-side path.
   */
  @Post(':itemId/move-to-cart')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  @HttpCode(HttpStatus.OK)
  async moveToCart(
    @Req() req: Request & { userId?: string },
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
  ) {
    const data = await this.service.moveToCart(req.userId as string, itemId);
    return { success: true, message: 'Moved to cart', data };
  }

  @Delete(':itemId')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async remove(
    @Req() req: Request & { userId?: string },
    @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string,
  ) {
    await this.service.remove(req.userId as string, itemId);
    return { success: true, message: 'Removed from wishlist' };
  }
}
