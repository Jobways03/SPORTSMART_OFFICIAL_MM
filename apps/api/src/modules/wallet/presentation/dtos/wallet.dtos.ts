// Phase 70 (2026-05-22) — Phase 66 audit Gap #19 (wallet flow
// audit). Pre-Phase-70 these were plain TS interfaces with no
// runtime validation; a Number()-cast on the controller side
// allowed strings/floats/NaN through. Class-validator at the pipe
// closes that.

import {
  IsInt,
  IsString,
  MaxLength,
  Min,
  Max,
} from 'class-validator';

// Server still hard-clamps with WALLET_MAX_TOPUP_PAISE at service
// level. DTO @Max is set to the platform-wide ceiling (₹100,000
// = 10,000,000 paise) so a malformed client gets a clear 400.
export class InitiateTopupDto {
  @IsInt({ message: 'amountInPaise must be an integer' })
  @Min(100, { message: 'Minimum top-up is ₹1' })
  @Max(10_000_000, { message: 'Maximum single top-up is ₹1,00,000' })
  amountInPaise!: number;
}

export class VerifyTopupDto {
  @IsString({ message: 'walletTransactionId is required' })
  @MaxLength(64)
  walletTransactionId!: string;

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

export class AdminCreditDto {
  @IsInt({ message: 'amountInPaise must be an integer' })
  @Min(1, { message: 'amountInPaise must be positive' })
  @Max(1_000_000_000, { message: 'amountInPaise exceeds maximum (₹1 crore)' })
  amountInPaise!: number;

  @IsString({ message: 'description is required' })
  @MaxLength(500)
  description!: string;

  @IsString({ message: 'internalNotes must be a string' })
  @MaxLength(1000)
  internalNotes?: string;
}

export class AdminDebitDto {
  @IsInt({ message: 'amountInPaise must be an integer' })
  @Min(1, { message: 'amountInPaise must be positive' })
  @Max(1_000_000_000, { message: 'amountInPaise exceeds maximum (₹1 crore)' })
  amountInPaise!: number;

  @IsString({ message: 'description is required' })
  @MaxLength(500)
  description!: string;

  @IsString({ message: 'internalNotes must be a string' })
  @MaxLength(1000)
  internalNotes?: string;
}
