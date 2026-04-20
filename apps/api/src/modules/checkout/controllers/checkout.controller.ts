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
    const isOnline = (data as any).paymentMethod === 'ONLINE';
    return {
      success: true,
      message: isOnline
        ? 'Order created — complete payment to confirm'
        : 'Order placed successfully',
      data,
    };
  }

  // ── POST /customer/checkout/payment/retry ───────────────────────────
  @Post('payment/retry')
  async retryPayment(
    @Req() req: any,
    @Body() body: { orderNumber: string },
  ) {
    if (!body.orderNumber) {
      return { success: false, message: 'orderNumber is required' };
    }
    const data = await this.checkoutService.retryPayment(
      req.userId,
      body.orderNumber,
    );
    return {
      success: true,
      message: 'New payment session created — complete payment to confirm',
      data,
    };
  }

  // ── POST /customer/checkout/payment/verify ──────────────────────────
  @Post('payment/verify')
  async verifyPayment(
    @Req() req: any,
    @Body()
    body: {
      razorpayOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
    },
  ) {
    if (
      !body.razorpayOrderId ||
      !body.razorpayPaymentId ||
      !body.razorpaySignature
    ) {
      return {
        success: false,
        message:
          'razorpayOrderId, razorpayPaymentId, and razorpaySignature are required',
      };
    }
    const data = await this.checkoutService.verifyPayment(req.userId, {
      razorpayOrderId: body.razorpayOrderId,
      razorpayPaymentId: body.razorpayPaymentId,
      razorpaySignature: body.razorpaySignature,
    });
    return {
      success: true,
      message: 'Payment verified — order confirmed',
      data,
    };
  }
}
