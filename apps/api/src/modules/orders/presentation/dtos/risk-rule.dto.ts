// Phase 72 (2026-05-22) — Phase 71 risk audit Gap #12. DTO for
// PATCH /admin/verification/risk-rules/:code.

import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export class UpdateRiskRuleDto {
  /**
   * Signed score contribution when the rule matches. Bounded to
   * [-100, 100] — the band thresholds top out at 14, so anything
   * past ±50 is almost certainly a misuse / typo.
   */
  @IsOptional()
  @IsInt({ message: 'scoreDelta must be an integer' })
  @Min(-100)
  @Max(100)
  scoreDelta?: number;

  /**
   * Rule-specific thresholds. Schema-less because each rule needs
   * a different shape (see DEFAULTS in risk-rule-config.service).
   * The service validates structural keys at use time; this DTO
   * only enforces that it's an object (not a primitive / array).
   */
  @IsOptional()
  @IsObject({ message: 'config must be an object' })
  config?: Record<string, any>;

  @IsOptional()
  @IsBoolean({ message: 'enabled must be a boolean' })
  enabled?: boolean;

  /**
   * Phase 72 audit Gap #17 — when true, value-rule reasons elide
   * exact amounts (renders bucketed form).
   */
  @IsOptional()
  @IsBoolean({ message: 'maskAmounts must be a boolean' })
  maskAmounts?: boolean;
}
