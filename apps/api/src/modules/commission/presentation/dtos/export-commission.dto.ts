import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import {
  CommissionRecordStatus,
  CommissionType,
  SellerSettlementStatus,
} from '@prisma/client';

// Query booleans arrive as strings ('true'/'false'/'1'); implicit conversion
// would make Boolean('false') truthy, so coerce explicitly.
const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' || value === '1';

/**
 * Phase 140 — runtime validation for GET /admin/commission/export. Previously
 * inline @Query strings with no validation: dateFrom=garbage → new Date(NaN) →
 * Prisma throw → 500; status=BOGUS → Prisma enum throw → 500. This rejects
 * malformed input at the boundary with a 400 and bounds the search length.
 */
export class ExportCommissionDto {
  @IsOptional()
  @IsUUID()
  sellerId?: string;

  @IsOptional()
  @IsUUID()
  subOrderId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsEnum(CommissionRecordStatus)
  status?: CommissionRecordStatus;

  @IsOptional()
  @IsEnum(CommissionType)
  commissionType?: CommissionType;

  @IsOptional()
  @IsEnum(SellerSettlementStatus)
  settlementStatus?: SellerSettlementStatus;

  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(80)
  search?: string;

  // adjustedAt IS NOT NULL — "show only manually-adjusted records".
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  adjustedOnly?: boolean;

  // refundedAdminEarning > 0 — "show only records with a reversal".
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  reversedOnly?: boolean;

  // Opt-in for the sensitive adjustmentReason column (dispute notes). Default
  // redacts it so a routine export doesn't carry internal reasoning.
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  includeReason?: boolean;

  // 'paise' appends the BigInt paise-sibling columns for ADR-007 reconciliation.
  @IsOptional()
  @IsIn(['decimal', 'paise'])
  precision?: 'decimal' | 'paise';
}
