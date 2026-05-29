import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  IsDateString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Phase 159p (audit #10) — optional per-item dispatched quantity so admin can
 * ship a partial quantity (e.g. 80 of 100 approved). Items omitted from the
 * array default to their full approvedQty (back-compatible with the old
 * all-or-nothing dispatch). The service caps dispatchedQty at approvedQty.
 */
export class ProcurementDispatchItemDto {
  @IsNotEmpty({ message: 'Item ID is required' })
  @IsUUID(undefined, { message: 'Item ID must be a valid UUID' })
  itemId!: string;

  @IsInt({ message: 'Dispatched quantity must be a whole number' })
  @Min(1, { message: 'Dispatched quantity must be at least 1' })
  dispatchedQty!: number;
}

export class ProcurementDispatchDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  // Phase 159p (audit #20) — shape guard: AWB / tracking numbers are
  // alphanumeric with dashes/slashes/spaces. Rejects free-text junk + any
  // control characters without coupling to a specific courier.
  @Matches(/^[A-Za-z0-9 \-_/]+$/, {
    message: 'trackingNumber may only contain letters, digits, spaces and - _ /',
  })
  trackingNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[A-Za-z0-9 .,&'\-_/()]+$/, {
    message: 'carrierName contains unsupported characters',
  })
  carrierName?: string;

  /**
   * ISO 8601 date string. Admin can tell franchise when they should expect
   * the shipment. Optional — omit if not yet known.
   */
  @IsOptional()
  @IsDateString()
  expectedDeliveryAt?: string;

  /**
   * Optional per-item dispatched quantities. Omit for full dispatch of every
   * approved item (legacy behaviour).
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcurementDispatchItemDto)
  items?: ProcurementDispatchItemDto[];
}
