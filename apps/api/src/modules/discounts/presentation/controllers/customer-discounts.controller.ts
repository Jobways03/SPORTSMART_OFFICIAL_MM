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
import { Throttle } from '@nestjs/throttler';
import { UserAuthGuard } from '../../../../core/guards';
import { Idempotent } from '../../../../core/decorators/idempotent.decorator';
import { PrismaService } from '../../../../bootstrap/database/prisma.service';
import { DiscountsService } from '../../application/services/discounts.service';
import {
  DiscountFraudService,
  TooManyCouponAttemptsError,
} from '../../application/services/discount-fraud.service';
import { ValidateCouponDto } from '../dtos/validate-coupon.dto';

/**
 * Phase 62 (2026-05-22) — coupon validate controller hardening.
 *
 * Pre-Phase-62:
 *   - Inline TS body type, no class-validator (audit Gap #6).
 *   - No @Idempotent — every retry of "Apply" wrote a fresh
 *     CouponAttempt row and ate into the rate-limit budget
 *     (audit Gap #11).
 *   - Single-coupon enforcement relied on client-supplied
 *     `currentCouponCode`; a client that cleared the field could
 *     stack codes (audit Gap #10).
 *   - @Throttle missing on the validate endpoint (audit Gap #14
 *     surface — coupon brute force).
 *
 * Phase 62 closes all four: DTO at the pipe layer, @Idempotent
 * for retry dedup, server-side query for active RESERVED
 * redemptions per customer as the authoritative single-coupon
 * gate, and @Throttle to bound the hot loop.
 */
@ApiTags('Customer Discounts')
@Controller('customer/coupons')
@UseGuards(UserAuthGuard)
export class CustomerDiscountsController {
  constructor(
    private readonly discountsService: DiscountsService,
    private readonly fraud: DiscountFraudService,
    private readonly prisma: PrismaService,
  ) {}

  // POST /customer/coupons/validate
  @Post('validate')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Idempotent()
  async validate(@Req() req: any, @Body() dto: ValidateCouponDto) {
    const customerId: string | null = req?.userId ?? req?.user?.id ?? null;

    // Audit Gap #10 — server-side single-coupon enforcement. The
    // pre-Phase-62 path trusted the client-supplied
    // currentCouponCode; a tampered client could pass it blank and
    // stack a second code on top of an existing reservation. The
    // server now queries for any active (RESERVED) DiscountRedemption
    // owned by this customer; if one exists for a DIFFERENT code,
    // refuse the new application regardless of currentCouponCode.
    if (customerId) {
      const activeReservation = await this.prisma.discountRedemption.findFirst({
        where: {
          customerId,
          status: 'RESERVED',
        },
        select: { discountCode: true },
      });
      if (
        activeReservation?.discountCode &&
        activeReservation.discountCode.toUpperCase() !== dto.code
      ) {
        throw new BadRequestException(
          'Only one coupon can be applied per order. Remove the current coupon to apply a different one.',
        );
      }
    }
    // Backstop on the client-supplied field — kept for the
    // pre-reservation case where the customer has only the
    // session-side preview and no DB row yet.
    if (
      dto.currentCouponCode &&
      dto.currentCouponCode !== dto.code
    ) {
      throw new BadRequestException(
        'Only one coupon can be applied per order. Remove the current coupon to apply a different one.',
      );
    }

    // Phase E (P1.4) — fraud / rate-limit. Build the attempt context
    // first; we use it for both the rate-limit gate and the
    // outcome-recording call after validation.
    const ctx = {
      customerId,
      ipAddress:
        (req?.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
        req?.ip ||
        null,
      deviceId: req?.headers?.['x-device-id'] ?? null,
      codeAttempted: dto.code,
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
        dto.code,
        Number(dto.subtotal || 0),
        Array.isArray(dto.items) ? dto.items : [],
        // Phase E (P1.3) — eligibility context. Auth guard already
        // populated req.userId / req.user; pass through so customer-
        // scoped rules (FIRST_ORDER_ONLY, velocity, etc.) light up.
        customerId
          ? { customerId }
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
