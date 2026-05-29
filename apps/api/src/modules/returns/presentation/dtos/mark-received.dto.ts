import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { sanitizeOptionalText } from '../../../../core/util/sanitize-text';

// Phase 96 (2026-05-23) — Mark Received audit Gap #17 closure.
//
// Structured parcel condition so finance / ops can filter on the
// condition without parsing free-text notes. OTHER falls back to the
// notes field for the specific reason. Free-text + sanitization on
// notes closes Gap #16.
export const PARCEL_CONDITIONS = [
  'OK',
  'BOX_DAMAGED',
  'ITEM_MISSING',
  'TAMPERED',
  'OTHER',
] as const;
export type ParcelCondition = (typeof PARCEL_CONDITIONS)[number];

export class MarkReceivedDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => sanitizeOptionalText(value, { maxLength: 500 }))
  notes?: string;

  @IsOptional()
  @IsIn(PARCEL_CONDITIONS as unknown as string[])
  parcelCondition?: ParcelCondition;
}
