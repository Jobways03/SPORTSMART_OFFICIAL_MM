import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsString, Matches, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Phase 34 (2026-05-21) — bulk-reorder one row.
 */
export class ReorderItemDto {
  @IsString()
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: 'id must be a UUID',
  })
  id!: string;

  @IsInt()
  @Min(0)
  sortOrder!: number;
}

/**
 * Phase 34 (2026-05-21) — bulk-reorder body. Cap at 200 to bound the
 * transaction size; reordering more than a couple hundred siblings is
 * a structural problem, not a UX flow.
 */
export class AdminReorderCategoriesDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'items must contain at least one entry' })
  @ArrayMaxSize(200, { message: 'cannot reorder more than 200 categories per request' })
  @ValidateNested({ each: true })
  @Type(() => ReorderItemDto)
  items!: ReorderItemDto[];
}
