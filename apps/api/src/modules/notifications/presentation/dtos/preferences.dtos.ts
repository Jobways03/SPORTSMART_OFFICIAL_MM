import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { NotificationChannel } from '@prisma/client';

/**
 * Phase 189 (#4) — one preference cell. `eventClass` is validated against
 * the canonical metadata in the controller (so the locked-class rule can be
 * applied); `channel` + `enabled` are typed here.
 */
export class PrefEntryDto {
  @IsString()
  @MaxLength(50)
  eventClass!: string;

  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;

  @IsBoolean()
  enabled!: boolean;
}

export class UpdatePreferencesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PrefEntryDto)
  entries!: PrefEntryDto[];
}

/**
 * Phase 189 (#10) — admin legal/compliance override. Mirrors the raw-dispatch
 * pattern: a bypass reason is mandatory and audited. Can force a locked class
 * back on (e.g. court-ordered notice) — never silently.
 */
export class AdminOverridePreferenceDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PrefEntryDto)
  entries!: PrefEntryDto[];

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  bypassReason!: string;

  /** COURT_ORDER | ADMIN | IMPORT — defaults to ADMIN. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  source?: string;
}
