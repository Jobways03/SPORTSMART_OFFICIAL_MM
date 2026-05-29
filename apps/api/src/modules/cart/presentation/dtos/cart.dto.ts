import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Phase 61 (2026-05-22) — class-validator DTOs replacing the
 * pre-Phase-61 inline `@Body() body: {...}` shape (audit Gap #5).
 *
 * Pre-Phase-61 the cart controller declared body types as TS
 * interfaces, which NestJS's ValidationPipe could not validate —
 * every field was effectively `any` for runtime validation. A
 * hostile client could send `{ productId: 12345, quantity: -1 }`
 * and the request reached the service layer before the typeof
 * checks rejected it.
 *
 * Per-field rules:
 *   - @IsUUID on entity refs so a malformed id is rejected at the
 *     pipe layer (not a service-level findFirst miss).
 *   - @Min(1) @Max(99) on quantity caps both the harmless typo
 *     (negative qty) and the abuse case (qty = 1e9).
 *   - MergeCartDto's outer @ArrayMaxSize(50) bounds the merge
 *     batch so a malicious sessionStorage payload can't bloat the
 *     authenticated user's cart in one POST.
 */

const MAX_QTY_PER_LINE = 99;
const MAX_MERGE_ITEMS = 50;

export class AddCartItemDto {
  @IsUUID(undefined, { message: 'productId must be a UUID' })
  productId!: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'variantId must be a UUID' })
  variantId?: string;

  @IsOptional()
  @IsInt({ message: 'quantity must be an integer' })
  @Min(1, { message: 'quantity must be at least 1' })
  @Max(MAX_QTY_PER_LINE, { message: `quantity must not exceed ${MAX_QTY_PER_LINE}` })
  quantity?: number;
}

/**
 * Phase 61 — PATCH /items/:itemId now REQUIRES quantity >= 1.
 * Pre-Phase-61 a quantity of 0 or negative silently deleted the
 * row and returned `{ removed: true }` masquerading as success
 * (audit Gap #6); legitimate removal goes through DELETE.
 */
export class UpdateCartItemDto {
  @IsInt({ message: 'quantity must be an integer' })
  @Min(1, { message: 'quantity must be at least 1; use DELETE to remove an item' })
  @Max(MAX_QTY_PER_LINE, { message: `quantity must not exceed ${MAX_QTY_PER_LINE}` })
  quantity!: number;
}

export class MergeCartItemDto {
  @IsUUID(undefined, { message: 'productId must be a UUID' })
  productId!: string;

  @IsOptional()
  @IsUUID(undefined, { message: 'variantId must be a UUID' })
  variantId?: string;

  @IsInt({ message: 'quantity must be an integer' })
  @Min(1, { message: 'quantity must be at least 1' })
  @Max(MAX_QTY_PER_LINE, { message: `quantity must not exceed ${MAX_QTY_PER_LINE}` })
  quantity!: number;
}

export class MergeCartDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'items must not be empty' })
  @ArrayMaxSize(MAX_MERGE_ITEMS, {
    message: `Maximum ${MAX_MERGE_ITEMS} items per merge`,
  })
  @ValidateNested({ each: true })
  @Type(() => MergeCartItemDto)
  items!: MergeCartItemDto[];
}
