import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Phase 59 (2026-05-22) — bulk seller-mapping suspend/activate
 * DTOs (audit Gaps #5 + #12). Pre-Phase-59 both endpoints
 * accepted an empty body — there was no input mechanism for a
 * reason, so the audit log Gap #3 had no "why" to capture even
 * if it had been wired. Mandatory 3-500 char reason matches the
 * shape of RejectMappingDto / StopMappingDto from Phase 56/58 so
 * the rejectionReason / suspensionReason columns are bounded.
 */

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class BulkSuspendMappingsDto {
  @IsString()
  @Transform(trim)
  @MinLength(3, { message: 'reason must be at least 3 characters' })
  @MaxLength(500, { message: 'reason must not exceed 500 characters' })
  reason!: string;
}

export class BulkActivateMappingsDto {
  @IsString()
  @Transform(trim)
  @MinLength(3, { message: 'reason must be at least 3 characters' })
  @MaxLength(500, { message: 'reason must not exceed 500 characters' })
  reason!: string;
}
