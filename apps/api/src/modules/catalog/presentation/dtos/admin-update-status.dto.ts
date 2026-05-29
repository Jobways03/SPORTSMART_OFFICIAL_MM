import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ProductStatus } from '@prisma/client';

/**
 * Phase 29 (2026-05-21) — status is pinned to the ProductStatus enum.
 * Pre-Phase-29 the column was @IsString() so any garbage payload
 * reached the controller's allowedTransitions check and surfaced as
 * a generic "Cannot transition" error. With the enum the DTO boundary
 * rejects unknown values with a clear validation message.
 */
export class AdminUpdateProductStatusDto {
  @IsEnum(ProductStatus, {
    message: `status must be one of: ${Object.values(ProductStatus).join(', ')}`,
  })
  status!: ProductStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
