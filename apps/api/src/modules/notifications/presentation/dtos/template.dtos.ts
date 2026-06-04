import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
// Value import (not `import type`) — @IsEnum needs the runtime enum object.
import { AdminDispatchAlertType, NotificationChannel } from '@prisma/client';

/**
 * Phase 185 (#3) — class-validator DTOs for the admin notification surface.
 *
 * These were previously plain TS interfaces, so the global ValidationPipe
 * (whitelist + forbidNonWhitelisted) was a no-op against them: an admin
 * could POST a 10 MB body, a garbage channel, or arbitrary extra fields.
 * As classes the global pipe now enforces type, length, enum and strips
 * unknown properties.
 */
export class UpsertTemplateDto {
  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  subject?: string;

  @IsString()
  @MinLength(1)
  // 100k chars is generous for a styled HTML email shell while still
  // blocking DB-bloat / DoS via a multi-MB body.
  @MaxLength(100_000)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  // Phase 185 (#4) — DLT registration ids (SMS).
  @IsOptional()
  @IsString()
  @MaxLength(120)
  dltTemplateId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  dltHeaderId?: string;

  // Phase 185 (#6) — declared expected vars, e.g. { required: [...] }.
  @IsOptional()
  @IsObject()
  variablesSchema?: Record<string, unknown>;

  // Phase 185 (#14) — strip internal payload fields at render (default on).
  @IsOptional()
  @IsBoolean()
  customerVisibleOnly?: boolean;
}

export class ToggleActiveDto {
  @IsBoolean()
  active!: boolean;
}

export class PreviewTemplateDto {
  // Phase 185 (#15) — bound the preview payload; the renderer HTML-escapes
  // every substituted value, so XSS can't enter via these.
  @IsOptional()
  @IsObject()
  vars?: Record<string, unknown>;
}

export class TestSendDto {
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  to!: string;

  @IsOptional()
  @IsObject()
  vars?: Record<string, unknown>;
}

export class CancelLogDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/**
 * Phase 187 (#5) — dedicated TEMPLATE-path dispatch DTO. The template path
 * respects customer opt-out, so it does NOT carry bypass fields. `eventClass`
 * is validated against the registered classes in the service (#12) so a
 * dispatch can't silently dodge opt-out via an unknown class.
 */
export class TemplateDispatchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  templateKey!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  recipientId!: string;

  @IsOptional()
  @IsObject()
  vars?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  eventClass?: string;

  // #8 — body-level idempotency key (defence-in-depth alongside @Idempotent).
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey?: string;
}

/**
 * Phase 187 (#4/#5/#11/#14/#17) — dedicated RAW-path dispatch DTO. The raw
 * path bypasses opt-out, so it REQUIRES an alertType + a bypassReason and an
 * explicit `confirmed` flag. Marketing has no alertType → can't be sent raw.
 */
export class RawDispatchDto {
  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  recipientId?: string;

  // Validated as email/phone in the service (#17), after channel is known.
  @IsOptional()
  @IsString()
  @MaxLength(254)
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  subject?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  body!: string;

  @IsEnum(AdminDispatchAlertType)
  alertType!: AdminDispatchAlertType;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  bypassReason!: string;

  // #14 — backend confirmation gate (a direct API call can't skip the modal).
  @IsBoolean()
  confirmed!: boolean;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey?: string;
}

/** Phase 185 (#3) — legacy combined dispatch DTO (deprecated; see service). */
export class DispatchDto {
  // Template path
  @IsOptional()
  @IsString()
  @MaxLength(200)
  templateKey?: string;

  @IsOptional()
  @IsObject()
  vars?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  eventClass?: string;

  // Raw path
  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100_000)
  body?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  eventType?: string;

  // Shared
  @IsOptional()
  @IsString()
  @MaxLength(64)
  recipientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(254)
  to?: string;
}
