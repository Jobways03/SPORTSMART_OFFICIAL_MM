import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Phase 207 (#8 / #18) — query DTOs for the admin access-log /
 * brute-force surface (AdminAccessLogController).
 *
 * Pre-Phase-207 every endpoint did `parseInt(hours, 10)` / `parseInt(limit,
 * 10)` with no guard, so `?hours=abc` produced NaN and reached the service
 * (and then Prisma) as `NaN` — a runtime error or, depending on the path, a
 * window of `since = Invalid Date`. actorType / kind were `.toUpperCase()`-d
 * and cast straight to the Prisma enum with no membership check, so a bogus
 * value reached Postgres as an invalid enum literal and 500'd instead of
 * 400'ing. These DTOs coerce + bound the numbers and constrain the enum-ish
 * strings to a known set. The global ValidationPipe runs whitelist +
 * forbidNonWhitelisted, so unexpected query keys are rejected too.
 *
 * NOTE: the service still applies its own Math.min/Math.max clamps as a
 * defence-in-depth backstop — the DTO bounds and the service bounds are
 * intentionally redundant.
 */

// The five polymorphic actor types (AccessActorType enum). Kept as a
// literal list here so a bad value 400s at the edge instead of reaching
// Prisma as an invalid enum cast.
const ACTOR_TYPES = ['CUSTOMER', 'ADMIN', 'SELLER', 'FRANCHISE', 'AFFILIATE'];

// AccessEventKind enum values (Phase 207 added the MFA/OTP verify kinds).
const EVENT_KINDS = [
  'LOGIN_SUCCESS',
  'LOGIN_FAILURE',
  'LOGOUT',
  'LOGOUT_ALL_DEVICES',
  'TOKEN_REFRESH',
  'PASSWORD_RESET',
  'NEW_DEVICE_DETECTED',
  'MFA_VERIFY_SUCCESS',
  'MFA_VERIFY_FAILED',
  'OTP_VERIFY_SUCCESS',
  'OTP_VERIFY_FAILED',
];

export class FailedLoginSpikeQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'hours must be an integer' })
  @Min(1, { message: 'hours must be at least 1' })
  @Max(24 * 7, { message: 'hours cannot exceed 168 (7 days)' })
  hours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'minFailures must be an integer' })
  @Min(2, { message: 'minFailures must be at least 2' })
  @Max(10_000, { message: 'minFailures cannot exceed 10000' })
  minFailures?: number;
}

export class RecentFailuresQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(ACTOR_TYPES, {
    message: `actorType must be one of: ${ACTOR_TYPES.join(', ')}`,
  })
  actorType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'hours must be an integer' })
  @Min(1)
  @Max(24 * 30)
  hours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1)
  @Max(200)
  limit?: number;
}

export class RecentActorsQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(ACTOR_TYPES, {
    message: `actorType must be one of: ${ACTOR_TYPES.join(', ')}`,
  })
  actorType?: string;

  @IsOptional()
  @IsString()
  actorRole?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 30)
  hours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class ListByRoleQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(ACTOR_TYPES, {
    message: `actorType must be one of: ${ACTOR_TYPES.join(', ')}`,
  })
  actorType?: string;

  @IsOptional()
  @IsString()
  @IsIn(EVENT_KINDS, {
    message: `kind must be one of: ${EVENT_KINDS.join(', ')}`,
  })
  kind?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 30)
  hours?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class ListForActorQueryDto {
  @IsOptional()
  @IsString()
  @IsIn(EVENT_KINDS, {
    message: `kind must be one of: ${EVENT_KINDS.join(', ')}`,
  })
  kind?: string;

  @IsOptional()
  @IsString()
  fromDate?: string;

  @IsOptional()
  @IsString()
  toDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
