import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Phase 56 (2026-05-22) — class-validator DTOs for the admin
 * seller-mapping endpoints. Pre-Phase-56 the admin PATCH accepted
 * `@Body() body: any` with ad-hoc per-field typeof checks; nothing
 * enforced pincode format, lat/lng range, sla upper bound, or
 * pickup-address length. The same risks audit Gap #3 + #6 + #7 +
 * #15 flagged for the seller controller (already closed in Phase 51)
 * applied to admin as well.
 *
 * Notably absent from AdminUpdateMappingDto: `reservedQty` (audit
 * Gap #14). Admin should not directly write reserved count; the
 * reservation system owns it. Use the inventory-adjust flow for
 * legitimate corrections.
 */

const PINCODE_PATTERN = /^\d{6}$/;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class AdminUpdateMappingDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  stockQty?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lowStockThreshold?: number;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(64)
  sellerInternalSku?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  settlementPrice?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  procurementCost?: number | null;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500, { message: 'pickupAddress must not exceed 500 characters' })
  pickupAddress?: string | null;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @Matches(PINCODE_PATTERN, { message: 'pickupPincode must be a 6-digit Indian pincode' })
  pickupPincode?: string | null;

  @IsOptional()
  @IsLatitude({ message: 'latitude must be a valid latitude (-90 to 90)' })
  latitude?: number | null;

  @IsOptional()
  @IsLongitude({ message: 'longitude must be a valid longitude (-180 to 180)' })
  longitude?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30, { message: 'dispatchSla must not exceed 30 days' })
  dispatchSla?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  operationalPriority?: number;
}

export class RejectMappingDto {
  @IsString()
  @Transform(trim)
  @MinLength(3, { message: 'reason must be at least 3 characters' })
  @MaxLength(500, { message: 'reason must not exceed 500 characters' })
  reason!: string;
}

/**
 * Phase 58 (2026-05-22) — reason is now mandatory on every stop
 * (audit Gap #5). Pre-Phase-58 admin could click Stop on a
 * top-selling mapping with no forensic record of why; customer
 * support couldn't answer "why is X not available from seller Y"
 * without re-creating context from logs. The same 3-500 char window
 * applies as RejectMappingDto so the DB column is bounded.
 */
export class StopMappingDto {
  @IsString()
  @Transform(trim)
  @MinLength(3, { message: 'reason must be at least 3 characters' })
  @MaxLength(500, { message: 'reason must not exceed 500 characters' })
  reason!: string;
}

/**
 * Phase 57 (2026-05-22) — explicit STOPPED → APPROVED transition.
 * Reason mandatory because reapprove implies a deliberate
 * re-evaluation of whatever caused the stop.
 */
export class ReapproveMappingDto {
  @IsString()
  @Transform(trim)
  @MinLength(3, { message: 'reason must be at least 3 characters' })
  @MaxLength(500, { message: 'reason must not exceed 500 characters' })
  reason!: string;
}

/**
 * Phase 57 (2026-05-22) — bulk-approve up to 100 PENDING_APPROVAL
 * mappings at once. Repo returns per-row outcomes so the response
 * surfaces partial success.
 */
export class BulkApproveDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'mappingIds must not be empty' })
  @ArrayMaxSize(100, { message: 'Maximum 100 mappings per bulk approve' })
  @IsUUID(undefined, { each: true, message: 'each mappingId must be a UUID' })
  mappingIds!: string[];
}

/**
 * Phase 58 (2026-05-22) — bulk-stop up to 100 APPROVED mappings
 * (audit Gap #17). Shared mandatory reason gets stamped on every
 * successful row so a compliance sweep ("seller X failed quality
 * audit, stop all their listings") still leaves a per-row forensic
 * trail. Rows in any non-APPROVED status come back as ok:false.
 */
export class BulkStopDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'mappingIds must not be empty' })
  @ArrayMaxSize(100, { message: 'Maximum 100 mappings per bulk stop' })
  @IsUUID(undefined, { each: true, message: 'each mappingId must be a UUID' })
  mappingIds!: string[];

  @IsString()
  @Transform(trim)
  @MinLength(3, { message: 'reason must be at least 3 characters' })
  @MaxLength(500, { message: 'reason must not exceed 500 characters' })
  reason!: string;
}
