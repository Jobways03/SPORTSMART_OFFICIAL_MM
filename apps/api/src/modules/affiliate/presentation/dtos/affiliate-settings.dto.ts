import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Admin-only PATCH for the affiliate program's tunable knobs.
 * Every field is optional — admins can save just the one they care
 * about. Numeric ranges match the schema's column widths and rule out
 * obviously-wrong values (negative rates, > 100% commission, etc.).
 */
export class UpdateAffiliateSettingsDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Commission rate must be a number with up to 2 decimal places' })
  @Min(0, { message: 'Commission rate cannot be negative' })
  @Max(100, { message: 'Commission rate cannot exceed 100%' })
  defaultCommissionPercentage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minimumPayoutAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Return window must be a whole number of days' })
  @Min(0)
  @Max(365)
  returnWindowDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100, { message: 'TDS rate cannot exceed 100%' })
  tdsRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  tdsThresholdPerFY?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Reversal window must be a whole number of days' })
  @Min(0)
  @Max(365)
  commissionReversalWindowDays?: number;
}
