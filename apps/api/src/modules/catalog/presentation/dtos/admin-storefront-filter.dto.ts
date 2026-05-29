import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Phase 40 (2026-05-21) — DTOs for the storefront filter mutations.
 *
 * Closes audit gaps:
 *   #4  @Body() body: any replaced with class-validator DTOs
 *   #9  scopeId existence is validated in the controller; here we
 *       only enforce shape (UUID when present)
 *   #17 free-form label gets @MaxLength(80) to bound XSS surface
 *       (React JSX escapes by default, but bounded length is a
 *       defence-in-depth measure)
 *   #18 reorder DTO bounds the array to 200 to prevent a malicious
 *       admin from chewing the DB with a 1M-id payload
 */

export const VALID_FILTER_TYPES = [
  'checkbox',
  'price_range',
  'boolean_toggle',
  'color_swatch',
  'text_input',
] as const;

export const VALID_BUILT_IN_TYPES = [
  'price_range',
  'brand',
  'availability',
  'variant_option',
] as const;

export const VALID_SCOPE_TYPES = ['GLOBAL', 'CATEGORY', 'COLLECTION'] as const;

export class CreateStorefrontFilterDto {
  @IsOptional()
  @IsUUID('4')
  metafieldDefinitionId?: string;

  @IsOptional()
  @IsString()
  @IsIn(VALID_BUILT_IN_TYPES as readonly string[])
  builtInType?: (typeof VALID_BUILT_IN_TYPES)[number];

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(80)
  label!: string;

  @IsString()
  @IsIn(VALID_FILTER_TYPES as readonly string[])
  filterType!: (typeof VALID_FILTER_TYPES)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsIn(VALID_SCOPE_TYPES as readonly string[])
  scopeType?: (typeof VALID_SCOPE_TYPES)[number];

  @IsOptional()
  @IsUUID('4')
  scopeId?: string;

  @IsOptional()
  @IsBoolean()
  collapsed?: boolean;

  @IsOptional()
  @IsBoolean()
  showCounts?: boolean;
}

export class UpdateStorefrontFilterDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsString()
  @IsIn(VALID_FILTER_TYPES as readonly string[])
  filterType?: (typeof VALID_FILTER_TYPES)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  collapsed?: boolean;

  @IsOptional()
  @IsBoolean()
  showCounts?: boolean;

  @IsOptional()
  @IsIn(VALID_SCOPE_TYPES as readonly string[])
  scopeType?: (typeof VALID_SCOPE_TYPES)[number];

  @IsOptional()
  @IsUUID('4')
  scopeId?: string;
}

export class ReorderStorefrontFiltersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200, { message: 'cannot reorder more than 200 filters per request' })
  @IsUUID('4', { each: true })
  ids!: string[];
}

/**
 * Phase 40 — DTO for the new "mark metafield as filterable" toggle
 * endpoints on AdminMetafieldDefinitionsController.
 */
export class MarkMetafieldFilterableDto {
  @IsBoolean()
  isFilterable!: boolean;

  @IsOptional()
  @IsString()
  @IsIn(VALID_FILTER_TYPES as readonly string[])
  defaultFilterType?: (typeof VALID_FILTER_TYPES)[number];

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  defaultFilterLabel?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  filterDisplayOrder?: number;
}

export class BulkMarkMetafieldFilterableDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500, { message: 'cannot toggle more than 500 definitions per request' })
  @IsUUID('4', { each: true })
  definitionIds!: string[];

  @IsBoolean()
  isFilterable!: boolean;
}
