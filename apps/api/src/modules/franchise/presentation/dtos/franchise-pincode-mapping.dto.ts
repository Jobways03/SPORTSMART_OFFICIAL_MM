import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Phase 159m — admin pincode → franchise coverage assignment DTOs.
 *
 * Indian PIN: 6 digits, first digit 1-9 (no leading zero) — same shape the
 * self-delivery pincode validator already enforces.
 */
export const INDIAN_PINCODE_REGEX = /^[1-9][0-9]{5}$/;
export const PINCODE_PRIORITY_MIN = 0;
export const PINCODE_PRIORITY_MAX = 1000;
export const BULK_PINCODES_MAX = 5000;

/** Single pincode assignment / update (PUT). */
export class AssignPincodeDto {
  @IsString()
  @Matches(INDIAN_PINCODE_REGEX, {
    message: 'pincode must be a 6-digit Indian PIN (no leading zero)',
  })
  pincode!: string;

  // Higher wins when multiple franchises map the same pincode.
  @IsOptional()
  @IsInt()
  @Min(PINCODE_PRIORITY_MIN)
  @Max(PINCODE_PRIORITY_MAX)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;

  // Optimistic concurrency: reject (409) if the row moved since the client
  // read it. Omitted → no check (first-write / non-version-tracking clients).
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}

/** Bulk assignment (POST) — one priority/reason applied to many pincodes. */
export class BulkAssignPincodesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_PINCODES_MAX)
  @IsString({ each: true })
  @Matches(INDIAN_PINCODE_REGEX, {
    each: true,
    message: 'each pincode must be a 6-digit Indian PIN (no leading zero)',
  })
  pincodes!: string[];

  @IsOptional()
  @IsInt()
  @Min(PINCODE_PRIORITY_MIN)
  @Max(PINCODE_PRIORITY_MAX)
  priority?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
