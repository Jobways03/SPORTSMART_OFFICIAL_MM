import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { VariantStatus } from '@prisma/client';

export class BulkVariantUpdateItemDto {
  @IsUUID()
  id!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsString()
  sku?: string;

  // Phase 41 (2026-05-21) — @IsEnum(VariantStatus). Pre-Phase-41 the
  // bulk endpoint accepted any string and the unique invalid status
  // crashed the whole batch with a Prisma 500.
  @IsOptional()
  @IsEnum(VariantStatus)
  status?: VariantStatus;
}

export class BulkUpdateVariantsDto {
  @IsArray()
  @ArrayMinSize(1)
  // Phase 41 — cap the bulk size. 200 covers the realistic admin / seller
  // grid-edit workflow without inviting a "update 50k variants in one
  // request" DoS.
  @ArrayMaxSize(200, { message: 'cannot bulk-update more than 200 variants per request' })
  @ValidateNested({ each: true })
  @Type(() => BulkVariantUpdateItemDto)
  variants!: BulkVariantUpdateItemDto[];
}
