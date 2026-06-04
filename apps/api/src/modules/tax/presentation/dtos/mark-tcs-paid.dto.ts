import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Phase 159z (GSTR-8 audit — sibling to MarkTcsFiledDto). The previous
 * controller had an ad-hoc presence check; this DTO adds bounds and a
 * uniqueness guard on the id list so a flood-payload can't blow up the
 * service. paymentReference (UTR / NEFT / RTGS / CIN challan handle) is
 * mandatory and capped so admin-typed slop doesn't bloat the row.
 */
export class MarkTcsPaidDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'ledgerIds must contain at least one id' })
  @ArrayMaxSize(2000, {
    message: 'ledgerIds may contain at most 2000 entries per request',
  })
  @ArrayUnique({ message: 'ledgerIds must be unique' })
  @IsString({ each: true })
  ledgerIds!: string[];

  /**
   * Phase 160 (§52 lifecycle audit #15) — a government remittance
   * reference (CIN: 17 digits, or a NEFT/RTGS UTR: typically 16–22
   * alphanumeric) ALWAYS contains digits. The prior length-only check
   * accepted "garbage". Now: 8–40 chars, alphanumeric + `/` `-`, and at
   * least one digit. This rejects free-text slop while staying lenient
   * across CIN / UTR / challan formats (the exact shape is verified at
   * the bank/NIC side anyway).
   */
  @IsString()
  @MinLength(8, { message: 'paymentReference must be at least 8 characters' })
  // MaxLength matches the regex upper bound (40) so the two bounds don't
  // contradict — a CIN is 17 digits, a NEFT/RTGS UTR ≤22, so 40 is ample.
  @MaxLength(40, { message: 'paymentReference must be at most 40 characters' })
  @Matches(/^(?=.*\d)[A-Za-z0-9/-]{8,40}$/, {
    message:
      'paymentReference must be a plausible CIN / UTR / challan reference ' +
      '(8–40 chars, alphanumeric with / or -, containing at least one digit)',
  })
  paymentReference!: string;

  /**
   * Phase 160 (§52 lifecycle audit #11) — optional file_metadata id of the
   * uploaded bank challan / proof-of-payment PDF. When present it's
   * persisted on the ledger so a CBIC audit can pull the challan, not
   * just the reference string.
   */
  @IsOptional()
  @IsString()
  @MaxLength(64, { message: 'paymentProofFileId must be at most 64 characters' })
  paymentProofFileId?: string;
}
