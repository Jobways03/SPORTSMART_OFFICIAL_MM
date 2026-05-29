import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { DisputeKind } from '@prisma/client';

/**
 * Phase 110 (2026-05-25) — validation DTOs for the self-service dispute
 * endpoints (seller filing today; the customer path is now ticket→promote).
 * Replaces inline TypeScript interfaces so the global ValidationPipe actually
 * runs: `kind` is enum-checked, `summary` length-bounded, link IDs + caption
 * length-capped.
 */
export class FileDisputeDto {
  @IsEnum(DisputeKind)
  kind!: DisputeKind;

  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  summary!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  masterOrderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  subOrderId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  returnId?: string;
}

export class ReplyDisputeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}

export class AttachEvidenceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  fileId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;
}
