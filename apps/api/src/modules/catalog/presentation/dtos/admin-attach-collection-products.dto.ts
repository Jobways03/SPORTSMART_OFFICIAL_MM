import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsString,
  Matches,
} from 'class-validator';

/**
 * Phase 37 (2026-05-21) — bulk-attach products to a collection.
 *
 * Cap matches the Phase 31 moderation-bulk cap (200) for now —
 * the storefront also caps the page size at 60 per call, so 200 is
 * already a multi-screen attach. If admins routinely curate
 * 200+ products, switching to an async job is cheaper than raising
 * this synchronously.
 */
export class AdminAttachCollectionProductsDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'productIds must contain at least one entry' })
  @ArrayMaxSize(500, { message: 'cannot attach more than 500 products per request' })
  @IsString({ each: true })
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    each: true,
    message: 'each productId must be a UUID',
  })
  productIds!: string[];
}

/**
 * Phase 37 (2026-05-21) — bulk-detach products from a collection.
 * Same cap as attach. Detach is generally faster (no eligibility
 * filter), so the cap is more about bounding the response size.
 */
export class AdminDetachCollectionProductsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    each: true,
    message: 'each productId must be a UUID',
  })
  productIds!: string[];
}
