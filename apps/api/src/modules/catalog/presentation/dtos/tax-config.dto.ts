import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { SupplyTaxability } from '@prisma/client';

/**
 * Phase 45 (2026-05-21) — class-validated DTOs for the tax-config
 * write paths. Replaces the inline @Body() body: {...} on the bulk
 * endpoint and gives the verify endpoint its own optimistic-lock +
 * reviewer-note shape.
 */

/**
 * Phase 46 (2026-05-21) — hard upper bound on the per-call batch size.
 * Pre-Phase-46 the controller had a silent `take: 2000` truncation
 * which let a category filter matching 5000 products quietly drop
 * 3000 of them. The DTO now caps explicit `productIds` at the same
 * 500-row value; the controller enforces the same cap for the
 * category-filter path and refuses (rather than truncates) when the
 * match set is larger.
 */
export const BULK_TAX_CONFIG_MAX_PRODUCTS = 500;

export class BulkUpdateTaxConfigDto {
  /**
   * Explicit target list. When present, productIds wins over
   * categoryId.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(BULK_TAX_CONFIG_MAX_PRODUCTS, {
    message: `cannot supply more than ${BULK_TAX_CONFIG_MAX_PRODUCTS} productIds per request`,
  })
  @IsUUID('4', { each: true })
  productIds?: string[];

  @IsOptional()
  @IsUUID('4')
  categoryId?: string | null;

  /**
   * When true + categoryId, filter to products whose hsnCode is
   * NULL or empty. Lets ops backfill in waves.
   */
  @IsOptional()
  missingHsnOnly?: boolean;

  // ── Tax fields. At least one must be supplied; the controller
  //    enforces the disjunction after validation passes. ──

  @IsOptional()
  @IsString()
  @Matches(/^\d{4,8}$/, {
    message: 'hsnCode must be 4-8 digits per CBIC HSN hierarchical levels',
  })
  hsnCode?: string | null;

  // Phase 45 — tightened to match the single-product UpdateProductDto
  // (the pre-Phase-45 bulk path capped at 4000 which silently
  // disallowed cess rates and any future custom > 40% rate).
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  gstRateBps?: number;

  // Phase 46 (2026-05-21) — Gap #18. Bulk path can now update cess
  // alongside the other tax fields. Single-product UpdateProductDto
  // already supports it; the bulk endpoint was the only path that
  // forced a per-product round-trip for cess-only updates
  // (e.g. tobacco / aerated drinks compliance changes).
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  cessRateBps?: number;

  @IsOptional()
  @IsEnum(SupplyTaxability)
  supplyTaxability?: SupplyTaxability;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2,6}$/, {
    message: 'defaultUqcCode must be 2-6 uppercase letters per CBIC UQC list',
  })
  defaultUqcCode?: string | null;
}

export class VerifyTaxConfigDto {
  /**
   * Phase 45 — optimistic-lock token. The admin's UI passes the
   * `taxConfigVersion` they reviewed; the server refuses the attest
   * with a 409 when the row has drifted (concurrent seller edit, etc).
   * Omit to skip the lock check (legacy callers; admin UI should
   * always send).
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;

  /**
   * Free-text reviewer note. Captured into the audit log row so a CA
   * reviewer can trace the attestation reasoning ("Spreadsheet
   * review 2026-03-12", "Bulk import from finance team", etc).
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reviewerNote?: string;
}

export class BulkVerifyTaxConfigDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500, { message: 'cannot attest more than 500 products per request' })
  @IsUUID('4', { each: true })
  productIds!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reviewerNote?: string;
}
