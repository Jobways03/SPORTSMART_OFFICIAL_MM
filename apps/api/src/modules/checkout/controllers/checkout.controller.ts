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
import { Idempotent } from '../../../core/decorators/idempotent.decorator';
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
  // Phase 1 (PR 1.3) — @Idempotent: a retried place-order POST (browser
  // refresh, network blip during the Razorpay-order create, double-tap
  // on the "Pay" button) returns the original response instead of
  // creating a duplicate MasterOrder + duplicate Razorpay order +
  // duplicate stock reservation. Client MUST supply X-Idempotency-Key.
  @Post('place-order')
  @Idempotent()
  async placeOrder(
    @Req() req: any,
    @Body()
    body: {
      paymentMethod?: string;
      couponCode?: string;
      // Affiliate referral code from URL ?ref= cookie. Independent of
      // couponCode — a customer can apply both (a discount coupon AND
      // an affiliate referral code), or just one, or neither. The
      // attribution rule (SRS §7.3) is "coupon wins" if the coupon
      // itself is also an affiliate-owned code.
      referralCode?: string;
      // Optional wallet portion to apply to this order. Server clamps
      // to chargedTotal and validates available balance before debit.
      walletApplyAmountInPaise?: number;
      // Shipping option (v1). The customer picks one at checkout; the
      // server re-quotes it against the current cart subtotal before
      // committing the order so the fee can't be tampered with.
      shippingOptionId?: string | null;
    },
  ) {
    const walletApply = Number(body.walletApplyAmountInPaise);
    const data = await this.checkoutService.placeOrder(
      req.userId,
      body.paymentMethod,
      body.couponCode,
      body.referralCode,
      Number.isFinite(walletApply) && walletApply > 0 ? walletApply : undefined,
      body.shippingOptionId ?? null,
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
  // Phase 1 (PR 1.3) — @Idempotent: layered with PR 0.12's TOCTOU
  // close inside the facade. The TOCTOU close prevents duplicate
  // event fan-out on the DB side; this decorator prevents duplicate
  // gateway round-trips on the API side (a retried verify still
  // hits Razorpay's fetchPayment, which has rate limits worth
  // respecting).
  @Post('payment/verify')
  @Idempotent()
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
