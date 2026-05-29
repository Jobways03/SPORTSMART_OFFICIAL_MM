import { IsOptional, IsString, IsNumber, IsEnum, Min } from 'class-validator';
import { VariantStatus } from '@prisma/client';

export class UpdateVariantDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  compareAtPrice?: number;

  // costPrice is display-only per product policy — it is NOT used
  // by procurement prefill or any pricing logic. Kept editable so
  // admins can record an informational cost per variant.
  @IsOptional()
  @IsNumber()
  @Min(0)
  costPrice?: number;

  // procurementPrice is the platform-wide default landed cost used
  // by the franchise procurement flow. Never exposed to customers.
  @IsOptional()
  @IsNumber()
  @Min(0)
  procurementPrice?: number;

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

  // Phase 41 (2026-05-21) — @IsEnum(VariantStatus) replaces @IsString.
  // Pre-Phase-41 a bogus status flowed through to Prisma and surfaced
  // as a 500. Now: 400 with the allowlist in the error body.
  @IsOptional()
  @IsEnum(VariantStatus)
  status?: VariantStatus;

  @IsOptional()
  @IsString()
  barcode?: string;
}
