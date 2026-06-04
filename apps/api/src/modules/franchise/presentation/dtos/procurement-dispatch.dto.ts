import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  IsDateString,
  ValidateNested,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Phase 236 — reject an expected-delivery date set clearly in the past (e.g. a
 * fat-fingered "1990"). Allows today onward (date-only granularity). @IsDateString
 * alone accepted any well-formed ISO date including historical ones.
 */
function ExpectedDeliveryNotInPast(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'expectedDeliveryNotInPast',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (value == null || value === '') return true;
          const d = new Date(value as string);
          if (Number.isNaN(d.getTime())) return true; // @IsDateString handles shape
          const startOfToday = new Date();
          startOfToday.setHours(0, 0, 0, 0);
          return d.getTime() >= startOfToday.getTime();
        },
        defaultMessage() {
          return 'expectedDeliveryAt cannot be in the past';
        },
      },
    });
  };
}

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
  @Max(1000000, { message: 'Dispatched quantity is implausibly large' })
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
  @ExpectedDeliveryNotInPast()
  expectedDeliveryAt?: string;

  /**
   * Optional per-item dispatched quantities. Omit for full dispatch of every
   * approved item (legacy behaviour).
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100, { message: 'At most 100 items per dispatch' })
  @ValidateNested({ each: true })
  @Type(() => ProcurementDispatchItemDto)
  items?: ProcurementDispatchItemDto[];
}
