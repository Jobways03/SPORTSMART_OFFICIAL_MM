import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Phase 66 (2026-05-22) — DTOs for the place-order + payment-verify
 * surface (audit Gaps #6 + #13).
 *
 * Pre-Phase-66:
 *   - `paymentMethod` was a free string; anything not 'ONLINE' (case-
 *     insensitive) silently mapped to COD. Sending 'UPI' produced a
 *     COD order without complaint (audit Gap #13).
 *   - `walletApplyAmountInPaise` was Number()-coerced from a string
 *     body, with no upper bound or integer guard.
 *   - couponCode was a free string with no length cap.
 */

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export enum PlaceOrderPaymentMethod {
  COD = 'COD',
  ONLINE = 'ONLINE',
}

export class PlaceOrderDto {
  /**
   * Phase 66 (audit Gap #13) — strict enum. Pre-Phase-66 any value
   * other than (case-insensitive) 'ONLINE' silently mapped to COD;
   * a customer typing 'UPI' got a COD order without complaint.
   */
  @IsOptional()
  @IsString()
  @Transform(upper)
  @IsEnum(PlaceOrderPaymentMethod, {
    message: 'paymentMethod must be either COD or ONLINE',
  })
  paymentMethod?: PlaceOrderPaymentMethod;

  @IsOptional()
  @IsString()
  @Transform(upper)
  @MaxLength(64, { message: 'couponCode must not exceed 64 characters' })
  couponCode?: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(64, { message: 'referralCode must not exceed 64 characters' })
  referralCode?: string;

  @IsOptional()
  @IsInt({ message: 'walletApplyAmountInPaise must be an integer' })
  @Min(0, { message: 'walletApplyAmountInPaise must be non-negative' })
  walletApplyAmountInPaise?: number;

  @IsOptional()
  @IsUUID(undefined, { message: 'shippingOptionId must be a UUID' })
  shippingOptionId?: string | null;

  @IsOptional()
  @IsUUID(undefined, { message: 'taxProfileId must be a UUID' })
  taxProfileId?: string | null;
}

export class VerifyPaymentDto {
  @IsString({ message: 'razorpayOrderId is required' })
  @MaxLength(64)
  razorpayOrderId!: string;

  @IsString({ message: 'razorpayPaymentId is required' })
  @MaxLength(64)
  razorpayPaymentId!: string;

  @IsString({ message: 'razorpaySignature is required' })
  @MaxLength(256)
  razorpaySignature!: string;
}

export class RetryPaymentDto {
  @IsString({ message: 'orderNumber is required' })
  @MaxLength(64)
  orderNumber!: string;
}
