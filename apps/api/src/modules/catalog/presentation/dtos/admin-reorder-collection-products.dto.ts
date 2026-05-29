import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Phase 37 (2026-05-21) — one reorder item.
 */
export class ReorderCollectionProductItemDto {
  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'productId must be a UUID',
  })
  productId!: string;

  @IsInt()
  @Min(0)
  sortOrder!: number;
}

/**
 * Phase 37 (2026-05-21) — bulk reorder products inside one collection.
 * Mirrors Phase 34's category reorder pattern.
 */
export class AdminReorderCollectionProductsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ReorderCollectionProductItemDto)
  items!: ReorderCollectionProductItemDto[];
}
