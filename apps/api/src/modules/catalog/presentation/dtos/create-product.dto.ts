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
  shortDescription?: string;

  @IsOptional()
  @IsString()
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
  // Mirror the columns added to products in catalog.prisma:165-188.
  // All optional — the schema fills in safe defaults
  // (gstRateBps=0, supplyTaxability=TAXABLE, cessRateBps=0,
  // taxInclusivePricing=true). TaxAuditReadinessService scans for
  // TAXABLE products with missing hsnCode/gstRateBps and gates the
  // OFF → STRICT mode flip on clearing those, so sellers/admins
  // should supply this data on create even though the DTO permits
  // omission.
  // `taxConfigUpdatedBy` / `taxConfigUpdatedAt` are NOT accepted from
  // input — the controller stamps them from the authenticated actor.
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
}
