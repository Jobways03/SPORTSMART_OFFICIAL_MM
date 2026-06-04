import { IsIn, IsISO8601, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export type AuditExportMode = 'redacted' | 'full';

/**
 * Phase 206 — query DTO for GET /admin/audit/export.csv.
 *
 * #4/#11/#12 — fromDate + toDate are REQUIRED (no more one-click full-table
 * dump) and ISO-8601 validated. The 90-day span cap + the 100K row refusal are
 * enforced in the controller (they need the parsed values).
 *
 * #6 — `mode` defaults to `redacted` (IP truncated, email masked, JSON
 * stripped). `mode=full` is additionally gated by the `audit.export.full`
 * permission in the controller and is self-audited.
 */
export class AuditExportQueryDto {
  @IsISO8601({}, { message: 'fromDate is required and must be ISO-8601' })
  fromDate!: string;

  @IsISO8601({}, { message: 'toDate is required and must be ISO-8601' })
  toDate!: string;

  @IsOptional()
  @IsIn(['redacted', 'full'], { message: 'mode must be "redacted" or "full"' })
  mode?: AuditExportMode;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_.-]+$/)
  module?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_.-]+$/)
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
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_.:-]+$/)
  action?: string;
}
