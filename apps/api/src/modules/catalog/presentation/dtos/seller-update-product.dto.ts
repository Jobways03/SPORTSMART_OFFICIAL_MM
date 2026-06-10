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
  MaxLength,
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

  // Tax-config cluster (HSN, GST rate, supply taxability, cess, UQC, tax
  // category) is super-admin-only — never editable by sellers. Removed
  // from this DTO so a seller request carrying them is rejected
  // (forbidNonWhitelisted).

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
   * Phase 249 (#4) — AI-content provenance on the update path. The
   * seller re-saves a product still carrying the AI draft (e.g. a
   * draft created earlier with AI copy is now being submitted). The
   * controller stamps the product's AI provenance and flips the log
   * GENERATED → ACCEPTED (CAS-guarded so a second save is a no-op on
   * the log). Allowlisted for the same forbidNonWhitelisted reason.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  aiGenerationLogId?: string;

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
