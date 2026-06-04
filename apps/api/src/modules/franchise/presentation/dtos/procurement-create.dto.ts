import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class ProcurementItemDto {
  @IsNotEmpty({ message: 'Product ID is required' })
  @IsUUID(undefined, { message: 'Product ID must be a valid UUID' })
  productId!: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'Variant ID must be a valid UUID' })
  variantId?: string;

  // Phase 235 — bound the per-line quantity. @Min(1) alone let a fat-finger /
  // compromised token request 1,000,000 units of one SKU.
  @IsNotEmpty({ message: 'Quantity is required' })
  @IsNumber({}, { message: 'Quantity must be a number' })
  @Min(1, { message: 'Quantity must be at least 1' })
  @Max(10000, { message: 'Quantity must not exceed 10,000 per item' })
  quantity!: number;
}

export class ProcurementCreateDto {
  // Phase 235 — cap the request size (was unbounded → a 10,000-item submission
  // was possible) and require at least one line.
  @IsArray({ message: 'Items must be an array' })
  @ArrayMinSize(1, { message: 'At least one item is required' })
  @ArrayMaxSize(100, { message: 'A request may contain at most 100 items' })
  @ValidateNested({ each: true })
  @Type(() => ProcurementItemDto)
  items!: ProcurementItemDto[];

  // Phase 235 — accept franchise-supplied notes. Pre-235 the franchise UI sent
  // `notes` but the DTO didn't declare it, so the global ValidationPipe
  // (forbidNonWhitelisted) rejected any non-empty note with a 400 — a live
  // end-to-end bug. Now accepted (trimmed, capped) and persisted.
  @IsOptional()
  @IsString({ message: 'Notes must be a string' })
  @Transform(trim)
  @MaxLength(500, { message: 'Notes must not exceed 500 characters' })
  notes?: string;
}
