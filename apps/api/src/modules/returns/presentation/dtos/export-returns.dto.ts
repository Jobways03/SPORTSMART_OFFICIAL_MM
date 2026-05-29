import { Transform } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { QcOutcome, ReturnRefundMethod, ReturnStatus } from '@prisma/client';

/** Split `?status=A,B` or repeated `?status=A&status=B` into a clean array. */
function toStringArray(value: unknown): string[] | undefined {
  const raw = Array.isArray(value)
    ? value.flatMap((v) => String(v).split(','))
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const parts = raw.map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/**
 * Query parameters for `GET /admin/returns/export`. Validated by the global
 * ValidationPipe (whitelist + transform), so unknown params are stripped and
 * malformed input returns 400 — instead of reaching Prisma as an invalid enum
 * value or `Invalid Date`, which previously surfaced as an unhandled 500.
 */
export class ExportReturnsDto {
  // Single value or comma-separated list — exports can span several statuses.
  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsArray()
  @IsEnum(ReturnStatus, { each: true })
  status?: ReturnStatus[];

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  sellerId?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(64)
  franchiseId?: string;

  @IsOptional()
  @Transform(upper)
  @IsEnum(QcOutcome)
  qcDecision?: QcOutcome;

  @IsOptional()
  @Transform(upper)
  @IsEnum(ReturnRefundMethod)
  refundMethod?: ReturnRefundMethod;

  @IsOptional()
  @Transform(upper)
  @IsIn(['SELLER', 'FRANCHISE'])
  nodeType?: 'SELLER' | 'FRANCHISE';
}
