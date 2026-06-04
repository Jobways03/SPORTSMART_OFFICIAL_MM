// Phase 70 (2026-05-22) — Phase 66 audit Gap #19 (wallet flow
// audit). Pre-Phase-70 these were plain TS interfaces with no
// runtime validation; a Number()-cast on the controller side
// allowed strings/floats/NaN through. Class-validator at the pipe
// closes that.

import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

// Phase 183 (#1/#11) — charset guard for free-text money-adjustment fields.
// Blocks markup / control chars that could become an XSS or CSV-formula payload
// in a downstream PDF/email/statement render.
const SAFE_TEXT = /^[\w\s.,!?():@/\-\n₹%+*='"&#]*$/u;
// Audit-grade reference (support ticket / dispute / UI-generated id).
const REF_NUMBER = /^[A-Za-z0-9_-]+$/;
// Phase 183 (#6) — a single direct adjustment is capped at ₹5 lakh; larger
// amounts must go through the dual-approval WalletAdjustment flow (audit #162).
const MAX_DIRECT_ADJUSTMENT_PAISE = 50_000_000;

// Phase 182 (Customer Wallet audit #12) — validated pagination on the
// transaction history. Query strings are coerced to int; out-of-range → 400
// (the service still clamps as a backstop).
export class WalletTransactionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be ≥ 1' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be ≥ 1' })
  @Max(100, { message: 'limit must be ≤ 100' })
  limit?: number;
}

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

// Phase 183 — a manual wallet adjustment now carries a REQUIRED audit-grade
// `reason` (#2), an optional `referenceNumber` that becomes the DB-idempotency
// key (#3), a ₹5L cap (#6), min-length + charset on free text (#1/#11), and a
// properly-optional `internalNotes` (was missing @IsOptional → a latent bug).
export class AdminCreditDto {
  @IsInt({ message: 'amountInPaise must be an integer' })
  @Min(1, { message: 'amountInPaise must be positive' })
  @Max(MAX_DIRECT_ADJUSTMENT_PAISE, { message: 'amountInPaise exceeds the ₹5,00,000 single-adjustment cap — use the dual-approval flow' })
  amountInPaise!: number;

  @IsString({ message: 'reason is required' })
  @MinLength(3, { message: 'reason must be at least 3 characters' })
  @MaxLength(500)
  @Matches(SAFE_TEXT, { message: 'reason contains unsupported characters' })
  reason!: string;

  @IsString({ message: 'description is required' })
  @MinLength(3, { message: 'description must be at least 3 characters' })
  @MaxLength(500)
  @Matches(SAFE_TEXT, { message: 'description contains unsupported characters' })
  description!: string;

  @IsOptional()
  @IsString({ message: 'internalNotes must be a string' })
  @MaxLength(2000)
  @Matches(SAFE_TEXT, { message: 'internalNotes contains unsupported characters' })
  internalNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(REF_NUMBER, { message: 'referenceNumber must be alphanumeric / dash / underscore' })
  referenceNumber?: string;
}

export class AdminDebitDto {
  @IsInt({ message: 'amountInPaise must be an integer' })
  @Min(1, { message: 'amountInPaise must be positive' })
  @Max(MAX_DIRECT_ADJUSTMENT_PAISE, { message: 'amountInPaise exceeds the ₹5,00,000 single-adjustment cap — use the dual-approval flow' })
  amountInPaise!: number;

  @IsString({ message: 'reason is required' })
  @MinLength(3, { message: 'reason must be at least 3 characters' })
  @MaxLength(500)
  @Matches(SAFE_TEXT, { message: 'reason contains unsupported characters' })
  reason!: string;

  @IsString({ message: 'description is required' })
  @MinLength(3, { message: 'description must be at least 3 characters' })
  @MaxLength(500)
  @Matches(SAFE_TEXT, { message: 'description contains unsupported characters' })
  description!: string;

  @IsOptional()
  @IsString({ message: 'internalNotes must be a string' })
  @MaxLength(2000)
  @Matches(SAFE_TEXT, { message: 'internalNotes contains unsupported characters' })
  internalNotes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(REF_NUMBER, { message: 'referenceNumber must be alphanumeric / dash / underscore' })
  referenceNumber?: string;
}
