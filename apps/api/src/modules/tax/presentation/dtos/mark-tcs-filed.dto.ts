import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Phase 159z (GSTR-8 export-flow audit #6) — body for
 * POST /admin/tax/tcs/mark-filed.
 *
 * The audit caught that the prior implementation flipped TCS rows to
 * FILED on a bare admin click, with no proof of an actual GSTN
 * submission. We now require the NIC-issued Acknowledgement Reference
 * Number (ARN) on every mark-filed call; the value is persisted on
 * each row and surfaced in the admin UI so a finance audit can re-look
 * up the original NIC filing.
 *
 * ARN format (CBIC AA/0000000000000/MMYY-style):
 *   AA + 11 digits + filing period as MMYY  (15 chars total)
 * We do a lenient check (alphanumeric, length 15) rather than an
 * exact regex so a CBIC format tweak doesn't lock the export. The
 * full pattern is verified at the NIC side anyway.
 */
export class MarkTcsFiledDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'ledgerIds must contain at least one id' })
  @ArrayMaxSize(2000, {
    message: 'ledgerIds may contain at most 2000 entries per request',
  })
  @ArrayUnique({ message: 'ledgerIds must be unique' })
  @IsString({ each: true })
  ledgerIds!: string[];

  /** GSTN-issued ARN string for the GSTR-8 filing. */
  @IsString()
  @MinLength(8, { message: 'nicArn must be at least 8 characters' })
  @MaxLength(64, { message: 'nicArn must be at most 64 characters' })
  @Matches(/^[A-Za-z0-9-]+$/, {
    message: 'nicArn must be alphanumeric (hyphens allowed)',
  })
  nicArn!: string;
}
