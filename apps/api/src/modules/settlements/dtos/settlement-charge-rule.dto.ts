import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

export const CHARGE_RULE_BASE_TYPES = [
  'PRICE_OF_GOODS_SOLD',
  'COMMISSION',
  'RULE',
] as const;
export type ChargeRuleBaseType = (typeof CHARGE_RULE_BASE_TYPES)[number];

export class CreateSettlementChargeRuleDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  /** Rate in basis points (1% = 100). Non-negative. */
  @IsInt()
  @Min(0)
  rateBps!: number;

  @IsIn(CHARGE_RULE_BASE_TYPES as unknown as string[])
  baseType!: ChargeRuleBaseType;

  /** Required only when baseType = RULE — the rule this one is levied on. */
  @IsOptional()
  @IsString()
  baseRuleId?: string;
}

export class SetChargeRuleStatusDto {
  /** true → ACTIVE (applied to new cycles), false → INACTIVE (skipped). */
  @IsBoolean()
  active!: boolean;
}
