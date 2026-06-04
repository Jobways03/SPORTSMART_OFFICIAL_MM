import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * Phase 168 (COD Mark-Paid audit #12/#18) — body for the COD cash-collection
 * mark-paid endpoint.
 *
 * `collectedAmountInPaise` is a DIGIT STRING, not a JS number: a master-order
 * total can exceed Number.MAX_SAFE_INTEGER on bulk B2B COD, and the DB column is
 * BigInt. The controller converts it to BigInt before handing to the service.
 * Optional — when omitted the service defaults to the full payable (the UI's
 * "collected full amount" affordance).
 *
 * `collectionReference` (cash receipt # / courier COD remittance ref) is charset
 * -guarded (#18) so admin input can't carry an XSS/formula-injection payload
 * into the order-detail page or a CSV export.
 */
export class MarkCodPaidDto {
  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{1,15}$/, {
    message: 'collectedAmountInPaise must be a non-negative integer (paise) as a string',
  })
  collectedAmountInPaise?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^[A-Za-z0-9\-/.: ]+$/, {
    message:
      'collectionReference may only contain letters, digits, space, and - / . :',
  })
  collectionReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  // Required by the service ONLY when the collected amount differs from the
  // payable; validated there (not here) so the cross-field rule lives next to
  // the money logic.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  varianceReason?: string;
}
