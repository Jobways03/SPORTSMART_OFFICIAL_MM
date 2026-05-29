import {
  DisputeKind,
  TicketActorType,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * Promote-to-dispute payload. A real class (not an interface) so the global
 * ValidationPipe runs at the boundary: `kind` is enum-checked (replacing the
 * controller's hand-maintained allowlist), severity is range-bounded, and
 * summary / internalNote are length-capped.
 */
export class PromoteTicketToDisputeDto {
  @IsEnum(DisputeKind)
  kind!: DisputeKind;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  severity?: number;

  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  summary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  internalNote?: string;
}

export interface CreateTicketDto {
  subject: string;
  body: string;
  priority?: TicketPriority;
  categoryId?: string;
  relatedOrderId?: string;
  relatedReturnId?: string;
  /** Customer-friendly numbers (e.g. SM20260062, RET-2026-000017). */
  relatedOrderNumber?: string;
  relatedReturnNumber?: string;
}

export class ReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;

  // Honoured only for ADMIN senders (the service clamps it to false otherwise);
  // the non-admin reply controllers don't even read this field.
  @IsOptional()
  @IsBoolean()
  isInternalNote?: boolean;
}

export class AssignDto {
  // null / omitted = unassign. @IsOptional skips validation for null|undefined;
  // a non-null value must be a sane-length admin id string.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  adminId!: string | null;
}

export class SetStatusDto {
  @IsEnum(TicketStatus)
  status!: TicketStatus;

  // Captured on RESOLVED / CLOSED transitions.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolutionSummary?: string;
}

export class SetPriorityDto {
  @IsEnum(TicketPriority)
  priority!: TicketPriority;
}

// Classes (not interfaces) so the global ValidationPipe bounds name/description
// length and enum-checks scopedTo — previously any string of any length was
// accepted.
export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsEnum(TicketActorType)
  scopedTo?: TicketActorType;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  // Nullable to clear; @ValidateIf lets an explicit null through the @IsString.
  @IsOptional()
  @ValidateIf((o) => o.description !== null)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.scopedTo !== null)
  @IsEnum(TicketActorType)
  scopedTo?: TicketActorType | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
