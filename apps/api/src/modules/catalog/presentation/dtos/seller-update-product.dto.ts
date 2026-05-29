import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SupplyTaxability } from '@prisma/client';
import { CreateVariantInlineDto, ProductSeoDto } from './create-product.dto';
import { SellerMetafieldValueDto } from './seller-create-product.dto';

/**
 * Phase 30 (2026-05-21) — explicit allowlist DTO for the seller update
 * path. See SellerCreateProductDto for the rationale.
 *
 * Same delta vs UpdateProductDto:
 *   • procurementPrice removed (admin-only)
 *   • categoryName / brandName removed (taxonomy injection)
 */
export class SellerUpdateProductDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  brandId?: string;

  @IsOptional()
  @IsString()
  shortDescription?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  hasVariants?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  basePrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  compareAtPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @IsOptional()
  @IsString()
  baseSku?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  baseStock?: number;

  @IsOptional()
  @IsString()
  baseBarcode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weight?: number;

  @IsOptional()
  @IsString()
  weightUnit?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  length?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  width?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  height?: number;

  @IsOptional()
  @IsString()
  dimensionUnit?: string;

  @IsOptional()
  @IsString()
  returnPolicy?: string;

  @IsOptional()
  @IsString()
  warrantyInfo?: string;

  @IsOptional()
  @Matches(/^\d{4,8}$/, {
    message: 'hsnCode must be 4-8 digits (HSN hierarchical levels) with no spaces or punctuation',
  })
  hsnCode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  gstRateBps?: number;

  @IsOptional()
  @IsEnum(SupplyTaxability)
  supplyTaxability?: SupplyTaxability;

  @IsOptional()
  @IsBoolean()
  taxInclusivePricing?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  cessRateBps?: number;

  @IsOptional()
  @Matches(/^[A-Z]{2,6}$/, {
    message: 'defaultUqcCode must be 2-6 uppercase letters per CBIC UQC list (e.g. NOS, PCS, KGS)',
  })
  defaultUqcCode?: string;

  @IsOptional()
  @IsString()
  taxCategory?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ProductSeoDto)
  seo?: ProductSeoDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVariantInlineDto)
  variants?: CreateVariantInlineDto[];

  /**
   * Phase 39 (2026-05-21) — seller-supplied metafield values for the
   * update path. Same semantics as the create DTO; the controller
   * upserts each one, validating against the definition first.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SellerMetafieldValueDto)
  metafields?: SellerMetafieldValueDto[];
}
