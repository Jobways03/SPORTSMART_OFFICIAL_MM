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

/**
 * Phase 30 (2026-05-21) — explicit allowlist DTO for the seller create
 * path.
 *
 * Pre-Phase-30 the seller controller used the shared `CreateProductDto`
 * (which the admin controller also extends) and stripped admin-only
 * fields via `delete (dto as any).procurementPrice`. A blacklist
 * approach leaks every future admin-only field that someone forgets to
 * add to the delete list. The seller DTO now lists every field it
 * accepts up front; anything else is silently ignored by class-validator.
 *
 * Specifically removed vs CreateProductDto:
 *   • `procurementPrice` — platform's negotiated landed cost. Admin-only.
 *   • `categoryName` / `brandName` — free-form taxonomy injection
 *     (Phase 30 audit #1). Sellers must reference categoryId / brandId
 *     UUIDs; new taxonomy comes through the admin /admin/categories +
 *     /admin/brands endpoints.
 */
export class SellerCreateProductDto {
  @IsString()
  title!: string;

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

  @IsBoolean()
  hasVariants!: boolean;

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
   * Phase 30 (2026-05-21) — atomic create + submit. When true, the
   * controller runs the create + readiness check + status flip + event
   * emission as one logical unit, closing the orphan-DRAFT window that
   * was reachable via the two-call (create then submit) flow.
   * Defaults false so the legacy "save as draft, submit later" path
   * still works.
   */
  @IsOptional()
  @IsBoolean()
  submitImmediately?: boolean;

  /**
   * Phase 249 (#4) — AI-content provenance. When the seller kept the
   * AI-generated draft, the FE echoes back the `meta.generationLogId`
   * the generate endpoint returned. The controller stamps the product's
   * AI provenance columns and flips the matching AiGenerationLog row
   * GENERATED → ACCEPTED. Optional: a hand-written product omits it.
   * Must be allowlisted here because the global ValidationPipe runs
   * forbidNonWhitelisted — an unlisted field would 400 the save.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  aiGenerationLogId?: string;

  /**
   * Phase 39 (2026-05-21) — seller-supplied metafield values. The
   * controller validates each entry against its definition (via
   * MetafieldValidationService) then upserts. Allows the seller to
   * fill in the required category fields in the same call as the
   * product create, eliminating the prior two-step ("create product",
   * "PATCH metafields") workflow which left a window where the row
   * was a half-finished DRAFT.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SellerMetafieldValueDto)
  metafields?: SellerMetafieldValueDto[];
}

/**
 * Phase 39 (2026-05-21) — single metafield value supplied by the
 * seller. Either `definitionId` OR the (namespace, key) pair must be
 * provided — the latter is more ergonomic for the form UX which
 * already knows the field key.
 */
export class SellerMetafieldValueDto {
  @IsOptional()
  @IsUUID()
  definitionId?: string;

  @IsOptional()
  @IsString()
  namespace?: string;

  @IsOptional()
  @IsString()
  key?: string;

  // Value shape is type-dependent (string / number / boolean / array /
  // object / null). MetafieldValidationService.validateValue does the
  // type checking — keeping this loose at the DTO layer.
  value?: unknown;
}
