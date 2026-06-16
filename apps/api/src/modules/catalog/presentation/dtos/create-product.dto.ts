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
  @MaxLength(255)
  metaTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  metaDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  metaKeywords?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
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
  @MaxLength(100)
  sku?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weight?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(64, { each: true })
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
  @MaxLength(150)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 &.,\-/()']*$/, {
    message:
      'categoryName must contain only letters, digits, spaces and & . , - / ( ) \'',
  })
  categoryName?: string;

  @IsOptional()
  @IsUUID()
  brandId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 &.,\-/()']*$/, {
    message:
      'brandName must contain only letters, digits, spaces and & . , - / ( ) \'',
  })
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
  @MaxLength(100)
  baseSku?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  baseStock?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  baseBarcode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weight?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
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
  @MaxLength(20)
  dimensionUnit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  returnPolicy?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
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
  @MaxLength(100, { each: true })
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
