// Phase 243 (#6/#7) — dedicated status-transition body for the FSM endpoint.
// Only operator-driven states are settable here (ACTIVE/PAUSED/ARCHIVED/DRAFT);
// SCHEDULED/EXPIRED are date-derived and never set by hand, and
// SUSPENDED_FOR_ABUSE is reached only via the abuse-action endpoint (#245).
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export const SETTABLE_DISCOUNT_STATUSES = [
  'ACTIVE',
  'PAUSED',
  'ARCHIVED',
  'DRAFT',
] as const;
export type SettableDiscountStatus = (typeof SETTABLE_DISCOUNT_STATUSES)[number];

export class SetDiscountStatusDto {
  @IsEnum(
    SETTABLE_DISCOUNT_STATUSES.reduce(
      (acc, s) => ({ ...acc, [s]: s }),
      {} as Record<string, string>,
    ),
    { message: `status must be one of: ${SETTABLE_DISCOUNT_STATUSES.join(', ')}` },
  )
  status!: SettableDiscountStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
