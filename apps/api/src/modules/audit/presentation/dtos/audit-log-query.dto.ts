import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Phase 204 (#14) / 205 (#6) — query DTO for GET /admin/audit/logs.
 *
 * The old controller did `parseInt(limit, 10)` with no DTO, so `?limit=-1`
 * reached Prisma as `take: -1` (throws) and free-text filters were unbounded.
 * The global ValidationPipe runs whitelist + forbidNonWhitelisted + transform,
 * so any unexpected query key is rejected too.
 */
export class AuditLogQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_.-]+$/, { message: 'module has invalid characters' })
  module?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_.-]+$/, { message: 'resource has invalid characters' })
  resource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  resourceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  actorId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  @Matches(/^[A-Z_]+$/, { message: 'actorType has invalid characters' })
  actorType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_.:-]+$/, { message: 'action has invalid characters' })
  action?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'fromDate must be an ISO-8601 date' })
  fromDate?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'toDate must be an ISO-8601 date' })
  toDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1)
  @Max(500)
  limit?: number;
}
