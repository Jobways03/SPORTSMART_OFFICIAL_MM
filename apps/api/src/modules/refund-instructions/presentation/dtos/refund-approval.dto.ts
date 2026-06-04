import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// Phase 170 — replaces the inline `{ reason: string }` / `{ question: string }`
// bodies (no validation). reason/question are charset-bounded (#security — they
// can surface in admin UI / future PDF/email; keep them to a safe-ish set while
// staying human-friendly — letters, digits, spaces, and common punctuation).
const SAFE_TEXT = /^[\w\s.,;:!?@#%&()\/'"+\-]+$/u;
const SAFE_TEXT_MSG =
  'must contain only letters, digits, spaces and common punctuation';

export class RejectRefundDto {
  // Phase 171 (#17) — apply the charset guard (was defined but not enforced).
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  @Matches(SAFE_TEXT, { message: `reason ${SAFE_TEXT_MSG}` })
  reason!: string;

  // Phase 171 (#6) — optional SAFE message surfaced to the customer; separate
  // from the internal `reason` (which may contain "fraud signals" etc).
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(SAFE_TEXT, { message: `customerVisibleReason ${SAFE_TEXT_MSG}` })
  customerVisibleReason?: string;
}

export class RequestInfoDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  @Matches(SAFE_TEXT, { message: `question ${SAFE_TEXT_MSG}` })
  question!: string;
}

export class RevertRejectionDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  @Matches(SAFE_TEXT, { message: `reason ${SAFE_TEXT_MSG}` })
  reason!: string;
}

// Phase 170 (#9) — bulk approve. Cap at 50 per call (each runs its own saga +
// audit + history row; 50 keeps a single request bounded).
export class BulkApproveDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids!: string[];
}

// re-export for tests / callers that want the charset
export { SAFE_TEXT };
