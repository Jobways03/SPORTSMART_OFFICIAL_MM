import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { UserAuthGuard } from '../../../core/guards';
import { Idempotent } from '../../../core/decorators/idempotent.decorator';
import { CheckoutService } from '../application/services/checkout.service';
import {
  PlaceOrderDto,
  RetryPaymentDto,
  VerifyPaymentDto,
} from '../presentation/dtos/place-order.dto';

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
    // Phase 66 (audit Gap #12) — surface the ALLOW_ONLINE_PAYMENTS
    // flag so the storefront can hide the ONLINE option without
    // having to read its own env. Default 'true' (Razorpay configured
    // in prod).
    const allowOnlinePayments =
      (process.env.ALLOW_ONLINE_PAYMENTS ?? 'true').toLowerCase() !== 'false';
    return {
      success: true,
      message: 'Checkout summary retrieved',
      data: {
        ...(data as any),
        paymentOptions: {
          codEnabled: true,
          onlineEnabled: allowOnlinePayments,
        },
      },
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
  // Phase 1 (PR 1.3) — @Idempotent: a retried place-order POST (browser
  // refresh, network blip during the Razorpay-order create, double-tap
  // on the "Pay" button) returns the original response instead of
  // creating a duplicate MasterOrder + duplicate Razorpay order +
  // duplicate stock reservation. Client MUST supply X-Idempotency-Key.
  @Post('place-order')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Idempotent()
  async placeOrder(@Req() req: any, @Body() dto: PlaceOrderDto) {
    // Phase 66 (audit Gap #13) — strict paymentMethod. The DTO
    // enforces enum membership at the pipe; we pass the validated
    // value straight through. Pre-Phase-66 'UPI' silently became
    // COD; now it's a 400 from the validator.
    const data = await this.checkoutService.placeOrder(
      req.userId,
      dto.paymentMethod,
      dto.couponCode,
      dto.referralCode,
      dto.walletApplyAmountInPaise && dto.walletApplyAmountInPaise > 0
        ? dto.walletApplyAmountInPaise
        : undefined,
      dto.shippingOptionId ?? null,
      dto.taxProfileId ?? null,
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
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async retryPayment(@Req() req: any, @Body() dto: RetryPaymentDto) {
    const data = await this.checkoutService.retryPayment(
      req.userId,
      dto.orderNumber,
    );
    return {
      success: true,
      message: 'New payment session created — complete payment to confirm',
      data,
    };
  }

  // ── POST /customer/checkout/payment/verify ──────────────────────────
  // Phase 1 (PR 1.3) — @Idempotent: layered with PR 0.12's TOCTOU
  // close inside the facade. The TOCTOU close prevents duplicate
  // event fan-out on the DB side; this decorator prevents duplicate
  // gateway round-trips on the API side (a retried verify still
  // hits Razorpay's fetchPayment, which has rate limits worth
  // respecting).
  @Post('payment/verify')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Idempotent()
  async verifyPayment(@Req() req: any, @Body() dto: VerifyPaymentDto) {
    const data = await this.checkoutService.verifyPayment(req.userId, {
      razorpayOrderId: dto.razorpayOrderId,
      razorpayPaymentId: dto.razorpayPaymentId,
      razorpaySignature: dto.razorpaySignature,
    });
    return {
      success: true,
      message: 'Payment verified — order confirmed',
      data,
    };
  }
}
