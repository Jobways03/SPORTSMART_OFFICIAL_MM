import {
  IsString,
  IsOptional,
  IsUUID,
  IsBoolean,
  IsNumber,
  IsInt,
  IsArray,
  Min,
  Max,
  Matches,
  MaxLength,
  ValidateNested,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SupplyTaxability } from '@prisma/client';

export class ProductSeoDto {
  @IsOptional()
  @IsString()
  metaTitle?: string;

  @IsOptional()
  @IsString()
  metaDescription?: string;

  @IsOptional()
  @IsString()
  metaKeywords?: string;

  @IsOptional()
  @IsString()
  handle?: string;
}

export class CreateVariantInlineDto {
  @IsNumber()
  @Min(0)
  price!: number;

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
  sku?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weight?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  optionValueIds?: string[];
}

export class CreateProductDto {
  @IsString()
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  categoryName?: string;

  @IsOptional()
  @IsUUID()
  brandId?: string;

  @IsOptional()
  @IsString()
  brandName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  shortDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  description?: string;

  @IsBoolean()
  hasVariants!: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  basePrice?: number;

  // Platform-wide default landed cost used by the franchise
  // procurement flow. Distinct from costPrice (display-only).
  @IsOptional()
  @IsNumber()
  @Min(0)
  procurementPrice?: number;

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

  // ─── Tax fields (Phase 1 GST) ──────────────────────────────────
  // Tax-config (HSN, GST rate, supply taxability, cess, UQC, tax category)
  // is SUPER_ADMIN-only and set exclusively via the SUPER_ADMIN-gated
  // tax-config endpoints (POST /admin/products/bulk/tax-config). It is NOT
  // accepted on product create/update — removed here so any request
  // carrying these fields is rejected (forbidNonWhitelisted). Products are
  // created with the schema's safe tax defaults until a super-admin sets
  // them.

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

  // Phase 249 (#4) — AI-content provenance. When the product is saved
  // carrying AI-generated copy, the FE echoes back the generate
  // endpoint's `meta.generationLogId`. The controller stamps the
  // product's AI provenance columns and flips the matching
  // AiGenerationLog row GENERATED → ACCEPTED. Optional; allowlisted
  // because the global ValidationPipe runs forbidNonWhitelisted.
  // (AdminCreateProductDto extends this DTO, so the admin create path
  // inherits the field too.)
  @IsOptional()
  @IsString()
  @MaxLength(64)
  aiGenerationLogId?: string;
}
