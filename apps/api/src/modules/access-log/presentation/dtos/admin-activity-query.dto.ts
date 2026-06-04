import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

/**
 * Phase 208 (#7) — query DTO for GET /admin/activity.
 *
 * Pre-Phase-208 the controller did `parseInt(hours, 10)` / `parseInt(limit,
 * 10)` with no guard, so `?hours=abc` reached the service as NaN. actorType
 * / source were `.toUpperCase()`-d and cast straight through. This DTO
 * coerces + bounds the numbers and constrains the enum-ish strings. Global
 * ValidationPipe (whitelist + forbidNonWhitelisted) rejects unknown keys.
 */

const ACTOR_TYPES = ['CUSTOMER', 'ADMIN', 'SELLER', 'FRANCHISE', 'AFFILIATE'];
const SOURCES = ['AUTH', 'ADMIN_ACTION', 'BUSINESS', 'IMPERSONATION'];

export class AdminActivityQueryDto {
  @IsOptional()
  @IsString()
  actorRole?: string;

  // Phase 208 (#11) — operator can pin to a single admin id. UUID-validated
  // so a malformed id 400s instead of silently matching nothing.
  @IsOptional()
  @IsUUID('4', { message: 'actorId must be a UUID' })
  actorId?: string;

  @IsOptional()
  @IsString()
  @IsIn(ACTOR_TYPES, {
    message: `actorType must be one of: ${ACTOR_TYPES.join(', ')}`,
  })
  actorType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'hours must be an integer' })
  @Min(1, { message: 'hours must be at least 1' })
  @Max(24 * 30, { message: 'hours cannot exceed 720 (30 days)' })
  hours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @IsString()
  @IsIn(SOURCES, { message: `source must be one of: ${SOURCES.join(', ')}` })
  source?: string;
}
