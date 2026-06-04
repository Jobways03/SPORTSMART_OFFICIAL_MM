import { AuthzReviewStatus } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Runtime authz-mode override. Tighten-only by construction — the
 * AuthzModeService applies these with OR-semantics over the env baseline,
 * so setting a flag false can only ROLL BACK to the env value, never drop
 * below a deploy-mandated strict mode.
 */
export class SetAuthzModeDto {
  @IsOptional()
  @IsBoolean()
  strictMode?: boolean;

  @IsOptional()
  @IsBoolean()
  abacEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  auditEnabled?: boolean;
}

/** Triage a logged authorization denial (false-positive review FSM). */
export class ReviewDenialDto {
  @IsEnum(AuthzReviewStatus)
  reviewStatus!: AuthzReviewStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reviewNote?: string;
}
