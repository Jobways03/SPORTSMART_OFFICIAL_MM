import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// Phase 94 (2026-05-23) — Seller/Franchise Return Response audit Gap #10/#11/#12.
//
// Pre-Phase-94 the controller body was an inline `{ decision; notes?;
// evidenceFileUrls? }` shape with no length cap on notes, no @MaxLength
// per-URL, and no @ArrayMaxSize on the array. A hostile seller could
// post a 100MB notes string OR thousands of evidence URLs in one call.
// This DTO closes those vectors and lets the global ValidationPipe
// reject malformed bodies before they reach the service.
export const SELLER_RESPOND_DECISIONS = ['ACCEPTED', 'CONTESTED'] as const;

// Phase 95 (2026-05-23) — Phase 94 deferred #20 closure. Per-item
// seller decision so a multi-item return can flip-flop per row.
export class SellerRespondItemDto {
  @IsUUID()
  returnItemId!: string;

  @IsIn(SELLER_RESPOND_DECISIONS as unknown as string[])
  decision!: 'ACCEPTED' | 'CONTESTED';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

// Phase 95 — Phase 94 deferred — structured contest reason category.
export const SELLER_CONTEST_REASON_CATEGORIES = [
  'INSUFFICIENT_EVIDENCE',
  'WRONG_ITEM_NOT_OURS',
  'CUSTOMER_DAMAGE',
  'OUT_OF_RETURN_WINDOW',
  'USED_BEYOND_NORMAL',
  'ALREADY_REPLACED',
  'COURIER_FAULT',
  'OTHER',
] as const;
export type SellerContestReasonCategory =
  (typeof SELLER_CONTEST_REASON_CATEGORIES)[number];

export class SellerRespondDto {
  @IsIn(SELLER_RESPOND_DECISIONS as unknown as string[], {
    message: 'decision must be ACCEPTED or CONTESTED',
  })
  decision!: 'ACCEPTED' | 'CONTESTED';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  // Phase 95 (2026-05-23) — structured contest reason for analytics
  // + admin dashboards. Free-text notes still allowed; this is the
  // structured signal that drives "top contest reasons" reports.
  @IsOptional()
  @IsIn(SELLER_CONTEST_REASON_CATEGORIES as unknown as string[])
  contestReasonCategory?: SellerContestReasonCategory;

  // Phase 95 — Phase 94 deferred #20 partial-cart support. When
  // present, each entry overrides the top-level decision for the
  // referenced returnItemId. The rollup logic (any CONTESTED →
  // top-level CONTESTED) lives in the service so admin/email
  // handlers don't need item-level awareness.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SellerRespondItemDto)
  itemDecisions?: SellerRespondItemDto[];

  // Phase 94 — Gap #12 evidence array cap + per-URL length cap. The
  // host-allowlist + format check live in the service so the env-driven
  // allowlist (Cloudinary cloud name) can shift without redeploying
  // this DTO.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(2048, { each: true })
  evidenceFileUrls?: string[];
}
