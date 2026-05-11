import {
  BadRequestException,
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UserAuthGuard } from '../../../../core/guards';
import { DiscountsService } from '../../application/services/discounts.service';
import {
  DiscountFraudService,
  TooManyCouponAttemptsError,
} from '../../application/services/discount-fraud.service';

@ApiTags('Customer Discounts')
@Controller('customer/coupons')
@UseGuards(UserAuthGuard)
export class CustomerDiscountsController {
  constructor(
    private readonly discountsService: DiscountsService,
    private readonly fraud: DiscountFraudService,
  ) {}

  // POST /customer/coupons/validate
  @Post('validate')
  async validate(
    @Req() req: any,
    @Body()
    body: {
      code: string;
      subtotal: number;
      items?: Array<{ productId: string; quantity: number; unitPrice: number }>;
      // Phase F (policy) — clients pass the currently-applied coupon
      // (if any) so we can reject any attempt to stack a second one.
      // Single-coupon-per-order is enforced at the API layer regardless
      // of what the stacking engine would otherwise allow.
      currentCouponCode?: string;
    },
  ) {
    // Single-coupon-per-order policy. If a coupon is already applied
    // to this checkout session and the customer is trying to apply a
    // *different* code, reject. Re-validating the same code (idempotent
    // refresh on subtotal change) is allowed.
    const currentCode = (body.currentCouponCode ?? '').trim().toUpperCase();
    const newCode = (body.code ?? '').trim().toUpperCase();
    if (currentCode && currentCode !== newCode) {
      throw new BadRequestException(
        'Only one coupon can be applied per order. Remove the current coupon to apply a different one.',
      );
    }

    // Phase E (P1.4) — fraud / rate-limit. Build the attempt context
    // first; we use it for both the rate-limit gate and the
    // outcome-recording call after validation.
    const ctx = {
      customerId: req?.userId ?? req?.user?.id ?? null,
      ipAddress:
        (req?.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req?.ip ||
        null,
      deviceId: req?.headers?.['x-device-id'] ?? null,
      codeAttempted: body?.code ?? '',
    };

    // Gate: too many invalid attempts → throw 429.
    try {
      await this.fraud.checkRateLimit(ctx);
    } catch (err) {
      if (err instanceof TooManyCouponAttemptsError) {
        // Use 429 so the client can show a cooldown message
        // distinct from invalid-code errors.
        throw new HttpException(
          {
            success: false,
            message: 'Too many coupon attempts. Please try again later.',
            retryAfterSeconds: err.retryAfterSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw err;
    }

    // Run the validation. On any thrown error we still record the
    // outcome so the fraud signals stay accurate.
    try {
      const data = await this.discountsService.validateCouponForCheckout(
        body.code,
        Number(body.subtotal || 0),
        Array.isArray(body.items) ? body.items : [],
        // Phase E (P1.3) — eligibility context. Auth guard already
        // populated req.userId / req.user; pass through so customer-
        // scoped rules (FIRST_ORDER_ONLY, velocity, etc.) light up.
        ctx.customerId
          ? { customerId: ctx.customerId }
          : undefined,
      );
      // Best-effort attempt log — never blocks the success response.
      void this.fraud.recordAttempt(ctx, 'VALID');
      return {
        success: true,
        message: 'Coupon applied',
        data: {
          code: data.code,
          title: data.title,
          valueType: data.valueType,
          value: data.value,
          discountAmount: data.discountAmount,
        },
      };
    } catch (err) {
      // Classify the failure for the abuse panel. Eligibility /
      // expiry messages live in the existing service errors; for
      // anything else we record as INVALID.
      const message =
        err instanceof BadRequestException
          ? typeof err.getResponse() === 'object'
            ? (err.getResponse() as any).message
            : err.message
          : (err as Error).message;
      const result = classifyAttemptFailure(message);
      void this.fraud.recordAttempt(ctx, result, message);
      throw err;
    }
  }
}

/**
 * Map the user-facing error message back to a CouponAttempt result.
 * Slightly fuzzy on purpose — message wording can drift, and the
 * categorization is just for analytics, not for any gating logic.
 */
function classifyAttemptFailure(
  message: unknown,
):
  | 'INVALID'
  | 'EXPIRED'
  | 'NOT_ELIGIBLE' {
  const text = String(message ?? '').toLowerCase();
  if (text.includes('expired')) return 'EXPIRED';
  if (
    text.includes('not eligible') ||
    text.includes('minimum') ||
    text.includes('first order') ||
    text.includes('not valid for') ||
    text.includes('already used')
  ) {
    return 'NOT_ELIGIBLE';
  }
  return 'INVALID';
}
