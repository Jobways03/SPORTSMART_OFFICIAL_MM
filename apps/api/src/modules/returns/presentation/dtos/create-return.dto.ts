import {
  ArrayMaxSize,
  ArrayMinSize,
  Equals,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { sanitizeOptionalText } from '../../../../core/util/sanitize-text';

const RETURN_REASON_CATEGORIES = [
  'DEFECTIVE',
  'WRONG_ITEM',
  'NOT_AS_DESCRIBED',
  'DAMAGED_IN_TRANSIT',
  'CHANGED_MIND',
  'SIZE_FIT_ISSUE',
  'QUALITY_ISSUE',
  'OTHER',
] as const;

export class CreateReturnItemDto {
  @IsNotEmpty()
  @IsUUID()
  orderItemId!: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsNotEmpty()
  @IsIn(RETURN_REASON_CATEGORIES as unknown as string[])
  reasonCategory!: string;

  // Phase 95 (2026-05-23) — Phase 93 deferred #22 closure. Defense-
  // in-depth HTML strip at the DTO boundary. Admin UI escapes at
  // render time, but a hostile payload sitting in the column is a
  // footgun for any future code path that logs/renders without
  // escaping (CSV exports, PDF generation, etc).
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => sanitizeOptionalText(value, { maxLength: 500 }))
  reasonDetail?: string;
}

export class CreateReturnDto {
  @IsNotEmpty()
  @IsUUID()
  subOrderId!: string;

  @IsArray()
  @ArrayMinSize(1)
  // Phase 93 (2026-05-23) — Gap #13/#21 array cap. A reasonable upper
  // bound stops a hostile client from sending 10k items in one POST.
  // 100 items is well above any real-world cart size.
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateReturnItemDto)
  items!: CreateReturnItemDto[];

  // Phase 95 (2026-05-23) — Phase 93 deferred #20 closure. See
  // reasonDetail above for rationale.
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  @Transform(({ value }) => sanitizeOptionalText(value, { maxLength: 1000 }))
  customerNotes?: string;

  // ── Fair-forfeit gate ─────────────────────────────────────────
  // If QC rejects the claim, the item is forfeited (not shipped back)
  // and no refund is issued. The customer must explicitly acknowledge
  // this risk at submission time — prevents surprise-forfeit complaints.
  @IsBoolean()
  @Equals(true, {
    message:
      'You must acknowledge the forfeit policy before submitting a return.',
  })
  forfeitConsent!: boolean;

  // Proof of the defect/issue the customer is claiming. The
  // *reason-based* requirement lives in ReturnService.createReturn:
  //   - DEFECTIVE / WRONG_ITEM / NOT_AS_DESCRIBED / DAMAGED_IN_TRANSIT
  //     / QUALITY_ISSUE → ≥1 photo required
  //   - CHANGED_MIND / SIZE_FIT_ISSUE → photos optional (the customer's
  //     word is enough; nothing visually to prove)
  // The DTO accepts an empty array so the service-level conditional
  // enforcement actually gets a chance to run. Sending nothing is
  // still allowed (defaults to []).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  // Phase 93 (2026-05-23) — Gap #5/#24. Format validation runs at the
  // DTO boundary; allowlist validation lives in the service so the
  // env-driven allowlist (media cloud name) can shift without
  // re-deploying the DTO.
  @MaxLength(2048, { each: true })
  // Phase 199 (2026-06-02) — Returns audit #7. DTO-level https format
  // check as defence-in-depth on top of the service's validateEvidenceUrls
  // (which carries the authoritative R2-derived host allowlist + the SSRF /
  // metadata-host guards). require_protocol + require_tld reject
  // bare/relative strings; the host allowlist is enforced service-side
  // because the trusted media host is env-derived (R2_PUBLIC_BASE_URL).
  @IsUrl(
    {
      protocols: ['https'],
      require_protocol: true,
      require_tld: true,
    },
    { each: true },
  )
  evidenceFileUrls?: string[];
}
