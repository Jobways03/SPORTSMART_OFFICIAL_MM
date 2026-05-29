import {
  IsString,
  IsOptional,
  IsUUID,
  IsBoolean,
  IsNumber,
  IsInt,
  IsArray,
  IsIn,
  Length,
  Min,
  Max,
  Matches,
  ValidateNested,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SupplyTaxability } from '@prisma/client';
import { ProductSeoDto, CreateVariantInlineDto } from './create-product.dto';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  title?: string;

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

  // Platform-wide default landed cost used by the franchise
  // procurement flow. Not shown to customers.
  @IsOptional()
  @IsNumber()
  @Min(0)
  procurementPrice?: number;

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

  // Phase 92 follow-up (2026-05-23) — Gap #22 admin surface for the
  // typed return-policy columns. `isReturnable=false` flips the row
  // to non-returnable (eligibility resolver short-circuits).
  // `nonReturnableReason` is shown to the customer on the eligibility
  // surface so they know WHY (e.g. "Final sale", "Innerwear").
  // `returnWindowDaysOverride` lets ops set a different window for
  // perishables (0d) or electronics (7d) without changing the global.
  // `allowedReturnReasonsJson` constrains the per-item reason picker.
  // `allowPartialReturn=false` forces all-or-nothing returns.
  @IsOptional()
  @IsBoolean()
  isReturnable?: boolean;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  nonReturnableReason?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  returnWindowDaysOverride?: number;

  @IsOptional()
  @IsArray()
  @IsIn(
    [
      'DEFECTIVE',
      'WRONG_ITEM',
      'NOT_AS_DESCRIBED',
      'DAMAGED_IN_TRANSIT',
      'CHANGED_MIND',
      'SIZE_FIT_ISSUE',
      'QUALITY_ISSUE',
      'OTHER',
    ],
    { each: true },
  )
  allowedReturnReasons?: string[];

  @IsOptional()
  @IsBoolean()
  allowPartialReturn?: boolean;

  // ─── Tax fields (Phase 1 GST) ──────────────────────────────────
  // See CreateProductDto for the equivalent block + rationale.
  // `taxConfigUpdatedBy` / `taxConfigUpdatedAt` are stamped by the
  // controller from the actor — never accepted from input.
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
