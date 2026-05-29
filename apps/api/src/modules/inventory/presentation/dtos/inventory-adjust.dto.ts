import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  NotEquals,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { StockMovementKind } from '@prisma/client';

/**
 * Phase 53 (2026-05-21) — class-validator DTOs for the seller +
 * admin stock-adjust endpoints. Pre-Phase-53 the seller controller
 * used inline TS interfaces with no reason field and no validation
 * (audit Gaps #1 / #2).
 */

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const ADJUST_REASON_MIN = 3;
export const ADJUST_REASON_MAX = 500;

// Phase 53 — admin-only kinds that the admin endpoint accepts. The
// seller path is hardcoded to MANUAL_ADJUST since sellers shouldn't
// be flipping kind themselves (a seller writing "WRITE_OFF" without
// admin signoff defeats the dual-tier permission).
export const ADMIN_ADJUST_KINDS = [
  StockMovementKind.MANUAL_ADJUST,
  StockMovementKind.WRITE_OFF,
  StockMovementKind.RESTOCKED,
  StockMovementKind.AUDIT_CORRECTION,
  StockMovementKind.DAMAGE,
  StockMovementKind.LOSS,
] as const;
export type AdminAdjustKind = (typeof ADMIN_ADJUST_KINDS)[number];

export class AdjustStockDto {
  @IsInt({ message: 'adjustment must be an integer' })
  @NotEquals(0, { message: 'adjustment must be non-zero' })
  adjustment!: number;

  @IsString()
  @Transform(trim)
  @MinLength(ADJUST_REASON_MIN, {
    message: `reason must be at least ${ADJUST_REASON_MIN} characters`,
  })
  @MaxLength(ADJUST_REASON_MAX, {
    message: `reason must not exceed ${ADJUST_REASON_MAX} characters`,
  })
  reason!: string;
}

export class StockImportRowDto {
  @IsString()
  @Transform(trim)
  @MinLength(1)
  @MaxLength(64)
  masterSku!: string;

  @IsInt()
  @Min(0)
  stockQty!: number;
}

export class StockImportDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'items array must not be empty' })
  @ArrayMaxSize(500, { message: 'Maximum 500 items per import' })
  @ValidateNested({ each: true })
  @Type(() => StockImportRowDto)
  items!: StockImportRowDto[];

  // Phase 53 — bulk imports also require a reason. Same forensic
  // requirement as the single-adjust path.
  @IsString()
  @Transform(trim)
  @MinLength(ADJUST_REASON_MIN)
  @MaxLength(ADJUST_REASON_MAX)
  reason!: string;
}

/**
 * Phase 53 — admin adjust DTO. Same shape as the seller DTO plus
 * optional `kind` selector (defaults to MANUAL_ADJUST). The WRITE_OFF
 * kind requires the higher-tier 'inventory.adjust.write_off'
 * permission — enforced in the controller, not here.
 */
export class AdminAdjustStockDto {
  @IsUUID(undefined, { message: 'mappingId must be a UUID' })
  mappingId!: string;

  @IsInt()
  @NotEquals(0)
  adjustment!: number;

  @IsString()
  @Transform(trim)
  @MinLength(ADJUST_REASON_MIN)
  @MaxLength(ADJUST_REASON_MAX)
  reason!: string;

  @IsOptional()
  @IsEnum(StockMovementKind, {
    message: `kind must be one of ${ADMIN_ADJUST_KINDS.join(', ')}`,
  })
  kind?: AdminAdjustKind;
}
