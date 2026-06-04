import { IsBoolean, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Phase 190 (#14) — retry options.
 *  - bypassReason: required if the recipient has opted out of this class —
 *    the retry then overrides opt-out and the reason is audited (#11/#12).
 *  - forceTemplateReRender + vars: re-render from the CURRENT template
 *    (#3) instead of re-sending the frozen body. Needs the original vars.
 */
export class RetryLogDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bypassReason?: string;

  @IsOptional()
  @IsBoolean()
  forceTemplateReRender?: boolean;

  @IsOptional()
  @IsObject()
  vars?: Record<string, unknown>;
}
