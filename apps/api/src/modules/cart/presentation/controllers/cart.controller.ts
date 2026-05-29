import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserAuthGuard } from '../../../../core/guards';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { CartService } from '../../application/services/cart.service';
import {
  AddCartItemDto,
  MergeCartDto,
  UpdateCartItemDto,
} from '../dtos/cart.dto';
import { CheckCartServiceabilityDto } from '../../../catalog/presentation/dtos/storefront-allocation.dto';

/**
 * Phase 61 (2026-05-22) — cart controller hardening.
 *
 * Changes vs. pre-Phase-61:
 *   - Replaced inline `@Body() body: {...}` interfaces with
 *     class-validator DTOs (audit Gap #5).
 *   - PATCH quantity ≤ 0 is now rejected by the DTO at the pipe
 *     layer (audit Gap #6) — removal goes through DELETE.
 *   - @Idempotent on POST /items + /merge so a retried request
 *     returns the cached response instead of double-adding
 *     (audit Gap #11).
 *   - @Throttle on mutating endpoints prevents a hostile client
 *     from looping POST /items unbounded (audit Gap #14). The
 *     30-per-60s budget is tuned for the storefront's typical
 *     "add 3-5 items per session" load while still cutting off
 *     enumeration / abuse.
 */
@ApiTags('Cart')
@Controller('customer/cart')
@UseGuards(UserAuthGuard)
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  async getCart(@Req() req: any) {
    const data = await this.cartService.getCart(req.userId);
    return { success: true, message: 'Cart retrieved', data };
  }

  @Post('items')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async addItem(@Req() req: any, @Body() dto: AddCartItemDto) {
    await this.cartService.addItem(
      req.userId,
      dto.productId,
      dto.variantId,
      dto.quantity ?? 1,
    );
    return { success: true, message: 'Item added to cart' };
  }

  // Sprint 3 Story 2.3 — save-for-later round-trip. Parking and
  // unparking are separate endpoints so the client UX can show
  // distinct loading states (and so we can charge them to different
  // analytics buckets later).

  @Post('items/:itemId/save-for-later')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async saveForLater(@Req() req: any, @Param('itemId') itemId: string) {
    await this.cartService.saveForLater(req.userId, itemId);
    return { success: true, message: 'Item saved for later' };
  }

  @Post('items/:itemId/move-to-cart')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async moveToCart(@Req() req: any, @Param('itemId') itemId: string) {
    await this.cartService.moveToCart(req.userId, itemId);
    return { success: true, message: 'Item moved back to cart' };
  }

  @Patch('items/:itemId')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async updateItem(
    @Req() req: any,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    await this.cartService.updateItem(req.userId, itemId, dto.quantity);
    return { success: true, message: 'Cart item updated' };
  }

  @Delete('items/:itemId')
  async removeItem(@Req() req: any, @Param('itemId') itemId: string) {
    await this.cartService.removeItem(req.userId, itemId);
    return { success: true, message: 'Item removed from cart' };
  }

  @Delete()
  async clearCart(@Req() req: any) {
    await this.cartService.clearCart(req.userId);
    return { success: true, message: 'Cart cleared' };
  }

  /**
   * Phase 64 (2026-05-22) — cart-level serviceability preview
   * (audit Gap #3). Runs the allocator preview per cart line at
   * the supplied pincode without reserving any stock. Lets the
   * cart UI tell the customer which lines won't deliver BEFORE
   * they click "Proceed to checkout" — pre-Phase-64 they only
   * learned at /checkout/initiate, by which point stock had been
   * reserved on the serviceable lines for 15 minutes.
   */
  @Post('check-serviceability')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async checkCartServiceability(
    @Req() req: any,
    @Body() dto: CheckCartServiceabilityDto,
  ) {
    const data = await this.cartService.checkCartServiceability(
      req.userId,
      dto.pincode,
    );
    return {
      success: true,
      message: data.allServiceable
        ? 'All cart items are deliverable to this pincode'
        : `${data.unserviceableCount} item(s) cannot be delivered to this pincode`,
      data,
    };
  }

  /**
   * Merge a cookie-cart from anonymous browsing into the authed cart.
   * Storefront calls this once right after login. Each item runs
   * through the normal addItem flow (stock + variant validation).
   *
   * Phase 61 — DTO-validated (max 50 items per merge), idempotent so
   * a network retry doesn't double-merge, and rate-limited so a
   * hostile login burst can't repeatedly slam the cart.
   */
  @Post('merge')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Idempotent()
  async mergeAnonCart(@Req() req: any, @Body() dto: MergeCartDto) {
    const data = await this.cartService.mergeAnonymousCart(req.userId, dto.items);
    return { success: true, message: 'Cart merged', data };
  }
}
