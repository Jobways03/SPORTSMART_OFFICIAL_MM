import { DisputeStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/**
 * Admin dispute-assignment DTOs. Previously these endpoints used inline
 * interfaces, so class-validator never ran and a direct API call could send
 * a non-integer severity, an unknown status, or a huge adminId string.
 */

export class AssignDisputeDto {
  // `null` un-assigns. A non-null value must be a non-empty admin id; the
  // service additionally verifies the admin exists and is ACTIVE.
  @ValidateIf((o) => o.adminId !== null && o.adminId !== undefined)
  @IsString()
  @MaxLength(64)
  adminId!: string | null;
}

export class SetDisputeStatusDto {
  // Must be a real DisputeStatus. The service rejects RESOLVED_* here — those
  // are decided via /decide (disputes.decide), not this generic status update.
  @IsEnum(DisputeStatus)
  status!: DisputeStatus;
}

export class SetSeverityDto {
  @IsInt()
  @Min(1)
  @Max(100)
  severity!: number;
}

export class AdminReplyMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;

  // Only honoured for ADMIN senders (the service double-gates it). Optional;
  // defaults to a public reply.
  @IsOptional()
  @IsBoolean()
  isInternalNote?: boolean;
}

export class DisputeLogisticsDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  courierName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  awbNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  evidenceFileId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class DecideDisputeDto {
  @IsIn(['RESOLVED_BUYER', 'RESOLVED_SELLER', 'RESOLVED_SPLIT'])
  outcome!: 'RESOLVED_BUYER' | 'RESOLVED_SELLER' | 'RESOLVED_SPLIT';

  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  rationale!: string;

  // Required (and matrix-validated) server-side when remedy != NO_REFUND.
  @IsOptional()
  @IsInt()
  @Min(0)
  amountInPaise?: number;

  // Restricted to the dispute-relevant subset. The shared Prisma enum also
  // carries return-side values (FRANCHISE / BRAND / ...) that a dispute
  // decision must not accept — @IsIn rejects them at the boundary.
  @IsIn(['SELLER', 'LOGISTICS', 'PLATFORM', 'CUSTOMER', 'NONE'])
  liabilityParty!: 'SELLER' | 'LOGISTICS' | 'PLATFORM' | 'CUSTOMER' | 'NONE';

  @IsIn(['FULL_REFUND', 'PARTIAL_REFUND', 'NO_REFUND', 'GOODWILL_CREDIT'])
  customerRemedy!: 'FULL_REFUND' | 'PARTIAL_REFUND' | 'NO_REFUND' | 'GOODWILL_CREDIT';

  @IsOptional()
  @ValidateNested()
  @Type(() => DisputeLogisticsDto)
  logistics?: DisputeLogisticsDto;
}

export class AttachDisputeContextDto {
  // Lenient pattern: alphanumerics + space / # / - / _ / / so the service's
  // normalizer can still strip an "Order "/"#" prefix — but no control chars
  // or script/SQL punctuation. At least one is required (checked in-handler).
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[\w\s#/-]+$/, { message: 'orderNumber has invalid characters' })
  orderNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[\w\s#/-]+$/, { message: 'returnNumber has invalid characters' })
  returnNumber?: string;
}
