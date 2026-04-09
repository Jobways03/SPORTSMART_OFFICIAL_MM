import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserAuthGuard } from '../../../core/guards';
import { CheckoutService } from '../application/services/checkout.service';

@ApiTags('Checkout')
@Controller('customer/checkout')
@UseGuards(UserAuthGuard)
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  // ── POST /customer/checkout/initiate ────────────────────────────────
  @Post('initiate')
  async initiateCheckout(
    @Req() req: any,
    @Body() body: { addressId: string },
  ) {
    const result = await this.checkoutService.initiateCheckout(
      req.userId,
      body.addressId,
    );
    return { success: true, ...result };
  }

  // ── GET /customer/checkout/summary ──────────────────────────────────
  @Get('summary')
  async getCheckoutSummary(@Req() req: any) {
    const data = await this.checkoutService.getCheckoutSummary(req.userId);
    return {
      success: true,
      message: 'Checkout summary retrieved',
      data,
    };
  }

  // ── POST /customer/checkout/remove-unserviceable ────────────────────
  @Post('remove-unserviceable')
  async removeUnserviceableItems(@Req() req: any) {
    const result = await this.checkoutService.removeUnserviceableItems(
      req.userId,
    );
    return { success: true, ...result };
  }

  // ── POST /customer/checkout/place-order ─────────────────────────────
  @Post('place-order')
  async placeOrder(
    @Req() req: any,
    @Body() body: { paymentMethod?: string },
  ) {
    const data = await this.checkoutService.placeOrder(
      req.userId,
      body.paymentMethod,
    );
    return {
      success: true,
      message: 'Order placed successfully',
      data,
    };
  }
}
