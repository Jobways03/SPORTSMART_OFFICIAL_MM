import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Phase 159l — bounds + audit-reason + optimistic-concurrency fields added.
 */
export const PROCUREMENT_PRICE_CHANGE_REASONS = [
  'INITIAL_SETUP',
  'RENEGOTIATION',
  'PROMO',
  'CORRECTION',
  'OTHER',
] as const;

export class FranchiseProcurementPriceUpsertDto {
  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  // Phase 159l (audit #7) — upper bound. Previously @Min(0.01) only, so an
  // admin could persist the Decimal(10,2) cap (₹99,999,999.99). 1,000,000 is a
  // generous per-unit landed-cost ceiling; the service additionally rejects a
  // cost wildly above the product MRP (audit #16).
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1_000_000)
  landedUnitCost!: number;

  @IsOptional()
  @IsString()
  notes?: string;

  // Phase 159l (audit #14) — structured change reason for the audit trail.
  @IsOptional()
  @IsIn(PROCUREMENT_PRICE_CHANGE_REASONS)
  changeReason?: (typeof PROCUREMENT_PRICE_CHANGE_REASONS)[number];

  // Phase 159l (audit #8) — optimistic concurrency. When the client supplies
  // the version it last read, the upsert rejects with 409 if the row was
  // updated concurrently (two admins editing the same SKU). Omitted → no check
  // (first-write / API clients that don't track versions).
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}
