import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { sanitizeOptionalText } from '../../../../core/util/sanitize-text';

// Phase 101 (2026-05-23) — Phase 103 audit Gap #3 closure.
//
// Optional close reason persisted on Return.closeReason so finance
// reports can distinguish "normal closure after refund" from "stale,
// customer unresponsive" without inspecting audit logs.
export class CloseReturnDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => sanitizeOptionalText(value, { maxLength: 500 }))
  reason?: string;
}
