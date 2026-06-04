import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Phase 55 (2026-05-21) — DTO hardening for the procurement-receipt
 * endpoint.
 *
 * Pre-Phase-55 the DTO was @IsNumber / @Min(0)-only; nothing enforced
 * damagedQty <= receivedQty, so a frontend bug could submit
 * { receivedQty: 5, damagedQty: 10 } and corrupt the
 * goodQty = receivedQty - damagedQty math downstream into negative
 * stock adds. The custom validator below closes that hole.
 *
 * @IsInt also tightens what was previously @IsNumber — receipt
 * quantities must be whole units (no fractional damage).
 */

function DamagedNotMoreThanReceived(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'damagedNotMoreThanReceived',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(_value: unknown, args?: any) {
          const obj = (args?.object ?? {}) as ReceiptItemDto;
          if (obj.damagedQty == null) return true;
          return obj.damagedQty <= obj.receivedQty;
        },
        defaultMessage() {
          return 'damagedQty must not exceed receivedQty';
        },
      },
    });
  };
}

export class ReceiptItemDto {
  @IsNotEmpty({ message: 'Item ID is required' })
  @IsUUID(undefined, { message: 'Item ID must be a valid UUID' })
  itemId!: string;

  @IsInt({ message: 'Received quantity must be a whole number' })
  @Min(0, { message: 'Received quantity must be at least 0' })
  @Max(1_000_000, { message: 'Received quantity is unreasonably large' })
  receivedQty!: number;

  @IsOptional()
  @IsInt({ message: 'Damaged quantity must be a whole number' })
  @Min(0, { message: 'Damaged quantity must be at least 0' })
  @DamagedNotMoreThanReceived()
  damagedQty?: number;
}

export class ProcurementReceiptDto {
  // Phase 236 — bound the receipt array (was unbounded).
  @IsArray({ message: 'Items must be an array' })
  @ArrayMinSize(1, { message: 'At least one item is required' })
  @ArrayMaxSize(100, { message: 'A receipt may contain at most 100 items' })
  @ValidateNested({ each: true })
  @Type(() => ReceiptItemDto)
  items!: ReceiptItemDto[];
}
