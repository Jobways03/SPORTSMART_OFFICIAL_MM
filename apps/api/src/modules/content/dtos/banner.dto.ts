import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
} from 'class-validator';
import { BannerSlot } from '@prisma/client';

/**
 * Phase 13 (2026-05-16) — Content module DTOs.
 *
 * Pre-Phase-13 the controllers took `@Body() body: any`, relying on
 * the global `whitelist: true / forbidNonWhitelisted: true`
 * ValidationPipe to drop unknown keys at runtime. That gave runtime
 * protection but zero static typing — code reviewers and IDE
 * tooltips both saw `any`, hiding the actual accepted shape.
 *
 * Banner-level fields below match the `Banner` Prisma model with
 * the optional fields kept optional and the schema-required fields
 * (`slot`, `title`, `imageUrl`) marked required for create and
 * optional for partial update.
 */

export class CreateBannerDto {
  @IsEnum(BannerSlot)
  slot!: BannerSlot;

  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @MaxLength(500)
  // Accepts both absolute URLs (https://cdn…) and relative paths
  // (/uploads/…). class-validator's @IsUrl rejects relative paths
  // outright, so we keep this as a plain string with a length cap.
  imageUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  ctaUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  scopeId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateBannerDto {
  @IsOptional()
  @IsEnum(BannerSlot)
  slot?: BannerSlot;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  ctaUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  scopeId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpsertStaticPageDto {
  @IsString()
  @MaxLength(300)
  title!: string;

  @IsString()
  // Body is HTML rendered into the storefront's privacy/terms/etc.
  // pages — length cap keeps it under our typical PDF/static-render
  // limit, not a security control.
  @MaxLength(100_000)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  metaTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  metaDesc?: string;

  @IsOptional()
  @IsBoolean()
  published?: boolean;
}

export class CreateFaqDto {
  @IsString()
  @MaxLength(100)
  category!: string;

  @IsString()
  @MaxLength(500)
  question!: string;

  @IsString()
  @MaxLength(5_000)
  answer!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateFaqDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  question?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  answer?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
