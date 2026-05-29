import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
// Phase 85 (2026-05-23) — reuse the canonical courier enum from
// Phase 82 so the admin override path and the seller path share one
// supported-couriers list.
import { SUPPORTED_COURIERS } from '../../../orders/presentation/dtos/update-fulfillment-status.dto';

/**
 * Phase 85 (2026-05-23) — manual AWB attachment audit Gaps #9, #10,
 * #14, #19, #23.
 *
 * Pre-Phase-85 the admin AWB attach endpoint accepted an inline
 * `{ courierName?, awb?, trackingUrl? }` with no class-validator
 * decorators. Five problems:
 *   1. Whitespace-only AWB passed the "at least one of courier/awb"
 *      check at the controller (Gap #9).
 *   2. Free-text courier was stored as "DTDC" / "dtdc" / "D.T.D.C."
 *      — reporting couldn't aggregate (Gap #10).
 *   3. trackingUrl could be `javascript:alert(1)` (Gap #23).
 *   4. A re-submit silently overwrote the prior AWB with no audit
 *      reason (Gap #19).
 *   5. "At least one of courier/awb" was too loose for the SHIPPED
 *      transition — both are needed for a customer tracking link
 *      (Gap #14).
 */
export class AttachAwbDto {
  @IsString({ message: 'courierName is required' })
  @MaxLength(64)
  @IsIn(SUPPORTED_COURIERS as readonly string[], {
    message: `courierName must be one of ${SUPPORTED_COURIERS.join(', ')}`,
  })
  courierName!: string;

  // Phase 85 — Gap #9. Mirror seller-side AWB format check from
  // UpdateFulfillmentStatusDto so the two paths reject the same
  // garbage. Accepts every courier AWB shape we ship.
  @IsString({ message: 'awb is required' })
  @Matches(/^[A-Za-z0-9-]{8,30}$/, {
    message: 'awb must be 8-30 chars, alphanumeric or dash only',
  })
  awb!: string;

  // Phase 85 — Gap #23. URL validation with protocol whitelist —
  // blocks `javascript:` URLs explicitly. Limited to http/https to
  // close XSS-via-href surface in admin / customer rendering.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(/^https?:\/\/.+/i, {
    message: 'trackingUrl must be an http(s) URL',
  })
  trackingUrl?: string;

  // Phase 85 — Gap #19. Replace flag. When set, the prior AWB is
  // archived to sub_order_awb_history with `detached_at = NOW()`
  // and a new history row is inserted. Required when the sub-order
  // already has a trackingNumber — the service guards the overwrite
  // path so a fat-fingered re-submit can't silently lose the
  // previous AWB.
  @IsOptional()
  @IsBoolean()
  replace?: boolean;

  // Phase 85 — Gap #19. When replace=true, a 10..500 char reason is
  // mandatory. `ValidateIf` makes this conditional so a first-attach
  // (no prior AWB) can omit it.
  @ValidateIf((o: AttachAwbDto) => o.replace === true)
  @IsString({ message: 'reason is required when replace=true' })
  @Length(10, 500, {
    message: 'reason must be 10..500 chars when replace=true',
  })
  reason?: string;
}
