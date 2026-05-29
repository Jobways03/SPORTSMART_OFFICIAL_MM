import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Phase 159w (GST Mode Toggle audit #6) — replaces the inline
 * `if (!allowed.includes(body.mode))` check on POST /admin/tax/mode with a
 * proper class-validator DTO (consistent with the rest of the codebase + a
 * Swagger schema).
 */
export class SetTaxModeDto {
  @IsIn(['OFF', 'AUDIT', 'STRICT'], {
    message: 'mode must be one of OFF, AUDIT, STRICT',
  })
  mode!: 'OFF' | 'AUDIT' | 'STRICT';

  /** Optional free-text justification, captured in the history + audit row. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  /**
   * Phase 159w (audit #10) — override the AUDIT-readiness gate to enter STRICT
   * while blockers still exist. Defaults false; the override is audited and
   * flagged on the history row.
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
