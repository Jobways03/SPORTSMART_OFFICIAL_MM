import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Phase 39 (2026-05-21) — DTOs for the metafield definitions
 * controller. Replaces `@Body() body: any` (audit gap #8) with
 * explicit allowlists and validates the JSON columns (choices /
 * validations) via @ValidateNested (audit gap #14).
 */

const VALID_TYPES = [
  'SINGLE_LINE_TEXT', 'MULTI_LINE_TEXT', 'NUMBER_INTEGER', 'NUMBER_DECIMAL',
  'BOOLEAN', 'DATE', 'COLOR', 'URL', 'DIMENSION', 'WEIGHT', 'VOLUME',
  'RATING', 'JSON', 'SINGLE_SELECT', 'MULTI_SELECT', 'FILE_REFERENCE',
] as const;

export class MetafieldChoiceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  value!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  label!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'colorHex must be #RRGGBB' })
  colorHex?: string;
}

export class MetafieldValidationsDto {
  @IsOptional()
  @IsNumber()
  min?: number;

  @IsOptional()
  @IsNumber()
  max?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minLength?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxLength?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  regex?: string;
}

export class CreateMetafieldDefinitionDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(40)
  namespace!: string;

  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message:
      'key must start with a lowercase letter and contain only lowercase letters, digits, and underscores',
  })
  @MaxLength(60)
  key!: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsString()
  @IsIn(VALID_TYPES as readonly string[])
  type!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MetafieldValidationsDto)
  validations?: MetafieldValidationsDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500, { message: 'choices cannot exceed 500 entries' })
  @ValidateNested({ each: true })
  @Type(() => MetafieldChoiceDto)
  choices?: MetafieldChoiceDto[];

  @IsOptional()
  @IsIn(['CATEGORY', 'CUSTOM'])
  ownerType?: 'CATEGORY' | 'CUSTOM';

  @IsOptional()
  @IsUUID('4')
  categoryId?: string;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;
}

export class UpdateMetafieldDefinitionDto {
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /**
   * Type change is only legal when no product values exist for the
   * definition — the controller enforces that pre-check.
   */
  @IsOptional()
  @IsString()
  @IsIn(VALID_TYPES as readonly string[])
  type?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => MetafieldValidationsDto)
  validations?: MetafieldValidationsDto;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => MetafieldChoiceDto)
  choices?: MetafieldChoiceDto[];

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class BulkCreateMetafieldDefinitionItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  namespace!: string;

  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/)
  @MaxLength(60)
  key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsIn(VALID_TYPES as readonly string[])
  type!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => MetafieldChoiceDto)
  choices?: MetafieldChoiceDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => MetafieldValidationsDto)
  validations?: MetafieldValidationsDto;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class BulkCreateMetafieldDefinitionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200, { message: 'cannot bulk-create more than 200 definitions per request' })
  @ValidateNested({ each: true })
  @Type(() => BulkCreateMetafieldDefinitionItemDto)
  definitions!: BulkCreateMetafieldDefinitionItemDto[];
}
