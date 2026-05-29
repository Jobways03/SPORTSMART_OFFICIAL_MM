import { IsNumber, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * Phase 138 — request validation for PATCH /admin/commission/:id/adjust.
 * Previously an inline TS interface (no runtime validation) — malformed bodies
 * reached the service. The service additionally caps newAdminEarning at the
 * order's totalPlatformAmount (a record can't earn the platform more than the
 * customer paid); the @Max here is a coarse safety ceiling.
 */
export class AdjustCommissionDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(10_000_000) // ₹1 crore — coarse upper bound
  newAdminEarning!: number;

  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  reason!: string;
}
