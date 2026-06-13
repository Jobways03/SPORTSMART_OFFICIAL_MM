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
  MaxLength,
  ValidateNested,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProductSeoDto } from './create-product.dto';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  // categoryName / brandName intentionally NOT accepted — admins reference
  // existing taxonomy by uuid (categoryId/brandId). The controller already
  // ignored these, so accepting them caused silent no-op "success"; rejecting
  // them (forbidNonWhitelisted) makes the contract honest.
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  brandId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  shortDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
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
  // Tax-config is SUPER_ADMIN-only — set via POST /admin/products/bulk/
  // tax-config, never via product update. Removed here so a request
  // carrying these fields is rejected (forbidNonWhitelisted).

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ProductSeoDto)
  seo?: ProductSeoDto;

  // variants[] removed — updateInTransaction never persisted them, so an
  // accepted-but-ignored field silently dropped inline variant edits. Variant
  // mutations go through the dedicated /admin/products/:id/variants endpoints.

  // Phase 249 (#4) — AI-content provenance on the admin update path.
  // Same semantics as CreateProductDto.aiGenerationLogId: when present
  // the controller stamps the product's AI provenance and CAS-flips the
  // log GENERATED → ACCEPTED. Optional; allowlisted for
  // forbidNonWhitelisted.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  aiGenerationLogId?: string;
}
