import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import {
  DiscrepancyStatus,
  ReconciliationKind,
} from '@prisma/client';

// Phase 174 — shared note/reason charset guard (#9/#19): letters, digits,
// whitespace, common punctuation + ₹. Blocks control chars / exotic payloads
// from reaching the CSV export or any future render path.
const NOTE_CHARSET = /^[\w\s.,:;!?@#&()\-/'"₹%+*=\n\r]*$/u;

/**
 * Phase 173 — typed + validated reconciliation DTOs (replaces the bare
 * `interface` casts the controller used before, which accepted any string for
 * `kind`/`status`).
 */
export class StartRunDto {
  @IsEnum(ReconciliationKind, {
    message: 'kind must be a valid ReconciliationKind',
  })
  kind!: ReconciliationKind;

  @IsISO8601({}, { message: 'periodStart must be an ISO-8601 date' })
  periodStart!: string;

  @IsISO8601({}, { message: 'periodEnd must be an ISO-8601 date' })
  periodEnd!: string;
}

export class TransitionDiscrepancyDto {
  @IsEnum(DiscrepancyStatus, {
    message: 'status must be a valid DiscrepancyStatus',
  })
  status!: DiscrepancyStatus;

  // Phase 173 (#19) — bound + charset-guard the operator note so it can never
  // carry control characters / formula prefixes into the CSV or any future
  // render path. Allows ₹, common punctuation, and whitespace.
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'notes must be 2000 characters or fewer' })
  @Matches(NOTE_CHARSET, { message: 'notes contains unsupported characters' })
  notes?: string;
}

/**
 * Phase 174 (#8) — reopen a terminal discrepancy. Reason is REQUIRED (reopening
 * a closed money investigation must be justified), bounded + charset-guarded.
 */
export class ReopenDiscrepancyDto {
  @IsString()
  @MinLength(3, { message: 'reason is required (min 3 characters)' })
  @MaxLength(2000, { message: 'reason must be 2000 characters or fewer' })
  @Matches(NOTE_CHARSET, { message: 'reason contains unsupported characters' })
  reason!: string;
}

/**
 * Phase 174 (#6) — assign / unassign a discrepancy. Omit the field to self-
 * assign (the controller uses the caller's adminId); pass `null` to unassign;
 * pass an admin id to assign to someone else.
 */
export class AssignDiscrepancyDto {
  @IsOptional()
  @IsString()
  @MaxLength(100, { message: 'assignedToAdminId must be 100 characters or fewer' })
  assignedToAdminId?: string | null;
}

/**
 * Phase 174 (#11) — bulk status transition. Bounded id list so a single call
 * can't sweep an unbounded set; each id is a uuid.
 */
export class BulkTransitionDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'ids must contain at least one discrepancy' })
  @ArrayMaxSize(500, { message: 'at most 500 discrepancies per bulk action' })
  @IsUUID('4', { each: true, message: 'each id must be a valid uuid' })
  ids!: string[];

  @IsEnum(DiscrepancyStatus, {
    message: 'status must be a valid DiscrepancyStatus',
  })
  status!: DiscrepancyStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'notes must be 2000 characters or fewer' })
  @Matches(NOTE_CHARSET, { message: 'notes contains unsupported characters' })
  notes?: string;
}
