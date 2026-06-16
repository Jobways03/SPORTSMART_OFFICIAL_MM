// Phase 243 (campaign-creation audit #1/#10/#11/#16) — typed, validated
// admin create/update bodies replacing `@Body() body: any`. With the global
// ValidationPipe (whitelist + forbidNonWhitelisted + transform) this both
// enforces every bound AND strips spoofable/dead fields (usedCount, the
// silently-dropped `customerIds`, a client-forced `status`) before they reach
// Prisma. Bounds that the service already re-checks (percentage 0-100) are
// duplicated here so a bad value fails fast with a precise 400.
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  DiscountType,
  DiscountMethod,
  DiscountValueType,
  DiscountAppliesTo,
  DiscountMinRequirement,
  BxgyGetDiscountType,
  DiscountFundingType,
  DiscountCommissionBasis,
  DiscountNature,
} from '@prisma/client';

// Codes are uppercased server-side; restrict to a safe character set so a
// pasted "ABC 123!@#" (which the customer can never type back at checkout, and
// which becomes an injection surface in CSV/PDF export) is rejected at the door.
const CODE_PATTERN = /^[A-Z0-9_-]{3,40}$/i;

export class CreateDiscountDto {
  @ValidateIf((o) => o.method !== 'AUTOMATIC')
  @IsOptional()
  @IsString()
  @Matches(CODE_PATTERN, {
    message: 'code may only contain letters, digits, - and _ (3-40 chars)',
  })
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  // Customer-facing marketing subline (distinct from internal title).
  @IsOptional()
  @IsString()
  @MaxLength(300)
  descriptionLong?: string;

  @IsEnum(DiscountType)
  type!: DiscountType;

  @IsOptional()
  @IsEnum(DiscountMethod)
  method?: DiscountMethod;

  @IsOptional()
  @IsEnum(DiscountValueType)
  valueType?: DiscountValueType;

  // PERCENTAGE in [0,100]; FIXED non-negative. Service re-checks against the
  // resolved valueType; this is the fast-fail upper bound (1e9 ≈ ₹10M flat).
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  value?: number;

  // "X% off up to ₹Y" ceiling, in paise. Only meaningful for PERCENTAGE.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000_000)
  maxDiscountAmountInPaise?: number;

  @IsOptional()
  @IsEnum(DiscountAppliesTo)
  appliesTo?: DiscountAppliesTo;

  // Legacy scalar eligibility ('ALL_CUSTOMERS' | 'SPECIFIC_CUSTOMERS'); now
  // actually persisted (#2). Rich rules go through eligibilityRules.
  @IsOptional()
  @IsString()
  @MaxLength(40)
  eligibility?: string;

  @IsOptional()
  @IsEnum(DiscountMinRequirement)
  minRequirement?: DiscountMinRequirement;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  minRequirementValue?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  maxUses?: number;

  @IsOptional()
  @IsBoolean()
  onePerCustomer?: boolean;

  @IsOptional()
  @IsBoolean()
  combineProduct?: boolean;

  @IsOptional()
  @IsBoolean()
  combineOrder?: boolean;

  @IsOptional()
  @IsBoolean()
  combineShipping?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  startsAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  endsAt?: string;

  // Only DRAFT is honored from the client (a "Save as draft", #18); every
  // other state is server-derived from the date window. Reject anything else.
  @IsOptional()
  @IsEnum({ DRAFT: 'DRAFT' } as Record<string, string>, {
    message: 'only DRAFT may be requested on create; other states are derived',
  })
  status?: 'DRAFT';

  // ── Product / collection scopes ──────────────────────────────────────────
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @IsUUID('4', { each: true })
  productIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  collectionIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @IsUUID('4', { each: true })
  buyProductIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @IsUUID('4', { each: true })
  getProductIds?: string[];

  // ── BUY_X_GET_Y ──────────────────────────────────────────────────────────
  @IsOptional()
  @IsString()
  @IsEnum({ MIN_QUANTITY: 'MIN_QUANTITY', MIN_AMOUNT: 'MIN_AMOUNT' } as Record<string, string>)
  buyType?: 'MIN_QUANTITY' | 'MIN_AMOUNT';

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  buyValue?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  buyItemsFrom?: string;

  // #10 — bound the free-unit count. A "buy-1-get-1000" typo gives away
  // 1000 units per redemption (capped only by cart stock).
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  getQuantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  getItemsFrom?: string;

  @IsOptional()
  @IsEnum(BxgyGetDiscountType)
  getDiscountType?: BxgyGetDiscountType;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  getDiscountValue?: number;

  // #11 — cap how many discounted pairs one order can trigger.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  maxUsesPerOrder?: number;

  // ── Funding (the *amounts* are finance-gated at the controller; the DTO
  // just type-checks). ───────────────────────────────────────────────────
  @IsOptional()
  @IsEnum(DiscountFundingType)
  fundingType?: DiscountFundingType;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  platformFundingPercent?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  sellerFundingPercent?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  brandFundingPercent?: number;

  // Phase 247-FB — franchise share + which franchise/brand bears the cost.
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  franchiseFundingPercent?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  franchiseId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  brandId?: string;

  @IsOptional()
  @IsEnum(DiscountCommissionBasis)
  commissionBasis?: DiscountCommissionBasis;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  fundingNotes?: string;

  @IsOptional()
  @IsEnum(DiscountNature)
  discountNature?: DiscountNature;

  // ── Affiliate link ───────────────────────────────────────────────────────
  @IsOptional()
  @IsUUID('4')
  affiliateId?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  affiliateCommissionPercent?: number;

  // ── Eligibility rules (rich, rule-table driven). Shape validated by the
  // eligibility service; bound the count here. ─────────────────────────────
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  eligibilityRules?: unknown[];
}
