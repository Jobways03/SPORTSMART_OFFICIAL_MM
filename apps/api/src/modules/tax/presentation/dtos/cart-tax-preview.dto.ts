import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Phase 65 (2026-05-22) — class-validator DTO for the
 * /customer/tax-preview/cart endpoint (audit Gap #7).
 *
 * Pre-Phase-65 the body was an inline TS interface, so a
 * non-UUID `addressId` would still hit the addresses lookup
 * (DB churn) before the `.find()` returned null. Validating at
 * the pipe layer fails fast and consistently.
 *
 * Optional `couponCode` + `selectedTaxProfileId` added so the
 * preview can include discount allocation (audit Gap #1) and B2B
 * GSTIN-state override (audit Gap #6) — both wired through to the
 * underlying allocator and tax engine.
 */

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CartTaxPreviewDto {
  @IsOptional()
  @IsUUID(undefined, { message: 'addressId must be a UUID' })
  addressId?: string;

  @IsOptional()
  @IsString()
  @Transform(upper)
  @Matches(/^[A-Z0-9_-]{1,64}$/, {
    message: 'couponCode must be 1-64 chars (letters, digits, _ -)',
  })
  couponCode?: string;

  @IsOptional()
  @IsUUID(undefined, {
    message: 'selectedTaxProfileId must be a UUID',
  })
  selectedTaxProfileId?: string;
}
